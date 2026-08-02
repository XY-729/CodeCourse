# Design: 移动端代码阅读位置进度条

## 组件改动（MobileCodeViewer.tsx）

1. **新增 ref**：`const progressFillRef = useRef<HTMLDivElement | null>(null);`
2. **新增刷新函数**（rAF 节流，仿 MarkdownViewer `refreshProgress` 的 scaleX 策略）：

```ts
const progressRafRef = useRef(0);
const refreshScrollProgress = useCallback((remeasure = false) => {
  if (progressRafRef.current) return;
  progressRafRef.current = window.requestAnimationFrame(() => {
    progressRafRef.current = 0;
    const el = scrollRef.current;
    const fill = progressFillRef.current;
    if (!el || !fill) return;
    const range = el.scrollHeight - el.clientHeight;
    const p = range > 0 ? Math.min(1, Math.max(0, el.scrollTop / range)) : 0;
    fill.style.transform = `scaleX(${p})`;
    fill.style.opacity = range <= 0 ? "0" : "1";
  });
}, []);
```

3. **`handleCodeScroll` 追加一行**：`refreshScrollProgress();`（现有处理器已统一处理所有滚动，包括虚拟列表更新与可见行上报）。
4. **首次挂载刷新**：在现有初始 restore 的 rAF effect（`useEffect` 挂载时）里同步调用 `refreshScrollProgress(true)`——但需等滚动容器高度稳定。更稳：在 `useEffect`（依赖 `content, path`）里调一次 `refreshScrollProgress(true)`，配合虚拟列表初始渲染；大文件初始为 0，滚动后立即有进度。
5. **卸载清理**：现有 `useEffect(() => () => window.cancelAnimationFrame(visLineRafRef.current), [])` 追加 `window.cancelAnimationFrame(progressRafRef.current)`。

## 渲染改动

`.mobile-code-viewer` 顶部（`mobile-code-notice` 之前）加：

```tsx
<div className="mobile-code-progress" aria-hidden="true">
  <div ref={progressFillRef} className="mobile-code-progress-fill" />
</div>
```

## CSS（android-experience.css 的 `html.platform-android` 段追加）

```css
html.platform-android .mobile-code-progress {
  position: sticky;      /* 贴组件顶部，不随代码滚动 */
  top: 0; z-index: 1;
  height: 2px;
  background: var(--mobile-surface-pressed);
  overflow: hidden;
}
html.platform-android .mobile-code-progress-fill {
  height: 100%;
  transform-origin: left;
  transform: scaleX(0);
  background: var(--mobile-progress);
  opacity: 0;            /* 不可滚动时隐藏 */
  transition: opacity 0.15s ease;
}
```

> 注意：`.mobile-code-scroll` 才是滚动容器；进度条放 `.mobile-code-viewer` 顶层 + sticky top:0 保证贴在可见顶部。视觉与 `.reader-progress-bar`（2px、圆角 999px）一致——补 `border-radius: 999px`。

## 测试（__tests__/mobileCodeViewer.test.tsx）

- 渲染：`container.querySelector(".mobile-code-progress")` 存在。
- 滚动更新：fire `scroll` 事件后，fill 的 `style.transform` 为 `scaleX(<比例>)`（rAF 需 mock 或用 `act` 内 flush）。
- 不可滚动：`scrollHeight <= clientHeight` 时 opacity 为 `"0"`。
- 不破坏现有虚拟列表/选择测试。

## 文件清单

- `frontend/src/components/MobileCodeViewer.tsx`（+~25 行）
- `frontend/src/styles/android-experience.css`（+~15 行）
- `frontend/src/__tests__/mobileCodeViewer.test.tsx`（+3 用例）
- `openspec/changes/android-code-reading-progress/*`（本变更）
