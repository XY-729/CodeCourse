# Tasks: 推理模型回答字段兼容

## 1. 后端 LLM 客户端回退

- [x] 1.1 `backend/app/services/llm_client.py` `_message_content`: content 为空时回退读 `reasoning_content`
- [x] 1.2 流式路径保持只读 content(实测流式 content 正常,不回退 reasoning 以免泄漏思考痕迹)

## 2. 超时放宽

- [x] 2.1 `generation_service.py`: outline 调用 `timeout=90` → `180`
- [x] 2.2 `generation_service.py`: 流式 `_stream_and_accumulate(timeout=120)` → `180`(3 处)
- [x] 2.3 `generation_service.py`: 课件/文件课件生成 `timeout=90/120` → `180`
- [x] 2.4 `outline_questionnaire.py`: 问卷生成 `timeout=90` → `180`

## 3. Android 端兼容

- [x] 3.1 `frontend/src/platform/android/localProvider.ts` `callLLM`: content 为空时回退 `reasoning_content`

## 4. 测试

- [x] 4.1 新增 `test_llm_client.py`:非流式空 content + reasoning_content → 返回 reasoning_content
- [x] 4.2 两字段都空 → 保持原报错
- [x] 4.3 回归: 后端 217 测试全绿
- [x] 4.4 前端: tsc 零错 + 371 测试全绿

## 5. 验证与推送

- [x] 5.1 用真实模型手动验证: `call_openai_compatible_chat` 返回完整总纲,不再报空 content
- [ ] 5.2 提交推送,确认 CI 绿
