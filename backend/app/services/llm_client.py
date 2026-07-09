from __future__ import annotations

import json
from typing import Any
from urllib import error, request


def mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def call_openai_compatible_chat(base_url: str, api_key: str, model: str, messages: list[dict[str, str]], timeout: int = 30) -> str:
    endpoint = f"{base_url.rstrip('/')}/chat/completions"
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
    }
    body = json.dumps(payload).encode("utf-8")
    http_request = request.Request(
        endpoint,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(http_request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LLM HTTP {exc.code}: {detail[:500]}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"LLM network error: {exc.reason}") from exc

    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("LLM response has no choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if not content:
        raise RuntimeError("LLM response has no message content")
    return str(content)
