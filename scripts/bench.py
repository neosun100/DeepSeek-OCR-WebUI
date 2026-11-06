"""吞吐 / 延迟 / 质量基准：打一个运行中的服务。

    uv run python scripts/bench.py --base http://127.0.0.1:8001 --concurrency 1,4,8 --out bench.json

页集 = 仓库样本图 + 样本 PDF 栅格化页 + 合成已知文字页（有真值 ⇒ 算字符召回）。
测量串行独占：一次只跑一个并发档；每档先丢弃 warmup 轮（首请求的 CUDA kernel 编译不进数字）。
输出 JSON 含每页原文，供跨引擎比对（--compare a.json b.json）。
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import statistics
import sys
import time
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "server"))
from deepseek_ocr_webui.documents import plan_pdf, rasterize_pdf  # noqa: E402
from deepseek_ocr_webui.judges import content_chars, strip_layout  # noqa: E402
from deepseek_ocr_webui.service import char_recall, render_text_image  # noqa: E402

SAMPLES = ROOT / "frontend" / "tests" / "e2e" / "samples"

KNOWN = [
    "Invoice No. 2026-11-07 Total amount due: 1,284.50 USD. Payment within 30 days.",
    "深度求索 OCR 第二代模型在文档解析任务上进行验证，本页为合成测试页面。",
    "Quarterly revenue grew 12.4% year over year while operating margin reached 31.7%.",
    "日本語のテキストも認識できるか確認するためのテストページです。2026年11月。",
]


def page_set() -> list[tuple[str, bytes, str | None]]:
    """(名字, PNG 字节, 真值或 None)"""
    out: list[tuple[str, bytes, str | None]] = []

    def png(im: Image.Image) -> bytes:
        b = io.BytesIO()
        im.save(b, format="PNG")
        return b.getvalue()

    for name in ("sample.png", "sample2.png", "sample3.png", "sample.jpeg", "sample1.jpg"):
        p = SAMPLES / name
        if p.exists():
            out.append((name, png(Image.open(p).convert("RGB")), None))
    for name in ("sample1.pdf", "sample2.pdf"):
        p = SAMPLES / name
        if p.exists():
            data = p.read_bytes()
            plan = plan_pdf(
                data,
                pages="1-2" if plan_pdf(data, pages=None, max_pages=999).page_count >= 2 else None,
                max_pages=999,
            )
            for i, im in rasterize_pdf(data, plan.pages):
                out.append((f"{name}#p{i + 1}", png(im), None))
    for i, text in enumerate(KNOWN):
        out.append((f"known{i}", png(render_text_image(text, width=1600, height=200)), text))
    return out


async def one(c: httpx.AsyncClient, name: str, data: bytes, mode: str) -> dict:
    t0 = time.monotonic()
    r = await c.post(
        "/api/ocr", files={"file": (f"{name}.png", data, "image/png")}, data={"prompt_type": mode}
    )
    dt = time.monotonic() - t0
    if r.status_code != 200:
        return {"name": name, "status": r.status_code, "latency_s": dt, "error": r.text[:300]}
    b = r.json()
    return {
        "name": name,
        "status": 200,
        "latency_s": round(dt, 3),
        "ok": b["ok"],
        "warnings": [w["code"] for w in b["warnings"]],
        "finish_reason": b["finish_reason"],
        "tokens": b["metadata"]["tokens"]["completion"],
        "vram_peak_mib": b["metadata"]["timing"].get("vram_peak_mib"),
        "raw_text": b["raw_text"],
        "text": b["text"],
    }


async def run_level(base: str, pages, conc: int, mode: str, rounds: int) -> dict:
    sem = asyncio.Semaphore(conc)
    async with httpx.AsyncClient(base_url=base, timeout=1800) as c:

        async def guarded(item):
            async with sem:
                return await one(c, item[0], item[1], mode)

        # warmup：每张图一次，不计数
        await asyncio.gather(*(guarded(p) for p in pages[: max(1, conc)]))
        work = [p for _ in range(rounds) for p in pages]
        t0 = time.monotonic()
        results = await asyncio.gather(*(guarded(p) for p in work))
        wall = time.monotonic() - t0
    lat = [r["latency_s"] for r in results if r["status"] == 200]
    toks = sum(r.get("tokens") or 0 for r in results if r["status"] == 200)
    truth = {p[0]: p[2] for p in pages}
    recalls = [
        char_recall(truth[r["name"]], r["text"])
        for r in results
        if r["status"] == 200 and truth.get(r["name"])
    ]
    return {
        "concurrency": conc,
        "requests": len(work),
        "errors": sum(1 for r in results if r["status"] != 200),
        "wall_s": round(wall, 2),
        "pages_per_min": round(len(lat) / wall * 60, 2),
        "tokens_per_s": round(toks / wall, 1),
        "latency_p50_s": round(statistics.median(lat), 2) if lat else None,
        "latency_p95_s": round(sorted(lat)[int(0.95 * (len(lat) - 1))], 2) if lat else None,
        "known_text_recall_min": round(min(recalls), 3) if recalls else None,
        "known_text_recall_mean": round(statistics.mean(recalls), 3) if recalls else None,
        "warning_counts": _count([w for r in results for w in r.get("warnings", [])]),
        "vram_peak_mib": max((r.get("vram_peak_mib") or 0) for r in results) or None,
        "pages": results[: len(pages)],  # 一轮的原文，供跨引擎比对
    }


def _count(xs: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return out


def compare(a_path: str, b_path: str) -> dict:
    """两个引擎在同一页集上的输出一致性：以 A 的内容字为「真值」算 B 的召回（反之亦然）。"""
    a = {p["name"]: p for p in json.loads(Path(a_path).read_text())["levels"][0]["pages"]}
    b = {p["name"]: p for p in json.loads(Path(b_path).read_text())["levels"][0]["pages"]}
    rows = []
    for name in sorted(set(a) & set(b)):
        ta, tb = strip_layout(a[name].get("raw_text", "")), strip_layout(b[name].get("raw_text", ""))
        rows.append({
            "name": name,
            "chars_a": content_chars(ta), "chars_b": content_chars(tb),
            "recall_b_vs_a": round(char_recall(ta, tb), 3), "recall_a_vs_b": round(char_recall(tb, ta), 3),
        })  # fmt: skip
    agree = [min(r["recall_b_vs_a"], r["recall_a_vs_b"]) for r in rows if r["chars_a"] > 20]
    return {"pages": rows, "min_agreement": min(agree) if agree else None,
            "mean_agreement": round(statistics.mean(agree), 3) if agree else None}  # fmt: skip


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8001")
    ap.add_argument("--concurrency", default="1,4,8")
    ap.add_argument("--mode", default="document")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--out", default="bench.json")
    ap.add_argument("--compare", nargs=2, metavar=("A", "B"))
    args = ap.parse_args()
    if args.compare:
        print(json.dumps(compare(*args.compare), ensure_ascii=False, indent=2))
        return 0
    pages = page_set()
    health = httpx.get(f"{args.base}/health", timeout=30).json()
    levels = []
    for conc in (int(x) for x in args.concurrency.split(",")):
        lv = asyncio.run(run_level(args.base, pages, conc, args.mode, args.rounds))
        print(json.dumps({k: v for k, v in lv.items() if k != "pages"}, ensure_ascii=False), flush=True)
        levels.append(lv)
    Path(args.out).write_text(json.dumps({"engine": health.get("engine"), "pages": len(pages), "levels": levels},
                                         ensure_ascii=False, indent=2))  # fmt: skip
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
