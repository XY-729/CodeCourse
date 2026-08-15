import { useState } from "react";

import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  Clock3,
  Code2,
  FileText,
  FolderTree,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import type {
  GenerationTask,
  LearningScope,
  Project,
  TreeNode,
} from "../api/client";

import type {
  GenerationIntent,
} from "./DesktopToolbar";

import FileTree from "./FileTree";

import { DeferredLiftTextarea } from "./DeferredLiftText";

import {
  generationTaskDate,
  generationTaskProgress,
  generationTaskStatusText,
  generationTaskTitle,
  isGenerationTaskRunning,
  isRetryableGenerationTask,
} from "./generationTaskModel";

export type MobileGenerationView =
  | "configure"
  | "files"
  | "tasks";

type ScopeType =
  LearningScope["type"];

type LessonContext = {
  number: number;
  title: string;
};

type Props = {
  view: MobileGenerationView;

  projectName: string | null;

  projectType:
    | Project["project_type"]
    | null;

  tree: TreeNode | null;

  intent: GenerationIntent;
  scope: ScopeType;

  selectedFiles: string[];

  instructions: string;

  currentFilePath: string | null;

  currentLesson:
    | LessonContext
    | null;

  tasks: GenerationTask[];

  generationBusy: boolean;
  generationStarting: boolean;

  retryingTaskId:
    | number
    | null;

  canGenerate: boolean;
  validationMessage: string;

  onViewChange: (
    view: MobileGenerationView,
  ) => void;

  onIntentChange: (
    intent: GenerationIntent,
  ) => void;

  onScopeChange: (
    scope: ScopeType,
  ) => void;

  onToggleFile: (
    path: string,
  ) => void;

  onClearFiles: () => void;

  onInstructionsChange: (
    value: string,
  ) => void;

  onGenerate: (
    instructions: string,
  ) => void;

  onRetry: (
    task: GenerationTask,
  ) => void;

  onOpenTask: (
    task: GenerationTask,
  ) => void;

  onOpenPrompts: () => void;
};

type IntentOption = {
  value: GenerationIntent;
  title: string;
  description: string;
  icon:
    typeof Sparkles;
  enabled: boolean;
};

function primaryLabel(
  intent: GenerationIntent,
): string {
  switch (intent) {
    case "lesson":
      return "生成当前课件";

    case "brief":
      return "生成粗略介绍";

    case "detailed":
      return "生成详细分析";

    default:
      return "生成学习总纲";
  }
}

function contextTitle(
  intent: GenerationIntent,
  currentFilePath: string | null,
  currentLesson:
    | LessonContext
    | null,
  projectName: string | null,
): string {
  if (
    intent === "brief" ||
    intent === "detailed"
  ) {
    return (
      currentFilePath ||
      "请先打开源码文件"
    );
  }

  if (intent === "lesson") {
    return currentLesson
      ? `第 ${currentLesson.number} 课 · ${currentLesson.title}`
      : "请先打开一节课程";
  }

  return (
    projectName ||
    "请先选择项目"
  );
}

function TaskStatusIcon({
  task,
}: {
  task: GenerationTask;
}) {
  if (
    task.status === "completed"
  ) {
    return (
      <Check
        size={19}
        aria-hidden="true"
      />
    );
  }

  if (
    task.status === "failed" ||
    task.status === "cancelled"
  ) {
    return (
      <CircleAlert
        size={19}
        aria-hidden="true"
      />
    );
  }

  if (
    task.status === "queued"
  ) {
    return (
      <Clock3
        size={19}
        aria-hidden="true"
      />
    );
  }

  return (
    <Loader2
      size={19}
      className="spin"
      aria-hidden="true"
    />
  );
}

export default function MobileGenerationPanel({
  view,

  projectName,
  projectType,

  tree,

  intent,
  scope,

  selectedFiles,
  instructions,

  currentFilePath,
  currentLesson,

  tasks,

  generationBusy,
  generationStarting,

  retryingTaskId,

  canGenerate,
  validationMessage,

  onViewChange,
  onIntentChange,
  onScopeChange,

  onToggleFile,
  onClearFiles,

  onInstructionsChange,
  onGenerate,

  onRetry,
  onOpenTask,

  onOpenPrompts,
}: Props) {
  const learningPlan =
    projectType ===
    "learning_plan";

  /*
   * The instructions draft lives here instead of App state so typing does not
   * re-render the whole app (which was the source of input lag). The parent
   * hears about the draft via a short debounce (for validation) and receives
   * it directly when the user taps the generate action.
   */
  const [
    instructionsDraft,
    setInstructionsDraft,
  ] = useState(instructions);

  const options:
    IntentOption[] = [
      {
        value: "outline",
        title: "学习总纲",
        description:
          "规划完整学习路线和课程顺序",
        icon: Sparkles,
        enabled:
          Boolean(projectName),
      },

      {
        value: "lesson",
        title: "当前课件",
        description:
          "展开当前课程的详细教材内容",
        icon: BookOpen,
        enabled:
          Boolean(currentLesson),
      },

      {
        value: "brief",
        title: "粗略介绍",
        description:
          "低成本了解当前文件职责和结构",
        icon: FileText,
        enabled:
          Boolean(currentFilePath),
      },

      {
        value: "detailed",
        title: "详细分析",
        description:
          "深入分析函数、数据流和修改风险",
        icon: Code2,
        enabled:
          Boolean(currentFilePath),
      },
    ];

  if (view === "files") {
    return (
      <section className="mobile-generation-panel">
        <header className="mobile-generation-subheader">
          <button
            type="button"
            className="mobile-generation-icon-button"
            onClick={() =>
              onViewChange(
                "configure",
              )
            }
            aria-label="返回生成设置"
            title="返回"
          >
            <ArrowLeft
              size={20}
              aria-hidden="true"
            />
          </button>

          <div>
            <strong>选择学习文件</strong>

            <small>
              已选择{" "}
              {selectedFiles.length} 个
            </small>
          </div>

          <button
            type="button"
            className="mobile-generation-text-button"
            onClick={onClearFiles}
            disabled={
              selectedFiles.length ===
                0 ||
              generationBusy
            }
          >
            清空
          </button>
        </header>

        <div className="mobile-generation-file-tree">
          {tree ? (
            <FileTree
              node={tree}
              selectedPath={null}
              selectedScopePaths={
                selectedFiles
              }
              fileSelectionMode
              onSelect={onToggleFile}
            />
          ) : (
            <div className="mobile-generation-empty">
              <FolderTree
                size={30}
                aria-hidden="true"
              />

              <strong>
                没有可选择的源码
              </strong>

              <p>
                当前项目还没有可读取的文件树。
              </p>
            </div>
          )}
        </div>

        <footer className="mobile-generation-file-footer">
          <span>
            {selectedFiles.length
              ? `已选择 ${selectedFiles.length} 个文件`
              : "至少选择一个文件"}
          </span>

          <button
            type="button"
            className="mobile-generation-primary"
            onClick={() =>
              onViewChange(
                "configure",
              )
            }
            disabled={
              selectedFiles.length ===
              0
            }
          >
            完成选择
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section className="mobile-generation-panel">
      <div
        className="mobile-generation-tabs"
        role="tablist"
        aria-label="生成中心页面"
      >
        <button
          type="button"
          role="tab"
          aria-selected={
            view === "configure"
          }
          className={
            view === "configure"
              ? "active"
              : ""
          }
          onClick={() =>
            onViewChange(
              "configure",
            )
          }
        >
          <Sparkles
            size={18}
            aria-hidden="true"
          />
          生成
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={
            view === "tasks"
          }
          className={
            view === "tasks"
              ? "active"
              : ""
          }
          onClick={() =>
            onViewChange(
              "tasks",
            )
          }
        >
          <Clock3
            size={18}
            aria-hidden="true"
          />
          任务

          {tasks.some(
            isGenerationTaskRunning,
          ) ? (
            <span
              className="mobile-generation-live-dot"
              aria-label="有任务正在生成"
            />
          ) : null}
        </button>
      </div>

      {view === "configure" ? (
        <>
          <div className="mobile-generation-scroll">
            <section className="mobile-generation-section">
              <h2>生成内容</h2>

              <div className="mobile-generation-intents">
                {options.map(
                  (option) => {
                    const Icon =
                      option.icon;

                    return (
                      <button
                        type="button"
                        key={option.value}
                        className={
                          intent ===
                          option.value
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          onIntentChange(
                            option.value,
                          )
                        }
                        disabled={
                          !option.enabled ||
                          generationBusy
                        }
                      >
                        <span>
                          <Icon
                            size={20}
                            aria-hidden="true"
                          />
                        </span>

                        <strong>
                          {option.title}
                        </strong>

                        <small>
                          {
                            option.description
                          }
                        </small>
                      </button>
                    );
                  },
                )}
              </div>
            </section>

            <section className="mobile-generation-context-card">
              <small>
                当前生成对象
              </small>

              <strong>
                {contextTitle(
                  intent,
                  currentFilePath,
                  currentLesson,
                  projectName,
                )}
              </strong>

              <span>
                {intent === "outline"
                  ? learningPlan
                    ? "将围绕你的学习目标规划课程"
                    : "将结合项目结构和关键文件生成路线"
                  : intent === "lesson"
                    ? "将生成教材化的完整课件"
                    : intent === "brief"
                      ? "快速建立文件整体认识"
                      : "深入理解代码结构与数据流"}
              </span>
            </section>

            {intent === "outline" ? (
              <section className="mobile-generation-section">
                <h2>学习范围</h2>

                {learningPlan ? (
                  <div className="mobile-generation-fixed-scope">
                    <BookOpen
                      size={19}
                      aria-hidden="true"
                    />

                    <div>
                      <strong>
                        学习计划
                      </strong>

                      <small>
                        根据下方目标规划课程，不读取项目源码
                      </small>
                    </div>
                  </div>
                ) : (
                  <div className="mobile-generation-scope-options">
                    <button
                      type="button"
                      className={
                        scope ===
                        "full_project"
                          ? "active"
                          : ""
                      }
                      onClick={() =>
                        onScopeChange(
                          "full_project",
                        )
                      }
                      disabled={
                        generationBusy
                      }
                    >
                      <FolderTree
                        size={20}
                        aria-hidden="true"
                      />

                      <span>
                        <strong>
                          全项目
                        </strong>

                        <small>
                          使用项目结构、README 和关键文件
                        </small>
                      </span>
                    </button>

                    <button
                      type="button"
                      className={
                        scope === "files"
                          ? "active"
                          : ""
                      }
                      onClick={() => {
                        onScopeChange(
                          "files",
                        );

                        onViewChange(
                          "files",
                        );
                      }}
                      disabled={
                        generationBusy
                      }
                    >
                      <FileText
                        size={20}
                        aria-hidden="true"
                      />

                      <span>
                        <strong>
                          指定文件
                        </strong>

                        <small>
                          {selectedFiles.length
                            ? `已选择 ${selectedFiles.length} 个文件`
                            : "选择需要重点学习的源码"}
                        </small>
                      </span>
                    </button>
                  </div>
                )}

                {!learningPlan &&
                scope === "files" ? (
                  <button
                    type="button"
                    className="mobile-generation-selected-files"
                    onClick={() =>
                      onViewChange(
                        "files",
                      )
                    }
                    disabled={
                      generationBusy
                    }
                  >
                    <span>
                      {selectedFiles.length
                        ? `已选择 ${selectedFiles.length} 个文件`
                        : "尚未选择文件"}
                    </span>

                    <strong>
                      选择文件
                    </strong>
                  </button>
                ) : null}
              </section>
            ) : null}

            <section className="mobile-generation-section">
              <div className="mobile-generation-section-heading">
                <h2>生成要求</h2>

                <button
                  type="button"
                  onClick={
                    onOpenPrompts
                  }
                  disabled={
                    generationBusy
                  }
                >
                  编辑提示词
                </button>
              </div>

              <DeferredLiftTextarea
                value={instructions}
                onLift={onInstructionsChange}
                onDraftChange={setInstructionsDraft}
                liftDelayMs={250}
                disabled={
                  generationBusy
                }
                placeholder={
                  learningPlan
                    ? "例如：从零学习 C++ 网络编程，先讲 socket，再讲并发服务器"
                    : "例如：面向初学者，优先解释请求流程和关键数据结构"
                }
                aria-label="生成要求"
              />

              {learningPlan ? (
                <small className="mobile-generation-required-note">
                  学习计划必须写明学习目标或知识范围。
                </small>
              ) : null}
            </section>

            {validationMessage ? (
              <div
                className="mobile-generation-validation"
                role="status"
              >
                <CircleAlert
                  size={17}
                  aria-hidden="true"
                />

                <span>
                  {validationMessage}
                </span>
              </div>
            ) : null}
          </div>

          <footer className="mobile-generation-footer">
            <button
              type="button"
              className="mobile-generation-primary"
              onClick={() =>
                onGenerate(
                  instructionsDraft,
                )
              }
              disabled={
                !canGenerate ||
                generationBusy
              }
            >
              {generationStarting ? (
                <Loader2
                  size={19}
                  className="spin"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles
                  size={19}
                  aria-hidden="true"
                />
              )}

              {generationStarting
                ? "正在创建任务"
                : primaryLabel(
                    intent,
                  )}
            </button>

            <small>
              只有确认后才会调用模型 API。
            </small>
          </footer>
        </>
      ) : (
        <div className="mobile-generation-task-list">
          {tasks.length ? (
            tasks.map((task) => {
              const progress =
                generationTaskProgress(
                  task,
                );

              const running =
                isGenerationTaskRunning(
                  task,
                );

              return (
                <article
                  key={task.id}
                  className={
                    `mobile-generation-task-card ` +
                    `status-${task.status}`
                  }
                >
                  <header>
                    <span className="mobile-generation-task-icon">
                      <TaskStatusIcon
                        task={task}
                      />
                    </span>

                    <div>
                      <strong>
                        {generationTaskTitle(
                          task,
                        )}
                      </strong>

                      <small>
                        {generationTaskDate(
                          task,
                        )}
                      </small>
                    </div>
                  </header>

                  <div className="mobile-generation-task-status">
                    <span>
                      {generationTaskStatusText(
                        task,
                      )}
                    </span>

                    {progress != null ? (
                      <strong>
                        {progress}%
                      </strong>
                    ) : null}
                  </div>

                  {running ? (
                    <div className="mobile-generation-progress">
                      {progress != null ? (
                        <span
                          style={{
                            width:
                              `${progress}%`,
                          }}
                        />
                      ) : (
                        <span className="indeterminate" />
                      )}
                    </div>
                  ) : null}

                  {task.error_message ? (
                    <p className="mobile-generation-task-error">
                      {task.error_message}
                    </p>
                  ) : null}

                  <footer>
                    {task.status ===
                      "completed" &&
                    task.output_path ? (
                      <button
                        type="button"
                        className="primary"
                        onClick={() =>
                          onOpenTask(
                            task,
                          )
                        }
                      >
                        <BookOpen
                          size={17}
                          aria-hidden="true"
                        />
                        打开结果
                      </button>
                    ) : null}

                    {isRetryableGenerationTask(
                      task,
                    ) ? (
                      <button
                        type="button"
                        onClick={() =>
                          onRetry(task)
                        }
                        disabled={
                          generationBusy ||
                          retryingTaskId ===
                            task.id
                        }
                      >
                        <RefreshCw
                          size={17}
                          className={
                            retryingTaskId ===
                            task.id
                              ? "spin"
                              : ""
                          }
                          aria-hidden="true"
                        />
                        继续生成
                      </button>
                    ) : null}

                    {running ? (
                      <span>
                        可以关闭应用，任务会在后台继续。
                      </span>
                    ) : null}
                  </footer>
                </article>
              );
            })
          ) : (
            <div className="mobile-generation-empty">
              <Clock3
                size={30}
                aria-hidden="true"
              />

              <strong>
                还没有生成任务
              </strong>

              <p>
                创建总纲、课件或文件分析后，进度会显示在这里。
              </p>

              <button
                type="button"
                onClick={() =>
                  onViewChange(
                    "configure",
                  )
                }
              >
                去生成
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
