# Proposal: 修复生成任务卡死

## 背景

2026-08-13 两次实际故障：任务 59（outline_lesson，卡在 8/11）与任务 63（outline_lesson，卡在 7/9），均以 status=running 卡死超过 50 分钟，UI 永远显示"生成中"，只能靠手动 kill + SQL 复位为 failed 恢复。

## 问题分析

两次卡死的共同模式：LLM 请求**已建立连接并开始返回内容，但输出中途停滞**，TCP 连接保持打开不关闭（故障时观察到一条挂起的 443 外部连接）。链路无任何兜底：

1. **httpx 超时不是整体截止**：`httpx.Timeout(180)` 是每阶段超时（connect/read/write 各 180s）。服务端只要每 3 分钟挤出一个字节（或连接空挂），read 超时永不触发，`stream_openai_compatible_chat` 无限挂起，`_stream_and_accumulate` 的 `async for` 永远拿不到下一块。
2. **异常不会发生 → 任务不流转**：`run_outline_lesson_task` 的 `except Exception → 标 failed` 逻辑存在，但请求未抛错，代码永远执行不到；任务卡在 running。
3. **无 stale 清理**：任务 running 后没有任何机制检测"久无进度更新"并复位；backend 重启后遗留 running 任务也不清理（下一次查询永远显示"生成中"）。

注意：后台生成本身是可行的（backend 由托盘保活，窗口关闭不杀进程），问题只在半途挂起没有兜底。

## 方案

三层兜底，覆盖"请求挂起"、"任务停滞"、"启动残留"：

1. **LLM 客户端整体截止**：`stream_openai_compatible_chat` 加 `total` 整体截止时间（请求开始到结束的硬上限，默认 180s+缓冲），到点强制断开，向调用方抛错 → 进入既有 `except Exception` 路径 → 任务标 failed。
2. **任务级 watchdog**：后台启动一个周期任务，扫描 running 任务：距 `updated_at` 超过阈值（生成类任务 15 分钟）且无进度 → 标 failed（error_message="生成超时，已自动取消，请重新生成"）。
3. **启动清理**：backend 启动（lifespan startup）时把遗留的 running 任务标 failed（error_message="上次生成中断，请重新生成"），避免重启后残留"生成中"。

## 非目标

- 不新增任务重试/断点续传（本次只保证状态正确流转到 failed，用户可重新生成）。
- 不改变 `call_openai_compatible_chat`（非流式）的超时语义——非流式单次调用本身有 read timeout，且被 3 次重试包裹；本次仅修复流式路径（两次故障均为流式 outline_lesson）。
- 不动 Android（桌面 backend 同一进程，修复自动覆盖两端）。
