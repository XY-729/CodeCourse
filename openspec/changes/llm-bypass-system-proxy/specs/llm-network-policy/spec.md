# LLM 出网策略（llm-network-policy）

## ADDED Requirements

### Requirement: 模型请求的代理策略

`llm_client` 建立的 httpx 客户端 SHALL 默认不使用操作系统代理（`trust_env=False`），避免国内模型 API 流量被系统代理绕道海外节点而触发中间人证书校验失败与连接超时。

#### Scenario: 未设置逃生舱环境变量
- **WHEN** 进程环境没有 `GPL_LLM_USE_SYSTEM_PROXY`（或为空）
- **THEN** `llm_client` 的同步与异步客户端均为 `trust_env=False`，请求直连 base_url

#### Scenario: 显式要求使用系统代理
- **WHEN** 环境变量 `GPL_LLM_USE_SYSTEM_PROXY` 为 `1` / `true` / `yes` / `on`（大小写与首尾空格不敏感）
- **THEN** 新建的同步与异步客户端为 `trust_env=True`，恢复继承系统代理的行为

#### Scenario: 代理策略不改变其余请求语义
- **WHEN** 任意 LLM 调用发生
- **THEN** 超时、重试次数、`max_tokens`、鉴权头与 payload 结构与改动前一致
