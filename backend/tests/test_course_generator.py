from pathlib import Path
import tempfile
import unittest

from app.services.course_generator import generate_course
from app.services.generation_service import PROMPT_INJECTION_SYSTEM_PROMPT, extract_file_signals, hash_inputs


class CourseGeneratorTests(unittest.TestCase):
    def test_generate_course_writes_to_external_course_dir(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "generated" / "1"
            (root / "README.md").write_text("# Demo\n", encoding="utf-8")
            (root / "CMakeLists.txt").write_text("cmake_minimum_required(VERSION 3.20)\n", encoding="utf-8")
            (root / "src").mkdir()
            (root / "src" / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")

            files = generate_course(root, course_dir=output_dir)
            names = [item.filename for item in files]

            self.assertIn("project_map.md", names)
            self.assertIn("lesson_05.md", names)
            self.assertFalse((root / ".generated_course").exists())
            outline = (output_dir / "outline.md").read_text(encoding="utf-8")
            project_map = (output_dir / "project_map.md").read_text(encoding="utf-8")
            self.assertIn("C/C++", outline)
            self.assertIn("技术栈线索", project_map)
            self.assertIn("生成方式", outline)

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
        self.assertIn("不可信输入", PROMPT_INJECTION_SYSTEM_PROMPT)
        self.assertIn("禁止泄露", PROMPT_INJECTION_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
