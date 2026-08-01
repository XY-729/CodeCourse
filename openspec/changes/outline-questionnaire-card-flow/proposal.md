## Why

用户反馈生成总纲前的问卷"太丑、用起来不顺手"。三个具体痛点：
1. **选项按钮不立体** — 缺乏层次与悬浮感，选中态靠药丸按钮边框，视觉扁平。
2. **没有进度感和结构** — 所有题一屏堆叠，不知道总共有几题、答到哪一题。
3. **视觉风格不统一** — 与 app 其他弹窗（`modal-title`/`icon-button`/玻璃拟态外壳）风格不一致。

用户选定方向：**更轻量的卡片流**（逐题作答、一题一卡、带进度）。

## What Changes

1. `frontend/src/components/OutlineQuestionnaireDialog.tsx`：从"所有题一屏堆叠"改为**逐题卡片流**：
   - 新增 `currentIndex` 状态，一次只渲染一道题。
   - 导航：`goNext()`/`goBack()`，Back 仅 `currentIndex>0` 时显示；Next 末题变"生成总纲"。
   - 门控改为**逐题 Next**（当前题未答则禁用），`answersReady` 只作最终提交保险。
   - 单选/多选 glyph 区分：单选 radio 圆点、多选 checkbox 方块，内嵌 `Check` 图标点亮。
   - 文本题从单行 `<input>` 改为 `<textarea>`，Enter 前进、Shift+Enter 换行。
   - header：`modal-title` + Sparkles + 关闭 `icon-button`× + 进度条"第 X / N 题"。
   - 关闭×与 Esc 都走 `onAnswers(null)`。
2. CSS 三文件（按 cascade 顺序）：
   - `frontend/src/styles.css`：替换原问卷样式块，新增 header/进度条/单卡/题号徽标/多选 hint/立体选项按钮/textArea。
   - `frontend/src/styles/apple-overlays.css`：追加桌面 token 覆盖。
   - `frontend/src/styles/android-experience.css`：追加 Android 移动端覆盖（52px 触控、`--mobile-*` token）。
3. 测试 `frontend/src/__tests__/outlineQuestionnaireDialog.test.tsx`：重写为逐题流程（导航 helper + 8 用例）。

## Capabilities

### Modified Capabilities

- `总纲前问卷交互 UI` — 从一屏堆叠改为逐题卡片流，带进度、Back/Next 导航、立体选项、关闭/Esc。

## Impact

- `frontend/src/components/OutlineQuestionnaireDialog.tsx` — 组件重写
- `frontend/src/styles.css` — 问卷样式块替换（原 1460-1513）
- `frontend/src/styles/apple-overlays.css` — 追加桌面覆盖
- `frontend/src/styles/android-experience.css` — 追加 Android 覆盖
- `frontend/src/__tests__/outlineQuestionnaireDialog.test.tsx` — 测试重写
- **App.tsx 零改动** — `Props` 签名、`onAnswers(answers|null)` 契约、`modal-backdrop`/`app-dialog` 外壳类全部保留
