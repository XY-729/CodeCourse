# ExplainPanel 测试与已提交 Props 自洽（explain-panel-test-consistency）

## MODIFIED Requirements

### Requirement: 移动端布局测试只引用已提交 ExplainPanel 具备的 Props 与行为

对 `ExplainPanel` 的测试（如 `mobileControlLayout.test.tsx`）SHALL 只传入其已提交 Props 中存在的属性，并只断言已提交实现实际渲染的 UI。测试不得因引用仅存在于本地未提交工作树的 UI 而失败。

#### Scenario: 测试不引用未提交的追问 API
- **WHEN** 运行 `mobileControlLayout.test.tsx`
- **THEN** 渲染 `ExplainPanel` 时不传入 `followUpRecord` / `onFollowUp`
- **AND** 选中回答记录时断言已提交实现渲染的「开始新问题」按钮，而非「取消追问」

#### Scenario: 被排除 UI 不使正式测试失败
- **WHEN** ExplainPanel 的追问 / 取消追问 UI 尚未正式实现（被排除在正式提交之外）
- **THEN** 正式测试不得因引用它而失败（TS2322 或断言缺失）
- **AND** 该 UI 落地正式时，测试与 Props 随实现一并提交
