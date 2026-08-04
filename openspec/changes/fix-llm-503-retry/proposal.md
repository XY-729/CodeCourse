# Proposal: fix-llm-503-retry

## Problem

DeepSeek 官方偶发 503（`service_unavailable_error`："Service is too busy. We advise users to temporarily switch to alternative LLM API service providers."），导致课件/总纲生成直接失败。这是**瞬态服务过载**，不是配置或代码错误——但当前两端对瞬态错误的容忍度很低：

- **桌面/后端**：`llm_client.py`（`call_openai_compatible_chat_result` / `stream_openai_compatible_chat`）完全没有重试。任何 5xx、429、408、网络超时都直接 `RuntimeError`，任务立刻失败，15 个调用点（课件、总纲、QA、术语等）全部受影响。
- **安卓**：`localProvider.ts` `callLLM`（963 行）虽有 3 次尝试，但（a）退避仅 1s/2s，对 503 过载太短（服务过载通常持续数十秒）；（b）不区分错误类型——401/403/400 等不可恢复错误也白重试 3 次，白白等待 3 秒。

## Why it matters

- 用户当前被 503 卡住无法生成课件；重试能显著提升 DeepSeek 高峰期的生成成功率。
- 后端无重试是缺口：任务级 `retryTask` 需用户手动操作，体验差。

## Scope

- 仅 LLM 调用层（`backend/app/services/llm_client.py` + `frontend/src/platform/android/localProvider.ts`）。
- 不改任务调度/队列；重试在调用层完成（同步与流式统一受益）。
- 不改模型选择逻辑（"切换供应商"是用户侧决策，非代码可替）。

## Approach

### 后端 `llm_client.py`

新增 `_TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}` 与 `_max_attempts = 3`。对同步调用（`call_openai_compatible_chat_result`）与流式调用（`stream_openai_compatible_chat`）统一包装：

- 对 `httpx.HTTPStatusError`：状态码在瞬态集合 → 重试；否则直接抛（4xx 不重试）。
- 对 `httpx.HTTPError`（网络错误）→ 重试。
- 指数退避 `base=1.5s, factor=2`（1.5s / 3s），仅两次重试间 sleep；第三次失败抛原始错误。
- 流式注意：`stream()` 的 `with` 内状态码 >=400 时抛 `RuntimeError`（非 HTTPStatusError），需在重试包装中按 `RuntimeError` 消息前缀 `LLM HTTP <status>` 判断瞬态。实现时把流式也改为 `raise_for_status` 风格或解析消息。

### 安卓 `localProvider.ts` `callLLM`

- 解析 `response.status`：`401/403/400/404` 等 <500 且不在 {408,429} → 直接抛（不重试）。
- 其余（429、5xx、网络异常）→ 指数退避 `base=3s, factor=2`（3s / 6s），最多 3 次尝试。
- 保留"空内容/未配置"不重试的现有逻辑。

## Success criteria

- 后端：503 → 自动重试成功（mock 2 次失败 + 1 次成功）；401 不重试；流式 503 同样重试。
- 安卓：503/网络错误 3 次尝试退避 3s/6s；401 立即抛错不重试。
- 全部现有测试无回归。
