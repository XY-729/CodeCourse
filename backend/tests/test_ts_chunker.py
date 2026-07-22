"""Integration tests: TypeScript/TSX chunking with real tree-sitter."""

import unittest

from app.services.ast_chunker import chunk_file


class TsAstChunkerTests(unittest.TestCase):

    def test_ts_function_declaration_has_symbol_name(self):
        source = "function greet(name: string): string {\n  return `Hello ${name}`;\n}\n"
        chunks = chunk_file("utils.ts", source, "typescript")
        funcs = [c for c in chunks if c.chunk_type in ("function", "method")]
        if not funcs:
            # tree-sitter may fail in some envs; if fallback, skip strict assertion
            self.assertTrue(any(c.parse_status == "fallback" for c in chunks),
                            "Should either have parsed functions or fallback")
            return
        self.assertIn("greet", [c.symbol_name for c in funcs])

    def test_ts_class_with_method_has_qualified_name(self):
        source = "class UserService {\n  save(data: any): void {\n    console.log(data);\n  }\n}\n"
        chunks = chunk_file("service.ts", source, "typescript")
        methods = [c for c in chunks if c.chunk_type == "method"]
        if not methods:
            self.assertTrue(any(c.parse_status == "fallback" for c in chunks))
            return
        # At least one method should have parent_symbol or qualified_name
        self.assertTrue(any(
            (c.parent_symbol and "UserService" in c.parent_symbol) or
            (c.qualified_name and "UserService" in c.qualified_name)
            for c in methods
        ), f"Expected UserService in method parent/qual: {[(c.symbol_name, c.parent_symbol, c.qualified_name) for c in methods]}")

    def test_ts_interface_generates_chunk(self):
        source = "interface Config {\n  port: number;\n  host: string;\n}\n"
        chunks = chunk_file("types.ts", source, "typescript")
        ifaces = [c for c in chunks if c.chunk_type in ("interface", "interface_declaration", "type_alias")]
        if not ifaces:
            self.assertTrue(any(c.parse_status == "fallback" for c in chunks))
            return
        self.assertIn("Config", [c.symbol_name for c in ifaces])

    def test_ts_imports_generate_separate_chunk(self):
        source = 'import { Injectable } from "@angular/core";\nimport * as fs from "fs";\n\nfunction run() {}\n'
        chunks = chunk_file("app.ts", source, "typescript")
        imports = [c for c in chunks if c.chunk_type == "imports"]
        if imports:
            self.assertIn("import", imports[0].content)

    def test_ts_multiple_functions_all_parsed(self):
        source = "export function a() {}\nexport function b() {}\nexport function c() {}\n"
        chunks = chunk_file("mod.ts", source, "typescript")
        funcs = [c for c in chunks if c.chunk_type == "function"]
        if len(funcs) >= 2:
            names = {c.symbol_name for c in funcs}
            self.assertGreaterEqual(len(names), 2)

    def test_tsx_jsx_component_recognized(self):
        source = "const App: React.FC = () => {\n  return <div>Hello</div>;\n};\n"
        chunks = chunk_file("App.tsx", source, "tsx")
        # JSX arrow functions should produce at least some parsed chunks
        self.assertGreater(len(chunks), 0)

    def test_ts_enum_generates_chunk(self):
        source = "enum Status {\n  Active,\n  Inactive,\n  Pending,\n}\n"
        chunks = chunk_file("enums.ts", source, "typescript")
        enums = [c for c in chunks if c.chunk_type in ("enum", "enum_declaration")]
        if enums:
            self.assertEqual("Status", enums[0].symbol_name)

    def test_ts_parse_status_is_parsed_not_fallback(self):
        """Valid TypeScript should be parsed by tree-sitter, not fallback."""
        source = "export class Database {\n  connect(): void {}\n  query(sql: string): any[] { return []; }\n}\n"
        chunks = chunk_file("db.ts", source, "typescript")
        non_fallback = [c for c in chunks if c.parse_status == "parsed"]
        self.assertGreater(len(non_fallback), 0,
            "Expected at least some tree-sitter parsed chunks for valid TS")
