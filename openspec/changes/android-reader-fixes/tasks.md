# Tasks: Android 阅读器两处回归修复

## 1. Bug 1 — 代码文本选中工具栏消失

- [x] 1.1 `MobileCodeViewer.tsx`:新增 `pendingSelectionRef` 与 `onSelectionChangeRef` (同步 ref)
- [x] 1.2 重写 `handleSelectionChange`:安卓分支选中中只读 `getSelection()` 写入 `pendingSelectionRef`,不 setState、不 `onSelectionChange`;选择不再活跃时一次性上报并清空 ref
- [x] 1.3 非安卓分支保留现有 selectionchange 即上报 + 锚点行 pin 逻辑
- [x] 1.4 `performProgrammaticScroll` 活动选择守卫改用原生 DOM selection 判断 (安卓),不再依赖 `selectionActive` state
- [x] 1.5 `selectionActive` state 在安卓路径不再被选中态置 true,仅用于非安卓路径;reset effect 与 search 分支保持

## 2. Bug 2 — 课件阅读进度丢失

- [x] 2.1 `MarkdownViewer.tsx`:恢复 effect (行 385) 移除 `if (androidRuntime) return;`
- [x] 2.2 恢复前加 `hasActiveAndroidSelection()` 守卫 (拖动选择时跳过),并在 rAF 回调内二次检查
- [x] 2.3 确认 rAF 内 `article.scrollTop = maxScroll * ratio` 对安卓生效,`restoredSourceRef` 每文档恢复一次的语义保持

## 3. 测试

- [x] 3.1 新增 `frontend/src/__tests__/androidCodeSelection.test.tsx`:
  - 安卓选中中不 setState / 不上报
  - 收起后上报一次、文本正确
  - 非安卓路径不回归
- [x] 3.2 新增 `frontend/src/__tests__/androidReadingRestore.test.tsx`:安卓 `initialScrollRatio` 恢复用例 + 活动选择守卫用例 + ratio=0 置顶用例
- [x] 3.3 现有 `virtualList.test.tsx` 无需改动 (非安卓路径未变)

## 4. 验证

- [x] 4.1 `pnpm --dir frontend test` 全部通过 (47 文件 / 367 测试)
- [x] 4.2 `npx tsc -b`(frontend)类型通过
- [ ] 4.3 人工验证 (安卓真机):代码选中工具栏不消失、收起后 assistant 可消费选中文本
- [ ] 4.4 人工验证 (安卓真机):课件重进恢复到原滚动位置
- [x] 4.5 桌面回归:测试套件覆盖 (非安卓路径未变,362→367 全绿)

> 注:4.3/4.4 需安卓真机/模拟器验证,本机为 Windows 桌面无法复现 WebView 原生 ActionMode 行为;单元测试已覆盖行为契约。
