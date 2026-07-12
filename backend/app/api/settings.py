from __future__ import annotations

from fastapi import APIRouter

from app.models.schemas import LLMSettingsRequest, LLMSettingsResponse, LLMTestResponse
from app.services.llm_client import call_openai_compatible_chat, mask_api_key
from app.services.storage import get_llm_settings, save_llm_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _response_from_settings(settings: dict[str, str]) -> LLMSettingsResponse:
    api_key = settings.get("api_key", "")
    return LLMSettingsResponse(
        provider=settings.get("provider", "deepseek"),
        base_url=settings.get("base_url", "https://api.deepseek.com"),
        model=settings.get("model", "deepseek-v4-flash"),
        enabled=settings.get("enabled", "false") == "true",
        has_api_key=bool(api_key),
        masked_api_key=mask_api_key(api_key) if api_key else None,
    )


@router.get("/llm", response_model=LLMSettingsResponse)
def read_llm_settings() -> LLMSettingsResponse:
    return _response_from_settings(get_llm_settings())


@router.put("/llm", response_model=LLMSettingsResponse)
def write_llm_settings(payload: LLMSettingsRequest) -> LLMSettingsResponse:
    settings = save_llm_settings(
        payload.provider,
        payload.base_url,
        payload.model,
        payload.enabled,
        payload.api_key,
        payload.clear_api_key,
    )
    return _response_from_settings(settings)


@router.post("/llm/test", response_model=LLMTestResponse)
def test_llm_settings() -> LLMTestResponse:
    settings = get_llm_settings()
    if settings["enabled"] != "true":
        return LLMTestResponse(ok=False, provider=settings["provider"], message="LLM 配置尚未启用。")
    if not settings["api_key"]:
        return LLMTestResponse(ok=False, provider=settings["provider"], message="请先保存 API Key。")
    try:
        content = call_openai_compatible_chat(
            settings["base_url"],
            settings["api_key"],
            settings["model"],
            [
                {"role": "system", "content": "你是 API 连通性测试助手。"},
                {"role": "user", "content": "请只回复 OK。"},
            ],
            timeout=20,
        )
    except RuntimeError as exc:
        return LLMTestResponse(ok=False, provider=settings["provider"], message=str(exc))
    return LLMTestResponse(ok=True, provider=settings["provider"], message=content[:200])


@router.get("/prompts")
def read_prompts():
    from app.services.prompt_store import EDITABLE_PROMPT_KEYS, load_prompt
    result = {}
    for key in EDITABLE_PROMPT_KEYS:
        result[key] = load_prompt(key)
    return result


@router.put("/prompts")
def write_prompts(payload: dict[str, str]):
    from app.services.prompt_store import EDITABLE_PROMPT_KEYS, save_prompt
    for key, value in payload.items():
        if key not in EDITABLE_PROMPT_KEYS:
            continue
        save_prompt(key, value)
    return {"ok": True}
