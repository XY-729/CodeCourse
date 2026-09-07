## Tasks

- [x] 1.1 `backend/app/services/term_service.py`:删除 `_local_candidates`/词典/标识符/中文技术词正则挖掘;`register_document_terms` 改为整批替换(superseded + 保留 manual),`allow_model_scan` 默认 false,model 产出直写 `term_model_scans` completed;新增 `term_learning_context`;TERMS 行解析容错(fence/续行)
- [x] 1.2 `backend/app/services/generation_service.py`:总纲/子总纲/学习计划课/文件课各节注入 `term_metadata_instruction(project_id)` + 节内 0-3 限制;`parse_term_metadata` 拆节词与合成词,装配重锚 `source_span`;流式输出经 `StreamingMetadataFilter` 过滤元数据行
- [x] 1.3 `backend/app/services/metadata_stream.py`(新):通用 `StreamingMetadataFilter`(qa.py 复用)
- [x] 1.4 QA 注入 `term_learning_context`;`prompt_contracts.py` TERMS 契约补充模型选择规则;`storage.py` upsert 保留 superseded→candidate/linked、manual 行不清理、model 来源优先
- [x] 2.1 `frontend/src/personalization/termMetadata.ts`(新):共享 `TERM_SELECTION_RULES`/`termMetadataInstruction`/`parseTermMetadata`/`anchorModelTerms`/`relocateModelTerms`/`selectTermScanContent`
- [x] 2.2 `termDisplayDecision.ts`:展示决策重写(代码块/已有链接拒绝;model-only;manual known/confirmed 隐藏;unknown 突出;其余 subtle);`termDisplayAllocator.ts`:manual 链接豁免预算;`termDisplayTypes.ts` 新增 reason/knowledgeStatus
- [x] 2.3 `termOccurrences.ts`:inline code 整 span 装饰(`termInlineCode`)、整词边界、manual 语义修正;`termCandidate.ts` fence/标题排除改为行扫描 + 整词校验
- [x] 2.4 `useDocumentTermsController.ts`:缓存键加 projectId;idle 停轮询;`useTermDisplay.ts` loading/abort 不产出决策;`api/client.ts` 增加 `knowledge_status` 归一
- [x] 3.1 `DocumentTermScanControl.tsx`(新):状态文案/重扫/失败重试/授权禁用;`App.tsx` 重扫确认与接线;`LearnerProfileDialog.tsx`/`WorkbenchEditorGroup.tsx` 原内联展示替换为控件
- [x] 3.2 `frontend/src/platform/android/localProvider.ts`:删除安卓侧 `localTermCandidates`/词典;总纲/子总纲/课件生成解析 TERMS→`validatedModelSelection`→`relocateModelTerms` 随内容入库;注入 `termLearningContext`
- [x] 3.3 后端 `personalization.py` profiles:concept 双向解析限定项目作用域 + `knowledge_status` + project 覆盖 global
- [x] 4.1 测试同步:前端 termDisplayDecision/termOccurrences/termDisplayProfileWire/useDocumentTermsController(含 idle 停轮询)/localTermAudit(课件回归);后端 test_term_candidates/test_personalization_profile/test_lesson_concurrency
- [x] 4.2 验证:后端 unittest 322 项通过;前端 vitest 522 项通过(1 项 stale 断言已随 4.1 修正);OpenSpec 文档补齐随提交推送
