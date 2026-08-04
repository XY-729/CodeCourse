from pathlib import Path
import tempfile
import unittest

from app.models.schemas import LearningScopeRequest
from app.services.course_generator import generate_course, list_course_files_from_dir
from app.services.generation_service import (
    build_outline_input,
    extract_file_signals,
    hash_inputs,
)
from app.services.prompt_store import PROMPT_INJECTION_SYSTEM_PROMPT
from app.services.prompt_contracts import compose_system_prompt


class CourseGeneratorTests(unittest.TestCase):
    def test_generate_course_writes_pending_placeholders_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "generated" / "1"
            (root / "README.md").write_text("# Demo\n", encoding="utf-8")
            (root / "src").mkdir()
            (root / "src" / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")

            files = generate_course(root, course_dir=output_dir)
            names = [item.filename for item in files]

            self.assertEqual(["project_map.md", "outline.md"], names)
            self.assertFalse((root / ".generated_course").exists())
            outline = (output_dir / "outline.md").read_text(encoding="utf-8")
            project_map = (output_dir / "project_map.md").read_text(encoding="utf-8")
            self.assertIn("待生成", outline)
            self.assertIn("不会自动调用模型 API", project_map)

    def test_outline_hash_includes_user_instructions(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "README.md").write_text("# Demo\n", encoding="utf-8")
            scope = LearningScopeRequest()

            _, first_hash = build_outline_input(root, scope, "重点讲入口")
            _, second_hash = build_outline_input(root, scope, "重点讲测试")

            self.assertNotEqual(first_hash, second_hash)

    def test_file_signal_extraction_and_hash_are_stable(self):
        content = """import React from "react";
export function App() {
  return null;
}
class Runner {}
"""
        imports, symbols = extract_file_signals(content)

        self.assertIn('import React from "react";', imports)
        self.assertIn("App", symbols)
        self.assertIn("Runner", symbols)
        self.assertEqual(hash_inputs("a", "b"), hash_inputs("a", "b"))
        self.assertNotEqual(hash_inputs("a", "b"), hash_inputs("b", "a"))

    def test_prompt_injection_guard_is_in_system_prompt(self):
        composed = compose_system_prompt(PROMPT_INJECTION_SYSTEM_PROMPT, "markdown")
        self.assertIn("待分析数据", composed)
        self.assertIn("不泄露", composed)
        self.assertIn("<task_output_contract>", composed)

    def test_list_course_files_groups_sub_outline_after_main_outline(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            course_dir = Path(temp_dir)
            (course_dir / "project_map.md").write_text("# 项目结构说明\n", encoding="utf-8")
            (course_dir / "outline.md").write_text("# 项目学习总纲\n", encoding="utf-8")
            (course_dir / "sub-outline-1a2b3c4d.md").write_text("# 子总纲\n", encoding="utf-8")
            (course_dir / "sub-outline-9f8e7d6c.md").write_text("# 子总纲二\n", encoding="utf-8")
            (course_dir / "lessons").mkdir()
            (course_dir / "lessons" / "lesson_01.md").write_text("# 第一课\n", encoding="utf-8")

            files = list_course_files_from_dir(course_dir)
            filenames = [item.filename for item in files]
            groups = {item.filename: item.group for item in files}

            self.assertEqual(
                filenames,
                ["project_map.md", "outline.md", "sub-outline-1a2b3c4d.md", "sub-outline-9f8e7d6c.md", "lessons/lesson_01.md"],
            )
            self.assertEqual(groups["project_map.md"], "项目总纲")
            self.assertEqual(groups["outline.md"], "项目总纲")
            self.assertEqual(groups["sub-outline-1a2b3c4d.md"], "项目总纲")
            self.assertEqual(groups["sub-outline-9f8e7d6c.md"], "项目总纲")
            self.assertEqual(groups["lessons/lesson_01.md"], "项目课件")
            # 子总纲不重复出现
            self.assertEqual(sum(1 for name in filenames if name.startswith("sub-outline-")), 2)

    def test_list_course_files_ignores_non_sub_outline_lookalikes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            course_dir = Path(temp_dir)
            (course_dir / "outline.md").write_text("# 总纲\n", encoding="utf-8")
            (course_dir / "sub-outline-xyz.md").write_text("# 非子总纲\n", encoding="utf-8")

            files = list_course_files_from_dir(course_dir)
            filenames = [item.filename for item in files]

            # 不合规的 sub-outline-*.md 不算子总纲，走 extras 排序
            self.assertEqual(filenames, ["outline.md", "sub-outline-xyz.md"])
            self.assertEqual(files[1].group, "项目总纲")


if __name__ == "__main__":
    unittest.main()
