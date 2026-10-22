from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.outline_questionnaire import (
    PREREQUISITE_DIMENSION,
    _parse_questions,
    persist_prerequisite_answers,
    serialize_learning_intent,
)


def _setup_temp_workspace():
    import app.core.config as cfg
    import app.services.generation_service as generation_service
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)
    cfg.DB_PATH = workspace / "app.db"
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = workspace / "repos"
    cfg.GENERATED_ROOT = workspace / "generated"
    storage.DB_PATH = cfg.DB_PATH
    storage.WORKSPACE_ROOT = cfg.WORKSPACE_ROOT
    storage.REPOS_ROOT = cfg.REPOS_ROOT
    storage.GENERATED_ROOT = cfg.GENERATED_ROOT
    generation_service.GENERATED_ROOT = cfg.GENERATED_ROOT
    storage.init_storage()
    return tmpdir


SAMPLE_QUESTIONS_JSON = """[
  {
    "question": "你对本领域前置知识（如数据结构、HTTP）的了解程度？",
    "question_type": "single_choice",
    "dimension": "prerequisite_level",
    "options": [
      {"value": "none", "label": "完全没了解"},
      {"value": "some", "label": "了解一点"},
      {"value": "familiar", "label": "较熟悉"}
    ],
    "rationale": "决定总纲是否加入前置课程"
  },
  {
    "question": "你希望课程偏什么风格？",
    "question_type": "single_choice",
    "dimension": "course_style",
    "options": [
      {"value": "practice", "label": "偏实战"},
      {"value": "principle", "label": "偏原理"}
    ],
    "rationale": "决定每课的讲解方式"
  },
  {
    "question": "你想学到什么程度？",
    "question_type": "multi_choice",
    "dimension": "learning_depth",
    "options": [
      {"value": "basic", "label": "了解即可"},
      {"value": "deep", "label": "深入掌握含原理"}
    ],
    "rationale": "决定学习目标深度"
  }
]"""


class OutlineQuestionnaireTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = _setup_temp_workspace()

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_parse_questions_from_model_json(self):
        questions = _parse_questions(SAMPLE_QUESTIONS_JSON)
        self.assertEqual(len(questions), 3)
        self.assertEqual(questions[0]["dimension"], "prerequisite_level")
        self.assertIn("question", questions[0])
        self.assertIn("options", questions[0])
        self.assertEqual(len(questions[0]["options"]), 3)

    def test_parse_questions_strips_code_fences(self):
        fenced = "```json\n" + SAMPLE_QUESTIONS_JSON + "\n```"
        questions = _parse_questions(fenced)
        self.assertEqual(len(questions), 3)

    def test_parse_questions_rejects_invalid_json(self):
        with self.assertRaises(RuntimeError):
            _parse_questions("not json at all")

    def test_parse_questions_accepts_empty(self):
        self.assertEqual(_parse_questions("[]"), [])

    def test_parse_questions_filters_invalid_items(self):
        mixed = json.dumps([
            {"question": "有效题", "options": [{"value": "a", "label": "A"}]},
            {"not_question": True},
            {"question": ""},
        ])
        questions = _parse_questions(mixed)
        self.assertEqual(len(questions), 1)

    def test_serialize_learning_intent(self):
        answers = [
            {"question": "前置知识了解程度？", "dimension": "prerequisite_level", "selected": "none"},
            {"question": "课程风格？", "dimension": "course_style", "selected": "practice"},
        ]
        intent = serialize_learning_intent(answers)
        self.assertIn("<learning_intent>", intent)
        self.assertIn("前置知识了解程度？ [prerequisite_level]：none", intent)
        self.assertIn("</learning_intent>", intent)

    def test_serialize_learning_intent_empty(self):
        self.assertEqual(serialize_learning_intent([]), "")

    def test_serialize_learning_intent_list_selection(self):
        answers = [
            {"question": "想学到什么程度？", "dimension": "learning_depth", "selected": ["basic", "deep"]},
        ]
        intent = serialize_learning_intent(answers)
        self.assertIn("basic、deep", intent)

    def test_preflight_answers_do_not_write_fixed_preferences(self):
        answers = [{"question": "前置知识？", "dimension": "prerequisite_level", "selected": "familiar"}]
        with patch("app.services.personalization_service.apply_preference_feedback", side_effect=AssertionError("retired preference write")):
            persist_prerequisite_answers(123, answers)

    def test_questionnaire_prompt_registered(self):
        from app.services.prompt_store import (
            PROMPT_DEFAULTS,
            PROMPT_METADATA,
        )

        self.assertIn("prompt.outline.questionnaire", PROMPT_DEFAULTS)
        self.assertIn("prompt.outline.questionnaire", PROMPT_METADATA)
        prompt = PROMPT_DEFAULTS["prompt.outline.questionnaire"]
        self.assertIn("question_type", prompt)
        self.assertIn("实际信息缺口决定", prompt)
        self.assertIn("信息缺口", prompt)
        self.assertIn("返回 []", prompt)
        self.assertNotIn("prerequisite_level", prompt)
        self.assertNotIn("course_style", prompt)
        self.assertNotIn("learning_depth", prompt)
        self.assertNotIn("偏原理", prompt)
        self.assertNotIn("偏实战", prompt)


if __name__ == "__main__":
    unittest.main()
