## Why

桌面端仍无法生成总纲（用户实测：问卷 preflight 可以，总纲生成不行）。运行中桌面端 DB 里 task #43（outline，completed）的 `generated/11/outline.md` 与 `project_map.md` 是**纯模型推理痕迹**（"Let me pick: namespace, cgroup..."、"Now, let me carefully write the two files"），不是有效总纲——但仍被标记 completed，因为 `_parse_outline_files` 从推理文字里抠到了 `## FILE:` 标记。

用真实 prompt 模板 + 真实仓库输入完整复现（`backend/repro_outline_call.py`）确认根因：

```
max_tokens=16384 时:  finish_reason=length, completion_tokens=16382
  reasoning_tokens=15714 (96% 被思考吃掉)
  content len=1960 (截断在 TERMS 开头), reasoning len=43255 (完整思考)
max_tokens=65536 时:  finish_reason=stop, content len=17528, FILE 段齐全
```

**根因**：`deepseek-v4-flash` 的思考阶段消耗 `max_tokens` 预算（16384）的 96%，content 只分到 ~660 token，必然被截断（或为空）。上轮 eac8e62 加的"content 为空 → 回退 reasoning_content"把思考痕迹当答案写盘，用户以为成功（比 failed 更糟）。

## What Changes

1. `backend/app/services/llm_client.py`：
   - `call_openai_compatible_chat_result` / `stream_openai_compatible_chat` 的 payload `max_tokens: 16384` → `65536`（DeepSeek 推理模型长内容需要，实测 64k 上限可用、16k 必然截断）。
2. `frontend/src/platform/android/localProvider.ts`：
   - `callLLM` 的 body 增加 `max_tokens: 65536`（目前完全没传，后端默认 16384，同截断风险）。
3. `backend/app/services/llm_client.py` `_message_content`：**移除** content 为空时回退 `reasoning_content` 的逻辑，保持原报错 "LLM response has no message content"（推理痕迹顶替真实内容写盘比失败更糟）。
4. `frontend/src/platform/android/localProvider.ts` `callLLM`：同步移除 content 为空回退 reasoning_content 的逻辑，保持原 "模型返回了空内容" 报错。

## Capabilities

### Modified Capabilities

- `LLM 客户端响应解析` — 推理模型不再被 max_tokens 截断；content 为空时不再用思考痕迹顶替，直接报错可重试。

## Impact

- `backend/app/services/llm_client.py` — `max_tokens` 16384→65536（同步+流式）+ 移除 reasoning fallback
- `frontend/src/platform/android/localProvider.ts` — `callLLM` 加 `max_tokens: 65536` + 移除 reasoning fallback
- `backend/tests/test_llm_client.py` — 移除 fallback 用例，新增 max_tokens payload 断言
- `backend/tests/test_learning_plan.py` — 新增 outline 调用 payload max_tokens=65536 断言
- 新增回归测试：真实复现脚本保留为 `backend/repro_outline_call.py`（不入库，仅诊断用）
