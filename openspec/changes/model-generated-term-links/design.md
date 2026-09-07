# 术语链接词改为生成时由模型选择

## Design

### 生成侧(后端 + 安卓镜像)

- `generation_service.py`:总纲/子总纲/学习计划课/文件课的每一节 prompt 注入 `term_metadata_instruction(project_id)`(附 `term_learning_context`,各节限 0-3 个术语),`parse_term_metadata` 拆出正文与 `section_terms`,装配时 `_with_term_metadata` 只重锚 `source_span.text`,入库时 `register_document_terms(..., model_terms)` 整批替换。
- 流式路径:抽取 `StreamingMetadataFilter` 到 `metadata_stream.py`(qa.py/generation_service 共用,折叠 TITLE/TERMS/HANDOFF/术语 行,代码块内字面量保留)。
- `term_service.py` `register_document_terms`:model 产出的整批选择会先 `UPDATE status='superseded'` 旧 model 行(保留 manual 行与解释),再登记新术语;`allow_model_scan` 默认 false;model_terms 非空时直接写 `term_model_scans` completed 记录,读文档不再补扫。删除 `_local_candidates`/词典/标识符正则。
- QA 侧 `prepare_question` 注入 `term_learning_context`;`prompt_contracts.py` TERMS 契约追加选择规则(结合 learner_context 与正文,允许 0 个)。

### 展示侧

- `termMetadata.ts`(新):`TERM_SELECTION_RULES`/`termMetadataInstruction` 共享契约;`parseTermMetadata`(容错拆行,fence 内保留);`anchorModelTerms`/`relocateModelTerms` 按正文重新锚定并去重;`selectTermScanContent` 供补扫时剔除代码块。
- `termDisplayDecision.ts` `buildPreliminaryTermDecision` 重写:代码块/已有链接一律拒绝;仅 model 来源候选可进;manual known → 隐藏,manual unknown → prominent;`knowledge_status=confirmed` → 隐藏;其余 model 选择默认 `model_selected` subtle。原分数量化/阈值/冷启动逻辑删除。
- `termDisplayAllocator.ts`:manual 显式链接始终可见不占预算;概念级去重改用扫描序。
- `termOccurrences.ts`:inline code 节点参与匹配且必须整 span(`termInlineCode` 包装不破坏代码样式);整词边界校验;链接来源判定与 manual 语义修正(已 linked 不再当作 manual)。
- `useDocumentTermsController.ts`:缓存键加 projectId 前缀;idle 不再轮询;`useTermDisplay` loading/abort 期间不产出决策(防旧决策闪现)。

### UI 与控制流

- `DocumentTermScanControl.tsx`(新):状态文案/重扫按钮/失败重试合一,复用现有 CSS 类;App.tsx 重扫前 confirmAction 确认;`model_scan_authorized` 缺失时禁用。
- `LearnerProfileDialog.tsx`/`WorkbenchEditorGroup.tsx`:原内联状态展示替换为该控件(工具栏紧凑型 + 弹窗说明型)。
- 后端 `personalization.py` profiles 接口:concept 按 id/键双向解析且限定项目作用域,返回 `knowledge_status`,project 证据覆盖 global。

### 测试

前端新增/更新:termDisplayDecision、termOccurrences、termDisplayProfileWire、useDocumentTermsController(轮询含 idle)、localTermAudit(课件回归:只标选中术语、code/强调保留);后端:test_term_candidates、test_personalization_profile、test_lesson_concurrency 同步新语义。
