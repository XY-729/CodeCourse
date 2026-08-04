# Tasks

## REQ-1 安卓生成子总纲

- [x] 1.1 新任务类型 sub_outline 分发（queueTask + runTask）
- [x] 1.2 generateSubOutline 实现（projectContext + prompt.outline + 幂等文件名）
- [x] 1.3 queueTask sourceFingerprint（sub_outline 用选中文件内容哈希）
- [x] 1.4 端点 POST /outlines/sub

## REQ-2 安卓子总纲课件

- [x] 2.1 端点 POST /lessons/sub-outline + outline_path 校验
- [x] 2.2 generateOutlineLesson 参数化 outline_path
- [x] 2.3 queueTask outline_lesson sourceFingerprint 用子总纲文件
- [x] 2.4 子总纲 addOutlineLessonLinks 带 outline_path

## REQ-3 桌面端

- [x] 3.1 outline/generate scope.paths → sub-outline-<hash>.md
- [x] 3.2 lessons/outline outline_path 可选参数
- [x] 3.3 后端 task model 支持 sub_outline

## 验证与交付

- [x] 4.1 前端 tsc / 测试全绿
- [x] 4.2 提交推送
- [x] 4.3 重建 APK + 重打包桌面
