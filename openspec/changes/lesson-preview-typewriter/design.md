# 预读逐字展示 — 设计

## Context

预读快照（`backend/app/services/lesson_preview.py`）按整章落地：`sections()` 只在某一章完成时更新 markdown。前端 `LessonPreview` 轮询 `/preview`，`version` 变化才换对象，`<PreviewMarkdown>` 全量渲染。

因此「逐字」只能是客户端对已就绪文本的**揭示动画**，不是真实生成速率。这一点必须在文案与预期上说清楚：它改善的是「整段砸下来」的观感，不缩短等待。

## Goals / Non-Goals

**Goals:**
- 已就绪内容按速度逐字显示，新章节接力而非重播
- 生成结束即全文；减少动效时不动画
- 速度可调且持久化

**Non-Goals:**
- 不改后端快照粒度、轮询间隔、生成并行度
- 不做「先直连/后代理」式的双路径（与 llm-bypass-system-proxy 无关）
- 不改文件课件的流式路径（那本来逐字）

## Decisions

### Decision 1: 结束态不做动画

任务终态时继续逐字只会让用户等一段已经拿到的文本。这条同时保住了既有测试语义（失败态快照立即可读）与失败场景的价值（读出已完成章节）。

### Decision 2: 用固定步长的 interval，而不是 rAF

`requestAnimationFrame` 在 jsdom/假定时器下行为不稳，且这里不需要与屏幕刷新对齐。16ms 一个 tick、按 `charsPerSecond` 累积小数余量（`carry`），既保证速度准确又不至每 tick 都触发重渲染。

### Decision 3: 速度偏好放 localStorage

沿用 `MarkdownViewer` 的 `codecourse.desktop.docFontSize` 约定，键名 `codecourse.desktop.previewSpeed`；读写都 `try/catch`，存储不可用时退回 `normal`。

### Decision 4: 揭示进度挂在状态条上，不放在面板里

进度放在 `DesktopGenerationStatus`（面板的父组件）而不是 `LessonPreview`：关闭面板只卸载面板，状态条还在，进度得以保留；重新打开时只打这次新增的内容。状态条本身在换任务（`task?.id` / `stream?.filename` 变化）时归零，所以不存在跨任务的串扰。

**踩到的坑**：为处理「重试清空快照」加的边界回收 effect，在面板刚打开、快照尚未到达时（markdown 为空串）会把记住的进度一次性夹到 0。回收必须跳过空 markdown。

### Decision 5: 接受「半截 markdown」的瞬时观感

逐字揭示的是 markdown 源文本，打字过程中会出现还没闭合的 `**`、`##` 或表格分隔行，渲染上会有短暂的原样显示。这是逐字与 markdown 渲染的固有冲突；当前取舍是简单优先，若观感不可接受，后续可改为「按完整块揭示 + 块内逐字」的细化方案。

### Decision 6: 减少动效的探测要 guard

`test.setupFiles` 为空，jsdom 不实现 `matchMedia`，其它组件测试各自 `Object.defineProperty` 打桩。这里用 `typeof window.matchMedia === "function"` 兜底，避免未打桩的用例崩溃。
