from __future__ import annotations

import asyncio
import json
import logging
import os
import math
import re
from collections.abc import AsyncIterator
from dataclasses import dataclass
from time import perf_counter, sleep
from typing import Any, Callable
from urllib.parse import urlparse

import httpx


_TRUTHY = {"1", "true", "yes", "on"}
logger = logging.getLogger(__name__)


def use_system_proxy() -> bool:
    """模型请求是否继承操作系统代理。

    默认关闭：系统代理（Clash 全局模式、公司网关等）会把发往国内 API 的请求
    绕道海外节点，带来中间人自签证书（CERTIFICATE_VERIFY_FAILED）与连接超时。
    确实需要经代理访问模型服务的用户设 GPL_LLM_USE_SYSTEM_PROXY=true 恢复。
    """
    return os.getenv("GPL_LLM_USE_SYSTEM_PROXY", "").strip().lower() in _TRUTHY


def _limits() -> httpx.Limits:
    return httpx.Limits(max_connections=12, max_keepalive_connections=6)


def _new_sync_client() -> httpx.Client:
    return httpx.Client(limits=_limits(), follow_redirects=True, trust_env=use_system_proxy())


def _new_async_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(limits=_limits(), follow_redirects=True, trust_env=use_system_proxy())


_SYNC_CLIENT = _new_sync_client()
_ASYNC_CLIENT: httpx.AsyncClient | None = None

# 瞬态错误：服务过载/限流/网关故障，重试可能成功；4xx 等不可恢复错误不重试。
_TRANSIENT_STATUS = {408, 429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 3
_RETRY_BASE_SECONDS = 1.5

# 流式响应没有整体截止时间时，服务端只要缓慢吐数据就能让请求无限挂起
# （read 超时是每阶段超时，不限制总时长）。total = read + 缓冲 作为硬上限。
_TOTAL_TIMEOUT_BUFFER_SECONDS = 30


def _retry_backoff(attempt: int) -> None:
    # attempt 从 0 开始，第 0/1 次失败后等待 1.5s / 3s，第 2 次失败后不再等待。
    if attempt < _MAX_ATTEMPTS - 1:
        sleep(_RETRY_BASE_SECONDS * (2 ** attempt))


async def _retry_backoff_async(attempt: int) -> None:
    if attempt < _MAX_ATTEMPTS - 1:
        await asyncio.sleep(_RETRY_BASE_SECONDS * (2 ** attempt))


@dataclass(frozen=True)
class LLMCallResult:
    content: str
    usage: dict[str, int | None]
    model: str
    latency_ms: int


def parse_usage(raw: dict[str, Any] | None) -> dict[str, int | None]:
    """Preserve provider measurements; absence of cache data is unknown."""
    raw = raw or {}

    def number(*values):
        for value in values:
            if value is not None and not isinstance(value, bool):
                try:
                    return max(0, int(value))
                except (TypeError, ValueError):
                    continue
        return None

    details = raw.get("prompt_tokens_details") or raw.get("input_tokens_details") or {}
    input_tokens = number(raw.get("prompt_tokens"), raw.get("input_tokens"))
    output_tokens = number(raw.get("completion_tokens"), raw.get("output_tokens"))
    total = number(raw.get("total_tokens"))
    if total is None and input_tokens is not None and output_tokens is not None:
        total = input_tokens + output_tokens
    return {"input_tokens": input_tokens, "output_tokens": output_tokens,
            "total_tokens": total,
            "cached_input_tokens": number(details.get("cached_tokens"), raw.get("prompt_cache_hit_tokens"), raw.get("cache_read_input_tokens")),
            "cache_creation_input_tokens": number(raw.get("cache_creation_input_tokens")),
            "uncached_input_tokens": number(raw.get("prompt_cache_miss_tokens"))}


def check_request_budget(messages: list[dict[str, str]], max_tokens: int, *, adjust_output: bool = False,
                         base_url: str = "", model: str = "") -> dict[str, Any]:
    """Preflight estimate, not provider token usage or a tokenizer measurement.

    The default is an application request budget, not a claim about the model's
    context window. Operators can configure the provider's actual smaller limit.
    No message or tree node is ever shortened to make the check pass.
    Model callers may fit their maximum output to the remaining window;
    strict preflight consumers keep the requested reservation by default.
    """
    # Official DeepSeek V4 models have a 1M context window. Do not apply this
    # allowance to a proxy/another provider just because its model name matches.
    # https://api-docs.deepseek.com/quick_start/pricing/
    official_deepseek = (urlparse(base_url).hostname == "api.deepseek.com"
                         and model in {"deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "deepseek-v4-pro"})
    context_limit = int(os.getenv("GPL_LLM_CONTEXT_TOKENS", "1000000" if official_deepseek else "131072"))
    input_bound = sum(len(json.dumps(message, ensure_ascii=False).encode("utf-8")) + 16 for message in messages) + 16
    # Charging every UTF-8 byte as a token rejects ordinary full-tree requests.
    # Use a mixed-script estimate with headroom; keep the byte upper bound only
    # as a diagnostic. The provider remains the authority on exact token limits.
    pieces = re.compile(r"[A-Za-z_]+|[0-9]+|[ \t\r\n]+|[^\x00-\x7f]|.", re.S)
    estimate = 16
    for message in messages:
        estimate += 16
        for value in message.values():
            text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
            for match in pieces.finditer(text):
                part = match[0]
                if part.isascii() and (part[0].isalpha() or part[0] == "_" or part[0].isdigit()):
                    estimate += math.ceil(len(part) / 3)
                elif part.isspace():
                    estimate += math.ceil(len(part) / 4)
                else:
                    estimate += math.ceil(len(part.encode("utf-8")) / 2)
    estimated_input = math.ceil(estimate * 1.2)
    if max_tokens <= 0 or context_limit <= 0:
        raise ValueError("模型输入/输出预算必须为正整数")
    requested_output = max_tokens
    available_output = context_limit - estimated_input
    if adjust_output and available_output < max_tokens:
        minimum_output = min(requested_output, 4096)
        if available_output < minimum_output:
            raise ValueError(f'完整输入占用过多预算（输入估算 {estimated_input}，非精确 tokenizer 计数；总预算 {context_limit}，最低输出预留 {minimum_output}）；已停止生成，完整知识树与已完成内容保留。')
        max_tokens = available_output
        logger.info('llm_output_budget_adjusted input_estimate=%s requested_output=%s reserved_output=%s context_budget=%s',
                    estimated_input, requested_output, max_tokens, context_limit)
    report = {"input_token_upper_bound": input_bound, "estimated_input_tokens": estimated_input,
              "reserved_output_tokens": max_tokens, "requested_output_tokens": requested_output, "context_budget": context_limit,
              "method": "unicode_weighted_estimate", "tokenizer_exact": False, "safety_factor": 1.2}
    if estimated_input + max_tokens > context_limit:
        raise ValueError(f"完整请求超过输入预算（输入估算 {estimated_input}，非精确 tokenizer 计数；输出预留 {max_tokens}，总预算 {context_limit}）；已停止生成，知识树未被截断。可按模型实际容量调整预算后重试。")
    logger.debug("llm_request_budget", extra={"budget": report})
    return report


def _record_usage(usage: dict[str, int | None], model: str, latency_ms: int) -> None:
    logger.info('llm_usage model=%s latency_ms=%s input_tokens=%s output_tokens=%s cached_input_tokens=%s',
                model, latency_ms, usage['input_tokens'], usage['output_tokens'], usage['cached_input_tokens'],
                extra={"usage": usage, "model": model, "latency_ms": latency_ms})


def _require_complete_response(data: dict[str, Any]) -> None:
    choices = data.get('choices') or []
    reason = choices[0].get('finish_reason') if choices else None
    if reason not in {'length', 'content_filter'}:
        return
    usage = parse_usage(data.get('usage'))
    logger.warning('Incomplete model response: finish_reason=%s input_tokens=%s output_tokens=%s cached_input_tokens=%s',
                   reason, usage['input_tokens'], usage['output_tokens'], usage['cached_input_tokens'])
    explanation = '模型输出达到长度上限' if reason == 'length' else '模型服务端过滤了输出'
    raise RuntimeError(f'模型响应未完整结束：{explanation}（finish_reason={reason}）；知识清单未发布，旧文档已保留')


def _async_client() -> httpx.AsyncClient:
    global _ASYNC_CLIENT
    if _ASYNC_CLIENT is None or _ASYNC_CLIENT.is_closed:
        _ASYNC_CLIENT = _new_async_client()
    return _ASYNC_CLIENT


def mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def _message_content(data: dict[str, Any]) -> str:
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("LLM response has no choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise RuntimeError("LLM response has no message content")
    return str(content)


def call_openai_compatible_chat_result(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 30,
    *,
    max_attempts: int = _MAX_ATTEMPTS,
    max_tokens: int = 65536,
) -> LLMCallResult:
    budget = check_request_budget(messages, max_tokens, adjust_output=True, base_url=base_url, model=model)
    max_tokens = budget['reserved_output_tokens']
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "max_tokens": max_tokens,
    }
    last_error: BaseException | None = None
    attempts = max(1, min(_MAX_ATTEMPTS, max_attempts))
    for attempt in range(attempts):
        from app.services.qa_work_scheduler import wait_before_model_request
        wait_before_model_request()
        started = perf_counter()
        try:
            response = _SYNC_CLIENT.post(
                endpoint,
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=timeout,
            )
            response.raise_for_status()
            data = response.json()
            _require_complete_response(data)
            usage = parse_usage(data.get("usage"))
            latency_ms = int((perf_counter() - started) * 1000)
            _record_usage(usage, str(data.get("model") or model), latency_ms)
            return LLMCallResult(
                content=_message_content(data),
                usage=usage,
                model=str(data.get("model") or model),
                latency_ms=latency_ms,
            )
        except httpx.HTTPStatusError as exc:
            last_error = exc
            if exc.response.status_code not in _TRANSIENT_STATUS:
                raise RuntimeError(f"LLM HTTP {exc.response.status_code}: {exc.response.text[:500]}") from exc
        except httpx.HTTPError as exc:
            last_error = exc
        except (ValueError, TypeError) as exc:
            raise RuntimeError("LLM response is not valid JSON") from exc
        if attempt + 1 < attempts:
            _retry_backoff(attempt)
    if isinstance(last_error, httpx.HTTPStatusError):
        raise RuntimeError(f"LLM HTTP {last_error.response.status_code}: {last_error.response.text[:500]}") from last_error
    raise RuntimeError(f"LLM network error: {last_error}") from last_error


def call_openai_compatible_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 30,
) -> str:
    """Compatibility text API for existing generation and QA callers."""
    return call_openai_compatible_chat_result(
        base_url,
        api_key,
        model,
        messages,
        timeout,
    ).content


async def stream_openai_compatible_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 90,
    *,
    usage_callback: Callable[[LLMCallResult], None] | None = None,
) -> AsyncIterator[str]:
    budget = check_request_budget(messages, 65536, adjust_output=True, base_url=base_url, model=model)
    started = perf_counter()
    latest_usage = parse_usage(None)
    response_model = model
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": True,
        "max_tokens": budget['reserved_output_tokens'],
        "stream_options": {"include_usage": True},
    }
    client = _async_client()
    last_error: BaseException | None = None
    emitted = False
    # 流式响应没有整体截止时间时，服务端只要缓慢吐数据就能让请求无限挂起
    # （httpx 的 read timeout 是每阶段超时，不限制总时长）。用 asyncio.timeout
    # 作为硬上限，超出即抛 TimeoutError（不重试——停滞的重试无意义，交由
    # 上层任务失败路径处理）。
    deadline = timeout + _TOTAL_TIMEOUT_BUFFER_SECONDS
    try:
        async with asyncio.timeout(deadline):
            for attempt in range(_MAX_ATTEMPTS):
                try:
                    async with client.stream(
                        "POST",
                        endpoint,
                        json=payload,
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=httpx.Timeout(timeout),
                    ) as response:
                        if response.status_code >= 400:
                            detail = (await response.aread()).decode("utf-8", errors="replace")
                            error = RuntimeError(f"LLM HTTP {response.status_code}: {detail[:500]}")
                            if response.status_code in _TRANSIENT_STATUS:
                                last_error = error
                                await _retry_backoff_async(attempt)
                                continue
                            raise error

                        content_type = response.headers.get("content-type", "").lower()
                        if "text/event-stream" not in content_type:
                            body = await response.aread()
                            try:
                                data = json.loads(body.decode("utf-8"))
                                content = _message_content(data)
                                _require_complete_response(data)
                                latest_usage = parse_usage(data.get("usage"))
                                response_model = str(data.get("model") or model)
                            except (ValueError, TypeError, UnicodeDecodeError) as exc:
                                raise RuntimeError("LLM response is neither SSE nor valid JSON") from exc
                            if content:
                                yield content
                            result = LLMCallResult("", latest_usage, response_model, int((perf_counter() - started) * 1000))
                            _record_usage(result.usage, result.model, result.latency_ms)
                            if usage_callback:
                                usage_callback(result)
                            return

                        complete = False
                        async for line in response.aiter_lines():
                            if not line or not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                if data == "[DONE]":
                                    complete = True
                                    break
                                continue
                            try:
                                event = json.loads(data)
                            except ValueError:
                                continue
                            if event.get("usage") is not None:
                                latest_usage = parse_usage(event["usage"])
                            response_model = str(event.get("model") or response_model)
                            choices = event.get("choices") or []
                            if not choices:
                                continue
                            reason = choices[0].get("finish_reason")
                            if reason in {"length", "content_filter"}:
                                _require_complete_response(event)
                            if reason == "stop":
                                complete = True
                            delta = choices[0].get("delta") or {}
                            content = delta.get("content")
                            if content:
                                emitted = True
                                yield str(content)
                        if not complete:
                            raise RuntimeError("模型连接提前结束，已保留部分回答，请重试")
                        result = LLMCallResult("", latest_usage, response_model, int((perf_counter() - started) * 1000))
                        _record_usage(result.usage, result.model, result.latency_ms)
                        if usage_callback:
                            usage_callback(result)
                        return
                except httpx.HTTPError as exc:
                    if emitted:
                        raise RuntimeError("模型流式连接中断，已保留部分回答，请重试") from exc
                    last_error = exc
                    await _retry_backoff_async(attempt)
    except TimeoutError as exc:
        raise RuntimeError(f"LLM stream exceeded overall deadline of {deadline}s") from exc
    if isinstance(last_error, httpx.HTTPError):
        raise RuntimeError(f"LLM network error: {last_error}") from last_error
    raise last_error if isinstance(last_error, RuntimeError) else RuntimeError(f"LLM network error: {last_error}") from last_error
