# 前端结构与重绘指南

重绘前先看 [界面清单](ui-surfaces.json)。这里的“界面”包括主页面、抽屉、弹窗、浮层、独立窗口和不同状态，而不只是导航页签。清单逐项记录入口、平台、组件文件、样式和应检查的状态；当前有 29 组界面/公共部件。

## 从哪里开始改

```text
src/
  App.tsx                   # 连接控制器与主视图的薄入口
  app/
    useAppController.ts     # 状态、业务事件、数据加载与持久化；不包含 JSX
    views/                  # 9 个视图装配文件，连接状态与组件
    shell/                  # 桌面标题栏、工具栏、反馈与弹窗装配
      mobile/               # 移动端顶部、底部导航及抽屉外壳
  features/
    navigation/             # 项目列表、课程列表、源码树
    reader/                 # Markdown、源码、独立文档窗口、阅读操作
      mobile/               # 移动端代码阅读器与阅读标题栏
    assistant/              # 桌面问答与历史
      mobile/               # 移动端问答/历史/知识面板
    generation/             # 生成配置、任务状态、大纲问卷
      mobile/               # 移动端生成配置/任务列表
    settings/               # 模型设置、学习者画像、提示词
      mobile/               # “我的”面板
    knowledge/              # 知识网络视图、布局、worker 与样式模型
    call-guide/             # 调用路径阅读器
    teaching/               # 教学反馈、续学、术语、参考资料
    gestures/               # 桌面手势层与帮助
  components/
    ui/                     # 按钮、底部抽屉、滑动指示等公共部件
    overlays/               # 通用对话框、命令面板、文件选择器
  workbench/                # 层叠工作区、分栏、标签与布局控制
  styles/
    desktop.css             # 桌面/浏览器入口的样式加载顺序
    android.css             # Android 入口的样式加载顺序
    base/                   # 从 styles.css 拆出的 25 段基础规则
    *.css                   # 主题、功能及平台覆盖样式
  styles.css                # 基础样式入口，只保留有序 @import
```

`api/`、`platform/`、`personalization/`、`learning/`、`generation/`、`hooks/` 等目录继续承载数据和业务逻辑。组件的就近测试随组件移动；跨模块测试留在 `__tests__/`。

`app/views/` 中的 `render*` 函数是视图装配函数，接收类型明确的 `AppViewModel`，不在函数内调用 Hook。组件内部状态仍由 `features/` 下的 React 组件管理。`AppViewModel` 从控制器返回值推导，只通过类型导入连接两层。控制器仍集中管理跨功能状态；本次拆分的边界是把重绘需要编辑的 JSX 移出业务编排。

## 界面定位表

以下路径均相对于 `src/`；具体组件与完整状态以 [ui-surfaces.json](ui-surfaces.json) 为准。

| 重绘目标 | 装配或主要实现位置 | 容易遗漏的部分 |
| --- | --- | --- |
| 整体布局 | `app/views/AppView.tsx`、`app/shell/` | 标题栏、顶部工具栏、更多菜单、全局反馈 |
| 欢迎页、项目错误页 | `workbench/WorkbenchSurface.tsx` | 首次启动、项目目录失效、重新定位 |
| 工作区 | `app/views/WorkbenchGroupView.tsx`、`workbench/` | 空标签组、编辑、菜单、拖放预览、窄窗层叠、恢复布局 |
| 项目/课程/源码导航 | `app/views/NavigationView.tsx`、`features/navigation/` | 桌面左栏与移动抽屉、空列表、学习计划、多选文件 |
| 课件与问答正文 | `features/reader/` | 流式文本、编辑保存、表格/代码块、术语、高亮、进度 |
| 源码 | `features/reader/CodeViewer.tsx`、`features/reader/mobile/` | 桌面 Monaco 与移动虚拟列表、搜索、原生选区 |
| 独立文档窗口 | `features/reader/DetachedDocumentWindow.tsx` | 主入口 `?detached`；源码、课件、问答三种正文 |
| 桌面问答 | `app/views/AssistantView.tsx`、`features/assistant/` | 新问/追问、历史、收藏、上下文、生成/停止/失败 |
| 移动问答 | `app/views/MobileAssistantView.tsx`、`features/assistant/mobile/` | 提问/历史/知识子页、诊断、续学、触屏操作 |
| 知识网络 | `app/views/KnowledgeView.tsx`、`features/knowledge/` | 紧凑侧栏/完整标签、节点菜单、空图、加载失败 |
| 调用路径 | `features/call-guide/` | 节点选择、访问进度、返回源码、生成讲解 |
| 桌面生成 | `features/generation/` | 配置面板、任务状态条、流式生成、重试与打开产物 |
| 移动生成 | `app/views/MobileGenerationView.tsx`、`features/generation/mobile/` | 配置/任务两页、无项目、范围选择、生成状态 |
| 大纲问卷 | `features/generation/OutlineQuestionnaireDialog.tsx` | 加载、分步选择、补充答案、错误、取消 |
| 文件选择器 | `components/overlays/ContextFilePickerDialog.tsx` | 上下文和生成两种用途、搜索无结果、多选 |
| 模型/应用设置 | `features/settings/LLMSettingsDialog.tsx` | 模型、个性化、阅读、隐私、测试失败、保存中 |
| 学习者画像 | `features/settings/LearnerProfileDialog.tsx` | 全局/项目偏好、术语诊断、重置确认 |
| 提示词编辑 | `features/settings/PromptEditor.tsx` | 模板切换、未保存退出、恢复默认、保存失败 |
| 移动“我的” | `app/views/MobileMeView.tsx`、`features/settings/mobile/` | 模型未配置、索引、进度、导入导出忙碌 |
| 移动导航与抽屉 | `app/views/MobileWorkspaceView.tsx`、`app/shell/mobile/` | 六种抽屉内容、进入/退出手势、软键盘、安全区域 |
| 选区与术语浮层 | `features/reader/SelectionQuickBar.tsx`、`features/teaching/` | 桌面浮动工具条、右键标注、Android 原生操作条 |
| 教学反馈与参考 | `features/teaching/` | 理解反馈、续学提示、参考资料弹窗 |
| 命令面板 | `components/overlays/CommandPalette.tsx` | 空搜索、无结果、键盘选择、移动搜索 |
| 通用弹窗 | `components/overlays/AppDialog.tsx`、`app/shell/AppOverlayLayer.tsx` | 输入、确认、危险操作、不再提示、焦点恢复 |
| 忙碌/错误/拖入反馈 | `app/shell/AppFeedbackLayer.tsx`、`components/ui/TaskFeedback.tsx` | 通知权限、数据传输锁定、全局与抽屉内反馈 |
| 手势 | `features/gestures/` | 轨迹层、识别反馈、帮助浮层 |
| 公共部件 | `components/ui/` | 异步按钮、底部抽屉、滑动选择指示、减少动画 |

保留但当前没有生产入口引用的 `RepositoryForm`、`TeachingRationale`、`TermFeedbackPopover` 单列为 `retained-ui`，没有当作可直接访问的页面。重新接入时应补充真实入口和状态。

## 样式怎么找

1. 查界面清单里的 `styles`，找到功能样式。
2. 基础规则在 `styles/base/`：如 `reader.css`、`assistant.css`、`knowledge.css`、`prompts.css`、`settings*.css`。
3. 公共主题覆盖在 `apple-tokens.css`、`apple-workbench.css`、`apple-content.css`、`apple-overlays.css`、`apple-depth.css`；移动覆盖在 `android-*.css` 与 `apple-android-final.css`。
4. 查看 `styles/desktop.css`、`styles/android.css` 的实际加载顺序，避免只改基础规则后又被后续覆盖。

本次基础样式按原始连续片段切分，保留规则、选择器、顺序和重复覆盖。文件名说明主要职责，少数原有共享选择器仍涉及多个界面。`base/workbench-theme.css` 保留历史工作区覆盖，`base/android-workbench.css` 保留移动布局与代码行几何规则。不要为整理目录而重排这些覆盖。

`teaching.css` 与 `desktop-generation.css` 仍由功能模块引入；知识图谱的 Canvas 样式在 `features/knowledge/knowledgeGraphStyles.ts`，不会全部出现在 CSS 中。Android 原生文本工具栏在 `android/app/src/main/java/com/codecourse/app/CodeCourseWebView.java`（仓库根目录），也应纳入涉及选区操作的重绘验收。

主题配色与层叠工作区的拖动/缩放语义受仓库 [AGENTS.md](../AGENTS.md) 约束。本次只整理源码结构；后续涉及这些行为的改动需要依据用户的新要求。

## 防遗漏的工作流程

- 按 `ui-surfaces.json` 的 `entry` 打开界面，逐个核对 `states`；同时检查桌面与 Android，以及浅色/深色、窄窗口、空数据、忙碌和失败状态。
- 共享组件修改后，检查清单中使用它的界面；弹窗、独立窗口和移动抽屉也要核对。
- 新增、移动或删除生产 TSX 文件时同步修改清单的 `files`；新增入口/子页时补充独立条目或相应状态。路径必须明确列出，不能用目录通配符自动兜底。
- 执行下列命令。两个构建命令已经自动包含清单检查；存在未登记的 TSX、失效的组件/样式路径或缺失入口/状态时会失败。

```sh
pnpm --dir frontend run check:ui
pnpm --dir frontend test
pnpm --dir frontend run build
pnpm --dir frontend run build:android
```

清单检查保证文件有登记且路径存在，不代替人工检查运行时子状态和视觉效果。纯 `.ts`、CSS 或原生代码中的新界面行为也需要主动更新清单。
