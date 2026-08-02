from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from app.services.code_intelligence import (
    HybridProvider,
    RetrievalSource,
    build_structural_index,
    structural_retrieve,
)


class _StaticProvider:
    def __init__(self, sources):
        self.sources = sources

    def retrieve(self, project_id, query, **kwargs):
        return list(self.sources)


class CodeIntelligenceTests(TestCase):
    def test_hybrid_provider_prefers_structural_and_deduplicates_fts(self):
        structural = RetrievalSource(
            path="src/main.py",
            start_line=4,
            end_line=12,
            symbol_name="run",
            relation="CALLS",
            provider="codebase-memory-mcp",
            score=90,
        )
        duplicate_fts = RetrievalSource(
            path="src/main.py",
            start_line=4,
            end_line=12,
            symbol_name="run",
            provider="fts",
            score=40,
        )
        fallback = RetrievalSource(path="src/config.py", start_line=1, end_line=8, provider="fts", score=30)
        provider = HybridProvider(_StaticProvider([structural]), _StaticProvider([duplicate_fts, fallback]))

        results = provider.retrieve(1, "who calls run", source_path="src/main.py", limit=8)

        self.assertEqual([item.path for item in results], ["src/main.py", "src/config.py"])
        self.assertEqual(results[0].provider, "codebase-memory-mcp")

    @patch("app.services.code_intelligence.structural_available", return_value=True)
    @patch("app.services.code_intelligence.get_project_index_status")
    @patch("app.services.code_intelligence._run_tool")
    def test_structural_retrieval_uses_search_graph_and_call_trace(self, run_tool, index_status, _available):
        index_status.return_value = {
            "structural_status": "completed",
            "structural_project_name": "codecourse-1",
        }

        def result_for(tool, payload, **_kwargs):
            if tool == "trace_path":
                return {
                    "callers": [
                        {
                            "name": "caller",
                            "qualified_name": "codecourse-1.src.caller.caller",
                            "hop": 1,
                        }
                    ]
                }
            if payload.get("qn_pattern"):
                return {
                    "results": [
                        {
                            "file_path": "src/caller.py",
                            "start_line": 9,
                            "end_line": 15,
                            "name": "caller",
                            "qualified_name": "codecourse-1.src.caller.caller",
                        }
                    ]
                }
            return {"results": [{"file_path": "src/main.py", "start_line": 4, "end_line": 12, "name": "run"}]}

        run_tool.side_effect = result_for
        results = structural_retrieve(
            1,
            "who calls run",
            source_path="src/main.py",
            selected_text="run",
            limit=8,
        )

        tool_names = [call.args[0] for call in run_tool.call_args_list]
        self.assertNotIn("semantic_query", tool_names)
        self.assertIn("search_graph", tool_names)
        self.assertIn("trace_path", tool_names)
        first_search = next(call for call in run_tool.call_args_list if call.args[0] == "search_graph")
        self.assertEqual(first_search.args[1]["format"], "json")
        self.assertIsInstance(first_search.args[1]["semantic_query"], list)
        self.assertTrue(any(item.path == "src/caller.py" for item in results))

    @patch("app.services.code_intelligence.structural_available", return_value=True)
    @patch("app.services.code_intelligence.get_project_index_status")
    @patch("app.services.code_intelligence._run_tool")
    def test_structural_file_pattern_union_includes_context_files(self, run_tool, index_status, _available):
        index_status.return_value = {
            "structural_status": "completed",
            "structural_project_name": "codecourse-1",
        }
        run_tool.return_value = {"results": []}

        structural_retrieve(
            1,
            "how does scheduler start",
            source_path="src/main.py",
            context_files=["src/scheduler.py", "src/worker\\task.py"],
            limit=8,
        )

        search_calls = [
            call for call in run_tool.call_args_list if call.args[0] == "search_graph"
        ]
        self.assertTrue(search_calls)
        file_pattern = search_calls[0].args[1]["file_pattern"]
        self.assertIn("src/main\\.py", file_pattern)
        self.assertIn("src/scheduler\\.py", file_pattern)
        # Windows backslash path normalized and regex-escaped
        self.assertIn("src/worker/task\\.py", file_pattern)
        self.assertIn("|", file_pattern)
        # Grouping parens around the union so alternation binds to the full path
        self.assertTrue(file_pattern.startswith(".*(") and file_pattern.endswith(").*"))

    @patch("app.services.code_intelligence.structural_available", return_value=True)
    @patch("app.services.code_intelligence.get_project_index_status")
    @patch("app.services.code_intelligence._run_tool")
    def test_structural_file_pattern_stays_source_only_without_context_files(self, run_tool, index_status, _available):
        index_status.return_value = {
            "structural_status": "completed",
            "structural_project_name": "codecourse-1",
        }
        run_tool.return_value = {"results": []}

        structural_retrieve(1, "who calls run", source_path="src/main.py", limit=8)

        search_calls = [
            call for call in run_tool.call_args_list if call.args[0] == "search_graph"
        ]
        self.assertTrue(search_calls)
        file_pattern = search_calls[0].args[1]["file_pattern"]
        self.assertEqual(file_pattern, ".*(src/main\\.py).*")

    @patch("app.services.code_intelligence.structural_available", return_value=True)
    @patch("app.services.code_intelligence.get_project_index_status")
    @patch("app.services.code_intelligence._run_tool")
    def test_structural_no_source_path_no_context_files_omits_file_pattern(self, run_tool, index_status, _available):
        index_status.return_value = {
            "structural_status": "completed",
            "structural_project_name": "codecourse-1",
        }
        run_tool.return_value = {"results": []}

        structural_retrieve(1, "project architecture", limit=8)

        search_calls = [
            call for call in run_tool.call_args_list if call.args[0] == "search_graph"
        ]
        self.assertTrue(search_calls)
        self.assertNotIn("file_pattern", search_calls[0].args[1])

    @patch("app.services.code_intelligence._resolve_engine_project_name", return_value="codecourse-7")
    @patch("app.services.code_intelligence._run_tool")
    @patch("app.services.code_intelligence.sync_analysis_snapshot", return_value=Path("C:/snapshots/7"))
    def test_structural_build_disables_repository_persistence(self, _snapshot, run_tool, _resolve):
        run_tool.return_value = {"node_count": 12, "edge_count": 8}

        result = build_structural_index(7, "fingerprint")

        payload = run_tool.call_args.args[1]
        self.assertEqual(payload["name"], "codecourse-7")
        self.assertEqual(payload["mode"], "full")
        self.assertFalse(payload["persistence"])
        self.assertEqual(result["indexed_fingerprint"], "fingerprint")
