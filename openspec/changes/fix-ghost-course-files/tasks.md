# Tasks: 修复生成失败后幽灵课件导致的 404

## 1. 诊断

- [x] 1.1 确认任务 54 状态：failed（"模型返回为空内容"），非卡死
- [x] 1.2 定位根因：`_incremental_open` 占位文件 + except 不清理 → 幽灵课件 → learning-state 404
- [x] 1.3 确认 3 个 stream 分支（outline/file_lesson/outline_lesson）都有此问题

## 2. 后端修复

- [x] 2.1 `stream_file_lesson_generation` except 分支删除占位文件
- [x] 2.2 `stream_outline_lesson_generation` except 分支删除占位文件
- [x] 2.3 `stream_outline_generation` except 分支删除占位文件（含输出目录下 outline.md/project_map.md）
- [x] 2.4 后端测试：失败清理占位文件用例（file_lesson/outline_lesson/outline/取消 4 条，全量 240 绿）

## 3. 前端修复

- [x] 3.1 SSE error 后刷新课程列表（file_lesson catch 里 `refreshCourses`）
- [x] 3.2 关闭失败的课件 tab（`GenStreamError.filename` → `closeItem`；outline/outline_lesson 走 `trackTask` 轮询，completed 才打开，无幽灵 tab）
- [x] 3.3 前端测试：error 事件清理幽灵课件用例（3 条：带 filename、无 filename、正常流完成）

## 4. 验证与交付

- [x] 4.1 后端全量测试绿（240 passed）
- [x] 4.2 前端 tsc + 全量测试绿（404 passed）+ build 通过
- [x] 4.3 提交推送（OpenSpec 变更 + 代码，6361c48）
- [x] 4.4 重新打包桌面端并验证快捷方式（安装目录已同步 app.asar aa904f92 + backend b10c99b5，桌面/开始菜单快捷方式均指向最新）
- [x] 4.5 重建 APK 交付绝对路径（bundle index-BRBP_zmH.js 与 dist 一致）

## 5. 后续（跨文件检索功能，独立变更）

- [ ] 5.1 课件分析 + AI 助手界面增加"选择文件"功能（另行跟踪）
