# Tasks: 课件重命名

## REQ-1 后端重命名能力

- [x] 1.1 `PATCH /api/projects/{id}/course/{filename}` API + RenameCourseRequest 校验（空/路径/非法字符/重名/保留名/不存在）
- [x] 1.2 文件移动 + H1 标题更新 + outline_path 引用重写 + 失败回滚
- [x] 1.3 子总纲标记保留 + add_outline_lesson_links 重写课件链接
- [x] 1.4 `rename_course_references` 事务迁移全部 DB 引用（tasks/qa/highlights/links/terms/states/nodes）
- [x] 1.5 `CourseFile.is_outline` 字段 + `_validate_sub_outline_path` 扩展为存在性与标记校验（所有调用点传 project_id）

## REQ-2 前端重命名入口

- [x] 2.1 CourseList 铅笔按钮（保留名隐藏）+ Sidebar 透传
- [x] 2.2 handleRenameCourse：进行中拦截 + requestText 弹窗 + flush 待更新
- [x] 2.3 成功后布局/选区/QA 同步 + 全量刷新 + toast
- [x] 2.4 renameCourseFile API + Android renameGeneratedFile

## REQ-3 测试与交付

- [x] 3.1 后端 test_course_rename（保留图谱边 + 引用迁移 + 拒绝保留名/重名）通过
- [ ] 3.2 前端 tsc / 后端全量测试通过
- [ ] 3.3 提交推送 + 桌面包重建同步 + 浏览器实测
