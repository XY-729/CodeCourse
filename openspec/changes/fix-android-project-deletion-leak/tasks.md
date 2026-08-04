# Tasks

## REQ-1 修复删除项目索引泄漏

- [x] 1.1 `deleteProject` 补删 `code_chunks`（索引主表）
- [x] 1.2 `deleteProject` 补删 `indexed_files`（索引文件元数据）
- [x] 1.3 `deleteProject` 补删 `project_files`（文件清单）
- [x] 1.4 保持既有清理顺序与 `.catch` 容错（FTS 先删，projects 行最后删）

## REQ-2 回归测试与验证

- [x] 2.1 新增删除清理测试（四表无残留）
- [x] 2.2 前端 tsc / 全量测试通过

## 交付

- [x] 3.1 提交推送（OpenSpec 收尾）
- [x] 3.2 重建 APK + 重打包桌面
