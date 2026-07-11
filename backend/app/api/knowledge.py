from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    KnowledgeEdgeCreateRequest,
    KnowledgeEdgeResponse,
    KnowledgeEdgeUpdateRequest,
    KnowledgeGraphResponse,
    KnowledgeLinkResponse,
    KnowledgeNodeCreateRequest,
    KnowledgeNodeResponse,
    KnowledgeNodeUpdateRequest,
)
from app.services import knowledge_service
from app.services.storage import KnowledgeEdge, KnowledgeLink, KnowledgeNode, get_project

router = APIRouter(prefix="/api/projects", tags=["knowledge"])


def _require_project(project_id: int) -> None:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if not Path(project.local_path).exists():
        raise HTTPException(status_code=404, detail="Project directory not found")


def _node_response(node: KnowledgeNode) -> KnowledgeNodeResponse:
    return KnowledgeNodeResponse(
        id=node.id,
        project_id=node.project_id,
        node_type=node.node_type,
        title=node.title,
        ref_type=node.ref_type,
        ref_id=node.ref_id,
        ref_path=node.ref_path,
        summary=node.summary,
        x=node.x,
        y=node.y,
        created_at=node.created_at,
        updated_at=node.updated_at,
    )


def _edge_response(edge: KnowledgeEdge) -> KnowledgeEdgeResponse:
    return KnowledgeEdgeResponse(
        id=edge.id,
        project_id=edge.project_id,
        source_node_id=edge.source_node_id,
        target_node_id=edge.target_node_id,
        relation_type=edge.relation_type,
        label=edge.label,
        created_at=edge.created_at,
        updated_at=edge.updated_at,
    )


def _link_response(link: KnowledgeLink) -> KnowledgeLinkResponse:
    return KnowledgeLinkResponse(
        id=link.id,
        project_id=link.project_id,
        source_type=link.source_type,
        source_path=link.source_path,
        term_text=link.term_text,
        qa_record_id=link.qa_record_id,
        node_id=link.node_id,
        created_at=link.created_at,
        updated_at=link.updated_at,
    )


@router.get("/{project_id}/knowledge/graph", response_model=KnowledgeGraphResponse)
def get_graph(project_id: int) -> KnowledgeGraphResponse:
    _require_project(project_id)
    nodes, edges = knowledge_service.list_graph(project_id)
    return KnowledgeGraphResponse(
        nodes=[_node_response(node) for node in nodes],
        edges=[_edge_response(edge) for edge in edges],
    )


@router.post("/{project_id}/knowledge/nodes", response_model=KnowledgeNodeResponse)
def create_node(project_id: int, payload: KnowledgeNodeCreateRequest) -> KnowledgeNodeResponse:
    _require_project(project_id)
    node = knowledge_service.create_manual_node(
        project_id=project_id,
        node_type=payload.node_type,
        title=payload.title,
        ref_type=payload.ref_type,
        ref_id=payload.ref_id,
        ref_path=payload.ref_path,
        summary=payload.summary,
        x=payload.x,
        y=payload.y,
    )
    return _node_response(node)


@router.put("/{project_id}/knowledge/nodes/{node_id}", response_model=KnowledgeNodeResponse)
def update_node(project_id: int, node_id: int, payload: KnowledgeNodeUpdateRequest) -> KnowledgeNodeResponse:
    _require_project(project_id)
    node = knowledge_service.edit_node(project_id, node_id, payload.title, payload.summary, payload.x, payload.y)
    if node is None:
        raise HTTPException(status_code=404, detail="Knowledge node not found")
    return _node_response(node)


@router.delete("/{project_id}/knowledge/nodes/{node_id}")
def delete_node(project_id: int, node_id: int):
    _require_project(project_id)
    if not knowledge_service.remove_node(project_id, node_id):
        raise HTTPException(status_code=404, detail="Knowledge node not found")
    return {"deleted": True, "id": node_id}


@router.post("/{project_id}/knowledge/edges", response_model=KnowledgeEdgeResponse)
def create_edge(project_id: int, payload: KnowledgeEdgeCreateRequest) -> KnowledgeEdgeResponse:
    _require_project(project_id)
    edge = knowledge_service.create_edge(project_id, payload.source_node_id, payload.target_node_id, payload.relation_type, payload.label)
    if edge is None:
        raise HTTPException(status_code=404, detail="Knowledge node not found")
    return _edge_response(edge)


@router.put("/{project_id}/knowledge/edges/{edge_id}", response_model=KnowledgeEdgeResponse)
def update_edge(project_id: int, edge_id: int, payload: KnowledgeEdgeUpdateRequest) -> KnowledgeEdgeResponse:
    _require_project(project_id)
    edge = knowledge_service.edit_edge(project_id, edge_id, payload.relation_type, payload.label)
    if edge is None:
        raise HTTPException(status_code=404, detail="Knowledge edge not found")
    return _edge_response(edge)


@router.delete("/{project_id}/knowledge/edges/{edge_id}")
def delete_edge(project_id: int, edge_id: int):
    _require_project(project_id)
    if not knowledge_service.remove_edge(project_id, edge_id):
        raise HTTPException(status_code=404, detail="Knowledge edge not found")
    return {"deleted": True, "id": edge_id}


@router.get("/{project_id}/knowledge/links", response_model=list[KnowledgeLinkResponse])
def list_links(
    project_id: int,
    source_type: Optional[str] = Query(default=None),
    source_path: Optional[str] = Query(default=None),
) -> list[KnowledgeLinkResponse]:
    _require_project(project_id)
    links = knowledge_service.links_for_source(project_id, source_type, source_path)
    return [_link_response(link) for link in links]
