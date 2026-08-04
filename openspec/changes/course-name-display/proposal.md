# Proposal: 课件生成后立即显示正确标题（修复初始显示为文件名）

## Why

用户反馈：生成的课件在列表/tab 中"一开始的名字都是 lesson.md，要关掉重新打开才是我要的简要文件名"。

根因：`trackTask` 在生成完成后先 `setCourses(nextCourses)`，紧接着同步调用 `openCourseInActiveGroup(...)`（App.tsx:2790→2802）。React 的 `setState` 是异步的，`openCourseInActiveGroup` 仍读取旧渲染闭包里的 `courses` 数组，`courses.find(...)` 找不到新生成的课件，于是 tab 标题回退到原始文件名（如 `lessons/lesson_01.md`）。重启后 `courses` 从库中重新加载（title 已由 H1 快照），名称才正确。

## What Changes

**新增共享辅助函数 `frontend/src/utils/titleFromMarkdown.ts`**：从 markdown 内容提取第一个 `# H1`（去空白），无 H1 时回退到文件名去 `.md`。与 Android `localProvider.ts` 内已有的 `titleFromMarkdown`（L165）行为一致。

**`frontend/src/App.tsx` 四处标题回退点**改为：先查 `courses` 快照 title，查不到时用已抓取的内容推导 H1 标题，不再直接回退到裸文件名：
- `openCourseInActiveGroup`（L2144）：tab 标题
- `buildOpenItem` course 分支（L2030）：拖拽/命令面板打开
- `hydrateStoredItem` course 分支（L1970）：重启恢复布局
- `activeLessonTitle`（L5072）：当前课标题（阅读器/重生成按钮）

**`frontend/src/platform/android/localProvider.ts`**：图谱连接改为 best-effort（try/catch + 节点存在校验）。之前 `linkLessonToOutline` 在 `ensureCourseNode` 返回 undefined 时会让 `createEdge` 抛"连线两端必须属于当前项目"，进而使整个任务标记为 failed——图谱连边失败绝不应让已完成的课件生成失败。

## Capabilities

### New Capabilities

### Modified Capabilities
- `course-name-display`: 课件生成后即刻以 H1 标题显示（tab/列表/阅读器），不再临时显示裸文件名
