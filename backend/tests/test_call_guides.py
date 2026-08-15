import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.models.schemas import CallGuideCandidate
from app.services.call_guide_service import (
    CallGuideError,
    _resolve_details,
    build_call_guide_graph,
    build_call_guide_qa_context,
    delete_persisted_call_guide,
    get_persisted_call_guide,
    list_persisted_call_guides,
    update_persisted_call_guide,
)
from app.services.code_intelligence import StructuralEngineError


ROOT = {
    "symbol_name": "run",
    "qualified_name": "app.run",
    "path": "src/main.py",
    "start_line": 4,
    "end_line": 10,
    "signature": "def run():",
}


class CallGuideGraphTests(unittest.TestCase):
    @patch("app.services.call_guide_service._run_tool")
    def test_name_only_trace_uses_exact_bounded_lookup(self, run_tool):
        run_tool.return_value = {
            "results": [{
                "name": "helper",
                "qualified_name": "app.helper",
                "file_path": "src/helper.py",
                "start_line": 2,
                "end_line": 5,
            }]
        }

        details = _resolve_details(1, "project-1", [{"symbol_name": "helper"}])

        self.assertEqual(details["helper"]["path"], "src/helper.py")
        payload = run_tool.call_args.args[1]
        self.assertEqual(payload["name_pattern"], "^(?:helper)$")
        self.assertLessEqual(payload["limit"], 31)

    @patch("app.services.call_guide_service._run_tool")
    def test_ambiguous_name_only_trace_is_not_resolved(self, run_tool):
        run_tool.return_value = {
            "results": [
                {"name": "helper", "qualified_name": "a.helper", "file_path": "a.py", "start_line": 1},
                {"name": "helper", "qualified_name": "b.helper", "file_path": "b.py", "start_line": 1},
            ]
        }

        self.assertEqual(_resolve_details(1, "project-1", [{"symbol_name": "helper"}]), {})

    @patch("app.services.call_guide_service._node_content", return_value="source")
    @patch("app.services.call_guide_service._resolve_root", return_value=ROOT)
    @patch("app.services.call_guide_service._index_context")
    @patch("app.services.call_guide_service._run_tool")
    def test_builds_only_verified_caller_and_second_hop_edges(
        self, run_tool, index_context, _resolve_root, _node_content
    ):
        index_context.return_value = ({"indexed_fingerprint": "fp-1"}, "project-1")

        def result_for(tool, payload):
            if tool == "trace_path" and payload["function_name"] == "app.run":
                return {"callers": [{"name": "start", "qualified_name": "app.start", "hop": 1}]}
            if tool == "trace_path" and payload["function_name"] == "app.start":
                return {"callers": [{"name": "main", "qualified_name": "app.main", "hop": 1}]}
            pattern = payload.get("qn_pattern", "")
            if "app\\.start" in pattern:
                return {"results": [{
                    "name": "start", "qualified_name": "app.start", "file_path": "src/start.py",
                    "start_line": 3, "end_line": 8,
                }]}
            if "app\\.main" in pattern:
                return {"results": [{
                    "name": "main", "qualified_name": "app.main", "file_path": "src/entry.py",
                    "start_line": 1, "end_line": 4,
                }]}
            return {"results": []}

        run_tool.side_effect = result_for
        graph = build_call_guide_graph(1, CallGuideCandidate(**ROOT))
        by_name = {node["symbol_name"]: node for node in graph["nodes"]}
        edge_pairs = {(edge["source"], edge["target"]) for edge in graph["edges"]}

        self.assertIn((by_name["start"]["id"], by_name["run"]["id"]), edge_pairs)
        self.assertIn((by_name["main"]["id"], by_name["start"]["id"]), edge_pairs)
        self.assertTrue(all(edge["verified"] for edge in graph["edges"]))
        self.assertEqual(graph["coverage"]["status"], "complete")

    @patch("app.services.call_guide_service._node_content", return_value="source")
    @patch("app.services.call_guide_service._resolve_root", return_value=ROOT)
    @patch("app.services.call_guide_service._index_context")
    @patch("app.services.call_guide_service._run_tool")
    def test_unresolved_direct_node_marks_partial_without_fabricated_edge(
        self, run_tool, index_context, _resolve_root, _node_content
    ):
        index_context.return_value = ({"indexed_fingerprint": "fp-1"}, "project-1")
        run_tool.side_effect = [
            {"callers": [{"name": "missing", "qualified_name": "app.missing", "hop": 1}]},
            {"results": []},
        ]

        graph = build_call_guide_graph(1, CallGuideCandidate(**ROOT))

        self.assertEqual([node["symbol_name"] for node in graph["nodes"]], ["run"])
        self.assertEqual(graph["edges"], [])
        self.assertEqual(graph["coverage"]["status"], "partial")

    @patch("app.services.call_guide_service._node_content", return_value="source")
    @patch("app.services.call_guide_service._resolve_root", return_value=ROOT)
    @patch("app.services.call_guide_service._index_context")
    @patch("app.services.call_guide_service._run_tool")
    def test_second_hop_failure_preserves_direct_edge_and_marks_partial(
        self, run_tool, index_context, _resolve_root, _node_content
    ):
        index_context.return_value = ({"indexed_fingerprint": "fp-1"}, "project-1")

        def result_for(tool, payload):
            if tool == "trace_path" and payload["function_name"] == "app.run":
                return {"callees": [{"name": "work", "qualified_name": "app.work", "hop": 1}]}
            if tool == "trace_path":
                raise StructuralEngineError("trace failed")
            return {"results": [{
                "name": "work", "qualified_name": "app.work", "file_path": "src/work.py",
                "start_line": 2, "end_line": 6,
            }]}

        run_tool.side_effect = result_for
        graph = build_call_guide_graph(1, CallGuideCandidate(**ROOT))

        self.assertEqual(len(graph["edges"]), 1)
        self.assertEqual(graph["coverage"]["status"], "partial")
        self.assertFalse(graph["coverage"]["callees_complete"])


class CallGuidePersistenceTests(unittest.TestCase):
    def setUp(self):
        import app.core.config as config
        import app.services.storage as storage

        self.tempdir = tempfile.TemporaryDirectory()
        root = Path(self.tempdir.name)
        config.DB_PATH = root / "app.db"
        config.WORKSPACE_ROOT = root
        config.REPOS_ROOT = root / "repos"
        config.GENERATED_ROOT = root / "generated"
        storage.DB_PATH = config.DB_PATH
        storage.WORKSPACE_ROOT = config.WORKSPACE_ROOT
        storage.REPOS_ROOT = config.REPOS_ROOT
        storage.GENERATED_ROOT = config.GENERATED_ROOT
        storage.init_storage()
        self.storage = storage
        self.project = storage.upsert_project("demo", "local://demo", root / "repo", "ready")

    def tearDown(self):
        self.tempdir.cleanup()

    def _insert(self):
        return self.storage.create_call_guide(
            self.project.id,
            "run 调用链",
            json.dumps(ROOT),
            json.dumps({
                "nodes": [{"id": "root", **ROOT, "content": "4: def run():", "direction": "root", "hop": 0}],
                "edges": [],
            }),
            json.dumps({
                "status": "complete", "callers_complete": True, "callees_complete": True,
                "reason": None, "engine": "test",
            }),
            "fp-1",
            "root",
        )

    @patch("app.services.call_guide_service.get_project_index_status")
    def test_persist_update_list_stale_and_delete(self, index_status):
        index_status.return_value = {"indexed_fingerprint": "fp-1"}
        row = self._insert()
        guide = get_persisted_call_guide(self.project.id, row["id"])
        self.assertFalse(guide["stale"])

        updated = update_persisted_call_guide(
            self.project.id, row["id"], title="入口", current_node_id="root",
            visited_node_ids=["root", "missing"],
        )
        self.assertEqual(updated["title"], "入口")
        self.assertEqual(updated["visited_node_ids"], ["root"])
        self.assertEqual(len(list_persisted_call_guides(self.project.id)), 1)

        index_status.return_value = {"indexed_fingerprint": "fp-2"}
        self.assertTrue(get_persisted_call_guide(self.project.id, row["id"])["stale"])
        self.assertTrue(delete_persisted_call_guide(self.project.id, row["id"]))
        self.assertIsNone(get_persisted_call_guide(self.project.id, row["id"]))

    @patch("app.services.call_guide_service.get_project_index_status", return_value={"indexed_fingerprint": "fp-2"})
    def test_stale_guide_is_rejected_before_qa(self, _index_status):
        row = self._insert()
        with self.assertRaisesRegex(CallGuideError, "已过期"):
            build_call_guide_qa_context(self.project.id, row["id"], "root", ["root"])

    @patch("app.services.call_guide_service.get_project_index_status", return_value={"indexed_fingerprint": "fp-1"})
    def test_qa_rejects_unverified_route_edge(self, _index_status):
        row = self._insert()
        with self.storage._connect() as conn:
            graph = {
                "nodes": [
                    {"id": "root", **ROOT, "content": "def run():", "direction": "root", "hop": 0},
                    {"id": "caller", **{**ROOT, "symbol_name": "caller"}, "content": "caller()", "direction": "caller", "hop": 1},
                ],
                "edges": [],
            }
            conn.execute("UPDATE call_guides SET graph_json = ? WHERE id = ?", (json.dumps(graph), row["id"]))
            conn.commit()
        with self.assertRaisesRegex(CallGuideError, "未经结构索引验证"):
            build_call_guide_qa_context(self.project.id, row["id"], "caller", ["caller", "root"])

    def test_project_deletion_cleans_guides(self):
        self._insert()
        self.assertTrue(self.storage.delete_project(self.project.id))
        self.assertEqual(self.storage.list_call_guides(self.project.id), [])


if __name__ == "__main__":
    unittest.main()
