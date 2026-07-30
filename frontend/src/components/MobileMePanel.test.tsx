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

import MobileMePanel from "./MobileMePanel";

function createProps() {
  return {
    projectName: "CodeCourse",
    projectType:
      "repository" as const,

    completedLessons: 3,
    totalLessons: 8,

    modelReady: true,
    modelLabel:
      "deepseek / deepseek-chat",

    terminologyDensity: 0.5,

    indexLabel:
      "结构索引已完成 · 120 个结构节点",

    indexBusy: false,

    hasLearningProgress: true,

    busy: false,

    themeMode:
      "light" as const,

    onOpenProjects: vi.fn(),
    onOpenProfile: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenPrompts: vi.fn(),

    onBuildIndex: vi.fn(),

    onResetLearningProgress:
      vi.fn(),

    onToggleTheme: vi.fn(),
  };
}

describe(
  "MobileMePanel",
  () => {
    it(
      "shows project and progress summary",
      () => {
        const props =
          createProps();

        render(
          <MobileMePanel
            {...props}
          />,
        );

        expect(
          screen.getByText(
            "CodeCourse",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "3/8",
          ),
        ).toBeTruthy();

        expect(
          screen.getByText(
            "已就绪",
          ),
        ).toBeTruthy();
      },
    );

    it(
      "keeps global settings available without project",
      () => {
        const props = {
          ...createProps(),

          projectName: null,
          projectType: null,

          completedLessons: 0,
          totalLessons: 0,

          terminologyDensity: null,

          hasLearningProgress:
            false,
        };

        render(
          <MobileMePanel
            {...props}
          />,
        );

        const profile =
          screen.getByRole(
            "button",
            {
              name:
                /我的学习档案/,
            },
          ) as HTMLButtonElement;

        const settings =
          screen.getByRole(
            "button",
            {
              name:
                /模型与个性化设置/,
            },
          ) as HTMLButtonElement;

        const theme =
          screen.getByRole(
            "button",
            {
              name:
                /切换到暗色模式/,
            },
          ) as HTMLButtonElement;

        expect(
          profile.disabled,
        ).toBe(true);

        expect(
          settings.disabled,
        ).toBe(false);

        expect(
          theme.disabled,
        ).toBe(false);
      },
    );

    it(
      "runs independent actions",
      () => {
        const props =
          createProps();

        render(
          <MobileMePanel
            {...props}
          />,
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                /模型与个性化设置/,
            },
          ),
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                /提示词编辑/,
            },
          ),
        );

        fireEvent.click(
          screen.getByRole(
            "button",
            {
              name:
                /切换到暗色模式/,
            },
          ),
        );

        expect(
          props.onOpenSettings,
        ).toHaveBeenCalledTimes(1);

        expect(
          props.onOpenPrompts,
        ).toHaveBeenCalledTimes(1);

        expect(
          props.onToggleTheme,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "locks state-changing actions while busy",
      () => {
        const props = {
          ...createProps(),
          busy: true,
        };

        render(
          <MobileMePanel
            {...props}
          />,
        );

        const settings =
          screen.getByRole(
            "button",
            {
              name:
                /模型与个性化设置/,
            },
          ) as HTMLButtonElement;

        const projects =
          screen.getByRole(
            "button",
            {
              name:
                /^项目与学习计划/,
            },
          ) as HTMLButtonElement;

        const theme =
          screen.getByRole(
            "button",
            {
              name:
                /切换到暗色模式/,
            },
          ) as HTMLButtonElement;

        expect(
          settings.disabled,
        ).toBe(true);

        expect(
          projects.disabled,
        ).toBe(true);

        expect(
          theme.disabled,
        ).toBe(false);
      },
    );

    it(
      "disables index for learning-plan projects",
      () => {
        const props = {
          ...createProps(),

          projectType:
            "learning_plan" as const,

          indexLabel:
            "学习计划无需代码索引",
        };

        render(
          <MobileMePanel
            {...props}
          />,
        );

        const indexButton =
          screen.getByRole(
            "button",
            {
              name:
                /项目索引/,
            },
          ) as HTMLButtonElement;

        expect(
          indexButton.disabled,
        ).toBe(true);
      },
    );
  },
);
