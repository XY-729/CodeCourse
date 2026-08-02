# Spec: 移动端代码阅读位置进度条

## Requirement

- **FR-1** Android 端（`html.platform-android`）打开代码文件时，查看器顶部显示一条横向阅读位置进度条。
- **FR-2** 进度条随滚动实时更新：`progress = scrollTop / (scrollHeight - clientHeight)`，clamp 到 [0,1]。
- **FR-3** 文档不可滚动（scrollHeight <= clientHeight）时进度条隐藏（opacity 0，不占布局外空间）。
- **FR-4** 更新频率受 rAF 节流限制（每动画帧最多一次，不触发 React 重渲染，直接操作 DOM style）。
- **FR-5** 首次挂载时执行一次初始刷新，确保初始位置正确（0 或恢复位置）。
- **FR-6** 样式与现有 `reader-progress-bar` 视觉一致（2px 高、圆角、主题色 `--mobile-progress`），明暗主题自适应。

## Non-goals

- 桌面端 MonacoCodeViewer 不加进度条。
- 不修改 MarkdownViewer 现有进度条行为。
- 不新增依赖。

## Technical notes

- 实现位置：`MobileCodeViewer.tsx` 的 `handleCodeScroll`（现有单一滚动处理器）中追加 rAF 节流的 DOM 写入；新增 `.mobile-code-progress` 容器置于 `.mobile-code-viewer` 顶部。
- 虚拟列表（`shouldVirtualize`）与进度条互不影响：进度条测量 `scrollRef.current.scrollTop/scrollHeight/clientHeight`，虚拟列表 spacer 已提供完整高度。
- 不设 `position: fixed`（滚动容器是 `.mobile-code-scroll`，进度条应贴在该容器顶部、跟随组件布局）。
