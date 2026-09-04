## Tasks

- [x] 1.1 `frontend/src/App.tsx`:新增 `qaFollowUpRecord` state;`activeQASessionId` = 追问记录 ?? (移动端 null / 桌面端 `qaSessionId` 护栏);`useQAAskController` 传 `activeQASessionId`/`parentQAId`;`onAnswerComplete` 清除追问记录回独立会话
- [x] 1.2 `frontend/src/App.tsx`:新增 `handleFollowUp`(跨项目守卫 + 选中/会话/追问态绑定);历史续学入口 `handleResumeContinuity`/`handleTeachingNextAction` follow_up 绑定追问记录;记录改名/回答更新/删除同步点维护 `qaFollowUpRecord`
- [x] 1.3 `frontend/src/components/MobileAssistantPanel.tsx`:新增 `followUpRecord`/`onFollowUp` props;操作栏"追问"按钮;"正在追问"chip + 取消;placeholder 统一为"请输入问题"
- [x] 2.1 `backend/app/services/continuity_service.py` + `frontend/src/personalization/continuity.ts`:`_stable_topic_choice` 改写为稳定上位分类(并发与内存模型 / C++ 新特性 / Linux 沙箱 / 进程与执行 等)
- [x] 2.2 `render_project_learning_context` / `renderProjectLearningContext(handoff, existingTopics)`:注入 `<existing_qa_topics>` JSON 列表;`prompt_contracts.py`/`promptContracts.ts` 补充 HANDOFF topic 约束
- [x] 2.3 `frontend/src/platform/android/localProvider.ts`:提问前拉取该项目 `existing_qa_topics` 传入
- [x] 2.4 `frontend/src/components/TeachingContinuityCards.tsx`:`compactTopicLabel(topic, records)` 简化旧历史主题并按稳定分类合并展示
- [x] 3.1 测试:后端 `tests/test_teaching_continuity.py`;前端 continuity/promptContracts/MobileAssistantPanel/mobileControlLayout/useQAAskController/TeachingContinuityCards 用例
- [x] 3.2 验证:前端 vitest 35 项通过;后端 unittest 全量 307 项通过;推送树类型检查干净(tsc 仅剩本地 persona 暂态差异)
- [x] 4.1 OpenSpec change 文档补齐并随功能提交推送;桌面 ExplainPanel 追问 UI 保留在本地 persona 工作树(明确排除)
