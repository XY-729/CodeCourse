# 总纲前置问卷 + 桌面偏好闭环 — 设计

## Context

CodeCourse 个性化引擎完整,但桌面端入口断裂(无偏好滑块、answer-feedback 零调用),且总纲生成缺少学习意图收集。本次新增"总纲前置问卷"(模型动态生成)并补齐桌面偏好闭环。双端共享 React 前端,Android 通过 `AndroidLocalProvider` 复用同一代码。

## Goals / Non-Goals

**Goals:**
- 每次生成总纲先由模型动态生成问卷,用户作答后答案注入当次总纲
- 仅"前置知识掌握程度"答案持久化写入 learner_preferences
- 桌面端五维偏好滑块 + 答案反馈闭环真正生效

**Non-Goals:**
- 不动 Android Java 原生代码
- 不改 `prompt.system` 安全规则
- 不改 `## FILE:` 双文件协议解析
- 不改总纲流式路径为前端主路径(仍走后端任务轮询)

## Decisions

### Decision 1: 复用动态问卷机制,不写死题库

问卷问题由模型动态生成,复用 Observer 的 `DynamicSurveyCandidate` pydantic 结构(`observation_schema.py:141`),但**放宽约束**:新增语义分类 dimension 值(prerequisite_level / course_style / learning_depth / free),选项不限于单选。生成用 `compose_system_prompt(prompt.system, "json")` 强制 JSON(复用 `TASK_OUTPUT_CONTRACTS["json"]`)。

**Why not 写死题库**: 用户明确要求"问题由模型返回,而不是写死";Observer 已验证"问题由模型生成"可行。

### Decision 2: 独立于 Observer 后台的同步问卷生成

新端点 `POST /outline/generate/preflight` **同步**调用模型生成问卷(非后台任务),返回 `{questions, preflight_id}`。前端拿到后渲染、用户作答、再 `POST /outline/generate/confirm` 提交。

**Why not 复用 Observer**: Observer 是 QA 回答后异步触发、由 `_survey_due` 限流(需 ≥5 次回答、24h 冷却)。总纲前置问卷需要"每次生成都问",语义不同。

### Decision 3: 前置知识答案经既有偏好反馈写入

`apply_preference_feedback(project_id, dimension="prerequisite_detail", choice=..., source="survey")`(`personalization_service.py:145`)已支持前置知识维度与 survey 来源(权重 0.05)。问卷答案中 `dimension == "prerequisite_level"` 的选项直接复用此函数,不新增写入路径。

### Decision 4: 答案注入当次总纲(两条路径都改)

`GenerateOutlineRequest` 增加可选 `survey_answers: list[dict]`。`run_outline_generation_task` 与 `stream_outline_generation` 都接收,序列化为 `<learning_intent>` 块并入 `user_instructions`,再进 `build_outline_input` / prompt 模板。

### Decision 5: 新表 `outline_preflights`

存储一次预问卷(preflight_id、project_id、questions_json、status、answers_json、created_at)。`confirm` 时按 preflight_id 校验并落答案,生成任务关联。不用现成 `survey_candidates` 表(那是 Observer 的,含 dimension 限制和冷却语义)。

### Decision 6: 桌面偏好滑块并入现有 `LearnerProfileDialog`

不加新对话框,在现有五视图外新增"讲解偏好"视图,复用 `getLearnerPreferences`/`updateLearnerPreferences`(五字段全支持,`client.ts:1379`)。`TeachingRationale` 组件(`TeachingRationale.tsx:121` 反馈条)确认桌面端已挂载 QA 回答下,补 `submitAnswerFeedback` 调用闭环。

## Architecture

```
点"生成总纲"(App.tsx handleGenerateOutline)
  → confirmAction(确认框)
  → generateOutlinePreflight(projectId, scope)      # POST /outline/generate/preflight
      后端: outline_questionnaire.py 用模型生成问卷(JSON)
           → 校验 → 落 outline_preflights 表
      ← { questions, preflight_id }
  → OutlineQuestionnaireDialog 渲染选择题(复用 learner-survey-card 样式)+ 跳过
  → confirmOutlineAnswers(preflight_id, answers)    # POST /outline/generate/confirm
      后端: ① 校验 preflight
            ② 序列化 <learning_intent> 块
            ③ prerequisite_level 类答案 → apply_preference_feedback
            ④ create_or_reuse_outline_task(带 survey_answers)
      ← GenerationTask(进入原有轮询)

桌面偏好闭环:
LearnerProfileDialog "讲解偏好"视图 → updateLearnerPreferences → learner_preferences
QA 回答 → TeachingRationale 反馈条 → submitAnswerFeedback → apply_preference_feedback
```

## Risks / Trade-offs

- **每次生成多一次模型调用**: 问卷生成增加一次 LLM 调用与延迟。缓解:问卷问题较小、json-only 输出、失败可跳过继续生成。
- **模型生成不合法 JSON**: 缓解:复用 `TASK_OUTPUT_CONTRACTS["json"]`,解析失败返回明确错误并允许跳过。
- **outline_preflights 表孤儿数据**: 缓解:跳过后 status 置 skipped;定期清理已过期 pending。
- **偏好滑块与 LLMSettingsDialog 术语密度重复入口**: 缓解:两处都读同一 `learner_preferences`,保存后同步刷新。
