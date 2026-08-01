# 总纲前置问卷逐题卡片流（One-Question Card Flow）

## ADDED Requirements

### Requirement: 逐题卡片流渲染

问卷 SHALL 一次只渲染一道题，用 `currentIndex` 状态控制当前题。`preflight` 变化时 `currentIndex` SHALL 归零。

#### Scenario: 初始渲染
- **WHEN** 问卷打开
- **THEN** 只显示第 1 题，其余题不在 DOM
- **AND** header 显示标题、进度"第 1 / N 题"、关闭按钮

#### Scenario: 前进到下一题
- **WHEN** 用户点击"下一步"且当前题已答
- **THEN** 渲染下一题，前一题离开 DOM
- **AND** 已答内容保存在顶层 `selections`/`texts` map 中

### Requirement: 逐题 Next 门控

"下一步"/"生成总纲"按钮 SHALL 在当前题未答时禁用。`answersReady`（全部答完）SHALL 仅作为末题提交按钮的最终保险。

#### Scenario: 当前题未答
- **WHEN** 当前题为单选/多选且未选任何选项，或为文本题且 trim 后为空
- **THEN** Next 按钮禁用

#### Scenario: 全部答完
- **WHEN** 所有题均已答
- **THEN** 末题按钮"生成总纲"可用，点击提交全部答案

### Requirement: Back 导航保留已答

"上一步"按钮 SHALL 仅在 `currentIndex > 0` 时显示。往返后回到的题 SHALL 保持已选状态（`.selected`）与已输入文本。

#### Scenario: 回退并前进
- **WHEN** 用户在第 2 题点击"上一步"
- **THEN** 回到第 1 题且其已选选项仍为 `.selected`
- **AND** 再次前进到第 2 题，第 2 题已选状态同样保留

### Requirement: 单选/多选视觉区分

单选 SHALL 用 radio 圆点 glyph，多选 SHALL 用 checkbox 方块 glyph。选中时 glyph 点亮为 accent 背景 + 白色 `Check` 图标。多选题 SHALL 显示"可多选"提示 pill。

#### Scenario: 单选题
- **WHEN** 渲染单选（`single_choice`）题
- **THEN** 每个选项显示圆形 glyph
- **AND** 点击某选项替换为最新选中（单选语义）

#### Scenario: 多选题
- **WHEN** 渲染多选（`multi_choice`）题
- **THEN** 每个选项显示方形 glyph，题头显示"可多选" pill
- **AND** 点击选项可多选/取消，选中项数组维护

### Requirement: 文本题 textarea 交互

文本题（`text` 或 `options` 为空）SHALL 用 `<textarea rows={3}>` 而非单行 `<input>`。Enter（非 Shift）SHALL 前进到下一题；Shift+Enter 换行；Esc 关闭。

#### Scenario: 文本输入
- **WHEN** 渲染文本题
- **THEN** 显示 textarea，占位"输入你的回答..."
- **AND** Enter 前进（末题时提交），Esc 关闭

### Requirement: 关闭与 Esc 返回 null

关闭按钮（header ×，`aria-label="关闭"`）与 Esc 键 SHALL 调用 `onAnswers(null)`，语义等同"跳过，直接生成"。

#### Scenario: 点击关闭按钮
- **WHEN** 用户点击 header 关闭 ×
- **THEN** `onAnswers(null)` 被调用一次

#### Scenario: 按 Esc
- **WHEN** 用户按 Escape 键
- **THEN** `onAnswers(null)` 被调用一次

### Requirement: 立体选项按钮样式

选项按钮 SHALL 具备三维层次：边框 + inner-highlight + 微阴影 + hover 上浮（`translateY(-1px)`）+ 选中 3px 光环。桌面与 Android 用各自 token 体系。

#### Scenario: hover 与选中
- **WHEN** 鼠标悬停选项
- **THEN** 边框变 accent、背景微染、轻微上浮阴影
- **WHEN** 选项选中
- **THEN** 边框/文字变 accent、背景 accent-soft、3px 光环、glyph 点亮

### Requirement: Android 触控适配

Android（`html.platform-android`）SHALL 覆盖问卷样式：选项按钮 ≥52px、导航按钮与关闭按钮 ≥44px、`--mobile-*` token、`--mobile-radius-sm` 圆角。深色模式 SHALL 由 `--mobile-*` 自动适配。

#### Scenario: Android 渲染
- **WHEN** 在 Android 平台打开问卷
- **THEN** 选项/导航/关闭触控目标 ≥44px（选项 ≥52px）
- **AND** 使用 `--mobile-*` token，深色模式正确

### Requirement: 外壳类与答案契约不变

外壳类 `modal-backdrop` + `app-dialog outline-questionnaire-dialog`、`Props` 签名、`onAnswers(answers|null)` 契约、`toAnswer` 答案形状 SHALL 保持不变（`App.tsx` 无需改动）。

#### Scenario: App 接线兼容
- **WHEN** App.tsx 以原有 `Props` 渲染问卷
- **THEN** 行为与 Promise 门完全兼容，无任何 App.tsx 改动

#### Scenario: 边界——0 题
- **WHEN** `preflight.questions` 为空
- **THEN** footer 显示"跳过，直接生成"与禁用的"生成总纲"，进度条隐藏，不崩溃

#### Scenario: 边界——未知 question_type
- **WHEN** 题目类型不是 single/multi/text
- **THEN** 按单选处理（radio glyph），提交时 `selected` 为 `selection[0] ?? ""`，与现行为一致
