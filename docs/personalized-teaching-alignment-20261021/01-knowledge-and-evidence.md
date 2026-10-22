# 01：模型 A——知识树、证据和后端数据

先读 [共同契约](00-common-contract.md)。本任务负责权威数据和状态，B 负责调用这些能力，C 实现 Android 等价服务，D 实现共享 TypeScript 与 UI。本轮文档中的任务尚未实施。

## 当前代码依据

| 位置 | 已实现事实与缺口 |
| --- | --- |
| backend/app/api/projects.py:203；services/storage.py:2223 | 新建计划创建项目和目录，不建立 cpp 概念根 |
| services/storage.py:1003、1471 | concepts 没有父字段；concept_relations 为多关系图，没有单父/无环约束 |
| services/personalization/observation_schema.py:110；learner_inference_service.py:182 | is_a、prerequisite、component 等混存；is_a 当前方向为具体概念指向上位概念 |
| services/knowledge_service.py:239、258 | 现有知识网络连接问答、来源及理解锚点，不是用户概念树 |
| services/personalization_service.py:41、48 | 已有通用/项目私有作用域与规范名、别名匹配，可以复用 |
| services/teaching_index.py:76、208 | TEACHING 已有范围与原文校验，落 teaching_documents/passages，但没有父节点信息 |
| services/teaching_index.py:246 | 只要是 outline 路径/标记，所有覆盖都被强制改 planned，连总纲真实解释也会降级 |
| services/teaching_index.py:398 | save_feedback 已本地校验 hash、片段、幂等并事务写证据，可以复用 |
| services/personalization/knowledge_state_service.py:76、264、283 | 证据写入、重放、撤销已有基础 |
| services/personalization/knowledge_state_resolver.py:22、143、179 | 默认先验 0.35、固定系数、诊断确认；不是事实熟悉状态 |
| services/course_completion.py:66、71 | 索引不完整时会调用 AI 补录；完整时按概念写已学证据，保留范围 |
| services/personalization/interaction_observer.py:142、451、786 | 另一次观察 AI 受开关控制，写关系和推断；不等于生成同步清单 |
| services/qa_service.py:1257、1277、1305 | 旧“保存理解”按问题/选区匹配概念；固定幂等键撤销后再确认可能复用已撤销事件，由 B 改接公共服务 |
| api/teaching.py:12、67 | 已有 course/qa、passageIds、contentHash、requestKey 反馈协议 |

不要把 storage.py 中 call_guides 的 root_json/graph_json 当作学习计划知识树，它们属于代码调用导读。

## A1. 冻结最小数据模型和公共接口

建议在现有 concepts 和教学证据账本上增补，不复制整套概念表。

需要表达：

- 概念主父归属：concept_id、parent_id（根为空）、scope、topology_version、结构来源。
- 学习计划与根关联：project_id、root_concept_id，可关联多个实际领域根。
- 文档版本、TeachingManifest v2 原始值、校验状态与拒绝原因。
- 逐 concept＋aspect＋dimension 的事实投影、来源计数和有效证据引用。
- topology_version 与 state_version 分离：结构变化和理解状态变化分别递增。
- 现有文档/问答网络作为来源关联，不再充当概念树。

公共服务至少提供以下等价能力，名称可按仓库风格调整，但参数语义冻结后不可随意换：

| 能力 | 输入/输出要点 |
| --- | --- |
| 获取完整树快照 | 当前项目，返回全局＋当前私有树、双版本、全量范围摘要 |
| 读取根识别上下文/应用根提案 | 已存项目、树版本、AI 提案；生成 AI 由 B 调用，A 只本地验证应用 |
| 校验/应用 manifest | 服务端绑定来源版本，返回 ref→持久概念 ID、覆盖、术语映射及问题列表 |
| 保存理解反馈 | 来源、hash、选中片段、结果、action_id；事务写证据和投影 |
| 保存完成/接触事实 | 幂等用户动作＋已校验来源，不触发扫描 |
| 撤销/删除来源 | 仅作废关联证据，重算受影响节点，不清空其他来源 |
| 保存用户原文要求 | 原文、作用域、来源；只存明确要求，不推导数值偏好 |

数据库唯一约束必须防住两批并发生成同概念/同父边的重复插入，不能只靠“先查再写”。已有私有符号的 project 范围不可因清单 scope 错误而外泄到全局。

## A2. 建立父子森林

1. 先解析已有 ID 和精确规范身份，再分配同批新 ID。
2. 解析清单内父引用，校验作用域、自环和全局循环；祖先已存在时复用。
3. 已有概念的父边缺省保持，重挂走显式请求及版本比较。
4. 新根/挂接的结构来源保存到计划或生成记录，可定位谁提出关系。
5. 把先修、应用等边继续作为非父子关系保存，不能当树层级。
6. 对旧 is_a 的迁移明确反转方向；多父/循环进入待整理记录，不随机取第一条。
7. 删除计划仅解除计划关联和其私有来源；通用根及其他计划有效证据继续存在。

自动补父为必做能力：复用已有合理父 → 缺失则应用同次清单提供的父/祖先链 → 挂接子概念。结构祖先无正文 quote/coverage 也合法，不得因此拒绝整份清单或提升熟悉度。已有无父小节点通过 placement_changes 和原父/结构版本比较自动补父；“显式”不表示需要用户逐项批准。并发新父须再次查身份复用，异父冲突保留现有权威边并记待协调，不能静默覆盖。

## A3. 升级教学索引和发布流程

1. 扩展 TEACHING 的数组解析为 legacy/v2 双读，按共同契约验证 concepts、coverage、terms。
2. 保留现有 quote 的真实、唯一定位规则，覆盖项不得由术语链接倒推。
3. 去掉“总纲全部强制 planned”。按条目实际内容区分计划和真实解释。
4. 生成记录的覆盖事实与用户熟悉状态分开保存；发布正文不能自动创建理解事件。
5. 新内容需清单完整才能进入可确认知识范围；无效元数据保留草稿和清晰状态。
6. 明确文件与数据库的发布/恢复顺序。中断后不得留下“数据库声称讲过但正文未发布”的半成品。
7. 清单校验、来源索引、状态投影各阶段可重试；重试不重新调用模型，也不重复建节点。

## A4. 统一事实状态和反馈

1. 按共同契约建立纯归约器，输入有效事件，输出逐范围状态和概念汇总。
2. 普通提问、选区或实际定位到的明确概念范围可产生 encountered；整篇打开只记文档行为，不把全部清单概念算接触。普通提问不负向扣分。
3. 完成产生 studied；理解反馈产生 self_reported_understood，不推高实现/调试能力。
4. 手动已会/不熟/清除保留人工来源；待澄清不删除历史学习记录；partial 保留为同一范围的 partially_understood，不误当跨范围 mixed。
5. 保留局部反馈：确认“连续存储”不确认“扩容/失效”；同范围可跨课程复用。
6. 整文确认只展开有效 brief/explained；纯 planned 总纲可以标“已看过计划”，不提升概念理解。
7. 新 action_id 区分撤销后的重新确认，网络重试使用原 ID，避免复活被撤销事件。
8. 事务内完成反馈、撤销关系、投影、版本递增；外部 UI 通知在提交后发送。

向 B 提供统一反馈函数，让其替换旧 qa_service.save_understanding；保留用户总结文本和锚点用途，不再从问题中猜本回答讲过哪些概念。

## A5. 确认操作零模型调用

course_completion 不再因索引缺失自动调用 reindex_document。已完整索引直接本地更新；未完整时保留进度事实，并标清知识范围未就绪，不能伪造已理解。

历史 reindex 可作为单独显式补录入口保留。课程完成、已理解、重启恢复、网络重试均不能偷偷启动它。已有重启恢复任务应只恢复确定性本地应用。

## A6. 退出旧画像写入和开关

1. settings API 不再允许关闭统一教学/证据分析；迁移旧 false，兼容旧请求时给出清楚行为，不再执行关闭。
2. 移除 fixed preference、关键词风格学习和偏好问卷的后端读写入口及生成约束。保留用户原文要求。
3. 诊断题新生成、pending、提交、评分、结果写画像与相关队列退出新流程；历史数据先保留可审计记录。
4. Observer 不能另写权威概念状态、父边或固定风格；如需保留证据提取，其输出必须走统一校验服务且不重复累积。
5. 检查 learner_inferences、domain_profiles、concept_capabilities、teaching_outcomes 等所有实际读写者；按“是否为可核对事实”处理，不能一概删掉真实 handoff/学习进度。
6. 旧后台任务恢复时先检查新流程版本，不能执行退役写入。

## A7. 迁移与归档

| 旧数据 | 新语义 |
| --- | --- |
| 无事件的 0.35 等先验 | unrecorded |
| manual_known / manual_unknown / clear | 用户声明已会 / needs_help / 解除人工覆盖，保留来源 |
| question neutral | encountered |
| 已生成且有效的 TEACHING | 教学覆盖事实，不自动变 studied |
| course_completion | studied，保留文档与范围 |
| summary/saved_understanding | 只保留原绑定概念和范围的用户理解声明 |
| Observer 假设、旧诊断/BKT 分数 | 历史记录，不直接进入新事实投影 |
| 旧父层级多父/环/身份不明 | 待整理，保留原记录，不随机选父 |

迁移版本化、可中断重跑、默认零 AI。更新后端 data_transfer.py 的表顺序和字段兼容，向 D/C 提供同一列表和迁移规则；不要让导入旧配置重新启用偏好、诊断或关闭个性化。

## 验收与交付

复用并更新：test_teaching_index.py、test_course_completion.py、test_profile_semantics.py、test_personalization_profile.py、test_knowledge_state_v2.py。

必须新增：计划根；同批父引用；循环/多父/私有隔离；并发同概念；总纲真实解释；新生成不升理解；理解/完成/撤销零模型调用；撤销后重确认；一个来源删除不清空另一来源；迁移先验仍未知；旧队列不能继续写画像。

自动补父回归还须覆盖：已有父直接复用；已有 C++ 但缺 STL 容器时补中间层再接 vector；整条合理祖先链缺失；已有无父小节点补父；结构祖先无 quote 且保持无证据；两任务并发补同父不重复。

向 B/C/D/E 交付 schema、服务签名、状态归约样例、迁移映射、准确测试结果和文件清单。不要单独打包覆盖安装。
