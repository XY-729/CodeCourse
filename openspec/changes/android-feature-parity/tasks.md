# Tasks

## P0-1 总纲前置问卷（REQ-1）

- [ ] 1.1 `localProvider.ts` 注册 `outline/generate/preflight`：复用 prompt.outline.questionnaire + 本地 LLM 生成问卷，返回桌面同构结构
- [ ] 1.2 注册 `outline/generate/confirm`：answers 注入 user_instructions → queueTask("outline")
- [ ] 1.3 App.tsx preflight 分支安卓验证（问卷弹出 + confirm 生成）

## P0-2 术语右键菜单（REQ-2）

- [ ] 2.1 MarkdownViewer 安卓术语分支加 onContextMenu → onTermAction（candidate 才弹）
- [ ] 2.2 App.tsx TermActionPopover 安卓触发验证（生成解释/我认识/我不认识/忽略）

## P0-3 选区高亮（REQ-3）

- [x] 3.1 原生 ActionMode 菜单新增"高亮"项（CodeCourseWebView.java TOGGLE_HIGHLIGHT_MENU_ID）+ App.tsx `codecourse-native-selection-highlight` 监听复用 handleToggleHighlight
- [x] 3.2 仅 course/qa 来源触发（file 忽略）；重复点按同文本 toggle 取消；ActionMode 收起即消失

## 验证与交付

- [x] 4.1 新增/更新单测（localProvider preflight/confirm；MarkdownViewer onContextMenu）
- [x] 4.2 前端 tsc / npm test / build 全绿
- [x] 4.3 浏览器 `?preview=android` 手工验证三条路径
- [x] 4.4 提交推送（OpenSpec 流程收尾）
- [ ] 4.5 重打包桌面 + 重建 APK
