from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.models.schemas import (
    LearningSettingsRequest,
    LearningSettingsResponse,
    LLMSettingsRequest,
    LLMSettingsResponse,
    LLMTestResponse,
    PersonalizationRuntimeSettingsRequest,
    PersonalizationRuntimeSettingsResponse,
)
from app.services.llm_client import call_openai_compatible_chat, mask_api_key
from app.services.learning_preferences import read_learning_preferences, save_learning_preferences
from app.services.storage import get_llm_settings, get_setting, save_llm_settings, set_setting

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _response_from_settings(settings: dict[str, str]) -> LLMSettingsResponse:
    api_key = settings.get("api_key", "")
    return LLMSettingsResponse(
        provider=settings.get("provider", "deepseek"),
        base_url=settings.get("base_url", "https://api.deepseek.com"),
        model=settings.get("model", "deepseek-flash"),
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


@router.get("/learning", response_model=LearningSettingsResponse)
def read_learning_settings() -> LearningSettingsResponse:
    return LearningSettingsResponse(**read_learning_preferences())


@router.put("/learning", response_model=LearningSettingsResponse)
def write_learning_settings(payload: LearningSettingsRequest) -> LearningSettingsResponse:
    return LearningSettingsResponse(**save_learning_preferences(payload.primary_programming_language))


@router.get("/personalization", response_model=PersonalizationRuntimeSettingsResponse)
def read_personalization_runtime_settings() -> PersonalizationRuntimeSettingsResponse:
    """Legacy switches describe the always-on local teaching/evidence flow.

    The observer flag no longer schedules a second model observation.
    """
    return PersonalizationRuntimeSettingsResponse(
        supported=True, teacher_planner_enabled=True, observer_enabled=True,
    )


@router.put("/personalization", response_model=PersonalizationRuntimeSettingsResponse)
def write_personalization_runtime_settings(
    payload: PersonalizationRuntimeSettingsRequest,
) -> PersonalizationRuntimeSettingsResponse:
    # Older clients can submit false, but cannot turn off authoritative facts.
    for key in ("personalization.teacher_planner.enabled", "personalization.observer.enabled"):
        set_setting(key, "true")
    return read_personalization_runtime_settings()


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


@router.get("/prompts/metadata")
def read_prompt_metadata():
    from app.services.prompt_store import prompt_metadata

    return {"prompts": prompt_metadata()}


@router.get("/prompts/history")
def read_prompt_history(key: str = Query(...)):
    from app.services.prompt_store import prompt_history

    try:
        return {"key": key, "revisions": prompt_history(key)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/prompts/preview")
def preview_prompt_template(payload: dict[str, str]):
    from app.services.prompt_store import preview_prompt_bundle

    key = payload.get("key", "")
    value = payload.get("value", "")
    try:
        return {"key": key, **preview_prompt_bundle(key, value)}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc).splitlines()) from exc


@router.post("/prompts/reset")
def reset_prompt_template(payload: dict[str, str]):
    from app.services.prompt_store import reset_prompt

    key = payload.get("key", "")
    try:
        return {"key": key, "value": reset_prompt(key)}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/prompts")
def write_prompts(payload: dict[str, str]):
    from app.services.prompt_store import (
        EDITABLE_PROMPT_KEYS,
        save_prompt,
        validate_prompt,
    )

    errors: dict[str, list[str]] = {}
    for key, value in payload.items():
        if key in EDITABLE_PROMPT_KEYS:
            item_errors = validate_prompt(key, value)
            if item_errors:
                errors[key] = item_errors
    if errors:
        raise HTTPException(status_code=422, detail=errors)
    for key, value in payload.items():
        if key in EDITABLE_PROMPT_KEYS:
            save_prompt(key, value)
    return {"ok": True}
