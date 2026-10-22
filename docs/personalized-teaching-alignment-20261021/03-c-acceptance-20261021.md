# C（DeepSeek Android 实现）验收记录

日期：2026-10-21（Asia/Shanghai）。结论：**未通过，需修正后复验**。不能据当前实现确认交付说明中“C1–C6 已落地、C7 导入导出已完成”的结论。

本次按用户最新要求仅验收，不修改应用源码，不替换本机安装。检查对象是基线 `0f08b71022d6544a96884e14d0a937980837667e` 上的当前未提交工作区；A/B/D 和语言设置相关改动在验收期间仍有写入，因此下述构建结果以最后一次检查为准。检查依据为 `00-common-contract.md`、`03-android-parity.md` 与 `03-c-delivery.md`。

## 实际验证

| 检查 | 结果 |
| --- | --- |
| Node | 22.23.3，与 CI 要求的 Node 22 主版本一致 |
| TypeScript | 初次 `tsc --noEmit` 通过；最后 Android 构建中的 TypeScript 检查也通过 |
| Android Web 构建 | `pnpm run build:android` 最后一次通过；TEMP/TMP 指向工作区临时目录 |
| Android 相关与提示词定向测试 | 18 文件通过；88 项通过、1 项跳过 |
| 最后全量源码测试 | `vitest run src --configLoader runner`：125 文件，124 通过、1 失败；707 项通过、4 失败、1 跳过 |
| 全量失败位置 | `frontend/src/__tests__/generationCheckpointProduction.test.ts`：总纲恢复、文件课件恢复、缺失章节恢复、repair 恢复四项；当前 hash 变化导致旧 checkpoint 失效并重新调用模型 |
| 补充复现 | 真实 SQLite + 实际服务/路由复现下列身份、反馈、导入和状态问题；另用流过滤与保存/渲染函数直接复现 HANDOFF 泄漏 |
| 设备 | `adb devices -l` 未列出设备；未进行真机或 Gradle 验收，不能给出断网、原生进程恢复和设备迁移通过结论 |

测试通过只证明已有断言成立。补充复现暴露的问题大多没有被原测试覆盖。

## 必须修正的问题

### F01 · P1 · 跨平台迁移跳过树、计划根和用户要求

位置：`frontend/src/platform/android/dataTransfer.ts:395-398`；对应本地表定义为 `knowledgeForestSchema.ts`。

导入器在目标表不存在时直接返回。Android 使用 `concept_placements / concept_aliases / plan_concept_roots`，桌面使用 `concept_tree_nodes / concept_alias_bindings / project_knowledge_roots`，没有表名和列映射，`user_teaching_requirements` 也没有本地承接。

实际向 Android 导入两个概念、父边、计划根和用户要求后：概念仍在，父边与根为空，用户要求表不存在。后续 normalization 只能补成 pending，再导出不能恢复被跳过的信息。后端当前导出表名单独也存在缺项，应由 A/C/D/E 一起统一归档契约，不能靠“同时列出两套表名”代替转换。

复验：桌面→Android→桌面完整比较规范 ID、父边、计划根、别名、范围、反馈及撤销、用户原文要求。

### F02 · P1 · 无效新清单仍覆盖旧有效课件

位置：`frontend/src/platform/android/localProvider.ts:1049-1052`、`:1083-1092`。

`upsertCourse` 先替换最终文件，再发布和校验清单；发布失败只返回 `metadataReady:false`，上层没有据此阻止完成。真实调用复现：旧有效课件存在，新的正文含损坏 TEACHING，函数仍成功返回，旧文件已被新正文覆盖。

应先暂存、验证并建立可恢复发布状态，再替换已发布文件；失败正文可保留为草稿，不能覆盖旧有效课件或宣称发布完成。

### F03 · P1 · 损坏章节清单被省略后，整课被伪装为完整

位置：`frontend/src/platform/android/localProvider.ts:2093-2097`、`:2130-2144`。

拼接只收集成功解析的章节清单，其余章节正文仍保留；最后把剩余清单包装成完整 v2。复现：第一章 TEACHING 损坏，第二章有效；最终文档 `parseTeachingManifest.status=complete`，coverage 却只含第二章。

必须让任一缺失/无效章节使整课清单保持未就绪，并按实际 concept＋aspect＋dimension 校验职责覆盖；名称出现在正文里不能替代清单校验。

### F04 · P1 · 文档版本改变后继续复用旧“已理解”反馈

位置：`frontend/src/platform/android/teachingIndex.ts:102-111`。

同一路径重生成时更新文档 hash，并通过 `(document_id,concept_id,aspect,quote)` 冲突重新激活旧 passage，却没有撤销旧反馈和证据。实际复现：gen1 确认理解后，gen2 正文/hash 改变但保留相同 quote，新文档仍为 `understood`，`documentConfirmed=true`，旧 feedback active=1，旧 evidence 未撤销。

反馈必须绑定有效来源版本。替换版本应使旧来源声明失效或明确迁移，不能凭 quote 相同自动把新版本算作已经确认。

### F05 · P1 · “已会→不会/清除/撤销”仍被树判为已会

位置：`frontend/src/platform/android/knowledgeForest.ts:571-576`；事件撤销另见 `localProvider.ts:3367-3379`。

森林把全部历史 action 变成 Set，只要出现过 `manual_known` 就返回 `declared_known`，不处理后来的 `manual_unknown / manual_clear`。撤销事件只写旧 `learning_events`，不会撤销对应新事实。实际路由与 SQLite 复现三种操作后均仍是 `declared_known`。

此外手动操作前后 `state_version` 仍为 0，依赖版本的术语/注释缓存不会失效。应复用 D 的按事实与时间归约逻辑，并在同一事务内写事实和版本。

### F06 · P1 · 同一范围后来的“仍不懂”被最早的“懂了”吞掉

位置：`frontend/src/platform/android/knowledgeForest.ts:640-648`。

反馈按时间升序读取，同范围已有记录时只追加 evidence_ids，不更新 familiarity 或 last_evidence_at。复现：first.md 对 API/conceptual 确认 understood，later.md 对相同范围反馈 needs_help；当前树仍返回首次的 `self_reported_understood` 和首次日期，当前困惑未进入生成上下文。

应保留全部证据并按当前明确困惑和逐范围规则归约，不能采用第一个反馈的状态。

### F07 · P1 · 新树没有接入 D 的实际界面读取接口

位置：`frontend/src/platform/android/localProvider.ts:317-322`、`:3128-3141`、`:3222-3227`。

新增的独立 tree/roots 路由存在，但 D 的实际树界面读取 `listConcepts` 与 Project DTO。Android 的 concepts DTO 没有 `parent_id`，Project DTO 没有计划根状态/ID/错误；成功建立的树因此在界面中仍被平铺，计划根仍显示待识别。concepts 查询还没有当前项目可见性过滤，复现可返回其他项目私有符号。

应让现有实际入口返回权威森林字段及当前项目可见概念，而不是仅新增无人调用的接口。

### F08 · P1 · 术语状态查询仍按旧 key，收不到 UUID 对应的事实状态

位置：`frontend/src/platform/android/localProvider.ts:2944`、`:3572`、`:3582`；调用方 `frontend/src/personalization/useTermDisplay.ts:201`。

manifest 术语保存 `concepts.id`，前端传入该 UUID；Android 却用 `c.concept_key IN (...)` 查询。实际已有 UUID 概念及手动 known/知识状态，接口仍返回空状态。返回结构也没有新事实 familiarity。确认理解、需要帮助、手动声明后的陌生术语显示不能正确反映最新树。

应统一 ID/key 的端到端含义并返回事实状态；最终标注与刷新还须包含当前 topology/state 版本。

### F09 · P2 · QA 保存后露出 HANDOFF 机器 JSON

位置：`frontend/src/platform/android/localProvider.ts:2631`；`teachingManifest.ts:normalizeTeachingResponse`。

流过滤器隐藏 HANDOFF，但保存时把完整 raw 交给仅清理 TEACHING 的 normalize 函数，未使用已分离的正文。直接复现：流式正文不含机器字段，`readingBody(normalizeTeachingResponse(filter.rawText))` 却含完整 HANDOFF JSON。正常按提示词输出 HANDOFF 就会触发，保存或重开回答后可见。

应以已分离的正文作为权威内容，分别保存同次清单与 handoff；保留代码示例中的同名文本。

### F10 · P2 · 通用知识的理解范围不跨计划共享

位置：`frontend/src/platform/android/knowledgeForest.ts:550`、`:590`。

feedback 和 coverage 按来源文档 project_id 过滤，global 证据却按全局读取。实际同一个 global vector 在计划1为 self_reported_understood，计划2却退成 encountered，ranges/coverage 为空。后续生成无法复用在其他计划已经确认的具体范围。

应按概念作用域选择可访问的全局来源事实，继续隔离其他项目的私有符号。

### F11 · P2 · 私有同名概念跨领域被误合并

位置：`frontend/src/platform/android/knowledgeForest.ts:309-314`。

私有身份的 concept_key 不包含 domain，duplicateKey 分支也不检查领域。实际在同项目创建 cpp 的 Node，再创建 javascript 的 Node，第二次得到完全相同的 ID，数据库仍只有 domain=cpp 的一行。

应使项目身份键包含领域，或在冲突时使用经过完整作用域/领域校验的身份解析；不能跨语言借用已有 ID。

### F12 · P2 · 断点恢复没有冻结知识树版本

位置：`frontend/src/platform/android/localProvider.ts:1973-1981`、`:2899-2905`；checkpoint 的保存字段。

当前新 helper 只把语言设置纳入 inputHash；恢复仍重新读取当前树，并复用旧 checkpoint 的计划和已完成章节。树变化而语言不变时，旧章节与剩余 writer 会使用不同知识树。既没有保存树快照/版本，也没有因树变化使旧结果失效。完整 concept＋aspect＋dimension 职责表仍未落入 checkpoint。

应持久化并复用同版树及职责表，或明确失效所有受影响旧结果。不要只冻结语言偏好。

### F13 · P2 · 非流式生成忽略响应未完成状态

位置：`frontend/src/platform/android/localProvider.ts:1255-1259`。

HTTP 200 的响应只取 message.content，不检查 finish_reason。实际返回 `finish_reason:"length"` 和未完成正文时，`callLLM` 仍正常成功返回；总纲/文件课件/章节等非流式入口可能发布截断内容。原生流路径的完成校验不能覆盖这些入口。

应要求响应确实完成，截断/过滤/中断进入失败或草稿状态，并保留旧已发布版本。

## 复现材料与范围

- 身份、跨计划范围、最新反馈、跨平台导入、重生成反馈：[repro.cjs](C:/Users/xiyua/Documents/CodeCourse/.codex-c-review/repro.cjs)。使用真实 SQLite 与实际服务；未修改生产代码。
- 发布覆盖、缺失清单、术语 ID、非流式截断：[reviewC_generation.test.ts](C:/Users/xiyua/Documents/CodeCourse/github-project-learner/frontend/.cache/reviewC_generation.test.ts)。这些是证明缺陷存在的复现断言，不是功能验收通过。
- 手工纠正、事件撤销、state_version、实际 DTO/路由：[retirement.test.ts](C:/Users/xiyua/Documents/CodeCourse/github-project-learner/tmp/review-c-retirement/retirement.test.ts)。8 项按期望功能写的验收断言均复现失败。

未将尚未具备设备验证的事项写成已通过，也未把共享文件的所有并行失败归因于 C。以上问题修正后，需重跑完整源码测试、Android 构建、真实双向迁移及设备断网/重启/取消验证，再决定接收。
