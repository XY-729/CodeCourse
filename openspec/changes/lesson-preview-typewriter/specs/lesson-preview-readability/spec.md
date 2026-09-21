# 预读面板的逐字呈现（lesson-preview-readability）

## ADDED Requirements

### Requirement: 生成中的预读内容逐字显示

预读面板在任务仍在生成时 SHALL 按设定速度把已就绪 markdown 逐字放出，而不是一次性整段渲染；新的快照到达时 SHALL 从已显示的位置继续，不重播已显示内容。

#### Scenario: 打开面板时已有就绪内容
- **WHEN** 面板打开且快照已有 markdown
- **THEN** 从第一个字符开始逐字显示

#### Scenario: 新章节到达
- **WHEN** 轮询拿到更长 markdown（version 变化）
- **THEN** 显示在原有进度上继续增长，滚动位置不跳变

#### Scenario: 生成结束
- **WHEN** 任务状态变为 completed / failed / cancelled
- **THEN** 立即显示快照全文，不再逐字

#### Scenario: 减少动效
- **WHEN** 用户系统开启了 `prefers-reduced-motion: reduce`
- **THEN** 直接显示全文

#### Scenario: 关闭面板后再打开
- **WHEN** 用户在生成中关闭预读面板，之后再次打开
- **THEN** 已经显示过的部分立即在场，不重打；只逐字显示这次新增加的内容

#### Scenario: 换任务或换生成目标
- **WHEN** 状态条切换到另一个任务，或开始另一份生成
- **THEN** 揭示进度归零，新任务从头逐字显示

### Requirement: 可自定义的显示速度

面板 SHALL 在生成中提供 慢/标准/快 三档速度，并把选择持久化，供后续预读沿用。

#### Scenario: 切换速度
- **WHEN** 用户点击某一档速度
- **THEN** 后续揭示按新速度进行，且该选择写入本地存储

#### Scenario: 下次打开
- **WHEN** 用户再次打开预读面板
- **THEN** 使用上次选择的速度
