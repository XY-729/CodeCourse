# Design: 课件并发生成与任务进度

## 现状

`backend/app/services/generation_service.py`：

- `run_outline_lesson_task`（947-1058）：`project_type == "learning_plan"` 分支委托 `_run_learning_plan_lesson_task`（722-944，已并发、有进度）；**repository 分支单次 `call_openai_compatible_chat` 生成整课，无进度**。
- `run_outline_generation_task`（414-495）：单次调用，无进度。
- `run_file_lesson_task`（581-620）：单次调用，无进度。
- stream 路径（`stream_outline_generation` / `stream_file_lesson_generation`）已有 stage label，保持不动。

前端 `frontend/src/components/GenerationSheet.tsx:104`：仅当 `progress_total > 0` 渲染 `current/total` 文本，无进度条；`TaskFeedback.tsx` 已有 `apple-feedback-progress` 条（桌面顶栏与移动端），随 `activeTask` 轮询自动显示。

## 方案

### 1. 抽取共享章节生成流程

新增 `_run_sectioned_lesson_task(project_id, task_id, lesson_number, lesson_title, lesson_input, instructions, settings, mode)`，其中 `mode ∈ {"learning_plan", "repository"}`：

- 阶段一（规划）：上报 `progress_total=12, progress_current=0, stage_label="正在规划课件"`；按 mode 构造规划 prompt，调用 LLM，`_parse_lesson_plan` 校验。
- 阶段二（并发章节）：`total = 2 + len(sections)`；上报 `progress_total=total, progress_current=1, stage_label="章节计划已完成"`；`ThreadPoolExecutor(min(len(sections), 4))` 并行生成章节，`as_completed` 逐章上报 `已完成 k/N：<章节标题>`。
- 阶段三（整合）：上报 `progress_current=total-1, stage_label="正在统一整合课件"`；生成公共部分（必要补充/综合串联/常见误区/练习与自测/本课小结）。
- 阶段四（组装）：去重 + `_missing_lesson_items` 覆盖校验 → 按 mode 组装输出：
  - learning_plan：`# 第 N 课` + 定位 + 目标 + 知识地图 + 正文 + `## 教材参照`（现有结构不动）。
  - repository：`# 第 N 课：<标题>` + 现有 `prompt.outline_lesson` 建议结构对应内容（`> 本课定位` 引言行 + 各 `##` 章节正文），保留"生成方式：AI 分章节生成"说明。

现有 `_run_learning_plan_lesson_task` 逐步迁移到 `mode="learning_plan"` 分支，行为与输出**逐字节不变**（测试 `test_learning_plan_lesson_is_generated_in_bounded_sections` 的 6 次调用与 6/6 进度必须保持）。

### 2. repository 章节 prompt

以 `prompt.outline_lesson`（用户可编辑，service 不改写）为系统指导，服务端补充章节级指令：

- 直接以 `## <章节标题>` 开始，只输出本章 Markdown；
- 每个知识项用包含完整名称的 `###` 小节展开；
- 只讲本章知识，跨章节内容交给整合阶段；
- 依据 `lesson_input` 中的真实路径/符号/RAG 片段讲解并标注 `路径:行号`，不编造。

### 3. 进度补全

- `run_outline_generation_task`：4 步（分析项目 → 生成总纲 → 解析归档 → 完成），repository 与 learning_plan 分支均上报。
- `run_file_lesson_task`：3 步（读取文件 → 生成课件 → 完成）。
- 失败分支统一 `stage_label="生成失败"`。

### 4. 前端 GenerationSheet 进度条

```tsx
// GenerationSheet.tsx 状态区
import { generationTaskProgress } from "./generationTaskModel";
// ...
const progress = activeTask ? generationTaskProgress(activeTask) : null;
// taskMessage 存在时：
// <div className="generation-sheet-status ...">
//   <span>{taskMessage}</span>
//   {progress != null ? <div className="generation-sheet-progress"><i style={{ width: `${progress}%` }} /></div> : null}
// </div>
```

CSS：`styles.css` 追加 `.generation-sheet-progress`（与 `apple-feedback-progress` 视觉一致：4px 圆角轨道 + `--apple-blue` 填充），深色模式随 token 自适应。

## 影响面

- `backend/app/services/generation_service.py`：核心改动。
- `backend/tests/`：新增仓库课件并发/进度测试；学习计划测试保持绿。
- `frontend/src/components/GenerationSheet.tsx` + `styles.css`：进度条。
- Android `localProvider.ts` 不动。

## 兼容性

- 输出文件仍写 `lessons/lesson_XX.md`；`register_document_terms`、`create_knowledge_node` 保留。
- 任务复用（`create_or_reuse_outline_lesson_task`）按 input_hash 复用已完成任务，不受生成流程改动影响。
