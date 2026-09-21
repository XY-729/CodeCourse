# 修「打开课件」404 — 设计

## Context

课件任务落库时 `output_path` 写的是 `project_course_dir(project_id) / relative_path` 的绝对路径（`generation_service.run_outline_lesson_task`），Windows 上带盘符与反斜杠。前端两处拿它和 `courses[].filename` 比较：

- `App.tsx` `handleOpenGenerationTask`（桌面状态条与移动面板的「打开课件」）
- `useGenerationTrackingController.ts` 完成后自动打开

比较写法是 `filename === outputPath || outputPath.endsWith("/" + filename)`，两头都因为反斜杠失配。

后端侧另有一道**有意**的限制：`course_generator.read_course_file` 第 79 行 `if "\\" in filename or not filename.endswith(".md"): raise FileNotFoundError`，即 API 明确拒绝含反斜杠的文件名。所以修在调用方是唯一正确的位置。

## Goals / Non-Goals

**Goals:**
- 两处调用点都改用同一个解析函数，任何情况下都不再把绝对路径当文件名
- 解析不出结果时给出可读提示，而不是发一个必然 404 的请求

**Non-Goals:**
- 不改后端 `read_course_file` 对反斜杠的拒绝（这是有意的输入约束，放宽它会扩大路径解析面）
- 不改 `output_path` 的存储格式（会影响历史任务与其它读取方）
- 不合并 `appUtils.normalizeOutputPath`（那是 QA 记录专用，回退值是 `qa/<id>`，语义不同）

## Decisions

### Decision 1: 三级匹配 + 相对段回退，而不是只剥前缀

先按规范化后的完整路径、再按后缀、再按文件名（basename）匹配，能同时覆盖「列表里有该文件」「列表里没有但路径合法」两种情形；只剥 `generated/<id>/` 前缀在非标准工作区路径下会猜错。匹配全部失败才返回 `null`。

### Decision 2: 课程列表项也做分隔符规范化

历史数据里出现过 `selection_answers\xxx.md` 这种带反斜杠的 filename（terms 接口可见）。匹配前统一分隔符，返回规范化后的相对路径。
