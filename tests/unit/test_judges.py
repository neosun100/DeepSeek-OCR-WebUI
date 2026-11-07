"""判据的正负对照：每条判据都要有「应当红」和「不该红」两类输入。"""

from __future__ import annotations

import json

import pytest

from deepseek_ocr_webui.judges import (
    content_chars,
    coord_loop,
    judge_page,
    repetition,
    strip_layout,
)

from ..conftest import SAMPLES


def codes(v) -> set[str]:
    return {w["code"] for w in v.warnings}


class TestRepetition:
    def test_verbatim_tail_detected(self) -> None:
        r = repetition("正常的开头内容。" + "同一句话不停地重复，" * 300)
        assert r.kind == "verbatim"
        assert r.period == len("同一句话不停地重复，")
        assert r.extent_chars >= 1000

    def test_incrementing_template_detected(self) -> None:
        # 递增编号：逐字不成周期，数字归一后才成周期
        s = "表头\n" + "".join(f"<tr><td>{i}</td><td>有限售条件</td></tr>" for i in range(300, 400))
        r = repetition(s)
        assert r.kind == "template"

    @pytest.mark.parametrize(
        "name",
        ["sample.json", "sample1.json", "sample2.json", "sample3.json", "sample4.json", "sample5.json"],
    )
    def test_real_clean_outputs_not_flagged(self, name: str) -> None:
        # 负对照：仓库里的真实 DeepSeek-OCR 输出（干净页）一条都不许检出
        raw = json.loads((SAMPLES / name).read_text())["raw_text"]
        assert not repetition(raw).detected

    def test_numeric_table_not_flagged(self) -> None:
        # 负对照（2026-11-07 红方抓到）：纯数字、行结构一致的合法表格 —— 数字归一后成周期，但各列数字不规则
        import random

        rnd = random.Random(7)  # 不规则数字（i*37%1000 这类构造本身是等差数列，就该判复读）
        rows = "".join(
            f"<tr><td>{rnd.randint(1, 9999)}</td><td>{rnd.randint(0, 999)}.{rnd.randint(0, 99)}</td></tr>"
            for _ in range(150)
        )
        r = repetition(rows)
        assert not r.detected, r

    def test_constant_step_coordinates_detected(self) -> None:
        # 正对照：空块 + y 坐标等步长递增（aws-gpu 定标里的复读形态）
        s = "".join(
            f"<|ref|>text<|/ref|><|det|>[[10, {y}, 900, {y + 20}]]<|/det|>\n" for y in range(0, 4000, 25)
        )
        assert repetition(s).kind == "template"

    def test_perturbed_loop_still_detected(self) -> None:
        # 正对照：防复读 processor 把复读「扰动」（随机插空格 / 换标点）后，周期对齐失效，只剩压缩比能抓
        import random

        rnd = random.Random(3)
        unit = "该公司股份为有限售条件流通股"
        s = "开头。" + "".join(unit + rnd.choice(["，", " ，", "、", "；", " "]) for _ in range(400))
        r = repetition(s)
        assert r.kind == "perturbed", r  # 必须命中压缩比分支，否则这条正对照守不住 LOOP_RAW_ZRATIO_MAX

    def test_short_text(self) -> None:
        assert not repetition("").detected
        assert not repetition("abc").detected


class TestCoordLoop:
    def test_same_number_repeated(self) -> None:
        assert coord_loop("<|det|>[[23, 268, 268, 268, 268, 268, 268]]<|/det|>")

    def test_too_many_numbers_in_box(self) -> None:
        assert coord_loop("[[1, 2, 3, 4, 5]]")

    def test_multiple_valid_boxes_ok(self) -> None:
        assert not coord_loop("<|det|>[[10, 10, 200, 60], [300, 400, 500, 450]]<|/det|>")

    def test_real_sample_ok(self) -> None:
        raw = json.loads((SAMPLES / "sample4.json").read_text())["raw_text"]
        assert not coord_loop(raw)


def test_content_chars_counts_cjk_and_ignores_layout() -> None:
    raw = "<|ref|>text<|/ref|><|det|>[[1, 2, 3, 4]]<|/det|>\n你好 world 42！"
    # strip_layout 之后 "text" 仍是 ref 里的字 —— 判据对 document 模式的类型词多算 4 个字，与 aws-gpu 口径一致
    assert content_chars("你好 world 42！") == 9
    assert "[[" not in strip_layout(raw)


class TestJudgePage:
    def test_clean_page_ok(self) -> None:
        v = judge_page("Hello world, this page has plenty of real text.", "stop", near_empty_chars=20)
        assert v.ok and not v.warnings

    def test_near_empty_is_reading_not_failure(self) -> None:
        v = judge_page("12", "stop", near_empty_chars=20)
        assert codes(v) == {"near_empty"}
        assert v.ok  # 空白页的正确答案就是空

    def test_empty_output_fails(self) -> None:
        v = judge_page("   ", "stop", near_empty_chars=20)
        assert "empty_output" in codes(v) and not v.ok

    def test_length_is_truncated(self) -> None:
        v = judge_page("x" * 100, "length", near_empty_chars=20)
        assert "truncated" in codes(v) and not v.ok

    def test_repetition_cut_not_double_reported(self) -> None:
        v = judge_page("a" + "重复句子，" * 400, "repetition_cut", near_empty_chars=20)
        assert "repetition_cut" in codes(v) and "repetition" not in codes(v)

    def test_bbox_invalid_is_reported(self) -> None:
        v = judge_page("hello there friend", "stop", near_empty_chars=5, bbox_invalid=2)
        assert "bbox_invalid" in codes(v)
        assert v.ok  # 框坏了文字还在：读数而非失败
