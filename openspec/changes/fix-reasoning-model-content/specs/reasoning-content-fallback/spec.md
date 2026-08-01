# 推理模型回答字段兼容（Reasoning Model Content Fallback）

## ADDED Requirements

### Requirement: 推理模型回答字段回退

当 LLM 非流式响应中 `message.content` 为空时,系统 SHALL 回退读取 `message.reasoning_content` 作为回答。适用场景:当前配置的 DeepSeek 推理模型(`deepseek-v4-flash`)把可见回答放在 `reasoning_content` 字段。

#### Scenario: 非流式响应的 content 为空
- **WHEN** 后端调用 `call_openai_compatible_chat` 收到非流式响应
- **AND** `message.content` 为空串或缺失
- **AND** `message.reasoning_content` 有内容
- **THEN** 返回 `reasoning_content` 作为回答,不再抛 "LLM response has no message content"

#### Scenario: 两者都为空
- **WHEN** `content` 与 `reasoning_content` 都为空
- **THEN** 保持原有行为(抛 "LLM response has no message content")

#### Scenario: 流式响应保持现状
- **WHEN** 后端 `stream_openai_compatible_chat` 收到 SSE delta
- **THEN** 只读取 `delta.content`,不读取 `delta.reasoning_content`
- **AND** 说明:实测流式下 content deltas 正常到达(29/次),流式路径不受空 content 影响;若读取 reasoning_content 会把思考痕迹泄漏给用户

### Requirement: Android 端同步兼容

Android 端 `AndroidLocalProvider.callLLM` 复用同一模型,同样需要支持推理模型。

#### Scenario: Android 端 content 为空
- **WHEN** Android 调用模型返回 JSON
- **AND** `message.content` 为空
- **AND** `message.reasoning_content` 有内容
- **THEN** 返回 `reasoning_content` 作为回答,不抛 "模型返回了空内容"

### Requirement: 长内容生成超时放宽

推理模型生成长内容耗时明显,长内容生成的同步调用超时需要放宽,避免误触 `ReadTimeout`。统一放宽到 180 秒。

#### Scenario: 总纲生成调用
- **WHEN** 后端 `run_outline_generation_task` 生成总纲
- **THEN** LLM 调用超时为 180 秒(原 90)

#### Scenario: 课件/文件课件生成调用
- **WHEN** 后端 `run_outline_lesson_task` / `run_file_lesson_task` 生成课件
- **THEN** LLM 调用超时为 180 秒(原 90)

#### Scenario: 流式总纲/课件生成调用
- **WHEN** 后端 `stream_outline_generation` / `stream_outline_lesson` / 文件课件流式生成调用 `_stream_and_accumulate`
- **THEN** 流式超时为 180 秒(原 120)

#### Scenario: 问卷生成调用
- **WHEN** 后端 `generate_questionnaire` 生成前置问卷
- **THEN** LLM 调用超时为 180 秒(原 90)

#### Scenario: QA 流式回答保持 90 秒
- **WHEN** 后端 `qa.py` 流式回答
- **THEN** 超时保持 90 秒(交互式短回答,无需放宽)
