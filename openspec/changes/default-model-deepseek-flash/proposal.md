# Proposal: 默认生成模型改为 deepseek-flash（原 v4-pro）

## Why

用户要求把“默认模型”切回 DeepSeek 的 flash 档（用户口中为 “v4.1flash”）。

先纠正名称——以 2026-09-18 实测 DeepSeek 官方接口为准：

```text
GET  https://api.deepseek.com/models
→ {"data": [{"id": "deepseek-flash"}, {"id": "deepseek-v4-pro"}]}

POST /chat/completions  model=deepseek-v4.1flash
→ HTTP 400 {"message": "The supported API model names are deepseek-flash, deepseek-v4-pro, but you passed deepseek-v4.1flash."}
```

即 **不存在 `deepseek-v4.1flash` / `deepseek-v4.1-flash`**；当前 flash 档的规范 id 是 `deepseek-flash`（旧的 `deepseek-v4-flash` 仍可用但已不在模型列表里）。本变更按 `deepseek-flash` 落地。

切换前的安全性验证（这正是 2026-09-02 那次事故的现场）：取本机 `.debug/20260917_202306_L6-planner-prompt.txt`（14317 字符的真实总纲 planner prompt）单发实测：

| model | HTTP | finish_reason | content 长度 | reasoning 长度 |
| --- | --- | --- | --- | --- |
| `deepseek-flash` | 200 | stop | **8268** | 12299 |
| `deepseek-v4-pro` | 200 | stop | 5972 | 13863 |

`deepseek-flash` 已不再复现“HTTP 200 + finish_reason=stop + content 为空”的故障（该故障是 `default-model-v4-pro` 变更的起因）。因此回切默认值不再有当时的风险。

## What Changes

把后端与前端中所有“未配置模型时的默认/回退值”从 `deepseek-v4-pro` 改为 `deepseek-flash`（与 `default-model-v4-pro` 变更相同的 6 个文件、9 处字面量）。只影响**未显式选择模型**的路径；已存在库中的 `llm.model` 值不改写（用户当前工作区仍是显式 `deepseek-v4-pro`，需另行切换）。

## Capabilities

### Modified Capabilities
- `llm-model-default`:LLM 未显式配置时的默认/回退模型由 `deepseek-v4-pro` 改为 `deepseek-flash`
