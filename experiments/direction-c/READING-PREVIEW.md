# 阅读合并小预览 · 2026-09-06

仅修改独立 Direction C 样片。不接入生产前端，不打包、不安装、不改快捷方式。

## 打开

在本目录运行 `npm.cmd run dev`：

- 大阅读区（侧栏默认收起）：http://127.0.0.1:5197/?preview=reading&scene=source
- 目录展开：http://127.0.0.1:5197/?preview=reading&scene=source&sidebar=open
- 从项目场景体验原转场：http://127.0.0.1:5197/?preview=reading&scene=project
- 不带 `preview=reading` 的地址保留原三场景游戏样片。

## 本轮范围

- 合并 COURSE / SOURCE 为一个 READ 入口，保持原游戏背景、按钮和 700ms 转场。
- 目录中切换课程 / 源码，只改变目录，不卸载工作区。
- 大工作区默认展示一份课件和一份源码，两栏均能打开两种文档。
- 复用 `frontend/src/workbench/layout.ts` 的标签和布局逻辑，预演混合标签、关闭、跨栏拖拽、拆分与比例调整。
- 左侧目录可收起；默认收起时正文面宽度超过视口的 90%。展开约 280ms，收起约 170–180ms，包含斜切显现与闪线。目录推开正文，不覆盖正文。
- 保留阅读滚动、分栏比例和标签，进入 ASK 再返回不丢失；减少动态效果模式移除扫屏、视差和侧栏动画。

源码内容是静态内置样本，不是 Monaco；课程是样文。选区提问进入原 ASK 演示，不传真实上下文。AI、文件、项目及生成等生产能力未在本预览接入，也未从正式程序删除。默认两栏只是样片的初始状态，不新增自动同步业务。

## 验证

- `npm.cmd run build`：通过（TypeScript + Vite）。
- `node scripts/test.mjs --config playwright.reading-preview.config.ts`：10 项通过。
- 1280×720、1440×900、1920×1080：已查看收起、展开和源码目录截图，检查标题与正文边界、按钮、分隔线及底部导航，未发现重叠。
- 验证目录切换、混合标签、关闭和拖拽、分栏调整、ASK 往返、选区提问入口、快速收展、键盘焦点、Escape 与 reduced-motion。
- PROJECT 与 ASK 的主要构图边界与不带预览开关的原样片逐项比较一致。
- 截图在 `artifacts/reading-preview/`，不覆盖之前的样片截图。
- 主仓库仍为 `main@d0346be`，tracked 和 staged diff 均为空。当前改动只在 `codex/ui-direction-c-experiment@ca2b925` 的样片目录；本轮未操作其他分支、安装目录或快捷方式。

这是等待用户审查的界面预览，不代表生产前端、Electron 或 Android 回归已经完成。
