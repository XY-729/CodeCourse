# Proposal: 预读面板按自定义速度逐字展示（方案 A）

## Why

「查看生成内容」打开的预读面板此前是整段整段地出现：后端快照只在**整章**完成时更新（`lesson_preview.LessonPreview.sections()`），面板拿到的 markdown 一次性渲染出来。用户希望已就绪的内容能按自定义速度流畅地逐字展示。

前提事实（决定了实现位置）：

- 文件课件走的是真流式（`stream_file_lesson_generation` 把模型的 SSE 逐字转发，前端 `onDelta` 实时累积），本来就是逐字；
- 学习计划/总纲课件的章节是 **4 路并行、非流式的整次调用**（`ThreadPoolExecutor` + `call_openai_compatible_chat`），后端手里没有字符级数据，只有「某一章完成」这种事件。

所以「逐字展示」只能在客户端对已就绪的 markdown 做，不能靠后端推流。用户已选定该方案（A），并明确不采用 B（改后端为真流式，需放弃并行、总时长约 1.5–3 倍）。

## What Changes

`frontend/src/components/DesktopGenerationStatus.tsx` 的预读面板：

- 新增逐字揭示：按固定速度把已就绪 markdown 逐字放出，新章节到达时接着打，不重播已显示部分；
- 生成结束（completed / failed / cancelled）时**立即给全文**——此时已无需等待，继续逐字只会拖慢阅读；
- 面板头部新增 慢/标准/快 三档速度选择（仅生成中显示），选择写入 `localStorage`（`codecourse.desktop.previewSpeed`），沿用 `codecourse.desktop.docFontSize` 的既有约定；
- 用户开启「减少动效」（`prefers-reduced-motion: reduce`）时跳过逐字，直接给全文。

只改观感，不改轮询节奏、快照格式或任何生成时机。

## Capabilities

### Added Capabilities
- `lesson-preview-readability`:预读面板对已就绪内容的呈现方式
