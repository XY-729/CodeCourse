"""Tests for AST-aware chunking."""

import unittest

from app.services.ast_chunker import ChunkSpec, chunk_file, estimate_tokens


class AstChunkerTests(unittest.TestCase):

    # --- Python ---

    def test_python_simple_function_is_kept_whole(self):
        source = "def add(a, b):\n    return a + b\n"
        chunks = chunk_file("main.py", source, "python")
        funcs = [c for c in chunks if c.chunk_type == "function"]
        self.assertGreaterEqual(len(funcs), 1)
        self.assertEqual("add", funcs[0].symbol_name)
        self.assertEqual("add", funcs[0].qualified_name)
        # Not split
        self.assertEqual(0, funcs[0].fragment_index)

    def test_python_two_functions_generate_two_chunks(self):
        source = "def foo():\n    pass\n\ndef bar():\n    pass\n"
        chunks = chunk_file("mod.py", source, "python")
        funcs = [c for c in chunks if c.chunk_type == "function"]
        self.assertEqual(2, len(funcs))
        names = {c.symbol_name for c in funcs}
        self.assertEqual({"foo", "bar"}, names)

    def test_python_decorator_stays_with_function(self):
        source = "@app.route('/')\n@auth_required\ndef home():\n    return 'ok'\n"
        chunks = chunk_file("views.py", source, "python")
        funcs = [c for c in chunks if c.chunk_type == "function"]
        self.assertGreaterEqual(len(funcs), 1)
        content = funcs[0].content
        self.assertIn("@app.route", content)

    def test_python_class_methods_have_parent_symbol(self):
        source = "class Service:\n    def process(self, data):\n        return data\n"
        chunks = chunk_file("svc.py", source, "python")
        methods = [c for c in chunks if c.chunk_type == "method" or (c.chunk_type == "function" and c.parent_symbol)]
        self.assertGreaterEqual(len(methods), 1)
        m = methods[0]
        self.assertIn("Service", m.parent_symbol or m.qualified_name or "")
        self.assertEqual("process", m.symbol_name)

    def test_python_imports_generate_separate_chunk(self):
        source = "import os\nfrom pathlib import Path\n\n\ndef main():\n    pass\n"
        chunks = chunk_file("app.py", source, "python")
        imports = [c for c in chunks if c.chunk_type == "imports"]
        self.assertGreaterEqual(len(imports), 1)
        self.assertIn("import os", imports[0].content)

    def test_python_file_summary_does_not_contain_full_body(self):
        source = "# Doc\n\ndef run():\n    x = 1\n    y = 2\n    return x + y\n"
        chunks = chunk_file("main.py", source, "python")
        summaries = [c for c in chunks if c.chunk_type == "file_summary"]
        self.assertGreaterEqual(len(summaries), 1)
        # File summary should not contain the full function body
        self.assertNotIn("x = 1", summaries[0].content)
        self.assertNotIn("return x + y", summaries[0].content)

    def test_python_qualified_name_is_correct(self):
        source = "class A:\n    def b(self):\n        return 1\n"
        chunks = chunk_file("mod.py", source, "python")
        funcs = [c for c in chunks if c.symbol_kind == "function" or c.chunk_type == "method"]
        self.assertTrue(any("A.b" in (c.qualified_name or "") for c in funcs))

    # --- Syntax error fallback ---

    def test_syntax_error_still_produces_chunks(self):
        source = "def broken(\n    x = {invalid\n\nprint('ok')\n"
        chunks = chunk_file("bad.py", source, "python")
        # Should fallback to line-based without crashing
        self.assertGreater(len(chunks), 0)
        self.assertTrue(any(c.parse_status == "fallback" for c in chunks))

    # --- Unsupported language fallback ---

    def test_unsupported_language_falls_back(self):
        source = "void main() {\n    printf(\"hello\");\n}\n"
        chunks = chunk_file("app.c", source, "c")
        self.assertGreater(len(chunks), 0)
        self.assertTrue(all(c.parse_status in ("fallback", "parsed") for c in chunks))

    # --- Token estimation ---

    def test_estimate_tokens_is_reasonable(self):
        self.assertGreater(estimate_tokens("hello world"), 0)
        self.assertLess(estimate_tokens("hello"), 10)
        long_text = "def func():\n    " + "x = 1\n" * 100
        self.assertGreater(estimate_tokens(long_text), 20)

    # --- ChunkSpec serialization ---

    def test_chunkspec_to_dict_has_all_fields(self):
        spec = ChunkSpec(
            chunk_type="function", path="a.py", language="python",
            start_line=1, end_line=5, symbol_name="foo", qualified_name="foo",
            parent_symbol=None, symbol_kind="function",
            content="def foo():\n    pass\n", token_count=5,
            parse_status="parsed", parser="python-ast",
            match_fields=["symbol_name", "qualified_name"],
        )
        d = spec.to_dict()
        self.assertEqual("function", d["chunk_type"])
        self.assertEqual("foo", d["symbol_name"])
        self.assertEqual("foo", d["qualified_name"])
        self.assertEqual("parsed", d["parse_status"])
        self.assertEqual("python-ast", d["parser"])
        self.assertIn("symbol_name,qualified_name", d.get("match_fields", ""))

    # --- Regression: old line-based is no longer used for Python ---

    def test_python_no_longer_uses_line_fallback_for_valid_source(self):
        source = "def a():\n    pass\n\ndef b():\n    pass\n\ndef c():\n    pass\n"
        chunks = chunk_file("mod.py", source, "python")
        non_fallback = [c for c in chunks if c.parse_status == "parsed" and c.chunk_type != "file_summary"]
        self.assertGreater(len(non_fallback), 0)
        # At least functions A, B, C should be individual chunks
        funcs = [c for c in chunks if c.chunk_type == "function"]
        self.assertGreaterEqual(len(funcs), 2)
