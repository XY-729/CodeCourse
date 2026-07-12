from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ImportProjectRequest(BaseModel):
    url: str = Field(min_length=5, max_length=500)


class CreateLearningPlanRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class ProjectResponse(BaseModel):
    id: int
    name: str
    url: str
    local_path: str
    status: str
    project_type: Literal["repository", "learning_plan"] = "repository"
    course_files: list[str] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TreeNode(BaseModel):
    name: str
    path: str
    type: Literal["file", "directory"]
    children: list["TreeNode"] = Field(default_factory=list)
    is_key_file: bool = False


class FileContentResponse(BaseModel):
    path: str
    language: str
    content: str


class CourseFile(BaseModel):
    filename: str
    title: str
    group: str = ""


class CourseContentResponse(BaseModel):
    filename: str
    content: str


class LearningScopeRequest(BaseModel):
    type: Literal["full_project", "files", "learning_plan"] = "full_project"
    paths: list[str] = Field(default_factory=list)


class GenerateOutlineRequest(BaseModel):
    scope: LearningScopeRequest = Field(default_factory=LearningScopeRequest)
    instructions: str = Field(default="", max_length=4000)


class GenerateFileLessonRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    mode: Literal["brief", "detailed"] = "brief"
    instructions: str = Field(default="", max_length=4000)


class GenerationTaskResponse(BaseModel):
    id: int
    project_id: int
    task_type: str
    status: str
    source_path: Optional[str] = None
    mode: Optional[str] = None
    model: Optional[str] = None
    prompt_version: str
    input_hash: str
    output_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    updated_at: str


class SelectionRange(BaseModel):
    start_line: int = Field(ge=1)
    start_column: int = Field(default=1, ge=1)
    end_line: int = Field(ge=1)
    end_column: int = Field(default=1, ge=1)


class QAAskRequest(BaseModel):
    source_type: Literal["file", "course", "selection"]
    source_path: Optional[str] = Field(default=None, max_length=1000)
    selected_text: str = Field(default="", max_length=20000)
    question: str = Field(min_length=1, max_length=4000)
    provider: str = Field(default="deepseek", max_length=80)
    base_url: str = Field(default="https://api.deepseek.com", max_length=500)
    model: str = Field(default="deepseek-v4-flash", max_length=160)
    session_id: Optional[int] = None
    selection_range: Optional[SelectionRange] = None


class QARecordResponse(BaseModel):
    id: int
    project_id: int
    session_id: Optional[int] = None
    source_type: str
    source_path: Optional[str] = None
    display_title: Optional[str] = None
    selected_text: str
    question: str
    answer_md: str
    provider: str
    model: str
    output_path: Optional[str] = None
    retrieval_trace: Optional[str] = None
    favorite: bool
    created_at: str
    updated_at: str


class QAUpdateRequest(BaseModel):
    question: Optional[str] = Field(default=None, min_length=1, max_length=4000)
    answer_md: Optional[str] = Field(default=None, min_length=1, max_length=100000)
    display_title: Optional[str] = Field(default=None, max_length=200)


class QAFavoriteRequest(BaseModel):
    favorite: bool


class HighlightCreateRequest(BaseModel):
    source_type: Literal["course", "qa"]
    source_path: str = Field(min_length=1, max_length=1000)
    selected_text: str = Field(min_length=1, max_length=8000)
    color: str = Field(default="#fff59d", max_length=32)
    note: Optional[str] = Field(default=None, max_length=1000)


class HighlightResponse(BaseModel):
    id: int
    project_id: int
    source_type: str
    source_path: str
    selected_text: str
    color: str
    note: Optional[str] = None
    created_at: str
    updated_at: str


class KnowledgeNodeCreateRequest(BaseModel):
    node_type: Literal["term", "qa", "course", "file", "manual"] = "manual"
    title: str = Field(min_length=1, max_length=200)
    ref_type: Optional[str] = Field(default=None, max_length=40)
    ref_id: Optional[int] = None
    ref_path: Optional[str] = Field(default=None, max_length=1000)
    summary: Optional[str] = Field(default=None, max_length=4000)
    x: Optional[float] = None
    y: Optional[float] = None


class KnowledgeNodeUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    summary: Optional[str] = Field(default=None, max_length=4000)
    x: Optional[float] = None
    y: Optional[float] = None


class KnowledgeNodeResponse(BaseModel):
    id: int
    project_id: int
    node_type: str
    title: str
    ref_type: Optional[str] = None
    ref_id: Optional[int] = None
    ref_path: Optional[str] = None
    summary: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None
    created_at: str
    updated_at: str


class KnowledgeEdgeCreateRequest(BaseModel):
    source_node_id: int
    target_node_id: int
    relation_type: Literal["explains", "parent_of", "related_to", "references"] = "related_to"
    label: Optional[str] = Field(default=None, max_length=120)


class KnowledgeEdgeUpdateRequest(BaseModel):
    relation_type: Optional[Literal["explains", "parent_of", "related_to", "references"]] = None
    label: Optional[str] = Field(default=None, max_length=120)


class KnowledgeEdgeResponse(BaseModel):
    id: int
    project_id: int
    source_node_id: int
    target_node_id: int
    relation_type: str
    label: Optional[str] = None
    created_at: str
    updated_at: str


class KnowledgeGraphResponse(BaseModel):
    nodes: list[KnowledgeNodeResponse] = Field(default_factory=list)
    edges: list[KnowledgeEdgeResponse] = Field(default_factory=list)


class KnowledgeLinkResponse(BaseModel):
    id: int
    project_id: int
    source_type: str
    source_path: str
    term_text: str
    qa_record_id: int
    node_id: int
    created_at: str
    updated_at: str


class ProjectIndexStatusResponse(BaseModel):
    project_id: int
    status: str
    chunk_count: int = 0
    updated_at: Optional[str] = None
    error_message: Optional[str] = None


class ProjectSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    source_path: Optional[str] = Field(default=None, max_length=1000)
    limit: int = Field(default=8, ge=1, le=20)


class ProjectSearchResult(BaseModel):
    path: str
    language: str
    start_line: int
    end_line: int
    chunk_type: str
    symbol_name: Optional[str] = None
    content: str
    score: float = 0


class QASessionResponse(BaseModel):
    id: int
    project_id: int
    title: str
    memory_summary: str
    active_source_path: Optional[str] = None
    created_at: str
    updated_at: str


class ProjectActionResponse(BaseModel):
    id: int
    status: str
    message: str
    course_files: list[str] = Field(default_factory=list)


class LLMSettingsRequest(BaseModel):
    provider: str = "deepseek"
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-v4-flash"
    api_key: Optional[str] = None
    enabled: bool = False
    clear_api_key: bool = False


class LLMSettingsResponse(BaseModel):
    provider: str
    base_url: str
    model: str
    enabled: bool
    has_api_key: bool
    masked_api_key: Optional[str] = None


class LLMTestResponse(BaseModel):
    ok: bool
    provider: str
    message: str
