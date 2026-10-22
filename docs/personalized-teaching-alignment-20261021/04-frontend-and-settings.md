# 04：模型 D——共享 TypeScript、前端交互与设置清理

先读 [共同契约](00-common-contract.md)。D 负责共享 TypeScript、UI、client DTO；C 独占 Android 业务目录。不要借此改主题、工作区层叠/拖动/正文排版行为。

## 当前代码依据

以下路径相对 frontend/src：

| 位置 | 事实 |
| --- | --- |
| features/settings/LLMSettingsDialog.tsx:149、158、345、384 | 保存两开关，另写 terminology_density；有术语少/标准/多/关闭 |
| features/settings/LearnerProfileDialog.tsx:680 | 回答深度、代码比例、顺序、前置详细度、术语密度控件 |
| personalization/preferenceEngine.ts:29、43、80、116 | 默认 0.5/balanced；按“详细/为什么”等词学习长期偏好；渲染固定指令 |
| personalization/usePersonalizationController.ts:40、69 | 获取并提交风格问卷与诊断 |
| features/assistant/ExplainPanel.tsx:295、310 | 风格选择题、诊断卡片 |
| features/assistant/mobile/MobileAssistantPanel.tsx:298、314 | 移动对应卡片 |
| features/teaching/UnderstandingFeedback.tsx:32、75 | 反馈提交 hash/片段/请求 ID，无 AI；已区分理解与掌握 |
| features/knowledge/KnowledgeGraphViewer.tsx:141 | 读取文档关联图接口，不是概念森林 |
| api/client.ts:1356、1610、1965 | 概念无父字段、关系类型为多种图边，仍有诊断 API |
| hooks/useQAGenerationController.ts:78 | QA 一律 defer_metadata=true，与同次清单目标冲突 |
| app/useAppController.ts:3318、3330、3354、3778 | 术语走普通 QA，但自动问题额外硬编码讲解方式 |
| personalization/termMetadata.ts:9；termDisplayAllocator.ts:10、73 | 候选最多 12、全文 6/12/20、每段 1/2 项限制 |
| personalization/useTermDisplay.ts:269 | 密度为零时全隐藏 |
| personalization/termDisplayDecision.ts:29、40 | 已有合法位置与人工已知过滤，需保留有效规则 |

## D1. 冻结共享类型和纯函数

1. 按 A 的服务语义和 B 的输出协议，定义概念树快照、TeachingManifest v2、来源版本、事实状态、反馈与术语 sidecar 类型。
2. 实现 v2/legacy 双读、增量元数据解析、稳定序列化、事实状态纯归约；与 A/E 的同一黄金样例逐字段一致。
3. teachingMetadata、termMetadata、promptContracts 改为新协议，覆盖正文尾部跨 chunk、代码块中的伪标记和格式错误。
4. knowledgeState 的新决策不再依赖诊断/BKT 或旧默认先验；旧字段只做兼容展示/迁移。
5. preferenceEngine 的关键词学习和数值指令退出。teacherPlan/domainInference 移除诊断与固定偏好字段；不为模型补一套固定教学顺序。
6. 不让 C 为 Android 再复制纯规则；接口先提供稳定 mock/fixture，C 可并行实现 provider。

manifest 类型与解析器同步支持可选 placement_changes 及纯结构祖先。视图能展示自动补出的父/祖先链，但不能因为分类节点新增便显示为已讲解或已理解；补父不额外要求用户逐项操作。

## D2. 设置和画像页清理

删除：

- “使用个性化教学”“分析学习过程”两个开关及保存/重置分支。
- 术语密度的少/标准/多/关闭和密度写入。
- 回答深度、代码比例、原理/例子/代码优先、前置知识详细度。
- 自动风格问卷、反馈问题及对应状态。
- 诊断卡片、答题提交、结果、dismiss/flag 等交互。

同时清理 props、controller、client DTO/API、默认值、缓存、状态重置、提示文本和无用样式；不能只隐藏组件，后台仍读写。

保留：

- 生成面板中的学习目标、补充要求、材料选取。
- OutlineQuestionnaireDialog 的正常总纲预检问卷。
- 当前问题与历史原文要求、用户手写总结、知识状态人工纠正、证据来源。
- 模型服务/API Key/模型启用、数据导入导出/重置等正常设置。
- 用户主动要求的练习内容；不再把自动诊断结果写画像。

若增加长期要求入口，直接保存用户原文和作用域，不重新解析成几个固定滑块；现有要求输入能复用则优先复用。

## D3. 概念树视图与状态

1. 使用 A/C 的权威概念森林，不把 knowledge_nodes 的课程/问答图伪装成知识树。
2. 计划显示实际根与识别状态；C++ → STL 容器 → vector 的关系在重启后仍存在。
3. 节点显示事实状态、覆盖范围和来源入口；无证据不能显示成“掌握 35%”。
4. “已理解”保持用户自述语义，不能改成“已掌握”；父节点不继承子项状态。
5. 用户可核对“哪个课件/回答讲过、何时确认、哪些范围仍不懂”，可以撤销纠正。
6. 不重做整个知识网络布局或工作区。可以保留原来源网络，增加明确概念视图；二者名称和数据源需清晰。

## D4. 理解交互统一

1. 复用 UnderstandingFeedback，全部总纲/课件/回答都按共同来源与片段协议。
2. 清单就绪才允许范围理解确认；未就绪显示明确状态与独立修复入口，不触发隐式模型调用。
3. 纯计划总纲允许标“已看过计划”，没有实际解释时不能升级知识理解。
4. 保留部分理解、需要帮助、清除、局部范围反馈和手写总结。
5. 新用户动作生成新 action_id，网络重试复用原动作；提交中、失败、成功显示真实状态。
6. 成功后刷新树、文档范围状态、术语标注缓存和其他读取同知识的界面。
7. 反馈用内容版本，旧页面提交遇到文档变化应刷新并提示，不能把旧片段绑定到新正文。

## D5. 陌生术语完整展示

1. 移除 terminologyDensity 参与决策，删除全文/段落配额以及 density=0 全隐藏。
2. 不截断不同概念候选；同概念重复位置按共同规则共享入口。
3. 保留代码块/已有链接不嵌套、最长匹配、真实技术词、手动链接。
4. 支持新 manifest 来源，不因旧 source==="model" 限制误丢有效清单术语。
5. 对 unrecorded 显示可了解入口，不能向用户宣称“你不会”；对当前 needs_help 正常提供帮助。
6. 以文档 hash＋tree state_version＋规则版本缓存，已理解/撤销后无需重新生成正文即可刷新。
7. 中文词界、C++ 命名空间、行内代码、表格、标题、相近词重叠使用一致 AST 定位。
8. 不能给正文所有字符串做简单替换，避免破坏链接、代码、行号和选区。

## D6. 术语解析和 QA 流

继续使用 runStreamingQuestion 和 relation_type=term_explanation，附真实概念/来源/选区/版本。

自动问题改成简短的上下文提问，不固定“先讲原理”“必须告诉下一步”。用户已有明确问题优先，历史解释可打开复用，但明确新问题不能被无条件缓存命中吞掉。

与 B/C 同步 defer_metadata：保留正文先展示，清单来自同次响应，不能继续强制切换到禁止清单的旧正文协议。理解与术语解释共享相同输出和反馈流程。

## D7. 归档和测试

更新 dataTransfer/archive.ts 共享表列表与格式兼容，采用 A/C 的映射；旧设置不能重新关闭新能力或恢复固定偏好。

主要测试：

- LLMSettingsDialog.lifecycle.test.tsx、LearnerProfileDialog.test.tsx。
- UnderstandingFeedback.test.tsx、ExplainPanel.desktopQA.test.tsx、MobileAssistantPanel.test.tsx。
- teachingMetadata.test.ts、promptContracts.test.ts、knowledgeStateGolden.test.ts、teacherPlan.test.ts。
- useTermDisplay、termDisplayAllocator/Decision、termOccurrences、useDocumentTermsController。
- QA streaming controller、MarkdownViewer.teachingMetadata、archive 测试。

删除旧测试的行为预期时，用“功能退出后不会请求/写入”和“原文要求仍传给模型”等真实场景替换。无需给每个删除的按钮新增镜像测试；重点验证无旧调用残留和跨端契约。

交付共享 TS 接口和黄金样例结果、UI 清理范围、调用链联通结果、两端构建结果。安装打包由 E 最后统一进行。
