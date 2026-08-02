import { afterEach, describe, expect, it, vi } from "vitest";
import { GenStreamError, generateFileLessonStream } from "../api/client";

function sseBody(...blocks: string[]): Response {
  const text = blocks.join("\n");
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("generateFileLessonStream error event", () => {
  it("throws GenStreamError carrying the failed filename from task_created", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseBody(
        'event: task_created\ndata: {"filename":"lessons/sandbox_linux.cpp_detailed.md","task_id":54}\n\n',
        'event: error\ndata: {"message":"模型返回为空内容。旧课件已保留。"}\n\n',
      ),
    );

    const onTaskCreated = vi.fn();
    const onDelta = vi.fn();
    const onCompleted = vi.fn();

    const error = await generateFileLessonStream(
      11,
      "src/sandbox_linux.cpp",
      "detailed",
      "",
      { onTaskCreated, onDelta, onCompleted },
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(GenStreamError);
    expect((error as GenStreamError).filename).toBe("lessons/sandbox_linux.cpp_detailed.md");
    expect((error as Error).message).toBe("模型返回为空内容。旧课件已保留。");
    expect(onTaskCreated).toHaveBeenCalledWith({
      filename: "lessons/sandbox_linux.cpp_detailed.md",
      task_id: 54,
    });
    expect(onDelta).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws GenStreamError with null filename when error arrives before task_created", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseBody('event: error\ndata: {"message":"Project not found"}\n\n'),
    );

    const error = await generateFileLessonStream(999, "src/main.py", "detailed", "").catch(
      (caught) => caught,
    );

    expect(error).toBeInstanceOf(GenStreamError);
    expect((error as GenStreamError).filename).toBeNull();
    expect((error as Error).message).toBe("Project not found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("streams deltas then completes on success without throwing", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseBody(
        'event: task_created\ndata: {"filename":"lessons/main.py_detailed.md","task_id":1}\n\n',
        'event: delta\ndata: {"text":"# 详细分析"}\n\n',
        'event: delta\ndata: {"text":"：main.py"}\n\n',
        'event: completed\ndata: {"filename":"lessons/main.py_detailed.md","task_id":1}\n\n',
      ),
    );

    const onDelta = vi.fn();
    const onCompleted = vi.fn();
    const filename = await generateFileLessonStream(
      1,
      "src/main.py",
      "detailed",
      "",
      { onDelta, onCompleted },
    );

    expect(filename).toBe("lessons/main.py_detailed.md");
    expect(onDelta).toHaveBeenCalledTimes(2);
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
