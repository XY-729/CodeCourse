# Change: android-feature-parity

## 1. Summary

补齐安卓端与桌面端的三处功能性差距：总纲前置问卷（preflight/confirm 路由）、术语右键操作菜单、Markdown 选区高亮。只覆盖 P0 功能性缺失，P1 降级与设计取舍另立变更。

## 2. Motivation

用户要求双端功能一致。审计确认三处安卓**无对应实现**（非取舍）：
- 总纲生成时问卷被静默跳过（localProvider 无 preflight/confirm 路由）；
- 术语无右键"标记已认识/忽略"菜单（安卓 span 无 onContextMenu）；
- Markdown 选区无高亮入口（SelectionQuickBar 桌面独占）。

## 3. Requirements

- **REQ-1**：安卓端 `localProvider` 实现 `outline/generate/preflight` 与 `outline/generate/confirm`，使 `App.tsx` 现有 preflight→问卷→confirm 分支在安卓生效；问卷答案注入总纲生成（与桌面一致）。
- **REQ-2**：MarkdownViewer 安卓术语分支支持右键（onContextMenu）触发 TermActionPopover，与桌面行为一致。
- **REQ-3**：安卓端提供 Markdown 选区高亮入口，复用 `handleToggleHighlight` 与现有高亮渲染/存储。实现走原生 WebView ActionMode 菜单（与既有"提问/解释术语/我认识"同构），不引入浮动条。
- **REQ-4**：不改变桌面端行为；不破坏现有测试。

## 4. Technical Design

### 4.1 总纲前置问卷（REQ-1）

桌面行为（`backend/app/api/projects.py:267-294`）：`/outline/generate/preflight` 用 `prompt.outline.questionnaire` 模板 + 本地 LLM 生成动态问卷，返回 `{status: "questionnaire"|"no_questions", questions: [...]}`；`/outline/generate/confirm` 携带 `preflight_id` + answers 生成总纲，answers 参与 prompt 的 learner_context。

安卓实现（`frontend/src/platform/android/localProvider.ts`）：
- 注册 `POST /projects/{id}/outline/generate/preflight`：复用 `prompt.outline.questionnaire` 模板（default-prompts.json 已有），通过本地 LLM 调用（`localProvider` 已有 chat 封装）生成问卷 JSON，解析为 `OutlineQuestion[]`，返回与桌面相同结构。
- 注册 `POST /projects/{id}/outline/generate/confirm`：body 含 `{preflight_id, answers, scope, instructions}`；answers 格式化为 learner_context 片段注入 `prompt.outline` 的 `{user_instructions}` 尾部（对齐桌面 `_resolve_prompt_state` 处理），随后 `queueTask("outline")` 生成总纲，返回 GenerationTask。
- `App.tsx:2832-2844` 不改动：preflight 成功后 `openOutlineQuestionnaire` 弹出问卷，confirm 走生成。

### 4.2 术语右键菜单（REQ-2）

`MarkdownViewer.tsx` 安卓术语分支（:761-786）：
- span 增加 `onContextMenu`：`event.preventDefault(); event.stopPropagation(); onTermAction?.(term, {x: event.clientX, y: event.clientY})`。
- 条件与桌面一致：`term.status === "candidate"` 才弹（linked 术语不弹标记菜单）。
- App.tsx:5941-5954 TermActionPopover 已全局挂载，安卓通过 `onTermAction` 触发后自动出现（组件有 `android` 分支处理定位）。

### 4.3 选区高亮（REQ-3）

安卓 Markdown 选区不上报到 JS（`captureSelection` 在 `androidRuntime` 下禁用，防止 React setState 破坏原生选区 Range），选区交互由 WebView 原生 ActionMode 承载。最小对齐（与桌面 toggle 行为一致）：

- `CodeCourseWebView.java`（已包裹 `SelectionActionModeCallback`，现有"提问/解释术语/我认识"三项）：新增 `TOGGLE_HIGHLIGHT_MENU_ID`（0xCC04）"高亮"菜单项，`SHOW_AS_ACTION_IF_ROOM`，`onActionItemClicked` 分发 `codecourse-native-selection-highlight` 事件（复用 `handleSelectionAction`，携带 `{text}`）。
- `App.tsx`：新增 `codecourse-native-selection-highlight` 监听（与 ask/explain/known 同构，`activeOpenItemRef` 解析 sourceType/sourcePath）：仅 `item.type === "course" | "qa"` 时调用 `handleToggleHighlight(sourceType, path, text)`——内部按 `highlights` 匹配：已有同文本高亮则删除（"已取消高亮"），无则 `handleCreateHighlight`（"已添加高亮"），与桌面 SelectionQuickBar 的 onToggleHighlight 完全同逻辑。
- 渲染侧无需改动：MarkdownViewer `highlightChildren` 已处理高亮 mark（两端共用）。

## 5. Edge Cases

- preflight LLM 失败/超时：返回 `{status: "error"}`，App.tsx:2835 现有分支走"无问卷直接生成"，不阻塞。
- 问卷答案为空（用户跳过）：confirm 带空 answers，总纲按无问卷路径生成（对齐桌面）。
- 术语右键在长按文本选区时：Android WebView 原生 ActionMode 优先；仅当未选中文本（selection 折叠）时术语右键/长按弹菜单——与桌面右键不冲突选区一致。
- 高亮菜单项在 WebView 内文本选区即出现（course/qa 来源），点按后 ActionMode 收起；重复点按同一选区文本为取消高亮（toggle），与桌面一致。
- 选区位于 code/plaintext 文件（`item.type === "file"`）时忽略：高亮仅支持 course/qa（桌面 `canHighlight` 同约束）。
- 无 `mobileRuntime` 环境（桌面）：所有改动不生效，桌面行为不变。

## 6. Test Plan

- 新增/更新 localProvider 单测：preflight 路由返回问卷结构；confirm 路由携带 answers 生成任务。
- 新增 MarkdownViewer 渲染测试：安卓分支 onContextMenu 触发 onTermAction。
- 全量前端 tsc / npm test / build。
- 浏览器 `?preview=android` 手工验证三条路径。
