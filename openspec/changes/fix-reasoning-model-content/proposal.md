## Why

桌面端生成总纲时报 `LLM network error: The read operation timed out`（`llm_client.py` 的 `httpx.ReadTimeout`），并且运行中的桌面后端 `generation_tasks` 里出现了 `outline failed: LLM response has no message content`（#42）。

实测确认根因：当前配置的模型 `deepseek-v4-flash` 是**推理模型**（DeepSeek R1 系）。它的响应把可见回答放在 `reasoning_content` 字段里，`content` 常常为空串（`""`）或只有 1 个字符。而代码只读 `message.content`：

- 非流式 `_message_content` 看到空 `content` → 抛 `LLM response has no message content`（即 #42）。
- 推理模型生成长总纲耗时明显（实测一次完整总纲 24s+，长输入下会更久），而 outline 调用用的是 `timeout=90`，容易触发 `ReadTimeout` → `LLM network error: The read operation timed out`（用户本次报错）。

## What Changes

1. `backend/app/services/llm_client.py`：
   - `_message_content`：当 `message.content` 为空时，回退读取 `reasoning_content`（推理模型把最终回答放在这里）。
   - 流式路径**保持只读 `delta.content`**——实测推理模型流式下 content deltas 正常到达，回退 reasoning 会把思考痕迹泄漏给用户（QA 流式回答受影响）。
2. `backend/app/services/generation_service.py`：总纲生成调用 `call_openai_compatible_chat` 的 `timeout` 从 90 提到 180（`run_outline_generation_task`、`stream_outline_generation` 里的 `_stream_and_accumulate(timeout=120)` 提到 180）。`outline_questionnaire.py` 的问卷生成 `timeout=90` 同步提到 180（问卷也是长输出）。
3. Android 侧同步：`frontend/src/platform/android/localProvider.ts` 的 `callLLM` 同样只读 `message.content`、空时抛"模型返回了空内容"，需回退 `reasoning_content`（已查证确认同 bug）。

## Capabilities

### Modified Capabilities

- `LLM 客户端响应解析` — 支持推理模型把回答放在 `reasoning_content` 的情况，`content` 为空时回退读取。

## Impact

- `backend/app/services/llm_client.py` — `_message_content` + 流式 delta 读取逻辑
- `backend/app/services/generation_service.py` — outline 生成超时 90→180
- `backend/app/services/outline_questionnaire.py` — 问卷生成超时 90→180
- （待查证）`frontend/src/platform/android/localProvider.ts` — Android 若走同一问题则同步修
- 新增回归测试：空 content + reasoning_content 回退解析
