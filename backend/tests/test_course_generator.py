from pathlib import Path
import tempfile
import unittest

from app.services.course_generator import generate_course


class CourseGeneratorTests(unittest.TestCase):
    def test_generate_course_detects_cpp_cmake_profile(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "README.md").write_text("# Demo\n", encoding="utf-8")
            (root / "CMakeLists.txt").write_text("cmake_minimum_required(VERSION 3.20)\n", encoding="utf-8")
            (root / "src").mkdir()
            (root / "src" / "main.cpp").write_text("int main() { return 0; }\n", encoding="utf-8")

            files = generate_course(root)
            names = [item.filename for item in files]

            self.assertIn("project_map.md", names)
            self.assertIn("lesson_05.md", names)
            outline = (root / ".generated_course" / "outline.md").read_text(encoding="utf-8")
            project_map = (root / ".generated_course" / "project_map.md").read_text(encoding="utf-8")
            self.assertIn("C/C++", outline)
            self.assertIn("技术栈线索", project_map)


if __name__ == "__main__":
    unittest.main()
