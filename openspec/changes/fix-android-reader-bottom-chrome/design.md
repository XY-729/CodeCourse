# Fix Android Reader Bottom Chrome

## Design

### 问题定位

沉浸阅读(`.android-reading-immersive`)当前同时做三件事:

1. 头部(reader header + topbar)高度归零 → 正确,视觉沉浸
2. `.workbench` `padding-bottom: 0` → **错误**,底栏仍固定显示,内容被遮挡
3. 底栏保持显示 → 与 2 冲突

### 方案

只保留"头部隐藏",不再触碰底部:

- `.android-reading-immersive .workbench` 的 `padding-bottom` **保持** `var(--android-bottom-navigation-height)`(默认 64px + safe-area)
- `.mobile-bottom-navigation` 继续固定显示(已正确)
- 阅读区高度在沉浸切换时只变化头部 52px → 无底部突变,消除抽搐
- `markdown-body` 88px 底部 padding 兜底,保证末行可读

### 验证

- 沉浸模式滚动到底:末行不被底栏遮挡
- 向下滑 48px 以上:头部隐藏、无抖动
- 向上滑:头部恢复
