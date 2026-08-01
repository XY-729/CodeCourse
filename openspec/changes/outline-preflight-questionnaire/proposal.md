## Why

CodeCourse 的个性化引擎完整(学习者画像、偏好存储、动态 learner_context 注入都已就位),但存在两个断裂:

1. **桌面端个性化闭环断裂**:`LearnerProfileDialog` 只有知识边界/概念/证据/调用四个视图,没有任何偏好滑块。`answer-feedback` 反馈接口桌面端零调用。桌面用户无法告诉系统"讲深一点/少点术语",个性化只能靠后台被动观察。OpenSpec 既有规范 `learner-preferences`(规范 7)明确要求"所有偏好应在学习档案页手动可调",但桌面端未实现。
2. **总纲生成缺少学习意图收集**:用户点"生成总纲"后直接生成,系统不知道用户对项目前置知识的了解程度、想要什么课程风格、学到什么程度。生成的课程可能跳过用户已经会的、或者默认用户已经掌握前置知识。

本次变更做两件事:
- **特性 A(总纲前置问卷)**: 每次生成总纲前,由模型动态生成一份问卷(选择题为主,不写死、不设上限、允许超出现有题型),含前置知识了解程度、课程风格、学习深度等问题。答案注入当次总纲;只有"前置知识掌握程度"类答案持久化写入 learner_preferences 档案。
- **特性 B(桌面偏好闭环)**: 在 `LearnerProfileDialog` 新增"讲解偏好"视图(五维滑块 + 重置),并在 QA 回答接通"这次讲解是否有效"反馈条,使桌面端个性化闭环真正生效。

## What Changes

### 特性 A: 总纲前置问卷

新增"生成总纲前问卷"流水线:

- 前端点"生成总纲" → 确认后先调 `POST /outline/generate/preflight`(新端点)
- 后端用总纲上下文(scope + README 摘要 + 现有偏好)让模型动态生成问卷,返回 `{questions, preflight_id}`
- 前端渲染多题选择题,用户作答或跳过
- 提交 `POST /outline/generate/confirm`(答案),后端:
  1. 所有答案序列化为 `<learning_intent>` 块注入当次总纲提示词
  2. 仅"前置知识掌握程度"类答案经 `apply_preference_feedback` 写入档案
  3. 进入原有生成流程(建任务)

问题完全由模型生成(复用 Observer 的 `DynamicSurveyCandidate` 模式),不写死题库;只强制"选择题优先、含至少一道前置知识掌握程度题"。

### 特性 B: 桌面端个性化偏好闭环

- `LearnerProfileDialog` 新增"讲解偏好"视图:answerDepth / codeRatio / explanationOrder / prerequisiteDetail / terminologyDensity 五维滑块(或 select),保存即调 `updateLearnerPreferences`,加"重置为默认"。
- QA 回答下方"这次讲解是否有效"反馈条(讲懂了/部分明白/仍不懂)在桌面端接通 `submitAnswerFeedback`,按用户反馈慢速调整偏好(对齐 `learner-preferences` 规范 2 慢速自动更新)。

## Impact

### New Files
- `backend/app/services/outline_questionnaire.py` — 问卷生成/解析/校验/落库
- `frontend/src/components/OutlineQuestionnaireDialog.tsx` — 多题问卷渲染
- `backend/tests/test_outline_questionnaire.py` — 后端测试
- OpenSpec change 文档

### Modified Files
- `backend/app/models/schemas.py` — `OutlinePreflightRequest/Response`, `GenerateOutlineRequest` 加 `survey_answers`
- `backend/app/api/projects.py` — `POST /outline/generate/preflight`、`POST /outline/generate/confirm`,改造 `POST /outline/generate`
- `backend/app/services/generation_service.py` — `build_outline_input` 并入 survey_answers;两条生成路径加参数
- `backend/app/services/storage.py` — 新表 `outline_preflights` + CRUD
- `backend/app/services/prompt_store.py` — 新提示词 `prompt.outline.questionnaire`
- `frontend/src/api/client.ts` — `generateOutlinePreflight`/`confirmOutlineAnswers` 等 API 函数
- `frontend/src/App.tsx` — `handleGenerateOutline` 插入问卷流程
- `frontend/src/components/LearnerProfileDialog.tsx` — 讲解偏好视图
- `frontend/src/components/TeachingRationale.tsx` — 确认桌面端反馈条挂载

### Not Touched
- Android Java 原生代码(`android/`)
- `prompt.system` 与安全规则
- `## FILE:` 双文件协议解析
- Electron shell

## Capabilities

- **New**: `outline-preflight-questionnaire` — 总纲生成前的模型动态问卷
- **New**: `desktop-preference-controls` — 桌面端偏好手动控制 + 反馈闭环
- **Modified**: `outline-generation` — 总纲提示词并入学习意图
