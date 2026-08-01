# Tasks: 推理模型输出截断修复

## 1. 后端 max_tokens 提升

- [x] 1.1 `backend/app/services/llm_client.py` `call_openai_compatible_chat_result`: payload `max_tokens` 16384 → 65536
- [x] 1.2 `backend/app/services/llm_client.py` `stream_openai_compatible_chat`: payload `max_tokens` 16384 → 65536

## 2. 移除 reasoning fallback（后端 + Android）

- [x] 2.1 `_message_content`: 移除 content 为空回退 `reasoning_content`（保持 "LLM response has no message content" 报错）
- [x] 2.2 `frontend/src/platform/android/localProvider.ts` `callLLM`: body 加 `max_tokens: 65536`
- [x] 2.3 `callLLM`: 移除 content 为空回退 `reasoning_content`（保持 "模型返回了空内容" 报错）

## 3. 测试

- [x] 3.1 `backend/tests/test_llm_client.py`: 移除 3 个 fallback 用例，新增 payload `max_tokens=65536` 断言（同步 + 流式）
- [x] 3.2 `backend/tests/test_learning_plan.py`: outline 生成调用断言 timeout=180
- [x] 3.3 后端全量测试绿（218 个）
- [x] 3.4 前端 tsc 零错 + 376 测试绿

## 4. 真实验证

- [x] 4.1 走正式代码路径真实调用：content 21673 字符完整、FILE 段齐全、total 34654 token
- [ ] 4.2 桌面端（新 build）生成总纲成功，course_files 出现有效 project_map.md/outline.md
- [ ] 4.3 Android 端生成总纲成功

## 5. 提交推送

- [x] 5.1 提交推送（dc68034），确认 CI 绿
- [ ] 5.2 重新打包桌面端（kill → rm dist → clean pycache → pack → 拷贝 → 验证 shortcut/exe）
- [ ] 5.3 重新构建 APK 交付
