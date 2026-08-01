# Design: 安卓端阅读器两处回归修复

## 背景

两个 bug 都源自 7/26 `4eb85ecb`(personalize) / 7/30-31 移动端统一阅读器重构(远端 29 提交)引入的代码路径分叉:

- 桌面路径 `MarkdownViewer`/`MonacoCodeViewer` 与安卓路径 `MobileCodeViewer` 共用同一 `App.tsx` 的 `onSelectionChange={handleSelection}`。
- `MarkdownViewer` 对安卓做了专门规避(不 setState、不捕获选择),而 `MobileCodeViewer` 没有——每次 `selectionchange` 都 setState,导致 ActionMode 被销毁。
- 滚动位置恢复 effect 对 `androidRuntime` 直接短路,安卓端保存了进度却不恢复。

## Bug 1: 代码文本选中工具栏消失

### 根因链路
`MobileCodeViewer.tsx:174-222` `selectionchange` 处理器:
1. `setSelectionActive(true)` (行 193) — MobileCodeViewer 自身重渲染
2. `setSelectionAnchorLine(anchorLine)` (行 194) — 再次重渲染
3. `onSelectionChange(...)` (行 206) → `App.tsx:handleSelection` (3067) → `setSelection/setSelectionAnchor` → 整个 App 子树重渲染
4. `renderLine` 重跑,`dangerouslySetInnerHTML` 内容 DOM 被 React 重建,原生 Range 失效,ActionMode 关闭

### 方案:安卓下"只读暂存,收起后上报"

**改 `MobileCodeViewer.tsx`:**

1. 新增组件级 ref 缓存待上报文本:
   ```ts
   const pendingSelectionRef = useRef<ViewerSelection | null>(null);
   const selectionActiveRef = useRef(false);   // 同步 ref,避免 setState
   ```

2. 重写 `handleSelectionChange`(安卓分支):
   - 选中中 (`!selection.isCollapsed`):只读 `getSelection()` 构造 `ViewerSelection`,写入 `pendingSelectionRef`;**不调用任何 setState,不调用 `onSelectionChange`**。
   - 收起后 (`selection.isCollapsed` 且 `pendingSelectionRef.current` 存在):把暂存文本通过 `onSelectionChange` 上报一次,然后清空 ref。
   - 这样选中期间零重渲染,ActionMode 存活;收起后文本仍进入 App state,assistant 可消费。

3. 非安卓路径完全保留现有逻辑(selectionchange 即上报 + 锚点行 pin)。

4. `performProgrammaticScroll` 的活动选择守卫(行 283)改用 `selectionActiveRef.current`(同步 ref)或原生 `hasActiveSelection()` 判断,不再依赖 `selectionActive` state。

5. `useEffect` 依赖数组 (行 222) 保持不变;新增 `selectionActiveRef` 不触发重渲染。

**注意 — App.tsx 侧**:`handleSelection` 的上报是在"收起后"发生,此时 selection 已 collapsed,`setSelection/setSelectionAnchor` 触发重渲染不会销毁已收起的 ActionMode(工具栏已消失,文本已固定)。这与 MarkdownViewer 在桌面的 `onMouseUp` 后上报同一语义。**App.tsx 无需修改。**

### 为什么可行
- WebView 原生 ActionMode 在 selection 收起后自动消失;React 重渲染只破坏"选中中"的 Range,不破坏已收起的文本状态。
- "收起后上报"与桌面 `onMouseUp` 上报语义一致,只是触发源从 mouse 事件换成 `selectionchange` 的 collapsed 分支。

## Bug 2: 课件阅读进度丢失

### 根因
`MarkdownViewer.tsx:385-405` 恢复 effect 第一行 `if (androidRuntime) return;`,安卓端从不执行 `article.scrollTop = maxScroll * ratio`。

### 方案:移除短路,复用活动选择守卫

改 `MarkdownViewer.tsx` 恢复 effect (行 385-405):

```ts
useEffect(() => {
  const article = articleRef.current;
  if (!article) return;
  // 恢复时避开活动选择:用户正拖动选择手柄时不得跳动滚动位置
  if (hasActiveAndroidSelection()) return;
  const restoreKey = `${sourceType}:${sourcePath ?? title}`;
  if (restoredSourceRef.current === restoreKey) return;
  const ratio = Math.min(1, Math.max(0, initialScrollRatio ?? 0));
  if (ratio === 0) {
    restoredSourceRef.current = restoreKey;
    article.scrollTop = 0;
    return;
  }
  const frame = window.requestAnimationFrame(() => {
    const maxScroll = Math.max(0, article.scrollHeight - article.clientHeight);
    if (maxScroll <= 0) return;
    scrollRangeRef.current = maxScroll;
    article.scrollTop = maxScroll * ratio;
    restoredSourceRef.current = restoreKey;
  });
  return () => window.cancelAnimationFrame(frame);
}, [androidRuntime, content, initialScrollRatio, sourcePath, sourceType, title]);
```

要点:
- `hasActiveAndroidSelection()` 在非安卓下返回 false(行 479),桌面行为不变。
- rAF 内恢复,布局稳定后设 `scrollTop`。
- `restoredSourceRef` 保持"每文档恢复一次",配合 `key={...activeItem.id}` 重挂载语义。
- 若用户正好在拖动选择手柄时打开文档(罕见),本次跳过;下次 content/source 变化(如切换回来)再触发恢复。

### 恢复会触发保存回写吗
- 恢复设 `article.scrollTop` 会触发 `scroll` 事件 → `settleScroll` → `commitReadingPosition`。此时已 `restoredSourceRef.current === restoreKey`,且 `commitReadingPosition` 有 `lastSavedRatioRef` 去重(行 521),不会产生 save→restore 循环。已验证恢复 effect 注释(行 383-384)所述防跳变逻辑仍成立。

## 测试

**新增/更新 (frontend/src/__tests__/):**

1. `mobileCodeSelection.test.tsx`(新):
   - 安卓运行时 `selectionchange` 选中中 → 断言未调用 `setState` 相关 effect(通过 mock 组件、`renderLine` 次数或 `selectionActive` DOM 类)、未调用 `onSelectionChange`。
   - 收起后 (dispatch collapsed `selectionchange`) → 断言 `onSelectionChange` 被调用一次、文本正确。
   - 非安卓运行时 → 现有行为 (selectionchange 即上报) 不回归。

2. `scrollPersistence.test.tsx`(更新):
   - 模拟 `isAndroidRuntime()` 返回 true:挂载 MarkdownViewer 传 `initialScrollRatio=0.5` → rAF 后断言 `article.scrollTop === (scrollHeight - clientHeight) * 0.5`。
   - 活动选择态下不恢复:mock `getSelection()` 非 collapsed → 断言 `scrollTop` 未被设置。

3. 现有 `virtualList.test.tsx` 中与 `selectionActive` state 相关的用例需随重构调整(若引用)。

## 文件清单

| 文件 | 改动 |
|---|---|
| `frontend/src/components/MobileCodeViewer.tsx` | selectionchange 安卓分支只读暂存/收起后上报;`selectionActiveRef` 替代 `selectionActive` state 用于滚动守卫 |
| `frontend/src/components/MarkdownViewer.tsx` | 移除恢复 effect 的 `androidRuntime` 短路;恢复时守卫活动选择 |
| `frontend/src/__tests__/mobileCodeSelection.test.tsx` | 新增 |
| `frontend/src/__tests__/scrollPersistence.test.tsx` | 更新:安卓恢复用例 |
| `frontend/src/__tests__/virtualList.test.tsx` | 更新:如有引用 `selectionActive` |

## 验证

1. `pnpm --dir frontend test` — 全部通过
2. `npx tsc -b`(frontend)— 类型通过
3. 安卓真机/模拟器人工验证:
   - 代码文件长按选中 → 工具栏保持可见;收起后 assistant 能拿到选中文本
   - 课件滚到中部 → 切走再回来 → 恢复到原位置
   - 代码大文件虚拟列表滚动/搜索/行跳转正常
4. 桌面端回归:选中文本→提问、课件滚动恢复、代码 Monaco 选中均正常
