# Android feature parity with desktop

## 背景

用户要求"安卓端和桌面端功能一致"。四 agent 并行审计 + 手工交叉验证后确认：主体功能（阅读/问答/生成/设置）双端基本对齐，但存在三类真实缺口：

**P0 功能性缺失（安卓无对应实现）**
1. 总纲前置问卷被跳过：`client.ts:502` 有 `outline/generate/preflight` + `confirm` 端点，`localProvider.ts:709` 只有 `/outline/generate`（直接 queueTask）→ `App.tsx:2832` 调 preflight 抛"移动端尚未实现" → 问卷答案静默丢弃。
2. 术语右键菜单缺失：MarkdownViewer 安卓 span（:761）无 onContextMenu，TermActionPopover 安卓永不触发，"标记已认识/忽略"无入口。
3. Markdown 选区无法高亮：SelectionQuickBar（App.tsx:5987 `!mobileRuntime`）不渲染，安卓高亮创建完全无入口。

**P1 体验降级**：流式生成缺失（SSE→轮询、无取消）、QA 回答非流式（client.ts:766-771）、QA 无并发限制（桌面 Semaphore(2)，安卓无限）、导入能力弱（ZIP≤40MB + HTTPS 快照，无本地文件夹/SSH）、无 OTA、快捷键只有 Ctrl+K。

## 范围

本变更只做 **P0 三件**（功能性缺失），P1 降级项另立变更。设计取舍项（分离窗口/托盘/手势/多分栏）不在范围内。

## 方案

### REQ-1 总纲前置问卷（P0-1）

- `localProvider.ts` 注册 `POST /outline/generate/preflight`：用本地 LLM 调用 + `prompt.outline.questionnaire` 模板（复用后端 `preflight` 端点行为，生成动态问卷，返回 `{status, questions}`）。
- 注册 `POST /outline/generate/confirm`：携带 `preflight_id` + answers，走现有总纲生成路径（与桌面 confirm 行为一致：answers 注入 learner_context）。
- `App.tsx:2832-2844` 现有 preflight/问卷/confirm 分支即可在安卓生效，无需改 App。

### REQ-2 术语右键菜单（P0-2）

- MarkdownViewer 安卓术语分支（span role=button）增加 `onContextMenu` 处理：`event.preventDefault()` + 调 `onTermAction?.(term, {x, y})`，触发 App.tsx:5941-5954 已挂载的 TermActionPopover（生成解释/我认识/我不认识/忽略）。
- 与桌面一致：右键位置锚定 popover。

### REQ-3 选区高亮（P0-3）

- 安卓端在选区出现时显示浮动高亮入口（复用 SelectionQuickBar 的高亮逻辑，移动端渲染受限版本：仅"高亮/取消高亮"），或在阅读工具条提供入口。
- 复用 `handleToggleHighlight`（App.tsx:3852）与现有高亮存储路径（qaHighlightDraft/reader-highlight）。
- 视觉对齐桌面：高亮 mark 渲染已两端共用（MarkdownViewer highlightChildren）。

## 验证

1. 前端 tsc / npm test / build 全绿。
2. 浏览器 preview（`?preview=android`）验证：生成总纲出现问卷、术语长按出菜单、选区高亮可用。
3. 重打包桌面 + 重建 APK。
4. 提交推送，OpenSpec 流程收尾。
