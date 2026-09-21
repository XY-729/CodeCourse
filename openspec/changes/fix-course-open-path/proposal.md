# Proposal: 修「打开课件」按钮 404（Windows 绝对路径当文件名）

## Why

用户在桌面端点「打开课件」一直报错。实测复现（2026-09-18，运行中的 `C:\Users\xiyua\CodeCourse`）：

| 请求的路径 | 结果 |
| --- | --- |
| `GET /api/projects/12/course/C:\Users\xiyua\...\generated\12\lessons\lesson_05.md`（当前行为） | 404 |
| `GET /api/projects/12/course/lessons/lesson_05.md` | 200 |

根因在 `frontend/src/App.tsx` 的 `handleOpenGenerationTask()`：

```ts
const matchingCourse = courses.find((course) => course.filename === outputPath || outputPath.endsWith(`/${course.filename}`));
const filename = matchingCourse?.filename ?? outputPath;
```

后端把课件的 `output_path` 存成**绝对路径**，Windows 上还是**反斜杠**（`C:\...\generated\12\lessons\lesson_05.md`）；而课程列表里的 `filename` 是**正斜杠相对路径**（`lessons/lesson_05.md`）。两个条件都不成立，于是回退成把绝对路径当文件名发给后端，必然 404。

同一段比较逻辑在 `frontend/src/generation/useGenerationTrackingController.ts`（移动端「生成完成自动打开」）里也有一份一样的写法。

桌面端此前靠自动打开兜住了这个按钮的失效，本次预览改动把桌面的自动打开关掉了（`autoOpenCompleted: mobileRuntime`），「打开课件」成为唯一入口，问题才暴露出来。

## What Changes

新增 `resolveCourseFilename()`（`frontend/src/app/appUtils.ts`），先统一路径分隔符，再按 完整路径 → 后缀 → 文件名 三级匹配，最后退回 `generated/<projectId>/` 之后的相对段；对不上时返回 `null`。两处调用点改用它，`handleOpenGenerationTask` 对 `null` 给出明确提示而不是发一个必然 404 的请求。

## Capabilities

### Added Capabilities
- `course-file-open`:从生成任务打开课件时的路径解析
