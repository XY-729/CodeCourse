"""Cost controls for chapter generation: reasoning effort, concurrency, resume.

These tests pin the quantities that made lessons slow and expensive:
- section writers ask DeepSeek for a cheaper thinking effort,
- chapters run with more than four workers,
- a retry restores validated chapters without another prompt dump or call.
"""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.services import generation_service as generation
from app.services.personalization.teaching.generation_context import GenerationContext

from test_lesson_prompt_autonomy import lesson_plan, response


class SectionConcurrencyTests(unittest.TestCase):
    def test_default_is_six_and_env_is_clamped(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GPL_SECTION_CONCURRENCY", None)
            self.assertEqual(generation._section_concurrency(), 6)
        for raw, expected in (("8", 8), ("12", 8), ("0", 1), ("-3", 1), ("bad", 6), ("1", 1)):
            with self.subTest(raw=raw), patch.dict(os.environ, {"GPL_SECTION_CONCURRENCY": raw}):
                self.assertEqual(generation._section_concurrency(), expected)


class SectionReasoningEffortTests(unittest.TestCase):
    def test_defaults_to_low_and_normalizes_unknown_values(self):
        with patch.dict(os.environ, {"GPL_SECTION_REASONING_EFFORT": "high"}):
            self.assertEqual(generation._section_reasoning_effort({}), "high")
        with patch.dict(os.environ, {"GPL_SECTION_REASONING_EFFORT": "nonsense"}):
            self.assertEqual(generation._section_reasoning_effort({}), "low")
        self.assertEqual(generation._section_reasoning_effort({"section_reasoning_effort": "disabled"}), "disabled")
        self.assertEqual(generation._section_reasoning_effort({"section_reasoning_effort": "default"}), "default")

    def test_section_request_forwards_the_effort(self):
        settings = {"base_url": "https://api.deepseek.com", "api_key": "k",
                    "model": "deepseek-flash", "section_reasoning_effort": "low"}
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(generation, "GENERATED_ROOT", Path(temporary)), \
                patch.object(generation, "call_openai_compatible_chat", return_value="body") as model:
            result = generation._lesson_response_result(
                1, 95, "section-1", settings, [{"role": "user", "content": "原题"}], "v1",
                reasoning_effort=generation._section_reasoning_effort(settings))
            self.assertEqual(result.content, "body")
            self.assertFalse(result.reused)
            self.assertEqual(model.call_args.kwargs["reasoning_effort"], "low")


class FailedSectionResumeTests(unittest.TestCase):
    def test_retry_restores_validated_chapter_without_prompt_dump_or_call(self):
        plan = lesson_plan(2)
        context = GenerationContext(
            topology_json=json.dumps({"topology_version": 3, "topology_status": "ready", "nodes": []}),
            state_json=json.dumps({"state_version": 4, "nodes": []}),
            requirements_json="[]", learning_preferences_json="{}")
        attempts = {"章节 1": 0, "章节 2": 0}

        def model(_base, _key, _model, messages, **_kwargs):
            prompt = next(message["content"] for message in messages if message["role"] == "user")
            if "章节标题：" in prompt:
                title = prompt.split("章节标题：", 1)[1].splitlines()[0]
                attempts[title] += 1
                if title == "章节 1" and attempts[title] == 1:
                    return "缺少知识清单的正文"
                item = next(section for section in plan["sections"] if section["title"] == title)["items"][0]
                return response(f"## {title}\n\n{title} 的真实讲解。", item)
            if "责任编辑" in prompt:
                return response()
            return json.dumps(plan, ensure_ascii=False)

        dumps: list[str] = []
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(generation, "GENERATED_ROOT", Path(temporary)), \
                patch.object(generation, "build_generation_context", return_value=context), \
                patch.object(generation, "update_generation_task"), \
                patch.object(generation, "load_prompt", return_value=""), \
                patch.object(generation, "_debug_dump", side_effect=lambda name, text: dumps.append(name)), \
                patch.object(generation, "call_openai_compatible_chat", side_effect=model):
            args = (1, 95, 1, "课件", "相同材料", "",
                    {"base_url": "fixture", "api_key": "fixture", "model": "fixture"})
            with self.assertRaises(RuntimeError):
                generation._run_learning_plan_lesson_task(*args, preview=Mock())
            generation._run_learning_plan_lesson_task(*args, preview=Mock())

        self.assertEqual(attempts, {"章节 1": 2, "章节 2": 1})
        section_dumps = [name for name in dumps if "section-2" in name]
        self.assertEqual(len(section_dumps), 1, dumps)


class ReasoningPayloadIntegrationTests(unittest.TestCase):
    def test_section_calls_carry_thinking_off_only_for_official_deepseek(self):
        from app.services.llm_client import reasoning_controls
        self.assertEqual(reasoning_controls("https://api.deepseek.com", "deepseek-flash", "low"),
                         {"thinking": {"type": "enabled"}, "reasoning_effort": "low"})
        self.assertEqual(reasoning_controls("https://api.deepseek.com", "deepseek-flash", "disabled"),
                         {"thinking": {"type": "disabled"}})
        self.assertEqual(reasoning_controls("https://proxy.example", "deepseek-flash", "low"), {})
        self.assertEqual(reasoning_controls("https://api.deepseek.com", "deepseek-flash", "default"), {})


if __name__ == "__main__":
    unittest.main()
