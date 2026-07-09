from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ImportProjectRequest(BaseModel):
    url: str = Field(min_length=5, max_length=500)


class ProjectResponse(BaseModel):
    id: int
    name: str
    url: str
    local_path: str
    status: str
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


class CourseContentResponse(BaseModel):
    filename: str
    content: str


class ExplainRequest(BaseModel):
    project_id: int
    path: Optional[str] = None
    selection: Optional[str] = None
    mode: Literal["file", "course", "selection"] = "file"


class ExplainResponse(BaseModel):
    provider: str
    explanation: str


class ProjectActionResponse(BaseModel):
    id: int
    status: str
    message: str
    course_files: list[str] = Field(default_factory=list)
