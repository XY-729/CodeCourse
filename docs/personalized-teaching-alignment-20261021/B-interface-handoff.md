# B 接口交接（实现中）

- 实际完整树调用：`knowledge_tree_service.get_tree_snapshot(project_id, conn=...)` 和 `list_requirements` 在同一事务读取。B 的 `generation_context.build_generation_context` 不截断节点，包含父边、身份状态、逐范围事实和生成覆盖；不读取旧概率或固定偏好。
- A 的计划创建入口可调用 `personalization.teaching.root_recognition.recognize_learning_plan_roots(project_id, requirements="")`。该函数只在根尚未 ready 时调用一次模型，然后交给 `apply_root_proposal`；无 API/识别失败抛出明确的待识别错误，项目已先保存。A 拥有 API 文件，B 不修改该入口。用户已选根无需调用。
- `manifest.parse_manifest` 返回 `.body/.manifest/.status/.errors`，v2 损坏不会退回旧 TERMS。`namespace_manifest/merge_manifests` 隔离章节 ref 并重新验证最终正文 quote。
- 清单 wire：尾部单行 `TEACHING: {"schema_version":2,"concepts":[],"coverage":[],"terms":[]}`；可迁移 Markdown 保存单行隐藏注释。TITLE/HANDOFF 保留。
- D 的术语来源过滤允许 `teaching_manifest_v2`。B 的 `term_service.get_document_term_annotations(project_id, source_type, source_path)` 返回 `content_hash/tree_snapshot/rules_version/cache_key/candidates`；每项含 concept_id、text、source_span、familiarity、offer_explanation。它直接读取 A 的 teaching_terms，支持同拼写不同身份；旧 DocumentTerm 的 text 唯一约束只用于兼容列表，不能代替完整 sidecar。A/D 可在 terms API 接出此派生层。
- `qa_service.save_understanding(..., action_id=None)` 与 `remove_understanding(..., action_id=None)` 用 A 的已校验片段反馈；省略 action_id 每次用户动作新建 UUID，网络重试应传同一值。
- QA 忽略旧 defer_metadata=true 的“第二次模型提取”语义，同次清单；恢复队列只本地解析、索引和登记，不启动 observer/planner。
- 模型预算：`GPL_LLM_CONTEXT_TOKENS` 为应用总预算，默认 131072；用 UTF-8 字节保守上界估算完整输入并预留输出，超限停止而不裁树。真实缓存用量由服务端 usage 解析，缺失为 null；流式支持 usage_callback 并记录 llm_usage 日志。

B 不改 A/C/D 拥有的文件，不单独安装。最终验证与文件清单另列于 B-delivery.md。
