# Proposal: LLM 请求不再继承系统代理（修选区问答 self-signed 证书失败）

## Why

桌面端「选取提问」报错：

```text
LLM network error: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate (_ssl.c:1010)
```

排查结论（2026-09-18，实机 `C:\Users\xiyua\CodeCourse` + `AppData\Roaming\CodeCourse`）：

1. `POST /api/projects/{id}/qa/stream` 的失败路径把异常直接作为 SSE `error` 事件回给前端（`backend/app/api/qa.py` 的 `except Exception as exc: yield _sse("error", ...)`），**不写日志**，所以 `backend.log` 里查不到这条报错——不是日志缺失。
2. `llm_client.py` 的两个 httpx 客户端都用默认 `trust_env=True`，会通过 `urllib.request.getproxies()` 读取 **Windows 注册表系统代理**。实测该机系统代理为 `127.0.0.1:7890`（Clash for Windows，`clash-win64` 正在监听）。
3. 该 Clash 订阅 `list.yml` 的 `mode: global`，且全局策略组指向海外节点（`🇯🇵Japan 锦 あすみ`）。**全局模式下所有流量（含 `api.deepseek.com`）都绕道海外节点**。
4. 直连 `api.deepseek.com:443` 的证书链正常（TrustAsia DV TLS RSA CA 2025 签发）；一旦经由该代理路径，就会出现中间人自签证书 → Python 侧（certifi 根证书集）校验失败，而浏览器/Chromium（Windows 根证书集）不受影响。同一路径还表现为大量 `LLM network error: The read operation timed out` / `httpx.ConnectTimeout`（`backend.log` 与 `model_call_audit` 中均有）。
5. 因此这不是模型配置问题：同一时刻用同样的 base_url/API Key 走直连的 `POST /api/settings/llm/test` 返回 `{"ok": true, "message": "OK"}`。

**结论**：国内 API 流量被系统代理（海外节点）劫持是根因；应用不该默认把模型调用交给系统代理。

## What Changes

`backend/app/services/llm_client.py` 的同步/异步 httpx 客户端改为 `trust_env=False`（不走系统代理），并提供逃生舱：环境变量 `GPL_LLM_USE_SYSTEM_PROXY` 为真值时恢复旧行为（继承系统代理）。仅影响 LLM 调用；仓库克隆等其它出网路径不变。

## Capabilities

### Added Capabilities
- `llm-network-policy`:模型调用的出网策略（是否继承操作系统代理）
