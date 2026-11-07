"""README 徽章生成器：数字从**真实运行**的报告里现算，绝不手写（代理量会骗人：list 数 ≠ 实跑通过数）。

    # 1) 先跑测试并留报告
    uv run pytest -q tests/unit tests/regression --junitxml=.runs/pytest.xml
    (cd frontend && npx vitest run --reporter=json --outputFile=../.runs/vitest.json)
    (cd frontend && npx playwright test --project=chromium --reporter=json > ../.runs/playwright.json)
    uv run python ~/.claude/skills/touchstone/tools/mutate.py tests/mutations.ini --cmd "…" > .runs/mutate.log
    # 2) 生成 / 校验
    uv run python scripts/badges.py            # 写 docs/assets/badges/*.svg
    uv run python scripts/badges.py --check    # 与提交版不一致 ⇒ exit 1

缺某份报告 ⇒ 那枚徽章不生成并打印「未生成（缺报告）」—— 不是通过，也不沿用旧数字。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import tomllib

ROOT = Path(__file__).resolve().parents[1]
RUNS = ROOT / ".runs"
OUT = ROOT / "docs" / "assets" / "badges"


# 每个字符的近似宽度（Verdana 11px，与 shields.io 同口径的粗估）；CJK 按 2 倍
def _w(s: str) -> int:
    return sum(14 if ord(c) > 0x2E80 else 7 for c in s) + 10


def svg(label: str, value: str, color: str) -> str:
    lw, vw = _w(label), _w(value)
    total = lw + vw
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="20" role="img" aria-label="{label}: {value}">'
        f"<title>{label}: {value}</title>"
        f'<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/>'
        f'<stop offset="1" stop-opacity=".1"/></linearGradient>'
        f'<clipPath id="r"><rect width="{total}" height="20" rx="3" fill="#fff"/></clipPath>'
        f'<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="#555"/>'
        f'<rect x="{lw}" width="{vw}" height="20" fill="{color}"/><rect width="{total}" height="20" fill="url(#s)"/></g>'
        f'<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="{lw / 2}" y="14">{label}</text><text x="{lw + vw / 2}" y="14">{value}</text></g></svg>\n'
    )


def version() -> str:
    return tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["version"]


def pytest_passed(p: Path) -> int | None:
    if not p.is_file():
        return None
    r = ET.parse(p).getroot()  # noqa: S314 —— 只读本地 pytest 自己生成的 junit 报告，不是外部输入
    suites = [r] if r.tag == "testsuite" else list(r)
    tests = sum(int(s.get("tests", 0)) for s in suites)
    bad = sum(int(s.get(k, 0)) for s in suites for k in ("failures", "errors"))
    skipped = sum(int(s.get("skipped", 0)) for s in suites)
    return tests - bad - skipped if bad == 0 else -1  # 有失败 ⇒ -1（徽章变红，不报好看的数）


def vitest_passed(p: Path) -> int | None:
    if not p.is_file():
        return None
    d = json.loads(p.read_text())
    return d["numPassedTests"] if d.get("numFailedTests", 0) == 0 else -1


def playwright_passed(p: Path) -> int | None:
    if not p.is_file():
        return None
    s = json.loads(p.read_text())["stats"]
    return s["expected"] if s.get("unexpected", 0) == 0 else -1


def mutation_red(p: Path) -> tuple[int, int] | None:
    if not p.is_file():
        return None
    m = re.search(r"(\d+) 条变异：(\d+) 变红", p.read_text())
    return (int(m.group(2)), int(m.group(1))) if m else None


def build() -> dict[str, str]:
    out: dict[str, str] = {"version": svg("version", f"v{version()}", "#18a058"),
                           "license": svg("license", "MIT", "#007ec6"),
                           "python": svg("python", "3.10–3.13", "#3776ab"),
                           "platforms": svg("runs on", "CUDA · Apple MPS · CPU", "#6f42c1"),
                           "model": svg("model", "DeepSeek-OCR-2", "#4d6bfe")}  # fmt: skip

    def count(name: str, label: str, n: int | None) -> None:
        if n is None:
            print(f"  ⊘ {name}: 未生成（缺报告）")
        elif n < 0:
            out[name] = svg(label, "failing", "#e05d44")
        else:
            out[name] = svg(label, f"{n} passed", "#44cc11")

    count("backend-tests", "backend tests", pytest_passed(RUNS / "pytest.xml"))
    count("frontend-tests", "frontend tests", vitest_passed(RUNS / "vitest.json"))
    count("e2e", "e2e (chromium)", playwright_passed(RUNS / "playwright.json"))
    mr = mutation_red(RUNS / "mutate.log")
    if mr is None:
        print("  ⊘ mutation: 未生成（缺报告）")
    else:
        red, total = mr
        out["mutation"] = svg("mutants killed", f"{red}/{total}", "#44cc11" if red == total else "#e05d44")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    badges = build()
    if a.check:
        stale = [
            n
            for n, s in badges.items()
            if not (OUT / f"{n}.svg").is_file() or (OUT / f"{n}.svg").read_text() != s
        ]
        if stale:
            print(f"🔴 徽章与提交版不一致：{stale}（重跑测试后执行 scripts/badges.py）")
            return 1
        print(f"✓ {len(badges)} 枚徽章与提交版一致")
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for n, s in badges.items():
        (OUT / f"{n}.svg").write_text(s)
        print(f"  ✓ {n}.svg")
    return 0


if __name__ == "__main__":
    sys.exit(main())
