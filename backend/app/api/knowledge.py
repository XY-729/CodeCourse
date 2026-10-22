from __future__ import annotations

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
    KnowledgeRootProposalRequest,
    KnowledgeReparentRequest,
    UserTeachingRequirementRequest,
    UserTeachingRequirementEdit,
)
from app.services import knowledge_service
from app.services.storage import KnowledgeEdge, KnowledgeLink, KnowledgeNode, get_project

router = APIRouter(prefix="/api/projects", tags=["knowledge"])


def _tree_action(operation):
    from app.services.knowledge_tree_service import TreeVersionConflict
    try:
        return operation()
    except TreeVersionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{project_id}/knowledge/tree")
@router.get("/{project_id}/knowledge-tree")
@router.get("/{project_id}/personalization/tree")
def concept_tree(project_id: int):
    _require_project(project_id)
    return knowledge_service.get_full_tree_snapshot(project_id)


@router.get("/{project_id}/knowledge/roots/context")
def root_context(project_id: int):
    _require_project(project_id)
    from app.services.knowledge_tree_service import get_root_recognition_context
    return get_root_recognition_context(project_id)


@router.post("/{project_id}/knowledge/roots")
def apply_roots(project_id: int, payload: KnowledgeRootProposalRequest):
    _require_project(project_id)
    from app.services.knowledge_tree_service import apply_root_proposal
    return _tree_action(lambda: apply_root_proposal(project_id, {
        "concepts": payload.concepts, "root_refs": payload.root_refs}, payload.tree_snapshot.model_dump()))


@router.put("/{project_id}/knowledge/tree/{concept_id}/parent")
def move_concept(project_id: int, concept_id: str, payload: KnowledgeReparentRequest):
    _require_project(project_id)
    from app.services.knowledge_tree_service import reparent_concept
    return _tree_action(lambda: reparent_concept(project_id, concept_id, payload.parent_id, payload.topology_version, payload.reason))


@router.get("/{project_id}/knowledge/requirements")
def requirements(project_id: int):
    _require_project(project_id)
    from app.services.knowledge_tree_service import list_requirements
    return list_requirements(project_id)


@router.post("/{project_id}/knowledge/requirements")
def add_requirement(project_id: int, payload: UserTeachingRequirementRequest):
    _require_project(project_id)
    from app.services.knowledge_tree_service import save_requirement
    return _tree_action(lambda: save_requirement(project_id, payload.text, payload.scope, "manual", payload.action_id))


@router.put("/{project_id}/knowledge/requirements/{requirement_id}")
def update_requirement(project_id: int, requirement_id: str, payload: UserTeachingRequirementEdit):
    _require_project(project_id)
    from app.services.knowledge_tree_service import edit_requirement
    return _tree_action(lambda: edit_requirement(project_id, requirement_id, payload.text))


@router.delete("/{project_id}/knowledge/requirements/{requirement_id}")
def remove_requirement(project_id: int, requirement_id: str):
    _require_project(project_id)
    from app.services.knowledge_tree_service import edit_requirement
    return _tree_action(lambda: edit_requirement(project_id, requirement_id, delete=True))


def _require_project(project_id: int) -> None:
    project = get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")


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
