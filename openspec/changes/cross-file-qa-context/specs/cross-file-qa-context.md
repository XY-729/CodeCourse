# Specs: 跨文件检索问答（选择文件功能）

## 1. 后端：context_files 参数透传与检索放宽

**Given** 请求 `POST /projects/{id}/qa/stream`（或 `/qa/ask`），`QAAskRequest.context_files` 为文件相对路径列表（可空）

**Then**

- `_retrieval_context` 把 `payload.context_files` 透传给 `hybrid_retrieve`
- `hybrid_retrieve` / `structural_retrieve` 接受 `context_files: Optional[list[str]]`：
  - 为空或 `None`：行为不变（`file_pattern` 仅限 `source_path`）
  - 非空：`file_pattern` = `.*(p1|p2|...).*`，其中 p_i = `re.escape(路径)`（含 `source_path` 与全部 `context_files`，全部归一化反斜杠）
- FTS 通道（`search_code_chunks`）不动（本就全项目检索）

## 2. 前端：AI 助手选择文件 UI

**Given** ExplainPanel "附带上下文"卡片存在

**When** 用户点击"选择文件"按钮

**Then**

- 弹出 `ContextFilePickerDialog`（复用 `.modal-backdrop` + `.app-dialog` 外壳）：
  - 搜索框过滤文件名/路径（大小写不敏感子串）
  - 平铺文件列表按目录前缀缩进分组，checkbox 多选
  - "确定"返回已选列表（可空）；"取消"/Esc/× 关闭不改变
- 已选文件在"附带上下文"卡片以 chips 显示（文件名 + × 移除），当前 source_path 高亮标注
- 提问请求 `QAAskPayload.context_files` 携带已选列表

## 3. 状态与边界

**Given** 已选文件列表状态 `contextFiles`（App.tsx）

**Then**

- 切换项目时清空
- `buildAskPayloadContext` 返回值包含 `context_files`
- 文件不存在/已删除时后端检索自动忽略（file_pattern 只过滤，不影响其他文件）

## 4. 验证

**Given** 实现后的代码

**When** 运行后端测试 + 前端测试

**Then** 新增 context_files 透传/file_pattern 拼接测试通过；全量测试不回归；tsc/build 通过
