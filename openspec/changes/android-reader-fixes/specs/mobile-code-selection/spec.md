# mobile-code-selection

## Requirements

### R1: 安卓端代码文本长按选中时,原生选择工具栏 (ActionMode) 不得消失
- 用户在安卓端代码查看器中长按文本开始选择时,系统选择工具栏 (复制/全选/等) 弹出后必须保持可见,直到用户主动操作。
- 选择过程中不得因 React 重渲染销毁原生 Range / ActionMode。

### R2: 选择过程不得触发 React 状态更新
- `MobileCodeViewer` 的 `selectionchange` 处理器在安卓运行时只读 `window.getSelection()`,不得调用 `setState`(含 `setSelectionActive`、`setSelectionAnchorLine`、`onSelectionChange` → 父组件 setState)。
- 虚拟列表的锚点行 pin 行为 (`selectionAnchorLine`) 在安卓下不得启用,避免重渲染。

### R3: 选择收起后选中文本仍可被问答链路消费
- 用户收起选择 (selection 变为 collapsed) 后,已选文本必须一次性上报给 App (通过 `onSelectionChange`),供 assistant (`MobileAssistantPanel` 的 `selection`) 消费,不得丢失。
- 上报必须在收起之后发生,不能在选择进行中发生。

### R4: 现有功能不受影响
- 非安卓 (桌面) 路径行为不变:选择即上报、虚拟列表锚点行 pin 照旧。
- 大文件虚拟列表、代码搜索跳转、显式行跳转 (`restoreLine` / `jumpRequest`) 在安卓下行为不变。
- `performProgrammaticScroll` 的"活动选择期间阻止滚动"守卫在安卓下继续有效(改用原生选择态判断)。

## Constraints

- 复用已有的 `hasActiveAndroidSelection()` 语义 (selection 非 collapsed 即活动),不引入重复判断。
- 只在 `frontend/src/` 前端层修改;不触及后端 FastAPI 与 Android 原生 (capacitor/java)。
