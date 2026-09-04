# Proposal: 默认生成模型改为 deepseek-v4-pro（原 flash）

## Why

`deepseek-v4-flash`（推理模型）在 2026-09-02 与 2026-09-04 两度对课件/总纲生成返回 **HTTP 200、finish_reason=stop、`message.content` 为空**，只产 `reasoning_content`，照扣 token 无产出。代码里所有“模型未配置时”的回退/默认字面量仍是 `deepseek-v4-flash`，导致：

- 显式把 `llm.model` 配成 `deepseek-v4-pro` 的工作区正常（原始工作区已切）；
- 新建/空白工作区未显式设 model 时，后端回落到 flash → 课件生成必失败（09-04 空白 CodeCourse 实例复现：outline_lesson 任务 3/3 失败，`error=LLM response has no message content`，`model=deepseek-v4-flash`；同 key 的 v4-pro 同请求正常）。

用户决策：不做“空 content 回退 reasoning_content”的代码兜底（会泄漏思考痕迹，且 v4-pro 无此问题），而是**把默认/回退模型整体切到 v4-pro**，从源头避免任何新工作区撞上 flash 故障。

## What Changes

把后端与前端中所有“未配置模型时的默认/回退值”从 `deepseek-v4-flash` 改为 `deepseek-v4-pro`。只影响**未显式选择模型**的路径；用户已显式配置的 flash 不受影响。

涉及 6 个文件共 9 处字面量：
- `backend/app/services/storage.py` — `get_llm_settings()` 环境回退、库回退；`save_llm_settings()` 空值默认
- `backend/app/api/settings.py` — 设置响应默认
- `backend/app/models/schemas.py` — LLMSettingsRequest 与 QA 请求的默认值
- `backend/app/services/data_transfer.py` — 设置导入/导出默认 2 处
- `backend/app/services/qa_service.py` — 选区问答 model 回退
- `frontend/src/components/LLMSettingsDialog.tsx` — Model 输入框占位提示

## Capabilities

### Modified Capabilities
- `llm-model-default`:LLM 未显式配置时的默认/回退模型由 `deepseek-v4-flash` 改为 `deepseek-v4-pro`
