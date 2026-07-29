from __future__ import annotations

import json
import unittest
from pathlib import Path

from app.services.personalization_service import render_preference_directives
from app.services.bibliography import (
    append_validated_bibliography,
    bibliography_markdown,
    validate_bibliography_selections,
)
from app.services.prompt_contracts import compose_system_prompt
from app.services.prompt_store import (
    DEFAULT_QA_ANSWER_PROMPT,
    PROMPT_DEFAULTS,
    preview_prompt,
    validate_prompt,
)
from app.services.generation_service import _dedupe_lesson_markdown
from app.services.storage import LearnerPreferences


ROOT = Path(__file__).resolve().parents[2]


class PromptQualityTests(unittest.TestCase):
    def test_quick_lookup_is_not_forced_into_a_tutorial(self):
        prompt = DEFAULT_QA_ANSWER_PROMPT
        self.assertIn("quick_lookup", prompt)
        self.assertIn("代码、表格、常见坑和延伸阅读都不是必选项", prompt)
        self.assertNotIn("学习者大多是初学者", prompt)
        self.assertNotIn("必须有代码例子", prompt)
        self.assertNotIn("至少 2-3 个相关术语", prompt)

    def test_json_contract_never_requires_markdown(self):
        system = compose_system_prompt("优先解决当前任务。", "json")
        self.assertIn("只输出一个有效 JSON 对象", system)
        self.assertIn("不要输出 Markdown", system)
        self.assertNotIn("输出必须使用 Markdown", system)

    def test_markdown_and_qa_contracts_are_task_specific(self):
        markdown = compose_system_prompt("", "markdown")
        qa = compose_system_prompt("", "qa")
        self.assertIn("输出 Markdown 正文", markdown)
        self.assertNotIn("只输出一个有效 JSON", markdown)
        self.assertIn("TITLE: 简短标题", qa)
        self.assertIn("TERMS: [...]", qa)

    def test_python_preference_directives_match_shared_vectors(self):
        vectors = json.loads(
            (ROOT / "shared" / "preference-directive-vectors.json").read_text(
                encoding="utf-8"
            )
        )
        for vector in vectors:
            values = vector["preferences"]
            preferences = LearnerPreferences(
                scope_type="global",
                scope_id="local-user",
                answer_depth=values["answer_depth"],
                code_ratio=values["code_ratio"],
                explanation_order=values["explanation_order"],
                prerequisite_detail=values["prerequisite_detail"],
                terminology_density=values["terminology_density"],
                feedback_count=0,
                survey_enabled=True,
                last_survey_at=None,
                updated_at="2026-01-01T00:00:00Z",
            )
            expected = "\n".join(f"- {item}" for item in vector["expected"])
            with self.subTest(vector=vector["name"]):
                self.assertEqual(render_preference_directives(preferences), expected)

    def test_bibliography_accepts_only_curated_ids_and_topics(self):
        selections = validate_bibliography_selections(
            [
                {
                    "id": "cpp-concurrency-in-action-2",
                    "topics": ["thread management", "invented chapter"],
                },
                {
                    "id": "cpp-primer-5",
                    "topics": ["multithreading"],
                },
                {
                    "id": "invented-book",
                    "topics": ["anything"],
                },
            ]
        )
        self.assertEqual(len(selections), 2)
        self.assertEqual(selections[0]["topics"], ["thread management"])
        self.assertEqual(selections[1]["topics"], [])
        rendered = bibliography_markdown(selections)
        self.assertIn("C++ Concurrency in Action", rendered)
        self.assertNotIn("invented chapter", rendered)
        self.assertNotIn("multithreading", rendered)

    def test_free_form_book_citations_are_removed_before_append(self):
        markdown = """# 课程

### 教材依据

- 《C++ Primer》第 18.2 节“多线程”

## 下一部分

正文保留。"""
        rendered = append_validated_bibliography(markdown, [])
        self.assertNotIn("18.2", rendered)
        self.assertNotIn("《C++ Primer》", rendered)
        self.assertIn("正文保留", rendered)
        self.assertIn("内置书目", rendered)

    def test_lesson_deduplication_removes_repeated_common_blocks(self):
        paragraph = "这一段用于解释同一个公共概念，长度足够触发去重。" * 8
        markdown = f"""## 核心章节

{paragraph}

## 常见误区

内容一。

{paragraph}

## 常见误区

内容二。"""
        rendered = _dedupe_lesson_markdown(markdown)
        self.assertEqual(rendered.count(paragraph), 1)
        self.assertEqual(rendered.count("## 常见误区"), 1)
        self.assertIn("内容二", rendered)

    def test_all_default_prompts_satisfy_placeholder_contracts(self):
        for key, value in PROMPT_DEFAULTS.items():
            with self.subTest(key=key):
                self.assertEqual(validate_prompt(key, value), [])

    def test_missing_and_unknown_placeholders_are_rejected(self):
        missing = DEFAULT_QA_ANSWER_PROMPT.replace("{context_text}", "")
        self.assertTrue(
            any("context_text" in error for error in validate_prompt("prompt.qa.answer", missing))
        )
        unknown = DEFAULT_QA_ANSWER_PROMPT + "\n{made_up_value}"
        self.assertTrue(
            any("made_up_value" in error for error in validate_prompt("prompt.qa.answer", unknown))
        )
        invalid = DEFAULT_QA_ANSWER_PROMPT + "\n{"
        self.assertTrue(
            any("花括号格式无效" in error for error in validate_prompt("prompt.qa.answer", invalid))
        )

    def test_preview_uses_safe_sample_values(self):
        rendered = preview_prompt("prompt.qa.answer", DEFAULT_QA_ANSWER_PROMPT)
        self.assertIn("这段逻辑为什么需要队列", rendered)
        self.assertIn("[示例选区与检索上下文]", rendered)
        self.assertNotIn("{context_text}", rendered)


if __name__ == "__main__":
    unittest.main()
