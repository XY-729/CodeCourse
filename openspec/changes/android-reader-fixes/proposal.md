## Why

安卓端 (v0.4.x 移动端统一阅读器重构后) 出现两个用户可感知的回归，都在"在最新 push (3946cb7) 基础上"仍可复现：

1. **代码文件文本无法选中**：在代码查看器 (MobileCodeViewer) 中长按文本，系统选择工具栏 (ActionMode) 弹出后立即消失；课件 (MarkdownViewer) 中长按选中正常。
2. **课件阅读进度丢失**：读完课件一部分后切换课件或重新进入，滚动位置回到顶部，需要从头翻；此前版本有进度恢复功能。

两处根因都已定位到具体代码：

- Bug 1：`frontend/src/components/MobileCodeViewer.tsx:174-222` 在 `selectionchange` 事件里对每次选择变化调用 `setSelectionActive/setSelectionAnchorLine`（React state），并触发 `onSelectionChange` → App.tsx 的 `setSelection/setSelectionAnchor`，导致整棵组件树重渲染、`renderLine` 重跑、DOM 节点被 React 重建，原生 Range 被销毁，WebView 的 ActionMode 立即关闭。而 `MarkdownViewer.tsx` 明确规避了这个坑：安卓下完全不 setState（`captureSelection` 行 611-613 直接 return），全靠 WebView 原生 ActionMode。
- Bug 2：`frontend/src/components/MarkdownViewer.tsx:385-386` 恢复滚动位置的 effect 第一行 `if (androidRuntime) return;` 直接短路。保存链路是活的（`App.tsx:4601` → `useLearningStateController.queueLearningUpdate` → `localProvider.updateLearningState` 写入 SQLite `learning_states`，打开时 `App.tsx:4266/4600` 读回 `initialScrollRatio`），但恢复在安卓被跳过，所以每次重新挂载都是 `scrollTop=0`。

本变更的目标：恢复安卓端代码文本的可选中性（不破坏虚拟列表、不破坏搜索、不破坏显式跳转），以及恢复安卓端课件的滚动位置恢复。

## What Changes

**1. 修复代码文本选中（Bug 1）**

`MobileCodeViewer.tsx` 的 `selectionchange` 处理器在安卓下只读 `getSelection()` 并直接上报，不调用会触发重渲染的 React state 更新。具体：

- `setSelectionActive(true)` / `setSelectionAnchorLine(anchorLine)` 这两个 state 唯一作用是"虚拟列表固定锚点行"（在拖动选择手柄跨越大量行时，把 anchor 行 pin 在虚拟渲染范围内）。在安卓长按选中的场景，选择手柄通常只跨几行，且重渲染本身就会销毁 Range——所以安卓下不再 setState。
- `selectionAnchorLine` 的 DOM pin 行为（行 385-388 把 anchor 行并进虚拟渲染数组）保留给非安卓路径；安卓下该值为 null，等价于"不 pin，全原生"。
- 保留对 `onSelectionChange` 的上报（App.tsx 需要 selectedText 用于问答），但上报在 selectionchange 里仍会触发 App 的 `setSelection`。需要确认：App.tsx 的 `handleSelection` 在 `mobileRuntime` 下调用 `setSelection/setSelectionAnchor` 也会造成重渲染。因此需检查 App.tsx 侧是否也对安卓做了规避，或需配合调整（见设计）。
- `performProgrammaticScroll`（行 283）依赖 `selectionActive` 阻止滚动：安卓下 `selectionActive` 不再被选中态置为 true，改为直接用 `hasActiveAndroidSelection()`（复用 MarkdownViewer 已有的工具，或本组件内联判断 `!window.getSelection().isCollapsed`）来判断。

**2. 恢复课件滚动位置（Bug 2）**

`MarkdownViewer.tsx` 恢复 effect（行 385-405）移除 `if (androidRuntime) return;`，让安卓也执行 `article.scrollTop = maxScroll * ratio`。恢复时避开活动选择态：

- 复用已有的 `hasActiveAndroidSelection()` 判断（行 478-482）：若用户在拖动选择手柄，跳过本次恢复，等下一次 content/source 变化时再恢复。
- 恢复时机使用 rAF（现有行 397-403 已有 `requestAnimationFrame` 包裹），等布局稳定后再设 scrollTop，避免被后续 resize/内容刷新覆盖。

## Capabilities

### New Capabilities

### Modified Capabilities
- `mobile-code-selection`: 安卓端代码文本可长按选中且选择工具栏不消失（虚拟列表 + 搜索 + 显式跳转不受影响）
- `android-reading-position`: 安卓端课件重进时恢复到上次滚动位置

## Impact

- `frontend/src/components/MobileCodeViewer.tsx` — selectionchange 处理器去 React state、programmatic scroll 改判活动选择
- `frontend/src/App.tsx` — 若 handleSelection 需配合，调整安卓下的 setState 规避
- `frontend/src/components/MarkdownViewer.tsx` — 移除恢复 effect 的 androidRuntime 短路
- 新增/更新 `frontend/src/__tests__/` 下相关回归测试（scrollPersistence、virtualList、MobileCodeViewer 选中）
- 不触及后端（Python）与 Android 原生 (capacitor/java) 代码

**Not touched:** 后端 FastAPI、Android 原生层、教材/提示词/个性化系统。
