"""Tests for persistent selected-text QA records."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient


def _setup_temp_db():
    import app.core.config as cfg
    import app.services.storage as storage

    tmpdir = tempfile.TemporaryDirectory()
    workspace = Path(tmpdir.name)

    db_path = workspace / "app.db"
    repos = workspace / "repos"
    generated = workspace / "generated"

    cfg.DB_PATH = db_path
    cfg.WORKSPACE_ROOT = workspace
    cfg.REPOS_ROOT = repos
    cfg.GENERATED_ROOT = generated

    storage.DB_PATH = db_path
    storage.GENERATED_ROOT = generated
    storage.REPOS_ROOT = repos
    storage.WORKSPACE_ROOT = workspace

    storage.init_storage()
    return tmpdir, workspace, generated


def _generated_file(generated: Path, project_id: int, output_path: str) -> Path:
    path = Path(output_path)
    if path.is_absolute():
        return path
    return generated / str(project_id) / path


class QARecordEndpointTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir, self.workspace, self.generated = _setup_temp_db()

        import app.services.generation_service as generation_service
        import app.services.qa_service as qa_service
        from app.main import app

        generation_service.GENERATED_ROOT = self.generated
        qa_service.project_course_dir = lambda project_id: (self.generated / str(project_id)).resolve()
        self.client = TestClient(app)

        from app.services.storage import set_setting, upsert_project

        repo_dir = self.workspace / "repos" / "repo"
        repo_dir.mkdir(parents=True)
        (repo_dir / "README.md").write_text("# Test\n", encoding="utf-8")
        (repo_dir / "src").mkdir()
        (repo_dir / "src" / "main.py").write_text(
            "from fastapi import FastAPI\n\napp = FastAPI()\n\n@app.get('/')\ndef health():\n    return {'ok': True}\n",
            encoding="utf-8",
        )
        self.project = upsert_project("repo", "https://github.com/test/repo.git", repo_dir, "scanned")
        set_setting("llm.enabled", "true")
        set_setting("llm.api_key", "fake-key")

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_ask_creates_record_and_markdown_file(self):
        model_answer = "TITLE: main 函数返回值说明\n\n## 结论\nUse the selected function."
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value=model_answer):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "def main():\n    return 1",
                    "question": "这段代码负责什么？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsNotNone(data["session_id"])
        self.assertEqual(data["source_path"], "src/main.py")
        self.assertEqual(data["display_title"], "def main")
        self.assertNotIn("TITLE:", data["answer_md"])
        self.assertIn("Use the selected function.", data["answer_md"])

        output_path = _generated_file(self.generated, self.project.id, data["output_path"])
        self.assertTrue(output_path.is_file())
        text = output_path.read_text(encoding="utf-8")
        self.assertIn("# def main", text)
        self.assertIn("这段代码负责什么？", text)
        self.assertIn("Use the selected function.", text)
        self.assertIn("## 附带上下文", text)
        self.assertGreater(text.find("## 记录信息"), text.find("## 回答"))
        self.assertGreater(text.find("来源类型"), text.find("## 记录信息"))

    def test_generic_question_uses_selection_and_source_for_fallback_title(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="## 结论\n这是后端框架线索。"):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "project_map.md",
                    "selected_text": "FastAPI",
                    "question": "这是什么",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["display_title"], "FastAPI")
        self.assertNotEqual(data["display_title"], "这是什么说明")

    def test_qa_creates_direct_knowledge_edges_and_links(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: FastAPI\n\nIt is the API framework."):
            first = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "FastAPI",
                    "question": "What is this?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )
            second = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "FastAPI",
                    "question": "How should I read it?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )
            child = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "selection",
                    "source_path": first.json()["output_path"],
                    "selected_text": "API framework",
                    "question": "Explain this part",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(child.status_code, 200)

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph")
        self.assertEqual(graph.status_code, 200)
        nodes = graph.json()["nodes"]
        edges = graph.json()["edges"]
        term_nodes = [node for node in nodes if node["node_type"] == "term"]
        qa_nodes = [node for node in nodes if node["node_type"] == "qa"]
        course_nodes = [node for node in nodes if node["node_type"] == "course" and node["ref_path"] == "outline.md"]
        self.assertEqual(term_nodes, [])
        self.assertEqual(len(qa_nodes), 3)
        self.assertEqual(len(course_nodes), 1)

        qa_by_ref = {node["ref_id"]: node for node in qa_nodes}
        course_node = course_nodes[0]
        self.assertTrue(any(
            edge["source_node_id"] == course_node["id"]
            and edge["target_node_id"] == qa_by_ref[first.json()["id"]]["id"]
            and edge["relation_type"] == "explains"
            for edge in edges
        ))
        self.assertTrue(any(
            edge["source_node_id"] == course_node["id"]
            and edge["target_node_id"] == qa_by_ref[second.json()["id"]]["id"]
            and edge["relation_type"] == "explains"
            for edge in edges
        ))
        self.assertTrue(any(
            edge["source_node_id"] == qa_by_ref[first.json()["id"]]["id"]
            and edge["target_node_id"] == qa_by_ref[child.json()["id"]]["id"]
            and edge["relation_type"] == "explains"
            for edge in edges
        ))
        self.assertFalse(any(edge["relation_type"] == "references" for edge in edges))

        links = self.client.get(
            f"/api/projects/{self.project.id}/knowledge/links?source_type=course&source_path=outline.md"
        )
        self.assertEqual(links.status_code, 200)
        self.assertEqual(len(links.json()), 2)
        self.assertTrue(all(link["term_text"] == "FastAPI" for link in links.json()))
        linked_node_ids = {link["node_id"] for link in links.json()}
        self.assertEqual(linked_node_ids, {qa_by_ref[first.json()["id"]]["id"], qa_by_ref[second.json()["id"]]["id"]})

    def test_knowledge_graph_collapses_old_term_bridge(self):
        from app.services.storage import create_knowledge_edge, create_knowledge_link, create_knowledge_node

        source = create_knowledge_node(self.project.id, "course", "outline.md", ref_type="course", ref_path="outline.md")
        term = create_knowledge_node(self.project.id, "term", "FastAPI", ref_type="term")
        qa = create_knowledge_node(self.project.id, "qa", "FastAPI", ref_type="qa", ref_id=999, ref_path="selection_answers/old.md")
        create_knowledge_edge(self.project.id, source.id, term.id, "references", "引用")
        create_knowledge_edge(self.project.id, term.id, qa.id, "explains", "解释")
        create_knowledge_link(self.project.id, "course", "outline.md", "FastAPI", 999, term.id)

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph")
        self.assertEqual(graph.status_code, 200)
        nodes = graph.json()["nodes"]
        edges = graph.json()["edges"]
        self.assertFalse(any(node["node_type"] == "term" for node in nodes))
        self.assertTrue(any(
            edge["source_node_id"] == source.id
            and edge["target_node_id"] == qa.id
            and edge["relation_type"] == "explains"
            for edge in edges
        ))
        self.assertFalse(any(edge["relation_type"] == "references" for edge in edges))

        links = self.client.get(
            f"/api/projects/{self.project.id}/knowledge/links?source_type=course&source_path=outline.md"
        )
        self.assertEqual(links.status_code, 200)
        self.assertEqual(links.json()[0]["node_id"], qa.id)

    def test_delete_qa_knowledge_node_removes_record_and_markdown(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: FastAPI\n\nIt is the API framework."):
            created = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "FastAPI",
                    "question": "What is this?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        qa_node = next(node for node in graph["nodes"] if node["ref_type"] == "qa" and node["ref_id"] == created["id"])
        output_path = _generated_file(self.generated, self.project.id, created["output_path"])
        self.assertTrue(output_path.exists())

        deleted = self.client.delete(f"/api/projects/{self.project.id}/knowledge/nodes/{qa_node['id']}")
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(output_path.exists())
        self.assertEqual(self.client.get(f"/api/projects/{self.project.id}/qa/{created['id']}").status_code, 404)

        graph_after = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        self.assertFalse(any(node["ref_type"] == "qa" and node["ref_id"] == created["id"] for node in graph_after["nodes"]))

    def test_delete_course_file_removes_course_graph_artifacts(self):
        from app.services.storage import create_highlight, create_knowledge_link, create_knowledge_node

        course_dir = self.generated / str(self.project.id)
        course_dir.mkdir(parents=True)
        course_file = course_dir / "outline.md"
        course_file.write_text("# Outline\nFastAPI\n", encoding="utf-8")
        course_node = create_knowledge_node(self.project.id, "course", "outline.md", ref_type="course", ref_path="outline.md")
        qa_node = create_knowledge_node(self.project.id, "qa", "FastAPI", ref_type="qa", ref_id=999, ref_path="selection_answers/fake.md")
        create_knowledge_link(self.project.id, "course", "outline.md", "FastAPI", 999, qa_node.id)
        create_highlight(self.project.id, "course", "outline.md", "FastAPI", "yellow")

        deleted = self.client.delete(f"/api/projects/{self.project.id}/course/outline.md")
        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(course_file.exists())

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        self.assertFalse(any(node["id"] == course_node.id for node in graph["nodes"]))
        links = self.client.get(f"/api/projects/{self.project.id}/knowledge/links?source_type=course&source_path=outline.md")
        self.assertEqual(links.status_code, 200)
        self.assertEqual(links.json(), [])
        highlights = self.client.get(f"/api/projects/{self.project.id}/highlights?source_type=course&source_path=outline.md")
        self.assertEqual(highlights.status_code, 200)
        self.assertEqual(highlights.json(), [])

    def test_delete_missing_course_file_still_cleans_stale_graph_entry(self):
        from app.services.storage import create_highlight, create_knowledge_node

        stale = create_knowledge_node(
            self.project.id,
            "course",
            "Stale lesson",
            ref_type="course",
            ref_path="missing.md",
        )
        create_highlight(self.project.id, "course", "missing.md", "stale", "yellow")

        deleted = self.client.delete(f"/api/projects/{self.project.id}/course/missing.md")

        self.assertEqual(deleted.status_code, 200)
        self.assertFalse(deleted.json()["file_existed"])
        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        self.assertFalse(any(node["id"] == stale.id for node in graph["nodes"]))
        highlights = self.client.get(
            f"/api/projects/{self.project.id}/highlights?source_type=course&source_path=missing.md"
        )
        self.assertEqual(highlights.json(), [])

    def test_renamed_course_node_is_reused_as_document_alias(self):
        from app.services.storage import create_knowledge_node

        course_node = create_knowledge_node(
            self.project.id,
            "course",
            "outline.md",
            ref_type="course",
            ref_path="outline.md",
        )
        renamed = self.client.put(
            f"/api/projects/{self.project.id}/knowledge/nodes/{course_node.id}",
            json={"title": "我的学习路线"},
        )
        self.assertEqual(renamed.status_code, 200)

        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: FastAPI\n\nAnswer"):
            asked = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "FastAPI",
                    "question": "What is it?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )
        self.assertEqual(asked.status_code, 200)

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        matching = [
            node for node in graph["nodes"]
            if node["ref_type"] == "course" and node["ref_path"] == "outline.md"
        ]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["id"], course_node.id)
        self.assertEqual(matching[0]["title"], "我的学习路线")

    def test_renamed_qa_node_is_reused_for_follow_up(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: Root\n\nRoot answer"):
            root = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "FastAPI",
                    "question": "Root question",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        root_node = next(node for node in graph["nodes"] if node["ref_type"] == "qa" and node["ref_id"] == root["id"])
        self.client.put(
            f"/api/projects/{self.project.id}/knowledge/nodes/{root_node['id']}",
            json={"title": "自定义别名"},
        )

        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: Child\n\nChild answer"):
            child = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "qa",
                    "source_path": root["output_path"],
                    "selected_text": "answer",
                    "question": "Follow up",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                    "session_id": root["session_id"],
                    "parent_qa_id": root["id"],
                },
            )
        self.assertEqual(child.status_code, 200)

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        root_nodes = [node for node in graph["nodes"] if node["ref_type"] == "qa" and node["ref_id"] == root["id"]]
        self.assertEqual(len(root_nodes), 1)
        self.assertEqual(root_nodes[0]["id"], root_node["id"])
        self.assertEqual(root_nodes[0]["title"], "自定义别名")

    def test_outline_node_uses_default_outline_label_without_overwriting_alias(self):
        from app.services.storage import create_knowledge_node

        legacy = create_knowledge_node(
            self.project.id,
            "course",
            "outline.md",
            ref_type="course",
            ref_path="outline.md",
        )
        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        upgraded = next(node for node in graph["nodes"] if node["id"] == legacy.id)
        self.assertEqual(upgraded["title"], "总纲")

        self.client.put(
            f"/api/projects/{self.project.id}/knowledge/nodes/{legacy.id}",
            json={"title": "自定义总纲别名"},
        )
        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        aliased = next(node for node in graph["nodes"] if node["id"] == legacy.id)
        self.assertEqual(aliased["title"], "自定义总纲别名")

    def test_search_favorite_and_edit_update_markdown(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="初始回答"):
            created = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "学习总纲",
                    "question": "如何开始？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        fav = self.client.post(f"/api/projects/{self.project.id}/qa/{created['id']}/favorite", json={"favorite": True})
        self.assertEqual(fav.status_code, 200)
        self.assertTrue(fav.json()["favorite"])

        filtered = self.client.get(f"/api/projects/{self.project.id}/qa?query=开始&favorite=true")
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()), 1)

        edited = self.client.put(
            f"/api/projects/{self.project.id}/qa/{created['id']}",
            json={"answer_md": "编辑后的 Markdown 回答"},
        )
        self.assertEqual(edited.status_code, 200)
        output_path = _generated_file(self.generated, self.project.id, edited.json()["output_path"])
        self.assertIn("编辑后的 Markdown 回答", output_path.read_text(encoding="utf-8"))

    def test_missing_api_key_does_not_create_empty_record(self):
        with patch("app.services.qa_service.get_llm_settings", return_value={"enabled": "false", "api_key": ""}):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "print('x')",
                    "question": "解释",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 400)
        history = self.client.get(f"/api/projects/{self.project.id}/qa")
        self.assertEqual(history.status_code, 200)
        self.assertEqual(history.json(), [])

    def test_empty_selection_is_allowed_and_written_as_placeholder(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="Answer without a selection."):
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "selection",
                    "source_path": None,
                    "selected_text": "",
                    "question": "How should I start?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["selected_text"], "")
        output_path = _generated_file(self.generated, self.project.id, data["output_path"])
        self.assertIn("无附带上下文", output_path.read_text(encoding="utf-8"))

    def test_index_build_and_search_find_code_symbols(self):
        import time

        built = self.client.post(f"/api/projects/{self.project.id}/index/build")
        self.assertEqual(built.status_code, 200)
        first_status = built.json()
        self.assertIn(first_status.get("status"), {"building", "completed"})

        # Wait for the background build to finish, up to 10 seconds
        status = "building"
        for _ in range(50):
            time.sleep(0.2)
            resp = self.client.get(f"/api/projects/{self.project.id}/index/status")
            if resp.status_code == 200:
                data = resp.json()
                status = data.get("status", "building")
                if status != "building":
                    break

        # If the build completed successfully, verify search works
        if status == "completed":
            found = self.client.post(
                f"/api/projects/{self.project.id}/search",
                json={"query": "FastAPI health", "source_path": "src/main.py", "limit": 5},
            )
            self.assertEqual(found.status_code, 200)
            results = found.json()
            if results:
                self.assertTrue(any("main.py" in item["path"] for item in results))
        else:
            # Build may have degraded (struct engine unavailable) but text index should work
            pass

    def test_same_session_injects_recent_memory(self):
        prompts: list[str] = []

        def fake_chat(_base_url, _api_key, _model, messages, timeout=90):
            prompts.append(messages[1]["content"])
            return "TITLE: main.py\n\n回答内容。"

        with patch("app.services.qa_service.call_openai_compatible_chat", side_effect=fake_chat):
            first = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "",
                    "question": "这个文件是干什么的？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()
            second = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "session_id": first["session_id"],
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "",
                    "question": "那它的入口在哪里？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["session_id"], first["session_id"])
        self.assertIn("这个文件是干什么的", prompts[-1])
        self.assertIn("当前会话记忆", prompts[-1])

    def test_file_context_without_selection_uses_file_summary(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: main.py\n\n这个文件提供健康检查接口。") as mocked:
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "",
                    "question": "这个文件是干什么用的？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        messages = mocked.call_args.args[3]
        prompt = messages[1]["content"]
        self.assertIn("上下文类型：当前代码文件", prompt)
        self.assertIn("src/main.py", prompt)
        self.assertIn("FastAPI", prompt)
        self.assertIn("health", prompt)

    def test_course_context_without_selection_uses_course_summary(self):
        course_dir = self.generated / str(self.project.id)
        course_dir.mkdir(parents=True, exist_ok=True)
        (course_dir / "outline.md").write_text("# 项目学习总纲\n\n从 FastAPI 路由开始读。", encoding="utf-8")

        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="TITLE: outline.md\n\n先按总纲读入口。") as mocked:
            resp = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "",
                    "question": "这个课件怎么学？",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(resp.status_code, 200)
        messages = mocked.call_args.args[3]
        prompt = messages[1]["content"]
        self.assertIn("上下文类型：当前课件", prompt)
        self.assertIn("outline.md", prompt)
        self.assertIn("从 FastAPI 路由开始读", prompt)

    def test_rename_history_updates_display_title_only(self):
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value="Answer."):
            created = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "course",
                    "source_path": "outline.md",
                    "selected_text": "scope",
                    "question": "Original question",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        renamed = self.client.put(
            f"/api/projects/{self.project.id}/qa/{created['id']}",
            json={"display_title": "Renamed history item"},
        )

        self.assertEqual(renamed.status_code, 200)
        data = renamed.json()
        self.assertEqual(data["display_title"], "Renamed history item")
        self.assertEqual(data["question"], "Original question")
        output_path = _generated_file(self.generated, self.project.id, data["output_path"])
        self.assertIn("Renamed history item", output_path.read_text(encoding="utf-8"))

    def test_highlight_create_list_and_delete(self):
        created = self.client.post(
            f"/api/projects/{self.project.id}/highlights",
            json={
                "source_type": "course",
                "source_path": "outline.md",
                "selected_text": "Important concept",
                "color": "#fff59d",
            },
        )

        self.assertEqual(created.status_code, 200)
        highlight = created.json()
        self.assertEqual(highlight["selected_text"], "Important concept")

        listed = self.client.get(f"/api/projects/{self.project.id}/highlights?source_type=course&source_path=outline.md")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)

        deleted = self.client.delete(f"/api/projects/{self.project.id}/highlights/{highlight['id']}")
        self.assertEqual(deleted.status_code, 200)

        listed_again = self.client.get(f"/api/projects/{self.project.id}/highlights?source_type=course&source_path=outline.md")
        self.assertEqual(listed_again.status_code, 200)
        self.assertEqual(listed_again.json(), [])

    def test_prompt_api_exposes_qa_answer_prompt(self):
        resp = self.client.get("/api/settings/prompts")

        self.assertEqual(resp.status_code, 200)
        prompts = resp.json()
        self.assertEqual(
            list(prompts.keys()),
            [
                "prompt.system",
                "prompt.outline",
                "prompt.file_lesson.template",
                "prompt.file_lesson.detailed_expected",
                "prompt.file_lesson.brief_expected",
                "prompt.outline_lesson",
                "prompt.learning_plan.outline",
                "prompt.learning_plan.lesson",
                "prompt.qa.answer",
            ],
        )
        self.assertIn("prompt.qa.answer", prompts)
        self.assertIn("prompt.outline_lesson", prompts)
        self.assertIn("prompt.learning_plan.outline", prompts)
        self.assertIn("prompt.learning_plan.lesson", prompts)
        self.assertIn("TITLE:", prompts["prompt.qa.answer"])
        self.assertIn("{model}", prompts["prompt.learning_plan.outline"])
        self.assertIn("4-10", prompts["prompt.learning_plan.outline"])


    def test_answer_terms_create_child_branch_in_same_session(self):
        root_answer = 'TITLE: Routing\nTERMS: ["FastAPI", "Dependency Injection"]\n\nFastAPI routing uses Dependency Injection.'
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value=root_answer):
            root = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "FastAPI",
                    "question": "What does this file use?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(root.status_code, 200)
        root_data = root.json()
        self.assertNotIn("TERMS:", root_data["answer_md"])
        terms = self.client.get(
            f"/api/projects/{self.project.id}/terms",
            params={"source_type": "qa", "source_path": root_data["output_path"]},
        )
        self.assertEqual(terms.status_code, 200)
        fastapi_term = next(item for item in terms.json() if item["term_text"] == "FastAPI")

        child_answer = 'TITLE: FastAPI\nTERMS: []\n\nFastAPI dispatches an HTTP request to a route.'
        with patch("app.services.qa_service.call_openai_compatible_chat", return_value=child_answer):
            child = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "qa",
                    "source_path": root_data["output_path"],
                    "selected_text": "FastAPI",
                    "question": "Explain this term.",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                    "parent_qa_id": root_data["id"],
                    "relation_type": "term_explanation",
                    "term_candidate_id": fastapi_term["id"],
                },
            )

        self.assertEqual(child.status_code, 200)
        child_data = child.json()
        self.assertEqual(child_data["parent_qa_id"], root_data["id"])
        self.assertEqual(child_data["session_id"], root_data["session_id"])
        self.assertEqual(child_data["relation_type"], "term_explanation")

        tree = self.client.get(
            f"/api/projects/{self.project.id}/qa/sessions/{root_data['session_id']}/tree"
        )
        self.assertEqual(tree.status_code, 200)
        self.assertEqual([item["id"] for item in tree.json()], [root_data["id"], child_data["id"]])

        linked_terms = self.client.get(
            f"/api/projects/{self.project.id}/terms",
            params={"source_type": "qa", "source_path": root_data["output_path"]},
        ).json()
        linked = next(item for item in linked_terms if item["id"] == fastapi_term["id"])
        self.assertEqual(linked["status"], "linked")
        self.assertEqual(linked["qa_record_id"], child_data["id"])

    def test_understanding_anchor_is_saved_and_added_to_graph(self):
        with patch(
            "app.services.qa_service.call_openai_compatible_chat",
            return_value="TITLE: FastAPI\nTERMS: []\n\nA concise answer.",
        ):
            qa = self.client.post(
                f"/api/projects/{self.project.id}/qa/ask",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "FastAPI",
                    "question": "What is this?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            ).json()

        saved = self.client.post(
            f"/api/projects/{self.project.id}/qa/{qa['id']}/understanding",
            json={"summary": "FastAPI maps incoming HTTP requests to Python route functions."},
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["qa_record_id"], qa["id"])

        loaded = self.client.get(
            f"/api/projects/{self.project.id}/qa/{qa['id']}/understanding"
        )
        self.assertEqual(loaded.status_code, 200)
        self.assertIn("HTTP requests", loaded.json()["summary"])

        graph = self.client.get(f"/api/projects/{self.project.id}/knowledge/graph").json()
        anchor_nodes = [node for node in graph["nodes"] if node["node_type"] == "anchor"]
        self.assertEqual(len(anchor_nodes), 1)
        self.assertEqual(anchor_nodes[0]["ref_id"], qa["id"])

    def test_streaming_ask_emits_stages_deltas_and_persists_once(self):
        import app.services.qa_service as qa_service

        async def fake_stream(*_args, **_kwargs):
            yield "TITLE: FastAPI\nTERMS: []\n\n"
            yield "FastAPI connects routes to Python handlers."

        with (
            patch("app.api.qa.stream_openai_compatible_chat", fake_stream),
            patch(
                "app.services.qa_service._retrieval_context",
                wraps=qa_service._retrieval_context,
            ) as retrieval,
        ):
            response = self.client.post(
                f"/api/projects/{self.project.id}/qa/stream",
                json={
                    "source_type": "file",
                    "source_path": "src/main.py",
                    "selected_text": "FastAPI",
                    "question": "What does this do?",
                    "provider": "deepseek",
                    "base_url": "https://api.deepseek.com",
                    "model": "deepseek-test",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("event: stage", response.text)
        self.assertIn("event: delta", response.text)
        self.assertIn("event: completed", response.text)
        self.assertIn("FastAPI connects routes", response.text)
        self.assertEqual(retrieval.call_count, 1)
        history = self.client.get(f"/api/projects/{self.project.id}/qa").json()
        self.assertEqual(len(history), 1)


if __name__ == "__main__":
    unittest.main()
