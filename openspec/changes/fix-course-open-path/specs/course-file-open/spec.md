# 课件打开路径解析（course-file-open）

## ADDED Requirements

### Requirement: 任务输出路径到课程文件名的解析

从生成任务打开课件时，系统 SHALL 把任务的 `output_path`（可能是 Windows 绝对路径、含反斜杠）解析成课程目录下的相对文件名（正斜杠）后再请求后端，而不得把绝对路径直接当作文件名。

#### Scenario: 后端返回的 Windows 绝对路径
- **WHEN** `output_path` 为 `C:\Users\x\AppData\Roaming\CodeCourse\generated\12\lessons\lesson_05.md`
- **AND** 课程列表含 `lessons/lesson_05.md`
- **THEN** 解析结果为 `lessons/lesson_05.md`，请求命中 200

#### Scenario: 课程列表项自身带反斜杠
- **WHEN** 课程列表里的 filename 是 `selection_answers\explicit_0038.md`
- **THEN** 匹配前先统一为正斜杠，返回 `selection_answers/explicit_0038.md`

#### Scenario: 列表里没有对应文件
- **WHEN** 路径含 `generated/<projectId>/`
- **THEN** 回退为该标记之后的相对段（如 `lessons/lesson_09.md`）

#### Scenario: 无法定位
- **WHEN** 路径为空，或不含 `generated/<projectId>/` 且文件名对不上任何课程
- **THEN** 解析结果为 `null`，后端不被请求；界面提示从课程列表打开

#### Scenario: 生成的课件完成时自动打开（移动端）
- **WHEN** 移动端任务完成且允许自动打开
- **THEN** 自动打开同样使用解析后的相对文件名
