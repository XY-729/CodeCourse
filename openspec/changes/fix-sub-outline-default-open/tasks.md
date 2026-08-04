# Tasks

## REQ-1 打开项目默认显示主总纲

- [x] 1.1 openProject 默认打开顺序改为 outline.md 优先于 recentCourse
- [x] 1.2 前端测试：recentCourse 指向子总纲时仍默认打开 outline.md

## REQ-2 桌面端子总纲分组

- [x] 2.1 list_course_files_from_dir 把 sub-outline-*.md 纳入"项目总纲"分组并正确排序
- [x] 2.2 后端测试：sub-outline 归入项目总纲组、排序正确、不重复

## 验证与交付

- [x] 3.1 前端 tsc / 测试全绿
- [x] 3.2 后端测试全绿
- [ ] 3.3 提交推送
- [ ] 3.4 重建 APK + 重打包桌面 + 同步安装目录 + 验证快捷方式
