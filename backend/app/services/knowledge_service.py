from __future__ import annotations

from typing import Optional

from app.services.storage import (
    KnowledgeEdge,
    KnowledgeLink,
    KnowledgeNode,
    QARecord,
    create_knowledge_edge,
    create_knowledge_link,
    create_knowledge_node,
    delete_knowledge_edge,
    delete_knowledge_node,
    find_knowledge_node,
    get_knowledge_edge,
    get_knowledge_node,
    list_knowledge_edges,
    list_knowledge_links,
    list_knowledge_nodes,
    update_knowledge_edge,
    update_knowledge_node,
)


SOURCE_TYPE_TO_NODE_TYPE = {
    "course": "course",
    "file": "file",
}


def _clean_term(text: str) -> str:
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if len(first) > 80:
        first = first[:80].rstrip()
    return first


def _source_node_title(source_type: str, source_path: Optional[str]) -> str:
    if not source_path:
        return "项目上下文"
    return source_path.split("/")[-1] or source_path


def get_or_create_node(
    project_id: int,
    node_type: str,
    title: str,
    ref_type: Optional[str] = None,
    ref_id: Optional[int] = None,
    ref_path: Optional[str] = None,
    summary: Optional[str] = None,
) -> KnowledgeNode:
    existing = find_knowledge_node(
        project_id,
        node_type=node_type,
        title=title,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_path=ref_path,
    )
    if existing:
        return existing
    return create_knowledge_node(
        project_id=project_id,
        node_type=node_type,
        title=title,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_path=ref_path,
        summary=summary,
    )


def create_manual_node(
    project_id: int,
    node_type: str,
    title: str,
    ref_type: Optional[str] = None,
    ref_id: Optional[int] = None,
    ref_path: Optional[str] = None,
    summary: Optional[str] = None,
    x: Optional[float] = None,
    y: Optional[float] = None,
) -> KnowledgeNode:
    return create_knowledge_node(project_id, node_type, title, ref_type, ref_id, ref_path, summary, x, y)


def list_graph(project_id: int) -> tuple[list[KnowledgeNode], list[KnowledgeEdge]]:
    return list_knowledge_nodes(project_id), list_knowledge_edges(project_id)


def edit_node(project_id: int, node_id: int, title: Optional[str], summary: Optional[str], x: Optional[float], y: Optional[float]) -> Optional[KnowledgeNode]:
    return update_knowledge_node(project_id, node_id, title=title, summary=summary, x=x, y=y)


def remove_node(project_id: int, node_id: int) -> bool:
    return delete_knowledge_node(project_id, node_id)


def create_edge(project_id: int, source_node_id: int, target_node_id: int, relation_type: str, label: Optional[str]) -> Optional[KnowledgeEdge]:
    if get_knowledge_node(project_id, source_node_id) is None or get_knowledge_node(project_id, target_node_id) is None:
        return None
    return create_knowledge_edge(project_id, source_node_id, target_node_id, relation_type, label)


def edit_edge(project_id: int, edge_id: int, relation_type: Optional[str], label: Optional[str]) -> Optional[KnowledgeEdge]:
    if get_knowledge_edge(project_id, edge_id) is None:
        return None
    return update_knowledge_edge(project_id, edge_id, relation_type=relation_type, label=label)


def remove_edge(project_id: int, edge_id: int) -> bool:
    return delete_knowledge_edge(project_id, edge_id)


def links_for_source(project_id: int, source_type: Optional[str], source_path: Optional[str]) -> list[KnowledgeLink]:
    return list_knowledge_links(project_id, source_type=source_type, source_path=source_path)


def attach_qa_record(record: QARecord) -> None:
    term_text = _clean_term(record.selected_text)
    if not term_text:
        return

    term_node = get_or_create_node(
        record.project_id,
        node_type="term",
        title=term_text,
        ref_type="term",
        ref_path=None,
        summary=f"来自 {record.source_path or '项目上下文'} 的提问名词或片段",
    )
    qa_node = get_or_create_node(
        record.project_id,
        node_type="qa",
        title=record.display_title or f"回答 #{record.id}",
        ref_type="qa",
        ref_id=record.id,
        ref_path=record.output_path,
        summary=record.answer_md[:500],
    )
    create_knowledge_edge(record.project_id, term_node.id, qa_node.id, "explains", "解释")

    if record.source_path and record.source_type in SOURCE_TYPE_TO_NODE_TYPE:
        source_node = get_or_create_node(
            record.project_id,
            node_type=SOURCE_TYPE_TO_NODE_TYPE[record.source_type],
            title=_source_node_title(record.source_type, record.source_path),
            ref_type=record.source_type,
            ref_path=record.source_path,
            summary=record.source_path,
        )
        create_knowledge_edge(record.project_id, source_node.id, term_node.id, "references", "引用")
        if record.source_type == "course":
            create_knowledge_link(
                project_id=record.project_id,
                source_type="course",
                source_path=record.source_path,
                term_text=term_text,
                qa_record_id=record.id,
                node_id=term_node.id,
            )
