# 推理模型输出截断修复（Reasoning Model Max-Tokens）

## ADDED Requirements

### Requirement: LLM 调用 max_tokens 提升

推理模型（`deepseek-v4-flash`）的思考阶段消耗大部分 `max_tokens` 预算，16384 下长内容必然截断（实测 96% 被思考吃掉，content 截断在 TERMS 开头）。后端与 Android 的 LLM 调用 SHALL 使用 65536。

#### Scenario: 后端同步调用
- **WHEN** 后端 `call_openai_compatible_chat_result` 发起非流式请求
- **THEN** payload `max_tokens` 为 65536（原 16384）

#### Scenario: 后端流式调用
- **WHEN** 后端 `stream_openai_compatible_chat` 发起流式请求
- **THEN** payload `max_tokens` 为 65536（原 16384）

#### Scenario: Android 调用
- **WHEN** Android `callLLM` 发起请求
- **THEN** payload 包含 `max_tokens: 65536`（原先未传，服务端默认 16384）

### Requirement: 移除 reasoning_content 顶替

content 为空时回退 `reasoning_content` 会把思考痕迹当答案写盘并误标任务 completed（task #43 事故）。推理模型的最终回答在 `content`；为空即截断或异常，SHALL 保持原报错。

#### Scenario: 后端 content 为空
- **WHEN** 后端收到响应且 `message.content` 为空
- **THEN** 抛 "LLM response has no message content"（不再回退 `reasoning_content`）

#### Scenario: 后端 content 正常
- **WHEN** `message.content` 非空
- **THEN** 返回 `content`（`reasoning_content` 存在也不使用）

#### Scenario: Android content 为空
- **WHEN** Android 收到响应且 `message.content` 为空
- **THEN** 抛 "模型返回了空内容"（不再回退 `reasoning_content`）

#### Scenario: 流式响应不受影响
- **WHEN** 后端流式 SSE delta 到达
- **THEN** 只读 `delta.content`（现状不变）
