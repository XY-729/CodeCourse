import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  GenerationTask,
  TreeNode,
} from "../api/client";

import MobileGenerationPanel from "./MobileGenerationPanel";

const TREE: TreeNode = {
  name: "",
  path: "",
  type: "directory",
  is_key_file: false,

  children: [
    {
      name: "App.tsx",
      path:
        "frontend/src/App.tsx",
      type: "file",
      is_key_file: true,
      children: [],
    },
  ],
};

const RUNNING_TASK:
  GenerationTask = {
    id: 10,
    project_id: 1,
    task_type: "outline",
    status: "running",

    source_path: null,
    mode: null,
    model: "test-model",

    prompt_version: "1",
    input_hash: "hash",
    output_path: null,
    error_message: null,

    progress_current: 2,
    progress_total: 4,
    stage_label:
      "正在生成课程结构",

    created_at:
      "2026-07-30T00:00:00Z",

    updated_at:
      "2026-07-30T00:00:00Z",
  };

function createProps() {
  return {
    view:
      "configure" as const,

    projectName: "CodeCourse",

    projectType:
      "repository" as const,

    tree: TREE,

    intent: "outline" as const,

    scope:
      "full_project" as const,

    selectedFiles: [],

    instructions: "",

    currentFilePath:
      "frontend/src/App.tsx",

    currentLesson: {
      number: 2,
      title: "状态管理",
    },

    tasks: [],

    generationBusy: false,
    generationStarting: false,

    retryingTaskId: null,

    canGenerate: true,
    validationMessage: "",

    onViewChange: vi.fn(),
    onIntentChange: vi.fn(),
    onScopeChange: vi.fn(),
    onToggleFile: vi.fn(),
    onClearFiles: vi.fn(),

    onInstructionsChange:
      vi.fn(),

    onGenerate: vi.fn(),
    onRetry: vi.fn(),
    onOpenTask: vi.fn(),
    onOpenPrompts: vi.fn(),
  };
}

describe(
  "MobileGenerationPanel",
  () => {
    it(
      "shows exactly one primary generation action",
      () => {
        const props =
          createProps();

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        expect(
          screen.getAllByRole(
            "button",
            {
              name:
                "生成学习总纲",
            },
          ),
        ).toHaveLength(1);
      },
    );

    it(
      "changes generation intent",
      () => {
        const props =
          createProps();

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                /详细分析/,
            },
          ),
        );

        expect(
          props.onIntentChange,
        ).toHaveBeenCalledWith(
          "detailed",
        );
      },
    );

    it(
      "opens file selection inside the generation center",
      () => {
        const props =
          createProps();

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                /指定文件/,
            },
          ),
        );

        expect(
          props.onScopeChange,
        ).toHaveBeenCalledWith(
          "files",
        );

        expect(
          props.onViewChange,
        ).toHaveBeenCalledWith(
          "files",
        );
      },
    );

    it(
      "toggles files in file selection view",
      () => {
        const props = {
          ...createProps(),

          view:
            "files" as const,

          scope:
            "files" as const,
        };

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        fireEvent.click(
          screen.getByText("App.tsx").closest("button")!,
        );

        expect(
          props.onToggleFile,
        ).toHaveBeenCalledWith(
          "frontend/src/App.tsx",
        );
      },
    );

    it(
      "shows task progress",
      () => {
        const props = {
          ...createProps(),

          view:
            "tasks" as const,

          tasks: [
            RUNNING_TASK,
          ],

          generationBusy: true,
        };

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        expect(
          screen.getByText("50%"),
        ).toBeTruthy();

        expect(
          screen.getByText(
            /正在生成课程结构/,
          ),
        ).toBeTruthy();
      },
    );

    it(
      "disables configuration while busy",
      () => {
        const props = {
          ...createProps(),

          generationBusy: true,
        };

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        const generate =
          screen.getByRole(
            "button",
            {
              name:
                "生成学习总纲",
            },
          ) as HTMLButtonElement;

        expect(
          generate.disabled,
        ).toBe(true);
      },
    );

    it(
      "requires instructions for learning plans",
      () => {
        const props = {
          ...createProps(),

          projectType:
            "learning_plan" as const,

          canGenerate: false,

          validationMessage:
            "请先填写学习目标",
        };

        render(
          <MobileGenerationPanel
            {...props}
          />,
        );

        expect(
          screen.getByText(
            "请先填写学习目标",
          ),
        ).toBeTruthy();

        const btn = screen.getByRole(
            "button",
            {
              name:
                "生成学习总纲",
            },
          ) as HTMLButtonElement;

        expect(btn.disabled).toBe(true);
      },
    );
  },
);
