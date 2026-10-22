# D 交付说明：共享 TypeScript、前端交互与设置清理

完成时间：2026-10-21。依据 [00：共同契约](00-common-contract.md) 与 [04：前端与设置](04-frontend-and-settings.md)。本文件只记录 D 的交付范围、接口变化与验证结果；安装打包、Gradle 验证和 CI 由 E 统一进行。

## 一、交付文件

新增：

| 文件 | 作用 |
| --- | --- |
| `frontend/src/personalization/conceptForest.ts` | 权威概念森林 DTO、事实熟悉度枚举、稳定序列化（拓扑在前、状态在后，无时间戳/活跃度排序） |
| `frontend/src/personalization/teachingManifest.ts` | TeachingManifest v2 校验、尾部 `TEACHING` 标记解析、章节命名空间合并、稳定序列化 |
| `frontend/src/personalization/familiarity.ts` | 只按用户自身行为归约事实熟悉度；不读概率、先验、BKT |
| `frontend/src/features/settings/ConceptForestPanel.tsx` | 概念树视图：父子归属、计划根状态、事实状态与人工纠正、依据入口 |
| `frontend/src/personalization/__tests__/conceptForest.test.ts`、`teachingManifest.test.ts`、`familiarity.test.ts`、`frontend/src/features/settings/ConceptForestPanel.test.tsx` | 上述共享契约的黄金样例与行为测试 |

修改（D 归属）：

| 文件 | 变更 |
| --- | --- |
| `frontend/src/api/client.ts` | `Project` 增加 `root_status/root_concept_ids/root_error`；新增 `PlanRootStatus`、`CreateLearningPlanOptions`；`DocumentTerm` 增加 `detection_source=manifest`、`concept_ref/quote/tree_snapshot`；`QAAskPayload` 增加 `concept_id/source_content_hash/tree_snapshot`；删除 `getPersonalizationRuntimeSettings`、`savePersonalizationRuntimeSettings`、`getLearnerPreferences`、`updateLearnerPreferences`、`submitAnswerFeedback`、`answerDynamicSurvey`、`dismissDynamicSurvey`、`getPendingDiagnostic`、`answerDiagnostic`、`dismissDiagnostic`、`flagDiagnostic` |
| `frontend/src/personalization/teachingMetadata.ts` | v2/legacy 双读：v2 对象优先于旧数组；`readTeachingCoverage` 报告 `ready/legacy/missing/invalid`；流式 `TEACHING` 尾部单行转隐藏注释；保留行内注释还原与代码围栏保护 |
| `frontend/src/personalization/termMetadata.ts` | 术语候选池去掉 12/24 截断与旧 TERMS 数量限制；`manifest` 来源沿用语义选择、不再被本地启发式丢弃 |
| `frontend/src/personalization/termDisplayDecision.ts` | 事实状态（`familiarity`）优先于旧 manual/BKT 字段；`needs_help` prominent；`declared_known`/`self_reported_understood` 隐藏；未记录不隐藏；标题、行内代码、表格中的真实术语可标注 |
| `frontend/src/personalization/termDisplayAllocator.ts`、`termLinkScorer.ts` | 删除全文/段落密度配额与 `terminologyDensity<=0` 全隐藏；保留同概念去重、手动链接优先、最长词匹配 |
| `frontend/src/personalization/useTermDisplay.ts`、`useDocumentTermsController.ts` | 移除密度参数；缓存键改为「文档 hash＋tree state_version＋规则版本」；profile 失败不再隐藏术语 |
| `frontend/src/personalization/termOccurrences.ts` | 支持 `manifest` 来源；标题/行内代码/表格术语进入候选；代码块与已有链接仍排除 |
| `frontend/src/personalization/preferenceEngine.ts`、`domainInference.ts`、`teacherPlan.ts`、`usePersonalizationController.ts`、`promptContracts.ts` | 关键词偏好学习、自动问卷、诊断候选、固定风格指令退出；问答契约改为「TITLE、HANDOFF、正文、尾部单行 TEACHING(v2)」 |
| `frontend/src/features/settings/LLMSettingsDialog.tsx`、`LearnerProfileDialog.tsx`、`mobile/MobileMePanel.tsx` | 删除「使用个性化教学」「分析学习过程」开关、术语密度控件、自动问卷与诊断卡片；移除仅用于偏好联动的 props/状态；画像「概念状态」页改为概念树视图（含计划根状态、事实状态、人工纠正、依据筛选） |
| `frontend/src/features/assistant/ExplainPanel.tsx`、`mobile/MobileAssistantPanel.tsx`、`frontend/src/app/views/*`、`frontend/src/app/useAppController.ts` | 同步删除问卷/诊断 props、状态与回调；术语提问改为普通 QA 并附 `concept_id/source_content_hash/tree_snapshot`；`defer_metadata=false` |
| `frontend/src/features/teaching/UnderstandingFeedback.tsx`、`TeachingRationale.tsx` | 理解反馈按共同来源/片段协议；清单未就绪才要求单独补全、不隐式调模型；删除把教学反馈映射成偏好数值的写入 |
| `frontend/src/dataTransfer/archive.ts` | 便携表清单加入桌面与 Android 两套概念森林表与 `user_teaching_requirements`；导入时强制教学/证据分析常开并丢弃旧固定偏好设置 |
| `frontend/ui-surfaces.json` | 学习者画像条目登记概念树视图与状态 |

测试更新：`LLMSettingsDialog.lifecycle`、`LearnerProfileDialog`、`UnderstandingFeedback`、`ExplainPanel.desktopQA`、`MobileAssistantPanel`、`teachingMetadata`、`promptContracts`、`teacherPlan`、`preferenceEngine`、`domainInference`、`termDisplayAllocator/Decision`、`termLinkScorer`、`useTermDisplay*`、`useQAGenerationController`、`archive`。删除旧配额/诊断/问卷预期的同时，替换为「功能退出后不请求/不写入」「用户原文仍原样传给模型」「未就绪不得确认理解」等真实场景。

## 二、与其他方的接口约定

1. **概念树数据源**：`ConceptForestPanel` 使用 `GET /projects/{id}/personalization/concepts`（A 已把 `parent_id/scope/project_id` 加入响应类型）与 `GET /projects/{id}/personalization/knowledge-state`，计划根用项目响应里的 `root_status/root_concept_ids/root_error`。若后端暂不返回 `parent_id`，视图按顶层显示并统计「待归属」数量，不伪造层级。A 若新增整棵快照接口，D 侧已备好 `ConceptForestSnapshot` 与 `serializeConceptForest` 可直接对接。
2. **便携表名映射**：A（`concept_tree_nodes`、`concept_alias_bindings`、`project_knowledge_roots`、`project_root_status`、`knowledge_tree_issues`、`user_teaching_requirements`、`knowledge_tree_versions`）与 C（`concept_placements`、`concept_aliases`、`plan_concept_roots`、`plan_root_status`、`teaching_manifests`、`knowledge_topology_conflicts`）目前物理表名不同，`PORTABLE_TABLES` 同时列出两套，两端导入都会跳过本机不存在的表；E 若要合并为一套，只需改这一处清单与各自 schema。
3. **提示词契约**：前端 QA 契约已改为尾部 v2 `TEACHING`（含 concepts/coverage/terms），旧 `TERMS` 仅兼容读取。B 的 `prompt_store`/`prompt_contracts` 与两份 `default-prompts.json` 需保持同一口径。
4. **Android**：C 已有自己的 `knowledgeForest.ts`/`teachingManifest.ts`，D 未改 `frontend/src/platform/android/**`；`useTermDisplay`、`termMetadata`、`promptContracts` 的签名保持兼容，C 可直接复用。

## 三、验证结果

| 项目 | 结果 |
| --- | --- |
| `pnpm --dir frontend exec tsc -b` | 通过（含 `platform/android`，0 error） |
| `pnpm --dir frontend run test` | 通过：124 个测试文件、702 通过、1 跳过（`check:tests` 与 `check:ui` 同时通过） |
| `pnpm --dir frontend run build` | 通过（含 UI 清单校验，`2066 modules`） |
| `pnpm --dir frontend run build:android` | 通过 |
| 桌面打包、本机安装、快捷方式、Gradle、CI | 未执行，按计划由 E 在所有方合并后统一进行 |

构建注意：本机 `%TEMP%` 中残留的 `esbuild-*` 临时二进制会被其它进程映射，导致 `vite build` 在 `[vite:esbuild-transpile]` 清理阶段报 `Access is denied`。把 `TEMP/TMP` 指向工作区内新目录后构建正常，与代码无关。

## 四、残留与风险

- 旧画像模块（`knowledgeState.ts` 的 BKT 概率、`preferenceEngine` 历史字段、`DomainProfile` 摘要、`diagnostic_items` 表）仍保留作历史展示与迁移兼容；新界面不再用它们决定状态，A 的后端清理完成后可整段删除。
- `TeachingRationale` 在基线上就没有渲染入口，本轮只删除了其中的偏好数值写入，未新增入口。
- 诊断/问卷相关后端接口尚未由 A 移除；前端已不再调用，`DiagnosticItem`/`DynamicSurveyCandidate` 类型仅为 C 的 Android 服务保留。
