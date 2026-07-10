from pathlib import Path
import tempfile
import unittest

from app.models.schemas import LearningScopeRequest
from app.services.course_generator import generate_course
from app.services.generation_service import (
    build_outline_input,
    extract_file_signals,
    hash_inputs,
)
from app.services.prompt_store import PROMPT_INJECTION_SYSTEM_PROMPT


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
        self.assertIn("待分析材料", PROMPT_INJECTION_SYSTEM_PROMPT)
        self.assertIn("不泄露", PROMPT_INJECTION_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
