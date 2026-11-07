"""每页产物判据（纯函数，零依赖）—— 移植自 aws-gpu `lib/ocr/judges.py`（canonical，2026-11-06）。

为什么需要：HTTP 200 只证明服务活着。模型会「生成了但是废的」：尾部逐字复读到 8192 token、
坐标停不下来（`[23,268,268,268…`）、空白输出。这些都必须单列成 warning 交给调用方，而不是混进「成功」。

⚠️ 阈值来源：Unlimited-OCR（以 DeepSeek-OCR 为底座）的 272 条原始输出定标。DeepSeek-OCR-2 上的复核
见 `tests/e2e` 与 `docs/BENCHMARKS.md`；改阈值必须同时改那里的定标记录。
"""

from __future__ import annotations

import re
import unicodedata
import zlib
from dataclasses import dataclass, field

# DeepSeek-OCR 的版面标签：<|ref|>label<|/ref|><|det|>[[x1,y1,x2,y2]]<|/det|>
_TAGS = re.compile(r"<\|/?[A-Za-z_]+\|>")
_BBOX = re.compile(r"\[([0-9,\s\[\]]*)\]")
_INNER_BOX = re.compile(r"\[([0-9,\s]*)\]")
_REPEAT_NUM = re.compile(r"\b(\d{1,4})\b(?:\s*,\s*\1\b){5,}")
_NUM = re.compile(r"\d+")


class JudgeLimits:
    LOOP_MIN_EXTENT = 1000  # 复读区 ≥ 这么多字符才算复读（干净页定标为 0，复读侧最小 3397）
    LOOP_TAIL_CHARS = 3000  # 只看尾部（复读总在尾部；全文扫是 O(n²)）
    LOOP_MAX_PERIOD = 400  # 最长周期（一整行空 <td> ≈ 333）
    LOOP_MATCH_MIN = 0.97  # 近似周期：容忍偶尔错一个字
    LOOP_ZRATIO_MAX = 0.05  # 压缩比检测「被扰动的复读」；干净页合法最小 0.110 ⇒ 2× 余量
    LOOP_ZRATIO_MIN_CHARS = 1500
    # 原文（不做数字归一）压缩比上限：纯数字合法表格归一后压缩比极低（0.018），但原文因数字不规则 ≥ 0.18；
    # 真复读被扰动后原文仍高度可压缩。0.10 = 归一线 0.05 的 2 倍。⚠️ 预防性阈值：未经 DeepSeek-OCR-2 语料定标
    LOOP_RAW_ZRATIO_MAX = 0.10
    BBOX_MAX_NUMS = 4


def strip_layout(raw: str) -> str:
    """去掉 ref/det 标签与坐标，只留内容文本（判据计数用，不是 Markdown 转换）。"""
    return _BBOX.sub(" ", _TAGS.sub(" ", raw or ""))


def content_chars(s: str) -> int:
    """NFKC 后的字母数字个数（中文按字）—— 标点 / 空白 / 版面符号不计。"""
    return sum(1 for c in unicodedata.normalize("NFKC", s or "") if c.isalnum())


def coord_loop(raw: str) -> bool:
    """同一个数连续 ≥ 6 次，或一个 bbox 里数字过多 ⇒ 坐标停不下来。"""
    if _REPEAT_NUM.search(raw or ""):
        return True
    # 只匹配最内层 [数字,…]（字符类不含 '['）⇒ [[a,b,c,d],[e,f,g,h]] 是两个合法框，不误判
    return any(
        len([x for x in g.split(",") if x.strip()]) > JudgeLimits.BBOX_MAX_NUMS
        for g in _INNER_BOX.findall(raw or "")
    )


def _tail_period(s: str) -> int | None:
    t = s[-JudgeLimits.LOOP_TAIL_CHARS :]
    n = len(t)
    for p in range(1, min(JudgeLimits.LOOP_MAX_PERIOD, n // 3) + 1):
        if sum(1 for a, b in zip(t, t[p:], strict=False) if a == b) >= JudgeLimits.LOOP_MATCH_MIN * (n - p):
            return p
    return None


def _extent(s: str, p: int, window: int = 200) -> int:
    bad: list[bool] = []
    run, i = 0, len(s) - p - 1
    while i >= 0:
        bad.append(s[i] != s[i + p])
        run += 1
        if len(bad) > window:
            bad.pop(0)
        if len(bad) == window and sum(bad) > (1 - JudgeLimits.LOOP_MATCH_MIN) * window:
            break
        i -= 1
    return run


def zratio(raw: str) -> float | None:
    t = _NUM.sub("0", raw or "")[-JudgeLimits.LOOP_TAIL_CHARS :]
    if len(t) < JudgeLimits.LOOP_ZRATIO_MIN_CHARS:
        return None
    b = t.encode("utf-8")
    return round(len(zlib.compress(b, 6)) / len(b), 4)


@dataclass
class Repetition:
    kind: str | None  # None | verbatim | template | perturbed
    period: int | None = None
    extent_chars: int = 0
    zratio: float | None = None

    @property
    def detected(self) -> bool:
        return self.kind is not None


def _numbers_follow_template(raw: str, period_norm: str, extent_norm: int) -> bool:
    """数字归一后成周期 ≠ 复读：纯数字表格（统计表、财务表）归一后每行都一样。

    真正的模板复读里，每一列数字要么不变、要么等步长递增（编号 +1、y 坐标 +25）；合法数据各列不规则。
    ⇒ 把复读区的数字按「每周期 k 个」排成行，要求**每一列**相邻差值有 ≥90% 相同才算复读。
    （aws-gpu canonical 没有这一步：它的定标语料里没有纯数字长表；本仓 2026-11-07 用负对照抓到后补上。）
    """
    k = len(_NUM.findall(period_norm))
    if k == 0:
        return True  # 周期里没有数字 = 不是数字差异造成的周期 ⇒ 按 verbatim 语义处理
    rows = extent_norm // max(1, len(period_norm))
    nums = [int(x) for x in _NUM.findall(raw)]
    take = rows * k
    if rows < 4 or len(nums) < take:
        return True
    grid = [nums[len(nums) - take + r * k : len(nums) - take + (r + 1) * k] for r in range(rows)]
    for col in range(k):
        diffs = [grid[r + 1][col] - grid[r][col] for r in range(rows - 1)]
        mode = max(set(diffs), key=diffs.count)
        if diffs.count(mode) < 0.9 * len(diffs):
            return False
    return True


def repetition(raw: str) -> Repetition:
    """尾部复读检测：逐字 → 数字归一（递增模板）→ 压缩比（被扰动的复读）。"""
    s = raw or ""
    norm = _NUM.sub("0", s)
    for kind, text in (("verbatim", s), ("template", norm)):
        p = _tail_period(text)
        ext = _extent(text, p) if p else 0
        if kind == "verbatim":
            exact = p is not None and s[-p:] == s[-2 * p : -p]
        else:
            exact = p is not None and _numbers_follow_template(s, norm[-p:], ext)
        if ext >= JudgeLimits.LOOP_MIN_EXTENT and exact:
            return Repetition(kind, p, ext)
    z = zratio(s)
    if (
        z is not None
        and z <= JudgeLimits.LOOP_ZRATIO_MAX
        and _raw_zratio(s) <= JudgeLimits.LOOP_RAW_ZRATIO_MAX
    ):
        return Repetition("perturbed", None, min(len(s), JudgeLimits.LOOP_TAIL_CHARS), z)
    return Repetition(None, zratio=z)


def _raw_zratio(raw: str) -> float:
    b = raw[-JudgeLimits.LOOP_TAIL_CHARS :].encode("utf-8")
    return len(zlib.compress(b, 6)) / max(1, len(b))


@dataclass
class PageVerdict:
    content_chars: int
    warnings: list[dict] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        # near_empty 是读数不是失败（空白页的正确答案就是空）
        return not any(w["code"] in _FAILING for w in self.warnings)


_FAILING = {"repetition", "repetition_cut", "coordinate_loop", "truncated", "empty_output"}


def judge_page(raw: str, finish_reason: str, *, near_empty_chars: int, bbox_invalid: int = 0) -> PageVerdict:
    n = content_chars(strip_layout(raw))
    v = PageVerdict(content_chars=n)
    if finish_reason == "repetition_cut":
        v.warnings.append(
            {"code": "repetition_cut", "message": "检测到尾部复读，已提前停止生成（复读部分已截断）"}
        )
    else:
        rep = repetition(raw)
        if rep.detected:
            v.warnings.append(
                {
                    "code": "repetition",
                    "message": f"输出尾部存在复读（{rep.kind}，约 {rep.extent_chars} 字符）",
                    "kind": rep.kind,
                    "extent_chars": rep.extent_chars,
                }
            )
    if finish_reason == "length":
        v.warnings.append({"code": "truncated", "message": "达到最大生成长度，输出可能不完整"})
    if coord_loop(raw):
        v.warnings.append(
            {"code": "coordinate_loop", "message": "坐标输出异常（数字循环），该页版面框不可信"}
        )
    if bbox_invalid:
        v.warnings.append(
            {"code": "bbox_invalid", "message": f"{bbox_invalid} 个版面框坐标不合法，已丢弃框、保留文字"}
        )
    if not (raw or "").strip():
        v.warnings.append({"code": "empty_output", "message": "模型没有输出任何内容"})
    elif n <= near_empty_chars:
        v.warnings.append(
            {"code": "near_empty", "message": f"识别出的有效字符很少（{n}），可能是空白页或非文字图像"}
        )
    return v
