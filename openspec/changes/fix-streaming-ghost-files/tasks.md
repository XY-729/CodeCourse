# Tasks: 修复流式课件生成的两个缺陷

## 1. 后端：临时文件流式写入

- [ ] 1.1 `stream_file_lesson_generation`：占位写入 `<final>.streaming`，成功 `Path.replace` 到最终路径，失败/取消只清理临时文件
- [ ] 1.2 `stream_outline_lesson_generation`：同上（`lessons/lesson_NN.md.streaming`）
- [ ] 1.3 `stream_outline_generation`：`outline.md` 走 `.streaming`；`project_map.md` 成功原子写不变
- [ ] 1.4 更新 `test_ghost_course_cleanup.py`：失败/取消后无 `*.md` 与 `*.streaming` 残留；成功路径旧课件不被截断
- [ ] 1.5 后端全量测试绿（backend 目录 pytest）

## 2. 前端：乐观标签路径

- [ ] 2.1 `handleGenerateFileLesson` 乐观 `filename` 前缀 `lessons/` → `files/`
- [ ] 2.2 前端 tsc + 测试 + build 绿

## 3. 验证与交付

- [ ] 3.1 真实验证：生成失败/成功路径，前端无 "learn source notfound" 404
- [ ] 3.2 提交推送
- [ ] 3.3 重打包桌面（同步安装目录 + 哈希验证 + 快捷方式）
- [ ] 3.4 重建 APK 交付绝对路径
