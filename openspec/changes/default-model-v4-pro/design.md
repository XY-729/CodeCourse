# 默认生成模型改为 v4-pro — 设计

## Context

`deepseek-v4-flash` 是 DeepSeek 推理系模型，故障期对生成请求返回 HTTP 200、`finish_reason=stop`、`message.content` 为空（只产 reasoning_content），照扣 token 无产出。两次故障（2026-09-02 原始工作区、2026-09-04 空白工作区）均表现为“正在规划课件 → 任务失败 `LLM response has no message content`”。两次的差异只在 `llm.model`：原始工作区已显式切 v4-pro → 正常；空白工作区未设/回落到 flash → 失败。

代码现状：模型默认值以裸字符串字面量散落在后端多处“未配置回退”与 schema 默认、前端一处输入框占位，全部仍是 `deepseek-v4-flash`。

## Goals / Non-Goals

**Goals:**
- 所有“未显式配置 model”路径的默认/回退值改为 `deepseek-v4-pro`
- 覆盖新工作区、空设置、导入缺 model、请求体缺 model、UI 占位

**Non-Goals:**
- 不改已显式配置 flash 的现有库值（那是用户选择，不是默认）
- 不做 reasoning_content 回退兜底（泄漏思考痕迹；pro 无此问题）
- 不改 llm_client、max_tokens、超时、提示词
- 不改模型可选项/白名单（本项目模型为自由文本，无白名单）

## Decisions

### Decision 1: 仅替换“未配置回退/默认”字面量，不动显式配置

改动语义 = 改**默认值**。`settings.get("model", DEFAULT)`、`Field(default=DEFAULT)`、`parsed.get(...) or DEFAULT`、`model.strip() or DEFAULT` 这类位置，把 DEFAULT 从 flash 换成 pro。对显式提供的 model 值不做任何改写。

**Why not 引入单一常量**: 本次改动希望 diff 最小、回归面最窄；统一常量属于后续重构，非本变更目标。

### Decision 2: 前端只改占位提示，不改初始值来源

Model 输入框的 `value` 来自后端 `get_llm_settings()`（后端默认即改）。占位提示 `placeholder` 同步改成 v4-pro，保持“后端默认”与“UI 提示”一致。
