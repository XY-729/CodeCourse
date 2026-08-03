# Spec: 流式课件生成的临时文件与路径一致

## 1. 流式写入临时文件（后端）

### 1.1 `_incremental_open` 签名不变，调用点改为临时路径

- 保留 `_incremental_open(path)` 语义（创建/截断空文件，父目录 mkdir）。
- 三个流式生成分支在**调用 `_incremental_open` 之前**，将目标输出路径替换为临时路径：
  - `stream_file_lesson_generation`：`output_path` 的 `filename` 追加 `.streaming` 后缀（保持同目录）。
  - `stream_outline_lesson_generation`：同规则（`lessons/lesson_NN.md` → `lessons/lesson_NN.md.streaming`）。
  - `stream_outline_generation`：`outline.md` → `outline.md.streaming`；`project_map.md` 仍只在成功时原子写入最终路径（现状不变）。

### 1.2 流式写入与成功发布

- 生成期间 `_stream_and_accumulate` 继续 append 到临时路径（增量预览只从 SSE 前端侧拿，不读文件）。
- 成功路径：`_require_markdown` / 解析通过后，把临时文件**原子替换**（`Path.replace`，同目录同文件系统）到最终路径，再执行原有收尾（register_document_terms、update_generation_task completed、SSE completed）。
- `stream_outline_generation` 的 `project_map.md` / `outline.md` 成功时：`project_map.md` 走 `_atomic_write`（现状不变）；`outline.md` 走临时文件 replace。

### 1.3 失败与取消清理

- `except Exception` / `asyncio.CancelledError` 分支：只清理**临时文件**（存在则 unlink），不触碰最终路径 → 旧课件在重新生成失败时保持不变。
- 清理空 `project_map.md` 占位的逻辑不再需要（它从不被提前创建）。

### 1.4 DB 任务状态

- 与现状完全一致：创建任务、置 running、失败/取消置 failed、成功置 completed；`output_path` 始终记录**最终路径**。

## 2. 前端乐观标签路径一致（App.tsx）

### 2.1 `handleGenerateFileLesson` 乐观标签

- 乐观打开标签使用的 `filename` 前缀从 `lessons/` 改为 `files/`，与 `_safe_lesson_filename` 生成的 `files/<base>_<mode>.md` 一致。
- 相关副作用保持一致：
  - `setCourses` 乐观列表项用新路径；
  - `streamingContentRef` 以新路径为 key；
  - `openItemInGroup` 打开乐观标签用新路径；
  - `onDelta` 更新 content 用新路径；
  - `onCompleted` 后 `refreshCourses` + `openCourseInActiveGroup(streamedFilename)`（后端返回真实文件名，不在此改动）。
- `GenStreamError.filename` 的 catch 清理逻辑用 `replace(/\\/g, "/")` 匹配，路径前缀修正后自动对齐（后端返回 `files/...`）。

## 3. 兼容与回归

- SSE 事件结构不变；缓存命中路径（`find_completed_task`）不变。
- `run_file_lesson_task`（非流式后台任务）不使用临时文件，保持不变。
- 测试更新：
  - `test_ghost_course_cleanup.py` 全部通过（失败后无 `*.md` 残留，`*.streaming` 也不残留；成功路径旧课件不被截断需补断言）。
  - 前端 `genStreamError.test.ts`、`virtualList.test.tsx` 等回归通过。
