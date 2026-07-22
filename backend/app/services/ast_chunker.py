"""AST-aware code chunking for CodeCourse index system.

Uses Python stdlib `ast` for .py files and tree-sitter for JS/TS/TSX/JSX.
Other languages use improved pattern-based fallback that respects token limits
and extracts function/class/method boundaries.
"""

from __future__ import annotations

import ast as py_ast
import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

# --- Configuration ---

CHUNK_TARGET_TOKENS = 600
CHUNK_SOFT_LIMIT = 1000
CHUNK_HARD_LIMIT = 1400
CHUNK_MIN_TOKENS = 40
OVERLAP_TOKENS = 50

AST_CAPABLE_SUFFIXES: dict[str, str] = {
    ".py": "python",
}
# tree-sitter capable
TREE_SITTER_SUFFIXES: dict[str, str] = {
    ".ts": "typescript",
    ".tsx": "tsx",
    ".js": "javascript",
    ".jsx": "javascript",
}


@dataclass
class ChunkSpec:
    chunk_type: str
    path: str
    language: str
    start_line: int
    end_line: int
    start_byte: int = 0
    end_byte: int = 0
    symbol_name: Optional[str] = None
    parent_symbol: Optional[str] = None
    qualified_name: Optional[str] = None
    symbol_kind: Optional[str] = None
    signature: Optional[str] = None
    docstring: Optional[str] = None
    content: str = ""
    token_count: int = 0
    fragment_index: int = 0
    fragment_count: int = 0
    parse_status: str = "parsed"
    parser: str = ""
    match_fields: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {
            "chunk_type": self.chunk_type,
            "path": self.path,
            "language": self.language,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "start_byte": self.start_byte,
            "end_byte": self.end_byte,
            "symbol_name": self.symbol_name,
            "parent_symbol": self.parent_symbol,
            "qualified_name": self.qualified_name,
            "symbol_kind": self.symbol_kind,
            "signature": self.signature,
            "docstring": self.docstring,
            "content": self.content,
            "token_count": self.token_count,
            "fragment_index": self.fragment_index,
            "fragment_count": self.fragment_count,
            "parse_status": self.parse_status,
            "parser": self.parser,
            "match_fields": ",".join(self.match_fields) if self.match_fields else None,
        }


# --- Token estimation (simple, language-agnostic) ---

def estimate_tokens(text: str) -> int:
    """Fast token count estimator: ~1 token per 3.5 chars for code, ~1 per word for CJK."""
    code_chars = len(text.encode("utf-8"))
    # Rough heuristic: code averages ~3 bytes per token; CJK ~1.5 bytes per token
    return max(1, code_chars // 3)


# --- Python AST chunker (stdlib ast) ---

def _chunk_python(source: str, rel_path: str) -> list[ChunkSpec]:
    results: list[ChunkSpec] = []
    try:
        tree = py_ast.parse(source)
    except SyntaxError:
        return results  # fallback to line-based

    lines = source.splitlines()

    def _get_text(node: py_ast.AST) -> str:
        try:
            start_lineno = node.lineno
            end_lineno = node.end_lineno or start_lineno
            return "\n".join(lines[start_lineno - 1 : end_lineno])
        except (AttributeError, IndexError):
            return ""

    def _get_docstring(body: list[py_ast.stmt]) -> Optional[str]:
        if body and isinstance(body[0], py_ast.Expr) and isinstance(body[0].value, py_ast.Constant) and isinstance(body[0].value.value, str):
            return body[0].value.value[:500]
        return None

    def _get_name(node: Any) -> Optional[str]:
        if hasattr(node, "name"):
            return str(node.name)
        if isinstance(node, py_ast.FunctionDef):
            return node.name
        if isinstance(node, py_ast.ClassDef):
            return node.name
        return None

    # Helper: build qualified_name from parent chain
    parent_stack: list[str] = []

    # Collect imports first
    import_lines: list[str] = []
    for node in py_ast.iter_child_nodes(tree):
        if isinstance(node, (py_ast.Import, py_ast.ImportFrom)):
            import_lines.append(_get_text(node))
            import_lines[-1] = import_lines[-1].rstrip()

    if import_lines:
        import_text = "\n".join(import_lines)
        if import_text.strip():
            first = import_lines[0].splitlines()[0] if import_lines else ""
            start_l = py_ast.unparse(py_ast.parse(first)).count("\n") + 1 if first else 1
            end_l = len(import_lines)
            for offset, _ in enumerate(import_lines):
                end_l = offset + 1
            results.append(ChunkSpec(
                chunk_type="imports", path=rel_path, language="python",
                start_line=1, end_line=len(import_lines),
                content=f"文件：{rel_path}\n语言：Python\nimport 语句\n\n{import_text}",
                token_count=estimate_tokens(import_text),
                parse_status="parsed", parser="python-ast",
                match_fields=["import"],
            ))

    # Collect top-level symbol names for file_summary
    symbols: list[str] = []
    imports_summary: list[str] = []
    for node in py_ast.iter_child_nodes(tree):
        if isinstance(node, (py_ast.Import, py_ast.ImportFrom)):
            if isinstance(node, py_ast.ImportFrom):
                imports_summary.append(f"from {node.module or ''} import ...")
            else:
                for alias in node.names:
                    imports_summary.append(f"import {alias.name}")
        elif isinstance(node, py_ast.FunctionDef):
            symbols.append(f"def {node.name}")
        elif isinstance(node, py_ast.ClassDef):
            symbols.append(f"class {node.name}")
        elif isinstance(node, py_ast.Assign):
            for target in node.targets:
                if isinstance(target, py_ast.Name):
                    symbols.append(f"var {target.id}")
                    break

    file_doc = py_ast.get_docstring(tree) or ""
    results.append(ChunkSpec(
        chunk_type="file_summary", path=rel_path, language="python",
        start_line=1, end_line=1,
        content=f"文件：{rel_path}\n语言：Python\n符号：{', '.join(symbols[:40])}\n导入：{', '.join(imports_summary[:20])}\n说明：{file_doc[:200]}",
        token_count=estimate_tokens(file_doc) + len(symbols) * 3,
        parse_status="parsed", parser="python-ast",
        match_fields=["path", "symbol"],
    ))

    # Process top-level nodes
    for node in py_ast.iter_child_nodes(tree):
        if isinstance(node, py_ast.FunctionDef):
            chunks = _handle_python_function(node, source, lines, rel_path, tuple(parent_stack))
            results.extend(chunks)
        elif isinstance(node, py_ast.ClassDef):
            chunks = _handle_python_class(node, source, lines, rel_path)
            results.extend(chunks)
        elif isinstance(node, py_ast.AsyncFunctionDef):
            chunks = _handle_python_function(node, source, lines, rel_path, tuple(parent_stack))
            results.extend(chunks)

    # Check coverage and add fragments for uncovered code
    covered = set()
    for r in results:
        for i in range(r.start_line, r.end_line + 1):
            covered.add(i)
    # Find gaps
    code_lines = {i + 1 for i, line in enumerate(lines) if line.strip() and not line.strip().startswith("#")}
    uncovered = sorted(code_lines - covered)
    if uncovered:
        # Group consecutive uncovered lines
        groups = [[uncovered[0]]]
        for ln in uncovered[1:]:
            if ln - groups[-1][-1] <= 1:
                groups[-1].append(ln)
            else:
                groups.append([ln])
        for group in groups:
            start, end = group[0], group[-1]
            body = "\n".join(lines[start - 1 : end])
            if not body.strip():
                continue
            tok = estimate_tokens(body)
            if tok >= CHUNK_MIN_TOKENS:
                results.append(ChunkSpec(
                    chunk_type="code_fragment", path=rel_path, language="python",
                    start_line=start, end_line=end,
                    content=f"文件：{rel_path}\n行号：{start}-{end}\n语言：Python\n\n{body}",
                    token_count=tok,
                    parse_status="partial", parser="python-ast",
                    match_fields=["content"],
                ))

    return results


def _handle_python_function(node: py_ast.FunctionDef | py_ast.AsyncFunctionDef, source: str, lines: list[str], rel_path: str, parents: tuple[str, ...]) -> list[ChunkSpec]:
    name = node.name
    qual = ".".join(list(parents) + [name]) if parents else name
    decorators = ["@" + py_ast.unparse(d) for d in node.decorator_list] if hasattr(node, "decorator_list") else []
    sig_start = node.lineno
    try:
        end = node.end_lineno or sig_start
    except AttributeError:
        end = sig_start
    doc = _get_docstring_ast(node.body)

    # Build content with decorators + signature + body
    body_text = "\n".join(lines[sig_start - 1 : end])
    token_count = estimate_tokens(body_text)

    if token_count <= CHUNK_SOFT_LIMIT:
        # Single chunk for this function
        content_header = f"文件：{rel_path}\n函数：{qual}\n语言：Python"
        if decorators:
            content_header += f"\n装饰器：{' '.join(decorators)}"
        if doc:
            content_header += f"\n文档：{doc[:200]}"
        return [ChunkSpec(
            chunk_type="function", path=rel_path, language="python",
            start_line=sig_start, end_line=end,
            symbol_name=name, parent_symbol=parents[-1] if parents else None,
            qualified_name=qual, symbol_kind="function",
            signature="\n".join(decorators + [lines[sig_start - 1].rstrip()]) if decorators else lines[sig_start - 1].rstrip(),
            docstring=doc,
            content=f"{content_header}\n\n{body_text}",
            token_count=token_count,
            parse_status="parsed", parser="python-ast",
            match_fields=["symbol_name", "qualified_name", "content"],
        )]

    # Long function: split into fragments
    return _split_long_node(
        node, source, lines, rel_path, name, qual, "function",
        decorators, doc, sig_start, end, parents, "python-ast",
    )


def _handle_python_class(node: py_ast.ClassDef, source: str, lines: list[str], rel_path: str) -> list[ChunkSpec]:
    name = node.name
    start = node.lineno
    try:
        end = node.end_lineno or start
    except AttributeError:
        end = start
    bases = [py_ast.unparse(b) for b in node.bases] if hasattr(node, "bases") else []
    doc = _get_docstring_ast(node.body)

    methods: list[str] = []
    chunks: list[ChunkSpec] = []

    for child in node.body:
        if isinstance(child, (py_ast.FunctionDef, py_ast.AsyncFunctionDef)):
            methods.append(child.name)
            sub = _handle_python_function(child, source, lines, rel_path, (name,))
            for s in sub:
                s.parent_symbol = name
                s.qualified_name = f"{name}.{s.symbol_name}"
            chunks.extend(sub)

    # Class overview
    full_text = "\n".join(lines[start - 1 : end])
    token_count = estimate_tokens(full_text)

    # If short class, include full body
    if token_count <= CHUNK_SOFT_LIMIT:
        overview = ChunkSpec(
            chunk_type="class", path=rel_path, language="python",
            start_line=start, end_line=end,
            symbol_name=name, symbol_kind="class",
            qualified_name=name,
            signature=f"class {name}" + (f"({', '.join(bases)})" if bases else ""),
            docstring=doc,
            content=f"文件：{rel_path}\n类：{name}\n基类：{', '.join(bases)}\n方法：{', '.join(methods[:50])}\n\n{full_text}",
            token_count=token_count,
            parse_status="parsed", parser="python-ast",
            match_fields=["symbol_name", "qualified_name", "content"],
        )
        chunks.insert(0, overview)
        return chunks

    # Long class: overview + individual methods
    overview_text = f"文件：{rel_path}\n类：{name}\n语言：Python\n基类：{', '.join(bases)}\n方法列表：{', '.join(methods[:80])}\n文档：{doc or '无'}"
    overview = ChunkSpec(
        chunk_type="class", path=rel_path, language="python",
        start_line=start, end_line=start,
        symbol_name=name, symbol_kind="class",
        qualified_name=name,
        signature=f"class {name}" + (f"({', '.join(bases)})" if bases else ""),
        docstring=doc,
        content=overview_text,
        token_count=estimate_tokens(overview_text),
        parse_status="parsed", parser="python-ast",
        match_fields=["symbol_name", "qualified_name", "symbol"],
    )
    chunks.insert(0, overview)
    return chunks


def _get_docstring_ast(body: list[py_ast.stmt]) -> Optional[str]:
    if body and isinstance(body[0], py_ast.Expr) and isinstance(body[0].value, py_ast.Constant) and isinstance(body[0].value.value, str):
        return body[0].value.value[:500]
    return None


def _split_long_node(node: py_ast.AST, source: str, lines: list[str], rel_path: str, name: str, qual: str, symbol_kind: str, decorators: list[str], doc: Optional[str], start: int, end: int, parents: tuple[str, ...], parser: str) -> list[ChunkSpec]:
    """Split a long function/class into statement-level fragments."""
    chunks: list[ChunkSpec] = []
    sig_line = lines[start - 1].rstrip()
    sig_text = "\n".join(decorators + [sig_line]) if decorators else sig_line

    # Get the body statements (skip decorators + signature + docstring)
    body_start = start + 1  # skip sig line
    if doc:
        # Find where docstring ends
        for i in range(start, min(end, start + 5)):
            if '"""' in lines[i] or "'''" in lines[i]:
                body_start = i + 1
                break

    # Group remaining lines into statement blocks
    statements: list[tuple[int, int, int, str]] = []  # (start_line, end_line, tokens, text)
    current: list[str] = []
    current_start = body_start
    current_tokens = 0

    for i in range(body_start - 1, end):
        line = lines[i]
        current.append(line + "\n")
        current_tokens += estimate_tokens(line) + 1

        if current_tokens >= CHUNK_TARGET_TOKENS and i > body_start:
            # Check if this is a clean break point (ends with a complete statement)
            stripped = line.strip()
            if stripped.endswith((":", "pass", "return ...", ")", "}", "]")) or not stripped:
                text = "".join(current)
                statements.append((current_start, i + 1, current_tokens, text))
                current = []
                current_start = i + 2
                current_tokens = 0

    # Remaining lines
    if current:
        text = "".join(current)
        statements.append((current_start, end, current_tokens, text))

    total = len(statements)
    for idx, (s, e, tok, text) in enumerate(statements):
        chunks.append(ChunkSpec(
            chunk_type=symbol_kind,
            path=rel_path, language="python",
            start_line=s,
            end_line=e,
            symbol_name=name,
            parent_symbol=parents[-1] if parents else None,
            qualified_name=qual,
            symbol_kind=symbol_kind,
            signature=sig_text[:500],
            docstring=doc,
            content=f"文件：{rel_path}\n{symbol_kind}：{qual}\n片段：{idx + 1}/{total}\n签名：{sig_text[:300]}\n\n{text}",
            token_count=tok,
            fragment_index=idx + 1,
            fragment_count=total,
            parse_status="parsed",
            parser=parser,
            match_fields=["symbol_name", "qualified_name", "content"],
        ))
    return chunks


# --- Tree-sitter chunker (JS/TS/TSX/JSX) ---

def _chunk_ts_with_tree_sitter(source: str, rel_path: str, lang: str) -> list[ChunkSpec]:
    """Use tree-sitter for TypeScript/JavaScript AST chunking."""
    try:
        import tree_sitter_javascript as tsjs
        import tree_sitter_typescript as tsts
        from tree_sitter import Language, Parser
    except ImportError:
        return []  # fallback to regex

    try:
        if lang == "typescript":
            ts_lang = Language(tsts.language_typescript())
        elif lang == "tsx":
            ts_lang = Language(tsts.language_tsx())
        else:
            ts_lang = Language(tsjs.language())
    except Exception:
        return []

    parser = Parser(ts_lang)
    source_bytes = source.encode("utf-8")
    tree = parser.parse(source_bytes)
    root = tree.root_node
    lines = source.splitlines()

    results: list[ChunkSpec] = []
    import_parts: list[str] = []

    def _node_text(node: Any) -> str:
        return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    def _node_lines(node: Any) -> tuple[int, int]:
        return node.start_point[0] + 1, node.end_point[0] + 1

    # Walk children
    def walk(node: Any, parent_class: Optional[str] = None):
        nonlocal import_parts
        for child in node.children:
            kind = child.type

            # Recurse into wrapper nodes
            if kind in ("export_statement", "export", "decorator", "ambient_declaration"):
                walk(child, parent_class)
                continue

            # Handle imports at root level only
            if kind in ("import_statement", "import") and not parent_class:
                import_parts.append(source_bytes[child.start_byte:child.end_byte].decode("utf-8", errors="replace"))
                continue

            if kind in ("function_declaration", "method_definition", "arrow_function", "function_expression", "generator_function"):
                name_node = child.child_by_field_name("name")
                name = _node_text(name_node) if name_node else f"anonymous_{child.start_point[0]}"
                qual = f"{parent_class}.{name}" if parent_class else name
                start_l, end_l = _node_lines(child)
                body_text = _node_text(child)
                tok = estimate_tokens(body_text)

                results.append(ChunkSpec(
                    chunk_type="method" if parent_class else "function",
                    path=rel_path, language=lang,
                    start_line=start_l, end_line=end_l,
                    symbol_name=name,
                    parent_symbol=parent_class,
                    qualified_name=qual,
                    symbol_kind="method" if parent_class else "function",
                    content=f"文件：{rel_path}\n函数：{qual}\n语言：{lang}\n\n{body_text}",
                    token_count=tok,
                    parse_status="parsed", parser="tree-sitter",
                    match_fields=["symbol_name", "qualified_name", "content"],
                ))
            elif kind in ("class_declaration", "class"):
                name_node = child.child_by_field_name("name")
                name = _node_text(name_node) if name_node else f"Anonymous_{child.start_point[0]}"
                start_l, end_l = _node_lines(child)
                body_text = _node_text(child)
                tok = estimate_tokens(body_text)

                results.append(ChunkSpec(
                    chunk_type="class", path=rel_path, language=lang,
                    start_line=start_l, end_line=end_l,
                    symbol_name=name, symbol_kind="class",
                    qualified_name=name,
                    content=f"文件：{rel_path}\n类：{name}\n语言：{lang}\n\n{body_text}",
                    token_count=tok,
                    parse_status="parsed", parser="tree-sitter",
                    match_fields=["symbol_name", "qualified_name", "content"],
                ))
                # Recurse into class body for methods
                body = child.child_by_field_name("body")
                if body:
                    walk(body, name)
            elif kind in ("interface_declaration", "enum_declaration", "type_alias_declaration"):
                name_node = child.child_by_field_name("name")
                name = _node_text(name_node) if name_node else f"Type_{child.start_point[0]}"
                start_l, end_l = _node_lines(child)
                body_text = _node_text(child)

                results.append(ChunkSpec(
                    chunk_type=kind.replace("_declaration", ""), path=rel_path, language=lang,
                    start_line=start_l, end_line=end_l,
                    symbol_name=name,
                    qualified_name=name,
                    symbol_kind=kind.replace("_declaration", ""),
                    content=f"文件：{rel_path}\n{kind}：{name}\n语言：{lang}\n\n{body_text}",
                    token_count=estimate_tokens(body_text),
                    parse_status="parsed", parser="tree-sitter",
                    match_fields=["symbol_name", "qualified_name", "content"],
                ))
            elif kind == "program":
                walk(child)
            elif kind in ("expression_statement", "variable_declaration", "lexical_declaration"):
                # Top-level declarations
                start_l, end_l = _node_lines(child)
                body_text = _node_text(child)
                tok = estimate_tokens(body_text)
                if tok >= CHUNK_MIN_TOKENS:
                    results.append(ChunkSpec(
                        chunk_type="constant", path=rel_path, language=lang,
                        start_line=start_l, end_line=end_l,
                        content=f"文件：{rel_path}\n声明\n语言：{lang}\n\n{body_text}",
                        token_count=tok,
                        parse_status="parsed", parser="tree-sitter",
                        match_fields=["content"],
                    ))

    walk(root)

    # Add imports chunk if any were collected during walk
    if import_parts:
        results.insert(0, ChunkSpec(
            chunk_type="imports", path=rel_path, language=lang,
            start_line=1, end_line=root.children[0].end_point[0] + 1,
            content=f"文件：{rel_path}\n语言：{lang}\nimport 语句\n\n" + "\n".join(import_parts),
            token_count=estimate_tokens("\n".join(import_parts)),
            parse_status="parsed", parser="tree-sitter",
            match_fields=["import"],
        ))

    # File summary for TS/JS
    symbols: list[str] = []
    import_summary: list[str] = []
    for c in results:
        if c.chunk_type == "imports":
            import_summary.append("imports present")
        elif c.symbol_name:
            kind = c.chunk_type or "symbol"
            symbols.append(f"{kind}:{c.symbol_name}")
    if symbols or import_summary:
        results.insert(0, ChunkSpec(
            chunk_type="file_summary", path=rel_path, language=lang,
            start_line=1, end_line=1,
            content=f"文件：{rel_path}\n语言：{lang}\n符号：{', '.join(symbols[:40])}\n导入：{', '.join(import_summary[:20])}",
            token_count=estimate_tokens(", ".join(symbols)) + 10,
            parse_status="parsed", parser="tree-sitter",
            match_fields=["path", "symbol"],
        ))

    return results


# --- Improved pattern-based chunker (fallback for unsupported languages) ---

# Regex patterns to find function/class/method boundaries
_FUNC_PATTERNS: dict[str, re.Pattern] = {
    "java": re.compile(
        r"((?:(?:@\w+(?:\([^)]*\))?\s*)*)"  # annotations
        r"((?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*"
        r"(?:<[^>]+>\s+)?"  # generics
        r"(\w+(?:\s*\[\])?(?:\s*\.\.\.)?)\s+"  # return type
        r"(\w+)\s*"  # name
        r"\([^)]*\)\s*(?:throws\s+\w[\w,.\s]*)?"  # params + throws
        r"\s*\{)",  # opening brace
        re.MULTILINE,
    ),
    "kotlin": re.compile(
        r"(?:(?:@\w+(?:\([^)]*\))?\s*)*)"
        r"((?:public|private|protected|internal|open|abstract|final|override|suspend|inline|data|sealed)\s+)*"
        r"(?:fun|class|interface|object|enum\s+class|data\s+class|sealed\s+class)\s+"
        r"(\w+)\s*"
        r"(?:<[^>]+>\s*)?"
        r"(?:\([^)]*\)\s*(?::\s*\w+)?\s*)"
        r"\{?",
        re.MULTILINE,
    ),
    "c": re.compile(
        r"(?:(\w+(?:\s*\*+)?)\s+)"  # return type
        r"(\w+)\s*\([^)]*\)\s*"  # name(params)
        r"\{",
        re.MULTILINE,
    ),
    "cpp": re.compile(
        r"(?:(?:virtual|static|const|inline|explicit|override|final|noexcept)\s+)*"
        r"(?:(\w+(?:::?\w+)*(?:\s*[*&<>,]+)*)\s+)"  # return type
        r"(?:(\w+::))?"  # class prefix
        r"(\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:noexcept\s*)?"
        r"(?:override\s*)?(?:final\s*)?"
        r"\{",
        re.MULTILINE,
    ),
    "rust": re.compile(
        r"""(?:#\[[\w()".,=]+\]\s*)*"""  # attributes
        r"""(?:pub(?:\s*\(\s*(?:crate|super|self)\s*\))?\s+)?"""
        r"""(?:async\s+)?(?:unsafe\s+)?(?:extern\s+(?:"[^"]*"\s+))?"""
        r"""(?:fn|struct|enum|trait|impl(?:<[^>]+>)?(?:\s+for)?)\s+"""
        r"""(\w+)\s*"""
        r"""(?:<[^>]+>\s*)?"""
        r"""\([^)]*\)\s*(?:->\s*\S+)?\s*"""
        r"""\{?""",
        re.MULTILINE,
    ),
    "go": re.compile(
        r"(?:func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?"  # receiver
        r"(\w+)\s*\([^)]*\)\s*"  # name(params)
        r"(?:\([^)]*\)\s*)?)"  # returns
        r"\{",
        re.MULTILINE,
    ),
}

_CLASS_PATTERNS: dict[str, re.Pattern] = {
    "java": re.compile(
        r"((?:public|private|protected|abstract|final|static)\s+)*"
        r"(?:class|interface|enum)\s+(\w+)"
        r"(?:\s+extends\s+\w+)?"
        r"(?:\s+implements\s+[\w,\s]+)?"
        r"\s*\{",
        re.MULTILINE,
    ),
    "cpp": re.compile(
        r"(?:class|struct|enum\s+class|enum)\s+(\w+)" + r"(?:\s*:\s*[^{]+)?\s*\{",
        re.MULTILINE,
    ),
    "rust": re.compile(r"(?:struct|enum|trait|impl)\s+(\w+)", re.MULTILINE),
    "go": re.compile(r"type\s+(\w+)\s+struct\s*\{", re.MULTILINE),
}


def _chunk_pattern_fallback(source: str, rel_path: str, lang: str) -> list[ChunkSpec]:
    """Improved pattern-based chunking. Better than old line-based approach."""
    lines = source.splitlines()
    results: list[ChunkSpec] = []

    def _add_chunk(chunk_type: str, start: int, end: int, symbol_name: Optional[str] = None, extra: Optional[str] = None):
        body = "\n".join(lines[start - 1:end])
        tok = estimate_tokens(body)

        if tok > CHUNK_HARD_LIMIT:
            # Split long pattern-matched blocks
            _add_line_chunks(chunk_type, start, end, body, symbol_name)
            return

        header = f"文件：{rel_path}\n行号：{start}-{end}\n语言：{lang}"
        if symbol_name:
            header += f"\n符号：{symbol_name}"
            if extra:
                header += f"\n{extra}"
        results.append(ChunkSpec(
            chunk_type=chunk_type, path=rel_path, language=lang,
            start_line=start, end_line=end,
            symbol_name=symbol_name,
            content=f"{header}\n\n{body}",
            token_count=tok,
            parse_status="fallback", parser="pattern",
            match_fields=["symbol_name"] if symbol_name else ["content"],
        ))

    def _add_line_chunks(chunk_type: str, start: int, end: int, body: str, symbol_name: Optional[str] = None):
        body_lines = body.splitlines()
        step = max(1, CHUNK_TARGET_TOKENS)
        total = max(1, len(body_lines) // step + (1 if len(body_lines) % step else 0))
        for i in range(0, len(body_lines), step):
            block = "\n".join(body_lines[i:i + step]).strip()
            if not block:
                continue
            frag_start = start + i
            frag_end = min(end, frag_start + step - 1)
            header = f"文件：{rel_path}\n行号：{frag_start}-{frag_end}\n语言：{lang}"
            if symbol_name:
                header += f"\n符号：{symbol_name}"
            results.append(ChunkSpec(
                chunk_type=chunk_type, path=rel_path, language=lang,
                start_line=frag_start, end_line=frag_end,
                symbol_name=symbol_name,
                content=f"{header}\n\n{block}",
                token_count=estimate_tokens(block),
                fragment_index=i // step + 1, fragment_count=total,
                parse_status="fallback", parser="pattern",
                match_fields=["symbol_name"] if symbol_name else ["content"],
            ))

    # Try to match functions
    func_pattern = _FUNC_PATTERNS.get(lang)
    if func_pattern:
        for match in func_pattern.finditer(source):
            start = source[:match.start()].count("\n") + 1
            # Find matching closing brace
            brace_count = 0
            end = start
            in_match = False
            for i, line in enumerate(lines[start - 1:], start=start):
                brace_count += line.count("{") - line.count("}")
                if brace_count <= 0 and in_match:
                    end = i
                    break
                in_match = True
            if end < start:
                end = start
            symbol_name = match.group(match.lastindex or 1) if match.lastindex and match.lastindex >= 1 else None
            if symbol_name:
                _add_chunk("function", start, end, symbol_name)

    # Try to match classes
    class_pattern = _CLASS_PATTERNS.get(lang)
    if class_pattern:
        for match in class_pattern.finditer(source):
            start = source[:match.start()].count("\n") + 1
            brace_count = 0
            end = start
            in_match = False
            for i, line in enumerate(lines[start - 1:], start=start):
                brace_count += line.count("{") - line.count("}")
                if brace_count <= 0 and in_match:
                    end = i
                    break
                in_match = True
            if end < start:
                end = start
            groups = match.groups()
            symbol_name = groups[0] if groups else None
            if symbol_name:
                _add_chunk("class", start, end, symbol_name)

    # If no patterns matched or gaps remain, cover with line chunks
    covered = set()
    for r in results:
        for i in range(r.start_line, r.end_line + 1):
            covered.add(i)
    non_empty = {i + 1 for i, l in enumerate(lines) if l.strip()}
    uncovered = sorted(non_empty - covered)

    if uncovered:
        groups = [[uncovered[0]]]
        for ln in uncovered[1:]:
            if ln - groups[-1][-1] <= 2:
                groups[-1].append(ln)
            else:
                groups.append([ln])
        for group in groups:
            body = "\n".join(lines[g - 1] for g in group)
            if not body.strip():
                continue
            _add_chunk("line_fallback", group[0], group[-1])

    return results


# --- Main entry point ---

def chunk_file(rel_path: str, source: str, language: str) -> list[ChunkSpec]:
    """AST-aware file chunking with language dispatch and fallback."""
    suffix = Path(rel_path).suffix.lower()
    results: list[ChunkSpec] = []

    # Try Python AST first (stdlib, guaranteed to work)
    if suffix == ".py":
        results = _chunk_python(source, rel_path)

    # Try tree-sitter for TS/JS
    elif suffix in (".ts", ".tsx", ".js", ".jsx"):
        lang = TREE_SITTER_SUFFIXES.get(suffix, "javascript")
        try:
            results = _chunk_ts_with_tree_sitter(source, rel_path, lang)
        except Exception:
            results = []
        if not results:
            results = _chunk_pattern_fallback(source, rel_path, language)

    # Pattern-based for other languages
    elif language in _FUNC_PATTERNS:
        results = _chunk_pattern_fallback(source, rel_path, language)

    # If no results from AST/pattern, use old-style line chunks as last resort
    if not results:
        results = _line_chunks_legacy(source, rel_path, language)

    return results


def _line_chunks_legacy(source: str, rel_path: str, language: str) -> list[ChunkSpec]:
    """Legacy line-based chunking with token limits instead of line limits."""
    lines = source.splitlines()
    results: list[ChunkSpec] = []
    current: list[str] = []
    current_tokens = 0
    current_start = 1

    for i, line in enumerate(lines, 1):
        line_tokens = estimate_tokens(line) + 1
        if current_tokens + line_tokens > CHUNK_TARGET_TOKENS and current:
            chunk_text = "\n".join(current)
            if chunk_text.strip():
                results.append(ChunkSpec(
                    chunk_type="line_fallback", path=rel_path, language=language,
                    start_line=current_start, end_line=i - 1,
                    content=f"文件：{rel_path}\n行号：{current_start}-{i - 1}\n语言：{language}\n\n{chunk_text}",
                    token_count=current_tokens,
                    parse_status="fallback", parser="line-based",
                    match_fields=["content"],
                ))
            current = []
            current_start = i
            current_tokens = 0
        current.append(line)
        current_tokens += line_tokens

    # Remaining
    if current:
        chunk_text = "\n".join(current)
        if chunk_text.strip():
            results.append(ChunkSpec(
                chunk_type="line_fallback", path=rel_path, language=language,
                start_line=current_start, end_line=len(lines),
                content=f"文件：{rel_path}\n行号：{current_start}-{len(lines)}\n语言：{language}\n\n{chunk_text}",
                token_count=current_tokens,
                parse_status="fallback", parser="line-based",
                match_fields=["content"],
            ))

    return results
