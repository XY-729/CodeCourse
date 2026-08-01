# 桌面端偏好控制与反馈闭环(Desktop Preference Controls)

## ADDED Requirements

### Requirement: 桌面端讲解偏好手动控制

桌面端学习档案页 SHALL 提供全部五维讲解偏好的手动调节入口,满足既有 `learner-preferences` 规范 7"所有偏好应在学习档案页手动可调"。

#### Scenario: 查看当前偏好
- **WHEN** 用户打开学习档案
- **THEN** 看到"讲解偏好"视图,展示当前五维值:
  - answerDepth(0-1)
  - codeRatio(0-1)
  - explanationOrder(balanced/example_first/principle_first/code_first)
  - prerequisiteDetail(0-1)
  - terminologyDensity(0-1)

#### Scenario: 调整偏好并保存
- **WHEN** 用户拖动滑块或切换顺序选择
- **THEN** 保存后调用 `updateLearnerPreferences` 写入对应 scope
- **AND** 界面显示保存成功
- **AND** 后续 QA 回答的 learner_context 反映新偏好(经 `render_preference_directives`)

#### Scenario: 重置为默认
- **WHEN** 用户点击"重置为默认"
- **THEN** 五个维度恢复默认值(0.5 / balanced)
- **AND** 通过确认框避免误操作

### Requirement: 桌面端答案反馈闭环

桌面端 QA 回答 SHALL 提供"这次讲解是否有效"反馈,并接通 `answer-feedback` 偏好反馈机制。

#### Scenario: 回答后出现反馈条
- **WHEN** 桌面端用户获得一次 QA 回答
- **THEN** 回答下方出现"讲懂了 / 部分明白 / 仍不懂"反馈条(复用 `TeachingRationale` 组件)

#### Scenario: 反馈微调偏好
- **WHEN** 用户点击"讲懂了"或"仍不懂"
- **THEN** 调用 `submitAnswerFeedback` 提交教学反馈
- **AND** 后端按教学反馈把对应偏好向成功/失败方向微调(幅度受慢速衰减约束)
- **AND** 反馈条显示已记录

### Requirement: 移动端共享一致行为

Android 端复用同一共享前端组件,行为一致。

#### Scenario: Android 端问卷流程可用
- **WHEN** Android 用户在移动端生成面板请求生成总纲
- **THEN** 走同一问卷前置流程(通过 `MobileGenerationPanel`)
- **AND** 学习档案的讲解偏好视图在移动端同样可用

## MODIFIED Requirements

### Requirement: LLMSettingsDialog 偏好一致
既有 `LLMSettingsDialog` 的"术语提示"下拉与新增偏好视图 SHALL 保持同步,同一时间展示同一 `terminologyDensity` 值。
