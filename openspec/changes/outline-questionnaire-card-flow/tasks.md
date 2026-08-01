# Tasks: 总纲前置问卷逐题卡片流

## 1. 组件重写 `OutlineQuestionnaireDialog.tsx`

- [x] 1.1 新增 `currentIndex` 状态，`preflight` 变化归零
- [x] 1.2 `goNext()`/`goBack()` 导航；Back 仅 `currentIndex>0` 显示；末题 Next 文案"生成总纲"
- [x] 1.3 逐题 `questionAnswered()` 门控；`answersReady` 仅作提交保险
- [x] 1.4 单选 radio 圆点 / 多选 checkbox 方块 glyph + `Check` 图标；多选"可多选" pill
- [x] 1.5 文本题改 `<textarea>`，Enter 前进 / Shift+Enter 换行 / 首文本题 autoFocus
- [x] 1.6 header：`modal-title` + Sparkles + 关闭 `icon-button`× + 进度条"第 X / N 题"
- [x] 1.7 关闭×与 Esc → `onAnswers(null)`（不用死代码 `onClose`）

## 2. CSS 三文件

- [x] 2.1 `styles.css`：替换问卷样式块（header/进度条/单卡/题号徽标/多选 hint/立体选项按钮/textarea）
- [x] 2.2 `apple-overlays.css`：追加桌面 token 覆盖（`html:not(.platform-android)`）
- [x] 2.3 `android-experience.css`：追加 Android 覆盖（`html.platform-android`，52px 选项 / 44px 导航与关闭 / `--mobile-*`）

## 3. 测试重写 `outlineQuestionnaireDialog.test.tsx`

- [x] 3.1 3 题样例（q0 single / q1 multi / q2 text）+ 导航 helper
- [x] 3.2 用例：逐题渲染+导航+submit 返回 toAnswer 形状（single→string、multi→array、text→trim）
- [x] 3.3 单选只留最后一次选择
- [x] 3.4 Next 当前题未答禁用，逐题解锁
- [x] 3.5 跳过 → null
- [x] 3.6 Back 保留已选（往返后 `.selected` 仍在，答案正确）
- [x] 3.7 进度显示"第 X / N 题"
- [x] 3.8 关闭按钮 + Esc 各自 resolve null
- [x] 3.9 单题 preflight：无"上一步"、按钮直接"生成总纲"

## 4. 验证

- [x] 4.1 `npx tsc -b` 零错误
- [x] 4.2 前端全量测试通过（376 个，含 5 个新增）
- [x] 4.3 `npm run build` CSS/TS 编译通过

## 5. OpenSpec 记录

- [x] 5.1 proposal.md / design.md / spec.md / tasks.md 已建
