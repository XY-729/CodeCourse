# Specs

## REQ-1 安卓生成子总纲

- **1.1** 新任务类型 `sub_outline`：`queueTask` 分支与 `runTask` 的 taskType 分发（`generateSubOutline`）
- **1.2** `generateSubOutline(projectId, payload, taskId, inputHash)`：`projectContext(projectId, paths)` 提供文件上下文，`prompt.outline` 模板渲染，产出与主总纲相同结构（`### 第 N 课`），文件名 `sub-outline-<hash8>.md`（`hashText(JSON.stringify({paths,title}))`），写 `course_files` group="总纲"
- **1.3** `queueTask` sourceFingerprint：`sub_outline` 用 `project_files` 中选中文件的内容哈希（无索引依赖）
- **1.4** 新端点 `POST /projects/:id/outlines/sub` → `queueTask(projectId, "sub_outline", body)`

## REQ-2 安卓子总纲课件

- **2.1** 新端点 `POST /projects/:id/lessons/sub-outline`，body `{ outline_path, lesson_number, title, instructions }`；校验 `outline_path` 匹配 `sub-outline-*.md` 且存在于 course_files
- **2.2** `generateOutlineLesson` 参数化：接受 `outline_path`（默认 `"outline.md"`），读对应文件、按 `### 第 N 课` 段落切分、`prepareLessonEvidence` 用子总纲段落
- **2.3** `queueTask` 的 `outline_lesson` sourceFingerprint：若 payload 带 `outline_path` 且非 `outline.md`，用该文件内容哈希（主总纲不再连带失效）
- **2.4** 课件链接：子总纲文档里也加 `addOutlineLessonLinks`（链接指向子总纲课件端点，含 `outline_path`）

## REQ-3 桌面端

- **3.1** `outline/generate`：scope.paths 非空时生成 `sub-outline-<hash8>.md`（不覆盖 `outline.md`）；否则维持现状
- **3.2** `lessons/outline`：body 加可选 `outline_path`（默认 `outline.md`），校验同 2.1
- **3.3** 后端路由 / 任务模型支持 `sub_outline` task_type（若桌面与安卓共享 task model 的地方有枚举校验）

## 验证

- 前端 tsc / 测试全绿（新增：sub_outline 端点、outline_path 参数化、文件名幂等）
- 安卓真机：选文件 → 生成子总纲 → 子总纲出现在"总纲"分组 → 点课生成课件只引用子总纲文件
- 主总纲生成行为不变（覆盖 outline.md）
