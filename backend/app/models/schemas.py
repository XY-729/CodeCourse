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


class ExplainRequest(BaseModel):
    project_id: int
    path: Optional[str] = None
    selection: Optional[str] = None
    mode: Literal["file", "course", "selection"] = "file"


class ExplainResponse(BaseModel):
    provider: str
    explanation: str


class QAAskRequest(BaseModel):
    source_type: Literal["file", "course", "selection"]
    source_path: Optional[str] = Field(default=None, max_length=1000)
    selected_text: str = Field(default="", max_length=20000)
    question: str = Field(min_length=1, max_length=4000)
    provider: str = Field(default="deepseek", max_length=80)
    base_url: str = Field(default="https://api.deepseek.com", max_length=500)
    model: str = Field(default="deepseek-v4-flash", max_length=160)


class QARecordResponse(BaseModel):
    id: int
    project_id: int
    source_type: str
    source_path: Optional[str] = None
    display_title: Optional[str] = None
    selected_text: str
    question: str
    answer_md: str
    provider: str
    model: str
    output_path: Optional[str] = None
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
