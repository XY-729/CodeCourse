# LLM 请求不再继承系统代理 — 设计

## Context

`llm_client.py` 现状：模块导入时创建 `_SYNC_CLIENT`（`httpx.Client(limits=..., follow_redirects=True)`），首次流式调用时惰性创建 `_ASYNC_CLIENT`（同参数）。两者都用 httpx 默认的 `trust_env=True`，因此会读取 `HTTP_PROXY`/`HTTPS_PROXY`，以及 Windows 注册表里的系统代理（`urllib.request.getproxies()` 的注册表分支）。

实机（2026-09-18）验证：`urllib.request.getproxies()` 返回 `{'http': 'http://127.0.0.1:7890', 'https': 'http://127.0.0.1:7890', ...}`，即 Clash for Windows 的混合端口。该 Clash 处于 `mode: global`，全局出口是海外节点，于是 `api.deepseek.com` 也走海外。

这条路径上的两类失败都在日志里留了痕：

- `model_call_audit` / `backend.log`：`LLM network error: The read operation timed out`、`httpx.ConnectTimeout`（走海外节点延迟高）。
- 选区问答：`CERTIFICATE_VERIFY_FAILED ... self-signed certificate`，因为代理路径上存在 TLS 中间人，其根证书在 Windows 证书存储里（浏览器因此正常）但不在 Python 的 certifi 根证书集里。

直连同一域名的证书链正常，`POST /api/settings/llm/test` 直连返回 OK，说明模型配置与密钥本身没有问题。

## Goals / Non-Goals

**Goals:**
- 模型 API 调用默认直连，不再被系统代理绕道，消除自签证书失败与代理引入的超时
- 保留“确实需要代理”的场景：显式开关可控
- 改动面最小：只动 `llm_client.py`，不动调用方、超时、重试与 payload

**Non-Goals:**
- 不改 `get_llm_settings()` 的 base_url/model 解析，也不改任何库中已存的配置
- 不引入代理设置 UI（本变更只提供环境变量逃生舱；设置界面属于后续独立变更）
- 不动 git 克隆、code-intelligence 等其它出网路径（它们各自有独立需求）
- 不做“先直连失败再走代理”的双路径重试（会引入额外超时且行为不可预测）

## Decisions

### Decision 1: 默认 `trust_env=False`，而不是“失败后绕过代理重试”

默认直连是唯一与“国内 API + 国内用户”默认形态一致的策略；失败回退式重试要先付出一次代理超时，且在代理路径损坏时把延迟叠加到每次调用上。

**Why not 保持默认继承代理、仅在证书错误时重试直连**：用户实际看到的是“偶尔失败”，回退方案会让用户继续承担代理路径的延迟与不确定性，且 `_ASYNC_CLIENT` 是长连接客户端，重试语义复杂。

### Decision 2: 逃生舱用环境变量 `GPL_LLM_USE_SYSTEM_PROXY`，不加设置项

项目已有 `GPL_*` 环境变量约定（`GPL_WORKSPACE_ROOT`、`GPL_DB_PATH`、`GPL_LLM_PROVIDER`）。加环境变量零 UI 改动、零 schema 改动，也不会波及 Android（Android 的模型调用在 WebView 里走 JS，不经过这个客户端）。需要代理访问海外中转的用户可自行设置。

### Decision 3: 保留 `_SYNC_CLIENT` 模块级名字

`backend/tests/test_llm_client.py` 多处 `patch("app.services.llm_client._SYNC_CLIENT")`。通过工厂函数 `_new_sync_client()` 建客户端，但赋值给同一个模块级名字，测试无需改动。
