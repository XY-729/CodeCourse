# Tasks: 总纲前置问卷 + 桌面偏好闭环

## 1. 后端数据层

- [x] 1.1 `storage.py`: 新增 `outline_preflights` 表(id TEXT PK, project_id INTEGER, scope_json TEXT, questions_json TEXT, status TEXT, answers_json TEXT, created_at TEXT, updated_at TEXT)
- [x] 1.2 `storage.py`: 加 CRUD — `insert_outline_preflight()`, `get_outline_preflight()`, `update_outline_preflight()`

## 2. 后端问卷生成服务

- [x] 2.1 新建 `backend/app/services/outline_questionnaire.py`: `generate_questionnaire(project_id, scope, instructions)` — 用模型生成问卷(JSON),解析校验,落库,返回 `(preflight_id, questions)`
- [x] 2.2 `prompt_store.py`: 新默认提示词 `prompt.outline.questionnaire`(问卷生成指令:选择题优先、至少一道前置知识题、模型自由扩展题型),加入 PROMPT_DEFAULTS 与 EDITABLE_PROMPT_KEYS
- [x] 2.3 `outline_questionnaire.py`: `serialize_learning_intent(answers)` — 把答案序列化为 `<learning_intent>` 块
- [x] 2.4 `outline_questionnaire.py`: `persist_prerequisite_answers(project_id, answers)` — 仅 dimension=prerequisite_level 的答案经 `apply_preference_feedback` 写入

## 3. 后端 API

- [x] 3.1 `schemas.py`: `OutlinePreflightRequest`(scope, instructions)、`OutlinePreflightResponse`(preflight_id, questions)、`OutlineConfirmRequest`(preflight_id, answers)、`GenerateOutlineRequest` 加 `survey_answers: list[dict] = []`
- [x] 3.2 `projects.py`: `POST /outline/generate/preflight`(同步调模型生成问卷)
- [x] 3.3 `projects.py`: `POST /outline/generate/confirm`(校验 preflight → 注入答案 → 建任务)
- [x] 3.4 `projects.py`: 改造 `POST /outline/generate` 接收 `survey_answers` 透传给 `create_or_reuse_outline_task`

## 4. 后端生成管线注入

- [x] 4.1 `generation_service.py`: `build_outline_input` 支持 `survey_answers` 并入 `<learning_intent>`
- [x] 4.2 `generation_service.py`: `run_outline_generation_task` 与 `stream_outline_generation` 加 `survey_answers` 参数
- [x] 4.3 `projects.py` 两条路径透传

## 5. 前端 API

- [x] 5.1 `client.ts`: `OutlineQuestion`/`OutlinePreflight` 类型、`generateOutlinePreflight()`, `confirmOutlineAnswers()`
- [x] 5.2 `client.ts`: 扩展 `generateOutline()` 接受 `survey_answers`

## 6. 前端问卷 UI

- [x] 6.1 新建 `frontend/src/components/OutlineQuestionnaireDialog.tsx`: 多题选择题渲染(单选/多选)、跳过按钮、加载态
- [x] 6.2 `App.tsx`: `handleGenerateOutline` 在 confirmAction 后插入 preflight → 问卷 → confirm 流程
- [x] 6.3 CSS: 复用 `learner-survey-card` 样式,必要时补 `.outline-questionnaire-*`

## 7. 桌面偏好闭环

- [x] 7.1 `LearnerProfileDialog.tsx`: 新增"讲解偏好"视图(五维滑块/select + 保存 + 重置默认),接通 `updateLearnerPreferences`
- [x] 7.2 `TeachingRationale` 反馈条桌面端已挂载 QA 回答下,`submitAnswerFeedback` 调用闭环已通

## 8. 测试

- [x] 8.1 新建 `backend/tests/test_outline_questionnaire.py`: 问卷生成 JSON 解析、落库、learning_intent 序列化、前置知识持久化、confirm 流程
- [x] 8.2 后端回归: `cd backend && .venv/Scripts/python.exe -m unittest`(203 测试)
- [x] 8.3 前端: `cd frontend && pnpm test`(371 测试) + `npx tsc -b`
- [ ] 8.4 手动桌面: 生成总纲 → 问卷 → 作答 → 总纲含前置章节;档案偏好滑块;QA 反馈条
