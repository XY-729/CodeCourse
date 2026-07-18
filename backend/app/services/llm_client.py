from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx


_SYNC_CLIENT = httpx.Client(
    limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
    follow_redirects=True,
)
_ASYNC_CLIENT: httpx.AsyncClient | None = None


def _async_client() -> httpx.AsyncClient:
    global _ASYNC_CLIENT
    if _ASYNC_CLIENT is None or _ASYNC_CLIENT.is_closed:
        _ASYNC_CLIENT = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=12, max_keepalive_connections=6),
            follow_redirects=True,
        )
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


def call_openai_compatible_chat(base_url: str, api_key: str, model: str, messages: list[dict[str, str]], timeout: int = 30) -> str:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {"model": model, "messages": messages, "stream": False}
    try:
        response = _SYNC_CLIENT.post(
            endpoint,
            json=payload,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
        response.raise_for_status()
        return _message_content(response.json())
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text
        raise RuntimeError(f"LLM HTTP {exc.response.status_code}: {detail[:500]}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"LLM network error: {exc}") from exc
    except (ValueError, TypeError) as exc:
        raise RuntimeError("LLM response is not valid JSON") from exc


async def stream_openai_compatible_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    timeout: int = 90,
) -> AsyncIterator[str]:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {"model": model, "messages": messages, "stream": True}
    client = _async_client()
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
                raise RuntimeError(f"LLM HTTP {response.status_code}: {detail[:500]}")

            content_type = response.headers.get("content-type", "").lower()
            if "text/event-stream" not in content_type:
                body = await response.aread()
                try:
                    content = _message_content(json.loads(body.decode("utf-8")))
                except (ValueError, TypeError, UnicodeDecodeError) as exc:
                    raise RuntimeError("LLM response is neither SSE nor valid JSON") from exc
                if content:
                    yield content
                return

            async for line in response.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    if data == "[DONE]":
                        break
                    continue
                try:
                    event = json.loads(data)
                except ValueError:
                    continue
                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield str(content)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"LLM network error: {exc}") from exc
