# android-reading-position

## Requirements

### R1: 安卓端课件重新进入时恢复到上次滚动位置
- 用户读过某个课件 (Markdown) 并滚动到一定位置后,切换课件或重新打开同一课件,必须恢复到上次阅读到的位置,而不是从顶部开始。
- 保存链路保持不变 (`onScrollRatioChange` → `learning_states` 表,`position_kind=scroll_ratio`),恢复端补齐。

### R2: 恢复不得干扰活动选择
- 当用户正在拖动文本选择手柄 (`window.getSelection()` 非 collapsed) 时,不得执行滚动恢复。
- 恢复时机使用 `requestAnimationFrame`,在布局稳定后设置 `scrollTop`,避免被内容刷新 / resize 覆盖。

### R3: 恢复只对已保存过位置的文档生效
- `initialScrollRatio === 0` 时保持 `scrollTop = 0`,不产生多余跳动。
- 同一文档不重复恢复 (`restoredSourceRef` 已存在逻辑),避免 save→restore 跳变循环。

## Constraints

- 复用组件内已有的 `hasActiveAndroidSelection()` 与 `restoredSourceRef` 逻辑。
- 仅在 `frontend/src/components/MarkdownViewer.tsx` 内修改恢复 effect;保存端、App.tsx 传递、localProvider 持久化均不变。
