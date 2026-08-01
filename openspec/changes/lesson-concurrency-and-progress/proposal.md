# 所有课件并发生成 + 所有生成任务进度条

## 背景

用户反馈："你确定现在生成课件会附带对应文件并且是并发生成的吗。我之前的生成进度条怎么没了，所有生成的东西都要有进度条。"

现状核查结果：

| 任务线 | 桌面后端 | 进度 |
|---|---|---|
| 学习计划课件（learning_plan） | 分章节生成，`ThreadPoolExecutor(max_workers=4)` 并发，规划→章节→整合 | ✅ 完整进度 |
| 仓库项目课件（repository outline_lesson） | **单次 LLM 调用串行生成整课** | ❌ 无进度（0/0） |
| 总纲（outline） | 单次调用 | ❌ 无进度（0/0） |
| 文件课件（file_lesson） | 单次调用 | ❌ 无进度（0/0） |

对照：Android 端（`localProvider.ts` 的 `generateDetailedLesson`）对**所有项目类型**的课件都分章节并发生成。桌面端仓库课件路径是唯一没有并发的课件生成路径，也是进度条消失的主要来源（后端不发进度 → 前端 `progress_total>0` 为假 → 不渲染进度条）。

## 目标

1. 桌面端仓库项目课件与学习计划课件、Android 端对齐：分章节规划 → 并发生成章节（≤4 workers）→ 统一整合，并保持文件附件、RAG、术语注册、知识节点等现有能力。
2. 所有生成任务（outline、file_lesson、outline_lesson 两种路径）都持续上报 `stage_label` + `progress_current/progress_total`，前端进度条恢复可见。

## 非目标

- 不改变现有生成内容质量（保留 `_require_markdown` 覆盖检查、知识项覆盖校验、术语元数据、教材校验、文件选择与 RAG 注入、知识节点创建）。
- 不改 Android 端（已并发、已有进度）。
- 不做桌面端任务级断点续跑（checkpoint），超出本变更范围。

## 方案

后端 `generation_service.py`：

- 抽取通用 `_run_sectioned_lesson_task(...)`：以"规划 → 并发章节 → 整合 → 组装"四阶段，供学习计划与仓库课件共用。仓库分支的章节生成 prompt 改用仓库课件教学要求（真实路径/符号/RAG 证据），禁止使用学习计划的"教材书目/禁止文件路径"约束。
- `run_outline_generation_task`：阶段进度"正在分析项目 1/4 → 正在生成总纲 2/4 → 正在解析与归档 3/4 → 生成完成 4/4"。
- `run_file_lesson_task`：阶段进度"正在读取文件 1/3 → 正在生成课件 2/3 → 生成完成 3/3"。
- 学习计划分支进度保持不变（现有测试断言 6/6 等不可破坏）。

前端：

- 桌面端 `GenerationSheet.tsx` 状态区新增 `<div className="generation-sheet-progress"><i style={{width: pct%}}/></div>`（复用 `generationTaskProgress`），无数字进度时保留文字状态。

## 风险

- 仓库课件改为分章节后模型调用次数从 1 次变为 2+N 次，耗时与 token 消耗上升——用户已明确要求并发生成，可接受；并发上限 4 与学习计划一致。
- `prompt.outline_lesson` 是用户可编辑提示词（EDITABLE_PROMPT_KEYS），不可在服务端改写——仓库章节生成使用该提示词原文，服务端只负责章节拆分与并发编排。
- 覆盖校验失败（`_missing_lesson_items`）会失败任务并保留旧课件，与学习计划一致。
