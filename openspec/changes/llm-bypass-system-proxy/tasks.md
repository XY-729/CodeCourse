# Tasks: LLM 请求不再继承系统代理

## 1. 实现

- [x] 1.1 `llm_client.py`：新增 `use_system_proxy()`（读 `GPL_LLM_USE_SYSTEM_PROXY`）
- [x] 1.2 `llm_client.py`：`_new_sync_client()` / `_new_async_client()` 工厂，`trust_env=use_system_proxy()`
- [x] 1.3 `llm_client.py`：`_SYNC_CLIENT` 与 `_ASYNC_CLIENT` 改由工厂创建（保留原模块级名字）

## 2. 测试

- [x] 2.1 默认环境：同步/异步客户端 `trust_env is False`
- [x] 2.2 `GPL_LLM_USE_SYSTEM_PROXY=true`（含 `1`/`yes`/`ON` 与带空格）：工厂产出 `trust_env is True`
- [x] 2.3 回归：`test_llm_client.py` 既有用例全绿（13/13）

## 3. 校验

- [x] 3.1 后端 unittest 全绿（330 用例，1 个失败为他人未提交的 lesson-preview 进度计数改动所致，与本变更无关）
- [x] 3.2 实机复核：直连 `api.deepseek.com` 的 TLS 校验通过，`POST /api/settings/llm/test` 返回 OK（1s 内）
- [x] 3.3 选区问答实机验证：对**已安装的 backend.exe**跑 `POST /api/projects/12/qa/stream`（临时工作区副本），返回 1337 个 `delta`、3050 字正文、无 `error` 事件
- [x] 3.4 旁证：`~/.config/clash/logs` 中 `api.deepseek.com` 连接记录停在本变更之前的 16:05，修复后的调用均未出现在 Clash 日志里

## 4. 交付

- [x] 4.1 重新打包桌面应用并更新本机安装内容（`dist-desktop/win-unpacked` → `C:\Users\xiyua\CodeCourse`，robocopy /MIR，172 文件）
- [x] 4.2 校验桌面 `CodeCourse.lnk` 指向新的安装可执行文件，且安装内容与打包产物 sha256 一致（app.asar / backend.exe / CodeCourse.exe 三项 MATCH）
