# 推理模型输出截断修复 — 设计

## Context

桌面端总纲生成持续失败。运行中桌面端 DB task #43（outline，completed）输出 `generated/11/outline.md`/`project_map.md` 是**纯推理痕迹**，仍被 completed（`_parse_outline_files` 从推理文字抠到 FILE 标记）。真实复现（`backend/repro_outline_call.py`，真实 prompt 模板 + mikuOJ 仓库输入）确认根因：

- `max_tokens=16384`：`completion_tokens=16382`（截断），其中 `reasoning_tokens=15714`（96% 被思考吃掉），content 仅 1960 字符且截断在 TERMS 开头。
- `max_tokens=65536`：`finish_reason=stop`，content 17528 字符，FILE 段齐全。

上轮修复（eac8e62，`fix-reasoning-model-content`）的错误假设：**"content 为空 → 回退 reasoning_content"**。真实响应中 content 被截断为空时，fallback 把思考痕迹当答案写盘 + 误标 completed——比直接报错更糟（用户以为成功）。

## Goals / Non-Goals

**Goals:**
- 后端同步/流式 payload `max_tokens` 16384 → 65536
- Android `callLLM` 增加 `max_tokens: 65536`
- 移除后端 + Android 的 reasoning_content 顶替逻辑（还原原报错）
- 回归测试覆盖 payload 与移除后的行为

**Non-Goals:**
- 不改 prompt 模板、模型选择、超时（180s 已够，实测 22k completion 在 180s 内）
- 不做截断后重试/续写（直接失败可重试更简单可靠）
- 流式路径行为不变（只读 delta.content）

## Decisions

### Decision 1: max_tokens 统一提到 65536

实测 16384 必然截断（思考 96% + content 4%），65536 完整（思考 14361 + content 22198 = 36559，留有余量）。API 实测 65536 上限可用（400/200 正常返回）。

**Why not 保守 32768**：真实总纲 content 已有 17.5k 字符 ≈ 22k token，加上思考 14k ≈ 36k，32768 仍可能截断。65536 一步到位。

### Decision 2: 移除 reasoning_content 顶替，还原原报错

eac8e62 的 fallback 是错误方向：content 为空 ≠ 回答在 reasoning_content——真实场景中 reasoning_content 是纯思考痕迹（"Let me pick: namespace, cgroup..."），且内容与 content 重叠/不同质。顶替会把思考痕迹写进课程文件并误标 completed。

移除后 content 为空 → "LLM response has no message content" / "模型返回了空内容"，任务 failed，用户可重试（此时 max_tokens 已提升，不会复现截断）。

**Why not 保留 fallback**：task #43 事故的直接原因，且真实模型 content 始终有效（16k 截断后仍非空）。保留 fallback 只会在其他失败模式下把垃圾写盘。

### Decision 3: Android 同步修

`callLLM` 完全没传 `max_tokens`（服务端默认 16384 = 截断风险），且同样有 reasoning fallback。同步加 `max_tokens: 65536` + 移除 fallback。Android `readTimeout: 300_000` 已足够。

## Risks

- 其他 DeepSeek 模型若 `max_tokens` 上限 < 65536 会 400——当前仅支持 deepseek-v4-flash（实测 64k OK）；报错信息会显示 HTTP 400 详情，用户可自行调小或换模型。
- 移除 fallback 后遇到 content 为空的真 case（非截断）会直接 failed——可接受，失败可重试优于假成功。

## Files

- `backend/app/services/llm_client.py` — `max_tokens` 16384→65536（同步 + 流式）+ `_message_content` 移除 reasoning fallback
- `frontend/src/platform/android/localProvider.ts` — `callLLM` body 加 `max_tokens: 65536` + 移除 reasoning fallback
- `backend/tests/test_llm_client.py` — 移除 fallback 用例，新增 max_tokens payload 断言
- `backend/tests/test_learning_plan.py` — outline 调用 payload 断言 max_tokens=65536
