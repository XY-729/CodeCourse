# LLM 默认模型为 v4-pro（llm-model-default）

## MODIFIED Requirements

### Requirement: 模型未配置时的默认/回退模型

当用户未显式配置 `llm.model`（新工作区、空设置、导入缺 model、请求体缺 model）时，系统 SHALL 默认/回退使用 `deepseek-v4-pro`，而不再使用 `deepseek-v4-flash`。

#### Scenario: 新工作区无任何 LLM 设置
- **WHEN** 后端 `get_llm_settings()` 读取且库中无 `llm.model`
- **THEN** 返回的 model 为 `deepseek-v4-pro`

#### Scenario: 环境变量未指定模型
- **WHEN** 无 `DEEPSEEK_MODEL`/`GPL_LLM_MODEL`，且命中环境 API key 分支
- **THEN** 回退 model 为 `deepseek-v4-pro`

#### Scenario: 保存空模型
- **WHEN** 用户在设置界面把 Model 留空并保存
- **THEN** 落库并返回的默认 model 为 `deepseek-v4-pro`

#### Scenario: 导入缺 model 的设置包
- **WHEN** 导入不含 `model` 字段的设置
- **THEN** 归一化后的 `llm.model` 为 `deepseek-v4-pro`

#### Scenario: 请求/响应体缺 model
- **WHEN** 设置响应组装或选区问答请求未带 model
- **THEN** 回退为 `deepseek-v4-pro`
