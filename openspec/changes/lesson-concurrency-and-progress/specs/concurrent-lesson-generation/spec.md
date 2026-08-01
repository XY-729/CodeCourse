# Spec: 课件并发生成与任务进度

## 需求

- ALL-1: 仓库项目（`project_type == "repository"`）的课件生成必须分章节规划并在章节间并发生成，行为与学习计划课件一致。
- ALL-2: 所有生成任务（outline、file_lesson、outline_lesson）在运行期间持续上报 `stage_label` 与 `progress_current/progress_total`；任一时刻前端可读取到 `progress_total > 0`。
- ALL-3: 仓库课件生成保留文件附件、RAG 检索片段、术语注册、知识节点创建与覆盖校验。

## 场景

### 仓库课件生成（repository outline_lesson）

- 任务进入 running 后立即上报 `progress_total=12, progress_current=0, stage_label="正在规划课件"`。
- 规划调用成功后上报 `progress_total=2+N, progress_current=1, stage_label="章节计划已完成"`（N=章节数，4-10）。
- 章节以 `min(N, 4)` 并发生成，每完成一章上报 `progress_current=1+completed, stage_label="已完成 k/N：<章节标题>"`。
- 整合阶段上报 `progress_total=2+N, progress_current=1+N, stage_label="正在统一整合课件"`。
- 完成时 `progress_current=progress_total`、`stage_label="生成完成"`。
- 失败时 `status=failed, stage_label="生成失败"`，保留旧课件（若存在）。

### 学习计划课件生成（learning_plan outline_lesson）

- 行为与现有一致（规划→并发章节→整合），进度语义不变。现有测试断言（`progress_current=6, progress_total=6, stage_label="生成完成"`、`mocked.call_count == 6`）必须继续通过。

### 总纲生成（outline）

- running 时上报 4 步：`正在分析项目 1/4` → `正在生成总纲 2/4` → `正在解析与归档 3/4` → `生成完成 4/4`（学习计划总纲分支同样上报，step 文案一致）。
- 失败时 `stage_label="生成失败"`。

### 文件课件生成（file_lesson）

- running 时上报 3 步：`正在读取文件 1/3` → `正在生成课件 2/3` → `生成完成 3/3`。
- 失败时 `stage_label="生成失败"`。

## 实现要点

- 后端抽取共享章节生成流程（规划→并发→整合→组装），仓库与学习计划分支仅在 prompt 构造与组装头部不同。
- 仓库章节生成 prompt 沿用 `prompt.outline_lesson` 的教学要求（真实路径/符号/RAG 证据），服务端不修改用户可编辑的提示词内容。
- 章节并发上限 `min(len(sections), 4)`。
- 组装输出与现有仓库课件格式一致：`# 第 N 课：<标题>` 开头，保留 `## 本课目标`、`## 阅读地图`、`## 核心讲解` 等章节（由各章节内容自然构成）。
- 桌面端 `GenerationSheet` 状态区渲染百分比进度条；无 `progress_total` 时仅显示文字（维持现状）。
