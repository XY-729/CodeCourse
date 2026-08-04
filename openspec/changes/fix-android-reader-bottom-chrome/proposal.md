## Why

用户反馈:安卓端文档最底部被工具栏遮挡,强行下滑会"抽搐"(滚动来回振荡)。

根因分析:

1. **底部遮挡**:沉浸阅读模式 CSS(`apple-android-final.css` `.android-reading-immersive .workbench`)把 `padding-bottom` 归零,但 `.mobile-bottom-navigation` 在该模式下仍固定显示(`android-shell.css` 强制 `opacity:1; pointer-events:auto`)→ 文档最后一行被 64px 底栏盖住,`markdown-body` 的 88px 底部 padding 兜不住。

2. **抽搐**:沉浸切换时头部 52px + 底部预留 64px 同时变化,`.markdown-scroll-viewport` 高度骤变,浏览器强制 clamp scrollTop 引发滚动位置振荡,`advanceReadingChrome` 随之反复切换 hidden 状态。

## What Changes

1. 沉浸模式下不隐藏底部导航栏,同时**保留阅读区底部滚动预留**(底栏仍占位)
2. 沉浸模式仅隐藏头部(保留视觉沉浸感),阅读区高度不再突变 → 消除抽搐
3. 保证文档最后一行的可读性:任何模式下滚动到底,末行都不被底栏遮挡
