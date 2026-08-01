# 总纲前置问卷逐题卡片流 — 设计

## Context

生成总纲前的问卷 UI 被用户反馈"太丑、用起来不顺手"。痛点：选项按钮不立体、无进度感与结构、与 app 其他弹窗风格不统一。方向：**逐题卡片流**（一题一卡、带进度、Back/Next 翻页）。

## Goals / Non-Goals

**Goals:**
- 逐题渲染（一次一道），带进度条"第 X / N 题"与题号徽标
- 逐题 Next 门控（当前题未答禁用），Back/Next 往返保留已答
- 单选 radio 圆点 / 多选 checkbox 方块 glyph 区分，多选提示"可多选"
- 文本题用 `<textarea>`，Enter 前进、Esc 关闭
- 关闭按钮 × 与 Esc → `onAnswers(null)`
- 桌面 + Android 共用组件，Android 触控尺寸（44px/52px）与 `--mobile-*` token 适配

**Non-Goals:**
- 不改 `App.tsx` 接线（`Props` 签名、`onAnswers` 契约、Promise 门保持原样）
- 不改后端答案注入逻辑（`serialize_learning_intent` / `persist_prerequisite_answers` 消费的 `OutlineSurveyAnswer` 形状不变）
- 不做"自由导航 + 全部答完才允许提交"的宽松模式（与轻量目标冲突）

## Decisions

### Decision 1: 逐题门控而非全答门控

Next 在当前题未答时禁用。`answersReady`（全部答完）只保留给末题"生成总纲"按钮作保险。这样"答不完到不了提交"由结构保证，用户每步只面对一道题。

**Why not 自由导航**: 逐题阻断更轻、更聚焦，符合"轻量卡片流"方向。

### Decision 2: Back/Next 往返不丢失已答

`selections`/`texts` 存顶层 map（key = `q.question`），翻页不清空。Back 后再 Next 回到原题，已选项仍为 `.selected`。

### Decision 3: 单选/多选纯 CSS glyph，不引原生 input

单选 = radio 圆点（`border-radius:50%`），多选 = checkbox 方块（`border-radius:5px`），选中点亮为 `--apple-blue` 背景 + 白色 `Check` 图标。保留现有按钮药丸结构，不引入原生表单控件，避免 Android/桌面渲染差异。

### Decision 4: 关闭×与 Esc 都走 `onAnswers(null)`

`onClose` prop 在 App.tsx 中是死代码（从不触发），新 UI 的关闭按钮直接调 `skip()`（即 `onAnswers(null)`），保持 App 接线不变。Esc 用 `useEffect` window keydown（仿 `TermFeedbackPopover` 模式），textarea 内 Esc 同样关闭。

### Decision 5: 外壳类与 token 体系复用

外壳保留 `modal-backdrop` + `app-dialog outline-questionnaire-dialog`，使既有平台覆盖继续生效（Android 24px 圆角、material 表面、移动模糊；桌面玻璃拟态）。颜色全部用 token（桌面 `--apple-*`，跨平台 `--cc-*`，移动 `--mobile-*`），深色模式自动适配，不写死 hex。

## Risks

- 逐题流程改变测试交互方式（后题在导航前不在 DOM）——测试需先导航再断言，测试已按此重写。
- Android 软键盘 Enter 会触发 textarea 前进——可接受，且与"Enter 前进"统一。
- 0 题 / 未知 `question_type` 边界：0 题显示跳过 + 生成总纲禁用、进度条隐藏；未知类型按 single 处理（radio glyph + `selected[0] ?? ""`），与现行为一致。

## Files

- `frontend/src/components/OutlineQuestionnaireDialog.tsx` — 组件重写
- `frontend/src/styles.css` — 问卷样式块替换
- `frontend/src/styles/apple-overlays.css` — 追加桌面覆盖
- `frontend/src/styles/android-experience.css` — 追加 Android 覆盖
- `frontend/src/__tests__/outlineQuestionnaireDialog.test.tsx` — 测试重写
