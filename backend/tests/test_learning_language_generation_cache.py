"""Saved example-language changes invalidate every course-generation cache."""

import asyncio
import json
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app.models.schemas import LearningScopeRequest
from app.services import generation_service as generation, storage
from app.services.personalization.teaching.generation_context import GenerationContext

from test_lesson_prompt_autonomy import lesson_plan, response


def context(language):
    return GenerationContext(
        topology_json='{"topology_version":3,"topology_status":"ready","nodes":[]}',
        state_json='{"state_version":4,"nodes":[]}',
        requirements_json="[]",
        learning_preferences_json=json.dumps({"primary_programming_language": language}),
    )


class LearningLanguageGenerationCacheTests(unittest.TestCase):
    def _patch_inputs(self, stack, temporary):
        project = SimpleNamespace(id=1, local_path=temporary, project_type="learning_plan")
        stack.enter_context(patch.object(generation, "GENERATED_ROOT", Path(temporary)))
        stack.enter_context(patch.object(generation, "get_project", return_value=project))
        stack.enter_context(patch.object(storage, "get_project", return_value=project))
        stack.enter_context(patch.object(generation, "load_prompt", return_value=""))
        stack.enter_context(patch.object(generation, "build_outline_input", return_value=("materials", "outline-input")))
        stack.enter_context(patch.object(generation, "build_file_lesson_input", return_value=("materials", "python", "file-input")))
        stack.enter_context(patch.object(generation, "build_outline_lesson_input", return_value=("lesson", "materials", "lesson-input")))

    def test_saved_language_invalidates_all_background_task_caches(self):
        creators = (
            lambda: generation.create_or_reuse_outline_task(1, Path("."), LearningScopeRequest(type="learning_plan"), "fixture"),
            lambda: generation.create_or_reuse_file_lesson_task(1, Path("."), "main.py", "detailed", "fixture"),
            lambda: generation.create_or_reuse_outline_lesson_task(1, Path("."), 1, "lesson", "fixture"),
        )
        for create in creators:
            with self.subTest(creator=create), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                self._patch_inputs(stack, temporary)
                cache = {}

                def create_task(**kwargs):
                    output = Path(kwargs["output_path"])
                    if output.suffix == ".md":
                        output.parent.mkdir(parents=True, exist_ok=True)
                        output.write_text("# 已完成的课件", encoding="utf-8")
                    else:
                        output.mkdir(parents=True, exist_ok=True)
                    task = SimpleNamespace(id=len(cache) + 1, output_path=str(output))
                    cache[kwargs["input_hash"]] = task
                    return task

                stack.enter_context(patch.object(generation, "build_generation_context", side_effect=[
                    context("Python"), context("Python"), context("C++"), context("C++"),
                ]))
                stack.enter_context(patch.object(generation, "find_completed_task", side_effect=lambda _project, _kind, digest, *_args, **_kwargs: cache.get(digest)))
                created = stack.enter_context(patch.object(generation, "create_generation_task", side_effect=create_task))
                first, first_cached = create()
                repeated, repeated_cached = create()
                changed, changed_cached = create()
                changed_repeated, changed_repeated_cached = create()

                self.assertEqual([first_cached, repeated_cached, changed_cached, changed_repeated_cached], [False, True, False, True])
                self.assertEqual(first.id, repeated.id)
                self.assertNotEqual(first.id, changed.id)
                self.assertEqual(changed.id, changed_repeated.id)
                self.assertEqual(created.call_count, 2)

    def test_saved_language_invalidates_all_streaming_task_caches(self):
        streams = (
            lambda: generation.stream_outline_generation(1, LearningScopeRequest(type="learning_plan")),
            lambda: generation.stream_file_lesson_generation(1, "main.py", "detailed"),
            lambda: generation.stream_outline_lesson_generation(1, 1, "lesson"),
        )

        async def collect_until_cache_or_creation(stream):
            try:
                async for event in stream:
                    if event["event"] in {"completed", "task_created"}:
                        return event
            finally:
                await stream.aclose()

        for stream in streams:
            with self.subTest(stream=stream), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                self._patch_inputs(stack, temporary)
                hashes = []
                cached = SimpleNamespace(id=1, output_path=temporary)

                def find_task(_project, _kind, digest, *_args, **_kwargs):
                    hashes.append(digest)
                    return cached if digest == hashes[0] else None

                stack.enter_context(patch.object(generation, "build_generation_context", side_effect=[context("Python"), context("C++")]))
                stack.enter_context(patch.object(generation, "_llm_settings_or_error", return_value={"model": "fixture"}))
                stack.enter_context(patch.object(generation, "update_generation_task"))
                stack.enter_context(patch.object(storage, "update_generation_task"))
                stack.enter_context(patch.object(storage, "update_project_status"))
                stack.enter_context(patch.object(generation, "find_completed_task", side_effect=find_task))
                stack.enter_context(patch.object(storage, "find_completed_task", side_effect=find_task))
                create_task = stack.enter_context(patch.object(storage, "create_generation_task", return_value=SimpleNamespace(id=2)))

                first = asyncio.run(collect_until_cache_or_creation(stream()))
                second = asyncio.run(collect_until_cache_or_creation(stream()))

                self.assertEqual(first["event"], "completed")
                self.assertTrue(first["data"]["cached"])
                self.assertEqual(second["event"], "task_created")
                self.assertNotEqual(hashes[0], hashes[1])
                self.assertEqual(create_task.call_count, 1)

    def test_language_change_while_queued_uses_the_actual_execution_context_for_reuse(self):
        operations = (
            (
                lambda: generation.create_or_reuse_outline_task(1, Path("."), LearningScopeRequest(type="learning_plan"), "fixture"),
                lambda task_id: generation.run_outline_generation_task(1, task_id, LearningScopeRequest(type="learning_plan")),
            ),
            (
                lambda: generation.create_or_reuse_file_lesson_task(1, Path("."), "main.py", "detailed", "fixture"),
                lambda task_id: generation.run_file_lesson_task(1, task_id, "main.py", "detailed"),
            ),
            (
                lambda: generation.create_or_reuse_outline_lesson_task(1, Path("."), 1, "lesson", "fixture"),
                lambda task_id: generation.run_outline_lesson_task(1, task_id, 1, "lesson"),
            ),
        )
        for create, run in operations:
            with self.subTest(run=run), tempfile.TemporaryDirectory() as temporary, ExitStack() as stack:
                self._patch_inputs(stack, temporary)
                tasks = []

                def create_task(**kwargs):
                    output = Path(kwargs["output_path"])
                    if output.suffix == ".md":
                        output.parent.mkdir(parents=True, exist_ok=True)
                        output.write_text("# 上次课件", encoding="utf-8")
                    else:
                        output.mkdir(parents=True, exist_ok=True)
                    task = SimpleNamespace(id=len(tasks) + 1, output_path=str(output),
                                           input_hash=kwargs["input_hash"], status="queued", progress_total=0)
                    tasks.append(task)
                    return task

                def update_task(task_id, status, **changes):
                    task = tasks[task_id - 1]
                    task.status = status
                    for key, value in changes.items():
                        setattr(task, key, value)
                    return task

                def find_task(_project, _kind, digest, *_args, **_kwargs):
                    return next((task for task in tasks if task.status == "completed" and task.input_hash == digest), None)

                def model(_base_url, _api_key, _model, messages, **_kwargs):
                    self.assertIn('"C++"', "\n".join(message["content"] for message in messages))
                    prompt = next(message["content"] for message in messages if message["role"] == "user")
                    if "章节标题：" in prompt:
                        section = lesson_plan(1)["sections"][0]
                        return response("## 章节 1\n\n这里是知识项 1 的讲解。", section["items"][0])
                    if "责任编辑" in prompt:
                        return response()
                    if "章节规划" in prompt:
                        return json.dumps(lesson_plan(1), ensure_ascii=False)
                    return response("# 课件\n\n这里是 C++ 示例的说明。")

                stack.enter_context(patch.object(generation, "build_generation_context", side_effect=[
                    context("Python"), context("C++"), context("Python"), context("C++"),
                ]))
                stack.enter_context(patch.object(generation, "create_generation_task", side_effect=create_task))
                stack.enter_context(patch.object(generation, "find_completed_task", side_effect=find_task))
                stack.enter_context(patch.object(generation, "update_generation_task", side_effect=update_task))
                stack.enter_context(patch.object(generation, "get_generation_task", side_effect=lambda task_id: tasks[task_id - 1]))
                stack.enter_context(patch.object(generation, "_llm_settings_or_error", return_value={
                    "model": "fixture", "base_url": "http://fixture.invalid", "api_key": "fixture",
                }))
                stack.enter_context(patch.object(generation, "call_openai_compatible_chat", side_effect=model))
                for method in ("_publish_generation", "register_document_terms", "update_project_status",
                               "_link_lesson_to_outline", "_debug_dump", "LessonPreview"):
                    stack.enter_context(patch.object(generation, method))
                stack.enter_context(patch.object(generation, "find_knowledge_node", return_value=SimpleNamespace(id=1)))

                queued, cached = create()
                queued_hash = queued.input_hash
                run(queued.id)
                self.assertFalse(cached)
                self.assertEqual(queued.status, "completed", vars(queued))
                self.assertNotEqual(queued.input_hash, queued_hash)
                python_task, python_cached = create()
                cpp_task, cpp_cached = create()
                self.assertFalse(python_cached)
                self.assertNotEqual(python_task.id, queued.id)
                self.assertTrue(cpp_cached)
                self.assertEqual(cpp_task.id, queued.id)

    def test_frozen_plan_retry_keeps_its_saved_language_without_another_planner_call(self):
        frozen = context("C++")
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.object(generation, "GENERATED_ROOT", Path(temporary)),
            patch.object(generation, "load_prompt", return_value=""),
            patch.object(generation, "call_openai_compatible_chat", return_value=json.dumps(lesson_plan(1))) as planner,
        ):
            first_plan, first_map, _ = generation._prepare_lesson_plan(1, 1, {
                "base_url": "http://fixture.invalid", "api_key": "fixture", "model": "fixture",
            }, "plan", frozen, "request-with-language")
            repeated_plan, repeated_map, repeated_context = generation._prepare_lesson_plan(
                1, 1, {}, "plan", frozen, "request-with-language",
            )
        self.assertEqual(planner.call_count, 1)
        self.assertEqual(first_plan, repeated_plan)
        self.assertEqual(first_map.version, repeated_map.version)
        self.assertEqual(repeated_context.learning_preferences_json, frozen.learning_preferences_json)
        self.assertIn('"C++"', repeated_context.render())


if __name__ == "__main__":
    unittest.main()
