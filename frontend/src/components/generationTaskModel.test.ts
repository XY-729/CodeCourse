import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  GenerationTask,
} from "../api/client";

import {
  generationTaskProgress,
  generationTaskTitle,
  isGenerationTaskRunning,
  selectPrimaryGenerationTask,
  sortGenerationTasks,
  upsertGenerationTask,
} from "./generationTaskModel";

function task(
  overrides:
    Partial<GenerationTask>,
): GenerationTask {
  return {
    id: 1,
    project_id: 1,
    task_type: "outline",
    status: "queued",

    source_path: null,
    mode: null,
    model: "test-model",

    prompt_version: "1",
    input_hash: "hash",
    output_path: null,
    error_message: null,

    progress_current: 0,
    progress_total: 0,
    stage_label: null,

    created_at:
      "2026-07-30T00:00:00Z",

    updated_at:
      "2026-07-30T00:00:00Z",

    ...overrides,
  };
}

describe(
  "generationTaskModel",
  () => {
    it(
      "selects a running task before a completed task",
      () => {
        const completed = task({
          id: 2,
          status: "completed",
          updated_at:
            "2026-07-30T02:00:00Z",
        });

        const running = task({
          id: 1,
          status: "running",
          updated_at:
            "2026-07-30T01:00:00Z",
        });

        expect(
          selectPrimaryGenerationTask([
            completed,
            running,
          ])?.id,
        ).toBe(1);
      },
    );

    it(
      "sorts tasks by latest update",
      () => {
        const result =
          sortGenerationTasks([
            task({
              id: 1,
              updated_at:
                "2026-07-30T01:00:00Z",
            }),

            task({
              id: 2,
              updated_at:
                "2026-07-30T02:00:00Z",
            }),
          ]);

        expect(
          result.map(
            (item) => item.id,
          ),
        ).toEqual([2, 1]);
      },
    );

    it(
      "updates an existing task without duplicating it",
      () => {
        const result =
          upsertGenerationTask(
            [
              task({
                id: 1,
                status: "queued",
              }),
            ],

            task({
              id: 1,
              status: "running",
            }),
          );

        expect(
          result,
        ).toHaveLength(1);

        expect(
          result[0].status,
        ).toBe("running");
      },
    );

    it(
      "calculates bounded progress",
      () => {
        expect(
          generationTaskProgress(
            task({
              progress_current: 3,
              progress_total: 4,
            }),
          ),
        ).toBe(75);

        expect(
          generationTaskProgress(
            task({
              progress_current: 8,
              progress_total: 4,
            }),
          ),
        ).toBe(100);
      },
    );

    it(
      "builds readable file task titles",
      () => {
        expect(
          generationTaskTitle(
            task({
              task_type:
                "file_lesson",

              source_path:
                "frontend/src/App.tsx",

              mode: "detailed",
            }),
          ),
        ).toBe(
          "App.tsx · 详细分析",
        );
      },
    );

    it(
      "recognizes terminal state",
      () => {
        expect(
          isGenerationTaskRunning(
            task({
              status: "running",
            }),
          ),
        ).toBe(true);

        expect(
          isGenerationTaskRunning(
            task({
              status: "completed",
            }),
          ),
        ).toBe(false);
      },
    );
  },
);
