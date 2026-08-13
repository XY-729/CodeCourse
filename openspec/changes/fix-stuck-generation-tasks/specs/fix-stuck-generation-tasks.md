# Spec: 修复生成任务卡死

## 场景

### 场景 1：LLM 流式输出中途停滞
用户在后台生成课件，LLM 输出到一半（如 7/9）停滞，连接保持打开但不返回数据。任务应在整体截止时间内超时，状态流转为 failed，UI 显示失败而非永久"生成中"。

### 场景 2：生成进程中断后残留
backend 崩溃/被杀/重启，遗留 running 任务。backend 下次启动时将这些任务标为 failed，UI 显示"生成失败"，用户可重新生成。

### 场景 3：任务长时间无进度
任务因未知原因停滞（网络黑洞、线程死锁），超过阈值无任何进度更新。watchdog 将其标为 failed。

## 功能需求

### FR-1 流式 LLM 调用整体截止

`stream_openai_compatible_chat`（backend/app/services/llm_client.py）：
- 请求开始前记录起始时间；
- 使用 `httpx.Timeout(timeout, total=timeout + 缓冲)`，`total` 为从请求开始到完成的硬上限；
- total 触发后抛出 `httpx.ReadTimeout`（或明确错误），进入既有重试（瞬态）或失败路径；
- 默认 total = read timeout + 30s 缓冲（如 read=180 → total=210）。

### FR-2 任务级 watchdog

- 新增后台周期任务（如每 60s 一次），扫描全部 `status='running'` 的 generation_tasks；
- 距 `updated_at` 超过 15 分钟 → 标 failed，error_message="生成超时，已自动取消，请重新生成"，stage_label="生成失败"；
- 不扫描 queued/completed/failed 任务。

### FR-3 启动清理

- `main.py` lifespan startup 阶段：将所有遗留 `status='running'` 任务标 failed，error_message="上次生成中断，请重新生成"，stage_label="生成失败"。

### FR-4 辅助

- 新增可复用的 `fail_stale_generation_tasks(timeout_minutes)` 函数（storage 或 generation_service）供 watchdog 与启动清理共用；
- watchdog 生命周期随 backend 主事件循环（lifespan 内启动/关闭）。

## 边界与约束

- 阈值：整体截止 210s（read 180 + 30s 缓冲）；watchdog 间隔 60s；running 超时 15 分钟。
- watchdog 标记仅针对 running 任务；绝不触碰 completed/failed。
- 失败信息为中文，与现有错误文案风格一致。
- 测试：llm_client 整体截止行为（mock 慢流）；watchdog 超时标记；启动清理（构造 running 任务 → lifespan 启动 → 断言 failed）。
