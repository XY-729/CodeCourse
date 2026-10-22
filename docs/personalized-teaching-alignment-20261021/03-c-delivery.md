# 模型 C 交付说明（Android 对齐）

日期：2026-10-21。范围：[03：Android 本地实现完整对齐](03-android-parity.md) 与 [00：共同契约](00-common-contract.md)。本说明只描述 Android 侧实际改动与验证结果，桌面/后端结论以 A、B、D 的交付为准。

## 状态

C1–C6 已落地；C7 的导入导出与新表迁移已完成并通过真实 SQLite 测试，Gradle/真机验证按分工留给 E。

## 针对审查记录 F01–F13 的修正（2026-10-21 晚）

| 缺陷 | 修正 |
| --- | --- |
| F01 跨平台迁移跳过树/根/要求 | schema v9 增加 `user_teaching_requirements`；归档用平台中立表名，Android 导出 `concept_alias_bindings`（由 `concept_aliases` 投影）并在导入时映射回绑定表；导入后 `rebuildTeachingState` 从正文内嵌 v2 清单本地重建 manifest 与索引（零模型）。新增真实 SQLite 用例：桌面形状归档 → Android 导入后父边、计划根、用户要求、别名、清单与索引均恢复，退役开关不随归档复活。 |
| F02 无效新清单覆盖旧课件 | `upsertCourse` 先校验并发布清单，`invalid`/发布失败直接抛错且不改写已发布文件（用户手工编辑除外，显式传 `requireValidMetadata=false`）。 |
| F03 损坏章节被省略后伪装完整 | 任一章（含整合）清单缺失/无效即整课不发布并报出章节号；旧课件保留。 |
| F04 重生成复用旧"已理解" | 文档 hash 变化时在同一事务内作废旧 `understanding_feedback` 并 `void_evidence`，再重建 passages；随后递增 state_version。 |
| F05 已会→不会/清除/撤销仍判已会 | 森林事实改由共享归约器 `resolveKnowledgeState` 计算（人工清除/最新声明生效）；手工操作在事务内写事实并递增 state_version；`learning_events` 撤销同时作废对应 v2 事实。 |
| F06 后续"仍不懂"被最早"懂了"吞掉 | 同 F05，按事件时序归约，最新明确反馈优先。 |
| F07 新树未接实际界面读取 | `listPersonalizationConcepts` 返回 `parent_id/scope/project_id` 且按当前项目可见性过滤；项目 DTO 带 `root_status/root_concept_ids/root_error`。 |
| F08 术语状态按旧 key 查 | `getTermDisplayProfiles` 同时接受概念 UUID 与旧 key，返回事实 `familiarity/ranges` 和最新 `tree_snapshot`。 |
| F09 QA 保存泄露 HANDOFF | 保存正文改用流过滤后的可见正文，清单从同次响应单独解析，HANDOFF 只作为独立元数据。 |
| F10 通用知识不跨计划 | 覆盖与证据按概念作用域读取：global 概念跨计划可见，项目私有符号仍隔离。 |
| F11 私有同名跨领域误合并 | 项目身份键含领域（`project:<id>:<domain>:symbol:<name>`）。 |
| F12 断点恢复不冻结树版本 | 总纲/课件 checkpoint 记录 `treeSnapshot`；树版本变化时明确失效并提示重新生成。 |
| F13 非流式忽略未完成状态 | `callLLM` 检查 `finish_reason`，非 `stop` 明确失败且不重试。 |

复验：`backend` 441 项、前端 `src` 125 文件 720 项、`tsc -b --force`、`build:android` 均通过。审查方此前放在 `frontend/.cache/reviewC_generation.test.ts` 的 4 条"缺陷复现"断言现在全部反向失败（它们断言的是修复前的行为），可作为缺陷已消失的旁证。

## 桌面打包与本机安装（2026-10-21 22:02）

- `electron-builder --dir` 产出 `dist-desktop-build/win-unpacked`（前端 `vite build` + PyInstaller 后端 + 打包 Git/代码智能资源）。
- 已镜像到本机安装目录 `C:\Users\xiyua\CodeCourse-0.4.10-reader-metadata`，10798 个文件逐一 SHA-256 比对，与打包产物完全一致（无缺失、无多余、无差异）。
- 桌面 `CodeCourse.lnk` 指向该目录 `CodeCourse.exe`，工作目录与图标已校验有效；启动后 4 个进程正常响应，日志显示项目 14 的课程与个性化档案正常加载（用户数据未受影响）。
- 注：从本仓库自动化环境启动 Electron 需先移除 `ELECTRON_RUN_AS_NODE`，否则 Electron 以 Node 模式运行并立即退出；用户从快捷方式启动不受影响。

## 文件清单（均为 C 归属）

新增：

- `frontend/src/platform/android/knowledgeForest.ts`：权威概念森林服务。身份解析、别名绑定、同批祖先补建、唯一父边、循环/作用域校验、`placement_changes` 与冲突记录、计划根关联、事实投影、稳定序列化上下文。全程不调用模型。
- `frontend/src/platform/android/teachingManifest.ts`：Android 适配层，解析/校验/序列化全部复用 D 的 `personalization/teachingManifest` 与 `personalization/conceptForest`，只保留 Android 需要的协议文本、规范化与术语提取。
- `frontend/src/platform/android/knowledgeForest.test.ts`、`knowledgeForestSchema.test.ts`：森林语义与 v7→v8 真实 SQLite 迁移测试。

修改：

- `database.ts`：schema version 7→8；concepts 增加 scope 列；创建森林/清单/冲突/版本表；`normalizeKnowledgeForest()` 作为迁移与导入共用的幂等规范化（派生 scope、待归属节点、待识别计划根、强制开启个性化与证据分析、退役旧队列）。
- `knowledgeForestSchema.ts`：计划根状态改为 `pending/ready/failed`。
- `teachingSchema.ts`：新增 `teaching_feedback_requests`（保持与后端清单入口一致）。
- `teachingIndex.ts`：清单驱动索引（无手写清单即 pending/invalid，不提升任何熟悉度）；反馈事务写证据与事实投影；`prepare` 改为按 v2 清单替换已讲范围；引用定位改用可见正文。
- `courseCompletion.ts`：完成只用已存清单，不再调用模型补索引；索引未就绪时保留完成进度并标记待重试。
- `streamingMetadata.ts`：保留完整原始流（`rawText`），供同次响应解析清单，机器字段不泄漏到正文。
- `localProvider.ts`：
  - 新建学习计划调用领域根识别，失败保留待识别状态；`GET/POST /projects/:id/personalization/roots`。
  - 所有生成入口（问卷预检、总纲、子总纲、文件课件、课件 planner、每个 writer、整合、QA、术语解析、显式补录）统一走完整森林快照 + 用户明确要求；删除 80/50 截断、旧偏好指令、4 条推断摘要与 planner 缓存。
  - 问答改为单次响应同时产出正文、TEACHING 清单与 HANDOFF；正文为权威，清单作为隐藏 sidecar 保存并发布，后台只做本地索引/术语收尾，不再二次调用模型。
  - 章节清单按命名空间合并后才解析身份；去掉单章 3、前 30、最多 24 等截断。
  - 删除旧画像执行链：观察器推断、领域画像、问卷候选、诊断候选、教师规划器、隐式偏好反馈；旧路由返回 `retired` 且不写任何画像。
- `personalizationRoutes.ts`：诊断、动态问卷、隐式偏好、固定偏好写入改为显式 `retired` 响应。
- `dataTransfer.ts`：归档导入后执行同一套森林规范化。
- `frontend/src/dataTransfer/archive.ts`（D 归属）：`PORTABLE_TABLES` 已包含桌面与 Android 两套森林/清单表名；导入时各自跳过不存在的表，归档恢复后仍执行同一套本地规范化。
- `frontend/src/__tests__/androidPersonalizationRoutes.test.ts`：新增退役路由断言。

## 接口与契约

- 清单版本固定为 v2，字段与共同契约第 4 节一致；`metadata_status` 取 `complete/pending/invalid/legacy`；content hash 统一为持久化 Markdown 的 UTF-8 SHA-256（含隐藏清单）。
- 版本统一为 `knowledge_tree_versions(topology_version,state_version)`；拓扑变更 +1，事实/覆盖变更 +1。
- 熟悉度只由事实推导：`understanding_feedback` → self_reported_understood/partially_understood/needs_help，课程完成证据 → studied，手工声明 → declared_known，其它接触 → encountered，无证据 → unrecorded；不沿父子树传播。
- 新增路由：`GET /projects/:id/personalization/roots`（计划根状态），`GET /projects/:id/personalization/tree|knowledge-tree`（完整快照），`POST /projects/:id/personalization/roots`（用户选定根）。退役路由统一返回 `{status:"retired"}`。

## 验证

- `tsc -b --force`：通过。
- `pnpm run check:tests`：通过。
- `vitest`：全仓 120 个测试文件、666 项通过（其中 C 相关 18 个文件、88 项）；新增森林语义、v7→v8 迁移、单次响应清单、取消不落库、崩溃后仅本地重放等用例。
- `pnpm run build:android`：通过（本机默认 TEMP 目录存在 esbuild 清理 ACL 问题，改用工作区临时目录后成功；E 打包时应设置 `TEMP/TMP`）。

## 交给 E 的事项

1. Gradle/真机：断网与无效 Key 下的理解/撤销/完成、后台/重启/取消、原生流元数据、桌面→Android→桌面迁移的设备结论。
2. 与 D 确认 `archive.ts` 表列表合并；确认术语展示侧使用最新 `state_version` 决定陌生链接。
3. 已知限制：`document_terms` 唯一键按 (project,source,path,term_text) 合并，同一拼写不同概念的入口需要在集成阶段决定是否扩展键或展示侧合并；本轮未改该表结构。
