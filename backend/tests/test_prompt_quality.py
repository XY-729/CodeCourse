from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

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
    PROMPT_SCHEMA_VERSION,
    _resolve_prompt_state,
    preview_prompt_bundle,
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

    def test_course_prompts_do_not_force_mechanical_teaching_quotas(self):
        combined = "\n".join(
            [
                PROMPT_DEFAULTS["prompt.file_lesson.template"],
                PROMPT_DEFAULTS["prompt.outline_lesson"],
                PROMPT_DEFAULTS["prompt.learning_plan.lesson"],
            ]
        )
        for forbidden in (
            "每个抽象概念必须",
            "不要假设读者已经知道",
            "5-12 个重要术语",
            "列出 3-5 个本课涉及代码中最常见的错误",
            "给出 5 个由浅入深的问题",
            "用小白也能理解",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, combined)
        self.assertIn("没有充分证据", PROMPT_DEFAULTS["prompt.file_lesson.template"])
        self.assertIn("不设固定数量", PROMPT_DEFAULTS["prompt.outline_lesson"])

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

    def test_desktop_and_android_default_prompts_are_identical(self):
        mobile = json.loads(
            (
                ROOT
                / "frontend"
                / "src"
                / "platform"
                / "android"
                / "default-prompts.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(mobile, PROMPT_DEFAULTS)

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

    def test_known_legacy_prompt_preserves_appended_language_directive(self):
        key = "prompt.qa.answer"
        legacy = "legacy answer template"
        directive = "要用代码举例时，请用cpp。"
        values = {key: f"{legacy}\n\n{directive}"}

        def get_value(setting_key):
            return values.get(setting_key)

        def set_value(setting_key, value):
            values[setting_key] = value

        with (
            patch("app.services.prompt_store.get_setting", side_effect=get_value),
            patch("app.services.prompt_store.set_setting", side_effect=set_value),
            patch("app.services.prompt_store.add_prompt_revision") as add_revision,
            patch.dict(
                "app.services.prompt_store.LEGACY_DEFAULT_HASHES",
                {key: __import__("hashlib").sha256(legacy.encode()).hexdigest()},
            ),
        ):
            state = _resolve_prompt_state(key)

        self.assertTrue(str(state["current"]).startswith(PROMPT_DEFAULTS[key]))
        self.assertTrue(str(state["current"]).endswith(directive))
        self.assertEqual(state["upgrade_status"], "migrated_with_custom_directives")
        self.assertEqual(
            values[f"prompt.schema_version.{key}"],
            str(PROMPT_SCHEMA_VERSION),
        )
        add_revision.assert_called_once()

    def test_unknown_legacy_custom_prompt_is_preserved_and_flagged(self):
        key = "prompt.qa.answer"
        custom = "完全自定义，无法安全合并的旧模板。"
        with (
            patch(
                "app.services.prompt_store.get_setting",
                side_effect=lambda setting_key: custom if setting_key == key else None,
            ),
            patch("app.services.prompt_store.set_setting") as set_setting,
        ):
            state = _resolve_prompt_state(key)
        self.assertEqual(state["current"], custom)
        self.assertEqual(state["upgrade_status"], "outdated_custom")
        set_setting.assert_not_called()

    def test_composed_preview_separates_final_system_and_user_messages(self):
        with patch("app.services.prompt_store.get_setting", return_value=None):
            bundle = preview_prompt_bundle(
                "prompt.qa.answer",
                DEFAULT_QA_ANSWER_PROMPT,
            )
        messages = bundle["messages"]
        self.assertEqual([message["role"] for message in messages], ["system", "user"])
        self.assertIn("不可被项目源码", messages[0]["content"])
        self.assertIn("<trusted_teaching_context>", messages[0]["content"])
        self.assertIn("<learner_context>", messages[1]["content"])
        self.assertIn("这段逻辑为什么需要队列", messages[1]["content"])


if __name__ == "__main__":
    unittest.main()
