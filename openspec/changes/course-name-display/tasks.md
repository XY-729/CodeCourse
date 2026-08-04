# Tasks: 课件生成后立即显示正确标题

## 1. 共享标题推导

- [x] 1.1 新增 `frontend/src/utils/titleFromMarkdown.ts`（H1 提取 + 文件名回退）
- [x] 1.2 单测 `frontend/src/__tests__/titleFromMarkdown.test.ts`（4 用例通过）

## 2. App.tsx 标题回退点

- [x] 2.1 `openCourseInActiveGroup`：tab 标题改从内容 H1 推导
- [x] 2.2 `buildOpenItem` course 分支：拖拽/命令面板打开标题
- [x] 2.3 `hydrateStoredItem` course 分支：重启恢复布局标题
- [x] 2.4 `activeLessonTitle`：阅读器当前课标题

## 3. Android 图谱连边容错

- [x] 3.1 `runTask` 持久化块：图谱连边包 try/catch，空节点跳过，失败仅 warn

## 4. 验证

- [x] 4.1 `npx tsc -b` 无错误
- [x] 4.2 前端全量测试：63 文件 440 用例全绿
- [x] 4.3 后端回归：255 用例全绿
- [x] 4.4 打包 APK 给用户真机验证
- [x] 4.5 桌面重打包 + 快捷方式指向 `C:\Users\xiyua\CodeCourse\CodeCourse.exe` 已验证
