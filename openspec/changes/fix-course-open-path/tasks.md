# Tasks: 修「打开课件」404

## 1. 实现

- [x] 1.1 `appUtils.ts` 新增 `resolveCourseFilename(outputPath, courseFilenames, projectId)`
- [x] 1.2 `App.tsx` `handleOpenGenerationTask` 改用该函数；解析失败时提示「找不到这个任务对应的课件文件，请从课程列表打开。」
- [x] 1.3 `useGenerationTrackingController.ts` 完成后自动打开改用该函数

## 2. 测试

- [x] 2.1 新增 `src/app/appUtils.test.ts`：Windows 绝对路径、正斜杠路径、相对路径、列表项带反斜杠、`generated/<id>/` 回退、无法定位返回 null

## 3. 校验

- [x] 3.1 前端 vitest 全绿（97 文件 541 用例）
- [x] 3.2 后端实测：`GET /api/projects/12/course/lessons%2Flesson_05.md` → 200；绝对路径 → 404（解析后不再产生该请求）
- [x] 3.3 后端 unittest 全绿（唯一失败为他人未提交的 lesson-preview 进度计数，与本变更无关）

## 4. 交付

- [x] 4.1 重新打包桌面应用并更新本机安装内容
- [x] 4.2 校验桌面 `CodeCourse.lnk` 指向新的安装可执行文件（sha256 三项一致）
- [x] 4.3 装机后实机复核：`/course/lessons%2Flesson_05.md` → 200；`/course/lessons%5Clesson_05.md` → 404（旧行为，新前端不再产生）
