# 跨文件检索问答：AI 助手选择文件功能

## 背景

用户反馈：在代码文件 A 中问"B 文件里相关代码"或项目层级问题时，当前检索会漏掉 B 文件。现有机制：

- `hybrid_retrieve`（code_intelligence.py:666）= StructuralGraphProvider + FtsProvider 双通道，0 次额外 LLM 调用
- **structural 通道**：`structural_retrieve` 的 `file_pattern` 被 `source_path` 限制为当前文件（code_intelligence.py:507-509、524）→ 跨文件符号、调用链检索漏检
- **FTS 通道**：`search_code_chunks`（storage.py:3079）本就全项目检索，`source_path` 只影响排序 → 已跨文件
- `trace_path` 调用链检索不限文件（天然跨文件）

结论：真正的瓶颈是 structural 的 `file_pattern` 单文件限制。用户选择额外文件后，应把 `file_pattern` 放宽为"当前文件 + 已选文件"的并集。

## 目标

1. AI 助手（ExplainPanel）的"附带上下文"卡片增加"选择文件"入口：弹窗多选项目文件（搜索 + 列表 + 勾选），已选文件以 chips 显示、可移除。
2. 提问请求携带 `context_files` 文件列表；后端 structural 检索的 `file_pattern` 放宽为 `source_path ∪ context_files`。
3. FTS 通道保持全项目检索（已跨文件，不动）。
4. 桌面 + Android 共用（复用现有弹窗/样式体系）。

## 非目标

- 不改变 0 次额外 LLM 调用的检索机制（不加路由 LLM 调用）
- 不做跨项目文件选择（仅当前项目内）
- 不改课件分析/生成管线的文件选择（那是 generation 侧，另行跟踪）

## 方案

### 后端

- `QAAskRequest`（schemas.py:160）新增 `context_files: list[str] = Field(default_factory=list, max_length=50)`
- `_retrieval_context`（qa_service.py:308）把 `payload.context_files` 透传 `hybrid_retrieve`
- `hybrid_retrieve` → `structural_retrieve` → 新参数 `context_files`：
  - 为空：维持现状（`file_pattern` = 仅 `source_path`）
  - 非空：`file_pattern` = `.*(escaped_source|escaped_f1|escaped_f2|...).*`（re.escape 每个路径，`|` 连接）

### 前端

- `QAAskPayload` 类型加 `context_files?: string[]`
- `buildAskPayloadContext`（App.tsx:1752）返回 `context_files`
- `runStreamingQuestion` 调用处（App.tsx:3260）payload 加 `context_files`
- ExplainPanel 新增 props：`contextFiles: string[]`、`onAddContextFiles`、`onRemoveContextFile`、`contextFilesReady`（弹窗打开标记）
- 新组件 `ContextFilePickerDialog`：搜索框 + 平铺文件列表（按目录前缀分组缩进）+ 勾选 + 确认；复用 `.app-dialog`/`.modal-backdrop` 外壳与 token
- "附带上下文"卡片：contextSummary 下加 chips 区（已选文件 + × 移除）+ "选择文件"按钮

## 验证

- 后端测试：context_files 传参 → `_retrieval_context` 调用 `hybrid_retrieve` 带 context_files；structural 的 file_pattern 拼接正确（含 source + 全部 context_files，re.escape 转义）
- 前端测试：picker 搜索过滤、勾选/取消、确认返回、chips 移除；payload 含 context_files
- tsc + 全量测试 + build；桌面/Android 手动过一遍 golden path
