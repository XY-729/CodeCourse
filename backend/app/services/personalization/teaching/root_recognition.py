"""B-owned root recognition; A owns applying proposals and project API wiring."""
from __future__ import annotations

import json

from app.services.personalization.teaching.generation_context import build_generation_context, apply_generation_context


def recognize_learning_plan_roots(project_id: int, requirements: str = "") -> dict:
    from app.services.knowledge_tree_service import get_root_recognition_context, apply_root_proposal
    from app.services.storage import get_llm_settings
    from app.services.llm_client import call_openai_compatible_chat
    from app.services.prompt_contracts import compose_system_prompt
    from app.services.prompt_store import load_prompt
    project = get_root_recognition_context(project_id)
    if project["root_status"]["status"] == "ready":
        return project["root_status"]
    settings = get_llm_settings()
    if settings.get("enabled") != "true" or not settings.get("api_key"):
        raise ValueError("计划已保存，知识根待识别；配置模型后可重试")
    snapshot = {**project["tree"], "requirements": project["requirements"]}
    context = build_generation_context(project_id, requirements, snapshot=snapshot)
    prompt = """为已经保存的学习计划识别实际领域根。只返回 JSON 对象：
{"concepts":[{"ref":"root","existing_id":null,"name":"领域根","domain":"领域","scope":"global","parent_ref":null,"aliases":[]}],"root_refs":["root"]}。
复用完整树中的真实规范概念和 ID，不因计划名称不同新建同义根。包括归属所需祖先；
root_refs 仅引用实际根节点。材料不足时不要猜测，返回 {"concepts":[],"root_refs":[]}。
计划数据：""" + json.dumps({"name": project["name"], "requirements": requirements}, ensure_ascii=False)
    messages = apply_generation_context([
        {"role": "system", "content": compose_system_prompt(load_prompt("prompt.system"), "json")},
        {"role": "user", "content": prompt}], context)
    raw = call_openai_compatible_chat(settings["base_url"], settings["api_key"], settings["model"], messages, timeout=90)
    proposal = json.loads(raw)
    allowed = {node["id"] for node in context.snapshot["nodes"]}
    from .prompt_forest import expand_prompt_references
    proposal = expand_prompt_references(proposal, allowed)
    if any(concept.get("existing_id") is not None and concept["existing_id"] not in allowed for concept in proposal.get("concepts", [])):
        raise ValueError("根识别引用了上下文之外的概念")
    return apply_root_proposal(project_id, proposal, context.tree_snapshot)
