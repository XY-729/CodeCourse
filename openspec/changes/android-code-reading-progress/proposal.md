# Android 代码文件阅读位置顶部进度条

## 背景

用户反馈：Android 端"首次打开文件时不会出现顶部横向进度条"。

现状核查结果（已读代码确认）：

- 阅读位置进度条（`.reader-progress-bar` / `.reader-progress-fill`，`MarkdownViewer.tsx:865-867`）**只存在于 MarkdownViewer**，随滚动更新 `scaleX(progress)`，供**课件/QA** 文档使用。
- 代码文件查看器 **MobileCodeViewer（Android）与 MonacoCodeViewer（桌面）都没有阅读位置进度条**——`CodeViewer.tsx` 与 `MonacoCodeViewer.tsx` 中搜索 `progress` 零命中。
- App.tsx 渲染代码文件时（`openFileInActiveGroup` → `openItemInGroup`，type 为 "file"），viewer 是 MobileCodeViewer（Android）或 Monaco（桌面），因此**打开代码文件永远不显示顶部阅读进度条**，与课件行为不一致。

用户确认方向：先只做 Android（MobileCodeViewer），桌面端暂不动。

## 目标

1. Android 端 MobileCodeViewer 增加顶部阅读位置进度条：随滚动实时更新（rAF 节流，与 MarkdownViewer 一致的合成器友好策略）。
2. 进度条样式与现有 `reader-progress-bar` 视觉一致（2px 细条、`--mobile-progress` 主题色），Android 明暗主题自适应。
3. 打开代码文件时进度条可见（初始 0），滚动时按 `scrollTop / (scrollHeight - clientHeight)` 更新；不可滚动时隐藏（opacity 0，同 MarkdownViewer）。

## 非目标

- 不改桌面端（MonacoCodeViewer）。
- 不改 MarkdownViewer 现有进度条。
- 不做虚拟列表外的新滚动逻辑——复用 MobileCodeViewer 现有 `handleCodeScroll`（已在滚动时调用 `updateRange` + `scheduleVisibleLine`）。
- 不引入新的依赖库。

## 方案

`frontend/src/components/MobileCodeViewer.tsx`：

- 新增 `progressFillRef`，顶部渲染 `<div className="mobile-code-progress"><div ref={progressFillRef} className="mobile-code-progress-fill" /></div>`（放在 `.mobile-code-viewer` 最顶部）。
- 在 `handleCodeScroll`（现有单一滚动处理器，MobileCodeViewer.tsx:345）中追加进度更新：`scrollTop / (scrollHeight - clientHeight)`，rAF 节流，`fill.style.transform = scaleX(progress)`、`fill.style.opacity = 不可滚动 ? 0 : 1`。
- 挂载时（首次打开文件）也调用一次刷新，确保初始状态正确。

`frontend/src/styles/android-experience.css`（或 styles.css 的 Android 段）：

- `.mobile-code-progress { height: 2px; ... }`、`.mobile-code-progress-fill { transform-origin: left; background: var(--mobile-progress); }`，与 `.reader-progress-bar` 视觉一致。

测试：

- `frontend/src/__tests__/mobileCodeViewer.test.tsx` 新增用例：渲染进度条元素；滚动后 `transform` 按比例更新；不可滚动时 opacity 0。

## 风险

- MobileCodeViewer 已有复杂的虚拟列表/选择逻辑（Android ActionMode 冲突），进度条是纯展示、不触发 setState（直接操作 DOM style），不会引入 React 重渲染 → 不触碰选择逻辑。
- 滚动监听已有（`handleCodeScroll`），只追加 rAF 节流的 DOM 写入，无新增监听器。
