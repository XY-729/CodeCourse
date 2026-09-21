# 默认生成模型改为 deepseek-flash — 设计

## Context

模型默认值以裸字符串字面量散落在后端多处“未配置回退”、schema 默认与前端占位提示中。2026-09-04 的 `default-model-v4-pro` 变更把这些字面量从 `deepseek-v4-flash` 统一改成了 `deepseek-v4-pro`，起因是 flash 档对长生成返回空 `content`。

2026-09-18 复测：用真实 planner prompt 单发，`deepseek-flash` 返回 8268 字符正文，故障不复现；同时 DeepSeek 的模型列表已把 flash 档规范化成 `deepseek-flash`（`deepseek-v4-flash` 仅作兼容别名，`deepseek-v4.1flash` 之类名称不存在）。

## Goals / Non-Goals

**Goals:**
- 所有“未显式配置 model”路径的默认/回退值改为 `deepseek-flash`
- 覆盖新工作区、空设置、导入缺 model、请求体缺 model、UI 占位
- 与上一次变更保持同构：同样的文件、同样的位置，只改字面量

**Non-Goals:**
- 不改已显式配置 model 的现有库值
- 不引入模型白名单/校验（本项目 model 是自由文本）
- 不改 Android 端 `localProvider.ts` 的 `DEFAULT_MODEL`（其值为 `deepseek-chat`，属于既有独立问题，且该默认值不在本变更语义内）
- 不改 `llm_client`、超时、max_tokens、提示词

## Decisions

### Decision 1: 用规范 id `deepseek-flash`，不用兼容别名 `deepseek-v4-flash`

以官方模型列表为准。别名可能在后续版本被移除，规范 id 更稳。

### Decision 2: 只替换“未配置回退/默认”字面量，不动显式配置

语义 = 改**默认值**。`settings.get("model", DEFAULT)`、`Field(default=DEFAULT)`、`parsed.get(...) or DEFAULT`、`model.strip() or DEFAULT` 这类位置把 DEFAULT 换成 `deepseek-flash`；对显式提供的 model 值不做改写。

### Decision 3: 前端只改占位提示

Model 输入框 `value` 来自后端 `get_llm_settings()`，`placeholder` 同步改成 `deepseek-flash`，保持“后端默认”与“UI 提示”一致。（UI 冻结约束针对的是主题/布局/美化，占位文案不在其列。）
