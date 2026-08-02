# 修复生成失败后幽灵课件导致的 "Learning source not found" 404

## 背景

用户报告：生成代码详细课件时弹出 "learn source notfound" 错误，且界面一直显示"生成中"。

现场诊断（桌面 app，项目 11 mikuOJ）：

- `generation_tasks` 表最新任务 id=54：`file_lesson`/detailed/`src/sandbox_linux.cpp`，**status=failed**，stage_label="生成失败"，错误"模型返回为空内容。旧课件已保留。"（`_require_markdown` 抛出）。**没有任务在跑，"生成中"是 UI 未反映失败状态。**
- 磁盘上 `generated/11/lessons/` 无 `sandbox_linux.cpp_detailed.md`，但 `learning_states` 表存在 `course/sandbox_linux.cpp_detailed.md` 记录。
- 后端日志：生成请求后紧跟着 `PUT /api/projects/11/learning-state 404` ×2。

根因链：

1. `stream_file_lesson_generation`（及 outline / outline_lesson 两个 stream 分支）在任务开始时就 `_incremental_open(output_path)` **创建空占位文件**（generation_service.py:1584）。
2. 前端收到 `task_created` SSE 后打开该课件。
3. 模型返回空 → `_require_markdown` 抛 `RuntimeError` → 任务标记 failed + SSE error。
4. **except 分支不删除占位文件**（空/损坏课件残留 = 幽灵课件）。
5. 前端在幽灵课件上滚动 → PUT learning-state → `_is_valid_source` 校验失败（文件不存在/为空不在 course 列表）→ **404 "Learning source not found"**（learning.py:64）→ 错误弹窗。

## 目标

1. 生成任务失败/取消时删除 `_incremental_open` 创建的占位文件，不留幽灵课件。
2. 前端收到 SSE `error` 事件时刷新课程列表并关闭失败的课件 tab（或标记失败），避免后续 learning-state 404。
3. 幽灵课件存量数据修复：`get_learning_state` 已有清理逻辑（校验失败即删除状态），无需新增。

## 非目标

- 不改 "模型返回为空内容" 的失败原因本身（模型侧问题）。
- 不动 `_require_markdown` 的校验逻辑。
- 不做 UI 层的大改。

## 方案

### 后端（generation_service.py）

三个 stream 分支（`stream_outline_generation` / `stream_file_lesson_generation` / `stream_outline_lesson_generation`）的 except 分支中，失败/取消时若输出文件存在且为空或未完成（任务未 completed），删除该文件：

```python
except Exception as exc:
    update_generation_task(task.id, "failed", error_message=str(exc), stage_label="生成失败")
    if output_path.exists():
        output_path.unlink()
    yield _sse_event("error", {"message": str(exc)})
```

注意：outline 分支 output 是目录（`output_dir`），需先检查是文件还是目录；outline_lesson/file_lesson 是单文件。失败时删除文件；目录分支删除失败生成的占位文件（如 outline.md 占位）。

### 前端（App.tsx）

- `generateFileLessonStream` 等的 `onError` 回调中：任务失败时，若当前打开的 tab 是失败的课件，关闭该 tab 并刷新课程列表。
- 简化：SSE error 后刷新课程列表（`refreshCourses`），让幽灵课件从列表中消失；若当前 activeItem 是该课件，关闭它。

## 验证

- 后端单元测试：构造失败任务 → 占位文件被删除。
- 真实场景：手动触发一次失败生成（如配置不存在的模型），确认无幽灵课件残留、无 404。
