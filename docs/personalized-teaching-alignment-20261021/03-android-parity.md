# 03：模型 C——Android 本地实现完整对齐

先读 [共同契约](00-common-contract.md)。Android 直接调用模型、使用本地 SQLite，不能假定后端改完就自动一致。C 单独编辑 platform/android 目录，默认提示词导出副本除外；共享 TypeScript 由 D 编辑。

## 当前代码依据

路径除特别注明均为 frontend/src/platform/android 下：

| 位置 | 事实与差异 |
| --- | --- |
| database.ts:8、472、567 | schema version 为 7；concepts 无父节点，concept_relations 无森林约束 |
| localProvider.ts:922 | 新建计划插项目并写 outline 占位，不建领域根 |
| localProvider.ts:1183、1192 | 两个个性化开关缺省 false，可保存 false |
| localProvider.ts:1608、2598、2562、3665 | 预检/QA 注入固定偏好；回答后关键词学习偏好；有固定维度写入 |
| localProvider.ts:1883、1899、1942 | 课件开始取上下文，规划/章节复用；章节协调已共享全课分工 |
| localProvider.ts:2029、2052 | 整合仍用开始时上下文，只重定位已有术语，未按最新树重新判断 |
| localProvider.ts:2933 | termLearningContext 只有已知 80、需支持 50 项与部分摘要 |
| localProvider.ts:2597-2619 | QA 当前轮只读 4 条推断摘要、固定风格和完成范围，要求只出正文 |
| localProvider.ts:2674、2691、2698 | 后台只补 TITLE/TERMS/HANDOFF，强制保留原正文，再跑供后续使用的 planner |
| streamingMetadata.ts:7、31、64 | 隐藏 TEACHING/REUSE，但没有将其完整回收保存 |
| teachingIndex.ts:54、69、192 | 已有清单原文验证、hash/片段检查与事务写反馈，值得复用 |
| localProvider.ts:2902；courseCompletion.ts:63 | 手动补录和完成时缺索引都可能额外调 AI |
| localProvider.ts:1944、2993、3033 | 单章 3、解析前 30、存储最多 24 个术语 |
| localProvider.ts:4309、4406；diagnosticService.ts:72、93、131、168 | 诊断候选校验、落库、评分、证据、教学结果、撤销均有实际实现 |

## C1. 数据库与概念森林

1. 按 A 冻结后的 schema 增加父归属、计划根、manifest 和事实投影，语义与桌面完全一致。
2. schema 版本在实际开工版本上递增，不能仅改建表字符串让已有 v7 安装漏迁移。
3. 复用现有数据库初始化与串行写队列，所有新表、索引、迁移可重复执行。
4. 同批新父节点、唯一父边、循环、作用域、别名身份使用与桌面一致规则。
5. 新建计划调用根识别/应用流程，成功展示领域根，失败保留待识别状态；不能把计划标题粗暴设为 cpp。
6. 通用树跨计划共享；私有符号隔离；删计划不删除其他计划通用知识。
7. D 提供共享纯归约器，C 不另写一套近似权重或枚举。

父归属同样必须自动完成：优先复用已有合理父，缺失时应用同次 manifest 的父/祖先链；已有无父小节点支持 placement_changes 自动补父。并发父身份去重、版本冲突和结构祖先不升熟悉度均与桌面一致，不在确认理解时另调 AI。

## C2. 真正接入当前轮完整上下文

1. 总纲预检、总纲、文件课件、课件 planner、每个 writer、整合、普通 QA/追问/术语解析接入同一完整快照构造。
2. 删除 80/50 等树截断；历史原文检索可限量，树身份/状态/范围不可静默限量。
3. 当前问题不再只依赖旧 4 条摘要和上轮 planner 缓存。
4. 当前轮直接拿到完整树和用户要求；是否需要额外 planner 按任务判断，不强制每轮多调模型。
5. 移除 renderPreferenceDirectives 的默认和历史数值注入，正常预检问卷继续接受真实学习目标/补充要求。
6. 使用共同稳定序列化和输入预算规则；网络失败时不要回退到旧固定风格链。

## C3. 流式 QA 同次清单

1. 复用 D 的 v2 解析器，原生流接收正文、尾部 TEACHING、TITLE/HANDOFF。
2. streamingMetadata 不再丢弃 TEACHING，返回分离的正文和清单；增量 chunk 边界不泄漏机器字段。
3. 不再要求模型“只出正文不要清单”；正常后台不另调 AI 重建相同元数据。
4. 保留已保存正文为权威；把同次响应中解析出的 manifest 独立保存为 sidecar，替换旧二次提取流程。不能只删 parsed.answer=record.answer_md 的正文保护就让后台响应有权改写原正文，也不能让清单因混在 parsed.answer 中而丢失。
5. 文本可先展示，清单校验成功后更新知识索引；失败保留草稿/待修复，不假确认理解。
6. 保存与重启恢复要保留清单状态；杀进程后不能只有答案而把知识树更新永远丢掉。
7. 原生取消、超时和未完成响应不得提交半份清单或虚假已讲事实。

## C4. 课件并发与最终术语

1. 沿用 lessonSectionCoordination，接 B/D 冻结后的完整职责表、概念范围与版本。
2. 同次任务所有 writer 用同一树和同一分工；重试不混版。
3. 合并全部 coverage/terms，按最终正文校验并重定位，不只拼旧候选字符串。
4. 移除单章 3、前 30、最多 24 等截断，分批存储代替丢项。
5. 最终发布前重新读取最新树 state_version，纯本地决定陌生链接；反馈同时发生时重新校验。
6. 继续保留旧文件直到新生成完整发布成功。

## C5. 理解与完成零模型调用

1. teachingIndex 继续校验 hash、片段、请求 ID，在事务内写证据和事实投影。
2. QA 旧理解总结、课程工具栏理解、局部反馈统一走同一服务。
3. courseCompletion 索引不完整时不再自动 scan；进度事实可保存，知识范围待就绪。
4. 取消、部分理解、需要帮助、重新确认正确重算；一个来源删除不清掉其他有效来源。
5. 断网/API Key 无效时，已就绪内容的理解/撤销/完成仍立即成功且零模型调用。
6. 历史补录单独显式任务，不能由后台恢复完成事件时触发。

## C6. 删除旧功能执行链

逐条停止：inferPreferenceSignals、固定维度反馈、动态风格问卷、diagnostic candidate 落库/评分/teaching_outcomes 写入、旧 observer 猜测写画像。

- 路由与返回值同步 D 的 client；旧兼容请求不能继续静默更新画像。
- 旧 enabled=false 不得关闭新流程，导入旧归档也一样。
- 不要把模型 API 的 enabled、网络设置、数据重置等正常功能当成个性化开关删除。
- 用户明确要求生成练习时仍可正常输出课程练习；此次删除的是自动诊断及其画像评分链。
- 旧后台队列、上轮 planner 缓存、diagnostic pending 恢复不能绕过退役规则。

## C7. 导入导出与设备验证

与 A/D 同步表列表、ID 迁移和版本；旧偏好、诊断证据保留历史语义，不进入新投影。验证桌面 → Android → 桌面，身份、树、范围、反馈撤销、用户要求不丢。

默认提示词来自 B 更新 prompt_store.py 后的统一导出，不手改 Android JSON；共享 teachingMetadata/termMetadata/knowledgeState/preferenceEngine 等由 D 改，C 不重复编辑。

主要测试：qaParity.test.ts、teachingIndex.test.ts、courseCompletion.test.ts、streamingMetadata.test.ts、__tests__/databaseInitialization.test.ts、__tests__/dataTransferImport.test.ts、__tests__/outlinePreflight.test.ts、__tests__/termRoutes.test.ts，以及 androidPersonalizationRoutes/androidTeachingOutcomeService 相关测试。

最后两个既有测试位于 frontend/src/__tests__，仍由 C 独占；必要的 android 原生目录修改也由 C 负责，不作顺带重构。其余既有共享测试由 D 编辑，最终 Gradle 全量检查和打包由 E 统一。

除单测和 Web 构建，还需真实 SQLite 迁移、断网反馈、后台/重启/取消、原生流元数据验证。向 E 交付设备与环境、数据库版本、调用次数、实际检查结果，不用纯 mock 通过代替设备结论。
