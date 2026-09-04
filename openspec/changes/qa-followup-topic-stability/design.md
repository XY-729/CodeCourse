# QA 手动追问与稳定主题归类

## Design

### 会话编排(移动端新语义,桌面端平台护栏保底)

`App.tsx` 新增 `qaFollowUpRecord` state(记录被追问的 QARecord),合成会话归属:

```
activeQASessionId = qaFollowUpRecord?.session_id
                 ?? (mobileRuntime ? null : qaSessionId)
```

- **Android(移动布局)**:无追问记录时 `activeQASessionId = null` → 每次提问都是独立新会话(`draft:` key);点击"追问"后进入 `session:` key,整条链续接。
- **桌面(base 语义)**:无追问记录时回退到旧 `qaSessionId` 自动续接逻辑 → 推送后桌面行为与 origin 一致,零回归。
- `useQAAskController` 的 `sessionId` / `parentQAId` 改为取 `activeQASessionId` 与 `qaFollowUpRecord?.id`(移动端)。
- `onAnswerComplete` 中清除 `qaFollowUpRecord` 并重置回独立会话。
- 新增 `handleFollowUp(record)`:跨项目守卫(提示"其他项目的回答只能查看,不能追问")→ 设选中记录/追问记录/会话 → 输入区进入追问状态。
- 历史续学入口(`handleResumeContinuity`、`handleTeachingNextAction` 的 `follow_up`)同样绑定追问记录。
- 记录改名/回答更新/删除的同步点全部维护 `qaFollowUpRecord`,避免悬空引用。

### 追问 UI(移动面板)

`MobileAssistantPanel.tsx` 新增 `followUpRecord` / `onFollowUp` props:

- 历史记录操作栏"追问"按钮 → `onFollowUp(record)`
- 输入区顶部显示"正在追问:<主题>"chip + 取消按钮(取消 → 清除记录回独立会话)
- placeholder 统一为"请输入问题"

桌面 ExplainPanel 的追问 UI 与 persona restyle 同体(Codex 在 persona 化文件之上实现),无法干净拆离,故**推送树中 ExplainPanel 保持 base**,其桌面交互语义由上述护栏维持;追问 UI 待 persona 改动一并推送。

### 稳定主题归类

**后端** `continuity_service.py` `_stable_topic_choice`(与前端镜像 `continuity.ts`):

- 将用户问题/表达式/函数名改写为简短稳定的上位知识分类:如 `shared_ptr`/`unique_ptr`/`weak_ptr` 问题 → "C++ 新特性";多线程/锁/内存序 → "并发与内存模型";`chroot`/`namespace` → "Linux 沙箱";fork/进程 → "进程与执行"
- `render_project_learning_context` 注入 `<existing_qa_topics>`(JSON 主题列表),模型优先复用既有分类
- `prompt_contracts.py` HANDOFF 约束补一行:topic 必须是简短稳定的上位知识分类,禁止复制用户问题/TITLE/表达式/函数名

**前端**:

- `continuity.ts` `renderProjectLearningContext(handoff, existingTopics)` 镜像后端注入现有主题
- Android `localProvider.ts` 提问前拉取该项目已有问答线程主题列表传入
- `TeachingContinuityCards.tsx` `compactTopicLabel(topic, records)`:旧历史(长文本/表达式型主题)按稳定分类规则简化,相同分类的记录合并为一个可续学条目

### 测试

- 后端:主题归类合并用例(新旧话题、同类指针问题归并)
- 前端:会话编排(独立会话/追问续接/取消)、主题注入渲染、历史合并分组、移动端布局("取消追问"态)

## 验证

- 前端 vitest 35 项全通过;后端 unittest 全量 307 项通过(其中 continuity 6 项)
- 推送树相对 base 类型检查干净(tsc 仅报本地 persona 工作树暂态差异,不在推送范围)
