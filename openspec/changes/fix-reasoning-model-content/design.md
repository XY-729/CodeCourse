# 推理模型回答字段兼容 — 设计

## Context

桌面端生成总纲时报 `LLM network error: The read operation timed out`,且运行中的桌面后端 DB(`AppData\Roaming\CodeCourse\app.db`)出现 `outline failed: LLM response has no message content`(#42)。

实测确认根因:当前模型 `deepseek-v4-flash` 是**推理模型**,响应把可见回答放在 `reasoning_content` 字段,`content` 常常为空(`""`)或极短。代码只读 `message.content`:
- 非流式 `_message_content` 空 content → 抛 "LLM response has no message content"
- 流式只读 `delta.content` → 丢内容
- Android `callLLM` 只读 `message.content` → 抛 "模型返回了空内容"

另外推理模型慢:一次完整总纲 24s+,长输入下可能超过 `timeout=90`,触发 `ReadTimeout` → "read operation timed out"。

## Goals / Non-Goals

**Goals:**
- `content` 为空时回退读 `reasoning_content`(非流式 + 流式 + Android)
- 总纲/问卷生成超时放宽到 180s
- 覆盖两种症状:空 content 报错、读超时

**Non-Goals:**
- 不改变模型选择逻辑(用户配置什么模型就用什么)
- 不改变 `max_tokens`、提示词内容
- 不做流式推理内容与最终回答的拼接复杂逻辑——只做"content 为空时用 reasoning_content 顶替"的最简兼容

## Decisions

### Decision 1: 仅非流式回退 `reasoning_content`;流式保持只读 content

非流式(`_message_content`):当 `content` 为空时,`reasoning_content` 就是推理模型的最终可见回答,直接回退读取。不做拼接(推理模型的 `reasoning_content` 含思考过程,与 content 重叠/不同质,拼接引入噪音)。

流式(`stream_openai_compatible_chat`):**保持只读 `delta.content`**。实测确认:推理模型流式下 content deltas 正常到达(单次 29 个 content chunk / 51 个 reasoning chunk),流式路径不受空 content 影响。若在此处也回退 reasoning_content,会把思考痕迹(`reasoning_content`)作为可见回答泄漏给用户——QA 流式回答是桌面主功能,不可接受。

**Why not 流式也回退**: 实测流式 content 可靠;回退引入思考痕迹泄漏回归。

**Why not 按模型开关**: 后端无法可靠探测模型是否推理型,且对非推理模型 `reasoning_content` 通常不存在(回退不生效),做成无感回退最稳。

### Decision 2: 超时统一放宽到 180s

- `generation_service.py`: `run_outline_generation_task` 的 `timeout=90` → `180`;`stream_outline_generation` 的 `_stream_and_accumulate(timeout=120)` → `180`
- `outline_questionnaire.py`: `generate_questionnaire` 的 `timeout=90` → `180`

Android 端 `callLLM` 已是 `readTimeout: 300_000`(300s),无需改。

### Decision 3: 错误信息保持原样

两字段都空时,保持现有报错文本("LLM response has no message content" / "模型返回了空内容"),让用户可判断模型确实没产出。Android 端现有 `callLLM` 对"模型返回了空内容"不再重试的判定也保留。

## Risks

- 推理模型在 `reasoning_content` 中也可能带思考杂质——但本产品中"模型确实给出了可读回答"优于"直接报错",可接受。
- 放宽超时只影响总纲/问卷两个同步路径,不影响其他 LLM 调用(QA/term 等仍 30-90s)。

## Files

- `backend/app/services/llm_client.py` — `_message_content` + 流式 delta 读取
- `backend/app/services/generation_service.py` — outline 生成超时 90/120 → 180
- `backend/app/services/outline_questionnaire.py` — 问卷生成超时 90 → 180
- `frontend/src/platform/android/localProvider.ts` — `callLLM` content 回退
- `backend/tests/test_llm_client.py`(或既有 llm 测试) — 新增回退用例
