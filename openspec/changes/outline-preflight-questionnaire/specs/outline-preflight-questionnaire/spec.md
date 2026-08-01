# 总纲前置问卷(Outline Preflight Questionnaire)

## ADDED Requirements

### Requirement: 总纲生成前动态问卷

每次用户请求生成总纲(仓库总纲或学习计划总纲)时,系统 SHALL 先返回一份由模型动态生成的问卷,用户作答或跳过后再进入生成流程。

#### Scenario: 用户点生成总纲
- **WHEN** 用户在项目页面请求生成总纲
- **AND** 通过了生成确认框
- **THEN** 前端调用 `POST /outline/generate/preflight`
- **AND** 后端用总纲上下文(scope、README 摘要、现有 learner_preferences)让模型生成问卷
- **AND** 返回 `{ questions, preflight_id }`,其中 `questions` 为非空数组

#### Scenario: 问卷问题完全由模型生成
- **WHEN** 后端生成问卷
- **THEN** 问题文本、选项、题目语义分类全部由模型动态生成
- **AND** 不存在写死的题库
- **AND** 生成指令强制"选择题优先、至少一道前置知识掌握程度题"
- **AND** 允许模型生成超出选择题的题型(多选、量表、文本)

#### Scenario: 用户作答后提交
- **WHEN** 用户回答问卷并确认生成
- **THEN** 前端调用 `POST /outline/generate/confirm` 携带答案数组与 `preflight_id`
- **AND** 后端把全部答案序列化为 `<learning_intent>` 块并入当次总纲的 `user_instructions`
- **AND** 进入原有 `create_or_reuse_outline_task` 生成流程

#### Scenario: 用户跳过问卷
- **WHEN** 用户选择跳过问卷
- **THEN** 问卷不生成学习意图块
- **AND** 总纲按原有逻辑生成,不阻塞

#### Scenario: 问卷生成失败
- **WHEN** 模型未配置、API 超时或返回非法 JSON
- **THEN** 后端返回明确的错误信息
- **AND** 前端允许用户跳过问卷继续生成

### Requirement: 前置知识答案持久化

问卷答案中语义分类为"前置知识掌握程度"(dimension=prerequisite_level)的项,其选择 SHALL 经偏好反馈机制写入 learner_preferences 档案。

#### Scenario: 前置知识答案写入档案
- **WHEN** 用户回答前置知识掌握程度问题并选择"未了解/了解一点"
- **THEN** 该答案经 `apply_preference_feedback(dimension="prerequisite_detail", choice=..., source="survey")` 写入
- **AND** `prerequisite_detail` 偏好值向"需要更多前置补足"方向小幅调整(不超过 0.05 × 衰减)

#### Scenario: 非前置知识答案不落库
- **WHEN** 用户回答课程风格、学习深度等其他问题
- **THEN** 这些答案只进入当次总纲 `<learning_intent>` 块
- **AND** 不改变 learner_preferences 中任何维度

### Requirement: 问卷答案注入当次总纲

提交的答案 SHALL 影响本次总纲的内容结构。

#### Scenario: 未了解前置知识
- **WHEN** 用户在前置知识题选择"未了解过该领域前置知识"
- **THEN** 注入 `<learning_intent>` 中的前置知识说明使总纲出现前置课程/基础章节
- **AND** 总纲的适合人群、前置知识章节相应调整

#### Scenario: 高学习深度偏好
- **WHEN** 用户选择"想深入掌握,含原理与验证"
- **THEN** 总纲每课的学习产出与自测标准更强调机制理解和验证能力
