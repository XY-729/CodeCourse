# 修复流式课件生成的两个缺陷（幽灵占位文件 + 乐观标签 404）

## 背景

用户报告：生成详细课件时弹出 "learn source notfound" 错误，生成过程打开的标签页内容为空白。

诊断（项目 11，`src/sandbox_linux.cpp` detailed）：

- **缺陷 A（本次 404 真凶）**：前端乐观打开"生成中"标签时用 `lessons/<file>.md` 路径（App.tsx），但后端单文件课件实际写到 `files/<file>.md`（`_safe_lesson_filename` 返回 `files/` 前缀；`lessons/` 是总纲按课课件的目录）。打开后 CourseViewer 挂载时 PUT learning-state → `_is_valid_source` 校验 `lessons/...` 不在课程列表 → 404 "Learning source notfound"（learning.py:63-64）。后端日志证实：`PUT /api/projects/11/learning-state 404` 的 source_path 全是 `lessons%2Fsandbox_linux.cpp_detailed.md`，而成功请求都是 `files%2F...`。
- **缺陷 B（此前"打开空白"）**：流式生成开始时 `_incremental_open(output_path)` 在**最终路径**创建空占位文件。失败时（6361c48 已修 unlink）旧课件被截断删除；即使成功，生成期间课程列表/学习状态能看到不完整文件，占位被打开即空白。且错误消息"旧课件已保留"与"占位截断了旧课件"矛盾。

## 目标

1. 流式生成的增量内容写入隐藏临时文件 `<name>.streaming`，成功时才原子替换到最终路径：
   - 生成期间最终路径不可见 → 无幽灵课件、无空白占位、无"生成中被课程列表收录"
   - 重新生成失败/取消时旧课件分毫不动（临时文件方案下"旧课件已保留"变为事实）
   - 成功路径行为与现在完全一致（完成后文件立即可读、learning-state 校验通过）
2. 前端乐观标签路径与后端真实位置一致（`files/` 前缀），消除生成过程中 learning-state 404。

## 非目标

- 不改变流式生成的 SSE 协议（task_created / delta / accumulated / completed / error 事件不变）。
- 不改变"模型返回为空"的失败判定逻辑（`_require_markdown`）。
- 不动 Android 非流式路径。

## 影响面

- 后端：`generation_service.py` 三个流式生成分支（`stream_file_lesson_generation`、`stream_outline_lesson_generation`、`stream_outline_generation`）。
- 前端：`App.tsx` 的 `handleGenerateFileLesson` 乐观标签路径。
- 测试：`test_ghost_course_cleanup.py`（新语义）、`genStreamError.test.ts`、`virtualList.test.tsx` 等回归。
