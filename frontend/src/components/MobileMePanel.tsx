import {
  Bot,
  BrainCircuit,
  ChevronRight,
  Download,
  FolderTree,
  KeyRound,
  Moon,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Sun,
  Upload,
  UserRound,
  type LucideIcon,
} from "lucide-react";

type ProjectType =
  | "repository"
  | "learning_plan";

type Props = {
  projectName: string | null;
  projectType: ProjectType | null;

  completedLessons: number;
  totalLessons: number;

  modelReady: boolean;
  modelLabel: string;

  terminologyDensity: number | null;

  indexLabel: string;
  indexBusy: boolean;

  hasLearningProgress: boolean;

  busy: boolean;
  themeMode: "light" | "dark";

  onOpenProjects: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenPrompts: () => void;

  onBuildIndex: () => void;
  onResetLearningProgress: () => void;
  onExportDataArchive: () => void;
  onImportDataArchive: () => void;
  onToggleTheme: () => void;
};

type ActionRowProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;

  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
};

function terminologyLabel(
  density: number | null,
) {
  if (density == null) {
    return "打开项目后可设置";
  }

  if (density <= 0) {
    return "陌生术语提示已关闭";
  }

  if (density <= 0.25) {
    return "陌生术语提示：少";
  }

  if (density <= 0.5) {
    return "陌生术语提示：标准";
  }

  return "陌生术语提示：多";
}

function ActionRow({
  icon: Icon,
  title,
  description,
  onClick,
  disabled = false,
  active = false,
  danger = false,
}: ActionRowProps) {
  return (
    <button
      type="button"
      className={
        `mobile-me-action-row ` +
        `${active ? "active" : ""} ` +
        `${danger ? "danger" : ""}`
      }
      onClick={onClick}
      disabled={disabled}
    >
      <span className="mobile-me-action-icon">
        <Icon
          size={20}
          aria-hidden="true"
        />
      </span>

      <span className="mobile-me-action-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>

      <ChevronRight
        className="mobile-me-action-chevron"
        size={18}
        aria-hidden="true"
      />
    </button>
  );
}

export default function MobileMePanel({
  projectName,
  projectType,

  completedLessons,
  totalLessons,

  modelReady,
  modelLabel,

  terminologyDensity,

  indexLabel,
  indexBusy,

  hasLearningProgress,

  busy,
  themeMode,

  onOpenProjects,
  onOpenProfile,
  onOpenSettings,
  onOpenPrompts,

  onBuildIndex,
  onResetLearningProgress,
  onExportDataArchive,
  onImportDataArchive,
  onToggleTheme,
}: Props) {
  const hasProject =
    Boolean(projectName);

  const progressPercent =
    totalLessons > 0
      ? Math.round(
          (
            completedLessons /
            totalLessons
          ) * 100,
        )
      : 0;

  const projectTypeLabel =
    projectType === "learning_plan"
      ? "自定义学习计划"
      : "代码仓库项目";

  return (
    <section className="mobile-me-panel">
      <div className="mobile-me-scroll">
        <section className="mobile-me-hero">
          <div className="mobile-me-avatar">
            <UserRound
              size={25}
              aria-hidden="true"
            />
          </div>

          <div className="mobile-me-hero-copy">
            <small>
              {hasProject
                ? "当前学习项目"
                : "CodeCourse"}
            </small>

            <strong>
              {projectName ||
                "还没有打开项目"}
            </strong>

            <span>
              {hasProject
                ? projectTypeLabel
                : "选择一个项目开始学习"}
            </span>
          </div>

          <button
            type="button"
            className="mobile-me-project-button"
            onClick={onOpenProjects}
            disabled={busy}
          >
            {hasProject
              ? "切换"
              : "选择项目"}
          </button>

          {hasProject ? (
            <div className="mobile-me-progress">
              <div>
                <span>课程进度</span>

                <strong>
                  {totalLessons > 0
                    ? `${completedLessons}/${totalLessons}`
                    : "暂无课程"}
                </strong>
              </div>

              <div
                className="mobile-me-progress-track"
                role="progressbar"
                aria-label="课程完成进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  progressPercent
                }
              >
                <span
                  style={{
                    width:
                      `${progressPercent}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
        </section>

        <section className="mobile-me-status-grid">
          <article
            className={
              modelReady
                ? "ready"
                : ""
            }
          >
            <span>
              <Bot
                size={18}
                aria-hidden="true"
              />
              AI 模型
            </span>

            <strong>
              {modelReady
                ? "已就绪"
                : "未就绪"}
            </strong>

            <small>{modelLabel}</small>
          </article>

          <article>
            <span>
              <BrainCircuit
                size={18}
                aria-hidden="true"
              />
              个性化
            </span>

            <strong>
              {hasProject
                ? "当前项目"
                : "未选择项目"}
            </strong>

            <small>
              {terminologyLabel(
                terminologyDensity,
              )}
            </small>
          </article>
        </section>

        <section className="mobile-me-section">
          <h2>学习与 AI</h2>

          <div className="mobile-me-action-card">
            <ActionRow
              icon={BrainCircuit}
              title="我的学习档案"
              description={
                hasProject
                  ? "查看知识边界、概念状态和判断依据"
                  : "选择项目后查看学习档案"
              }
              onClick={onOpenProfile}
              disabled={
                !hasProject || busy
              }
            />

            <ActionRow
              icon={KeyRound}
              title="模型与个性化设置"
              description={
                modelReady
                  ? modelLabel
                  : "配置模型 API、教学观察和术语提示"
              }
              onClick={onOpenSettings}
              disabled={busy}
            />

            <ActionRow
              icon={Sparkles}
              title="提示词编辑"
              description="调整系统提示词和教学模板"
              onClick={onOpenPrompts}
              disabled={busy}
            />
          </div>
        </section>

        <section className="mobile-me-section">
          <h2>当前项目</h2>

          <div className="mobile-me-action-card">
            <ActionRow
              icon={FolderTree}
              title="项目与学习计划"
              description={
                hasProject
                  ? `当前：${projectName}`
                  : "导入仓库或新建学习计划"
              }
              onClick={onOpenProjects}
              disabled={busy}
            />

            <ActionRow
              icon={RefreshCw}
              title={
                indexBusy
                  ? "正在构建索引"
                  : "项目索引"
              }
              description={indexLabel}
              onClick={onBuildIndex}
              disabled={
                !hasProject ||
                projectType ===
                  "learning_plan" ||
                indexBusy ||
                busy
              }
            />

            <ActionRow
              icon={RotateCcw}
              title="重置学习进度"
              description={
                hasLearningProgress
                  ? "清除完成状态和阅读位置"
                  : "当前没有可重置的学习进度"
              }
              onClick={
                onResetLearningProgress
              }
              disabled={
                !hasProject ||
                !hasLearningProgress ||
                busy
              }
              danger
            />
          </div>
        </section>

        <section className="mobile-me-section">
          <h2>数据迁移</h2>

          <div className="mobile-me-action-card">
            <ActionRow
              icon={Download}
              title="导出 CodeCourse 数据包"
              description="保存项目、课件、问答和学习记录，不含 API Key"
              onClick={onExportDataArchive}
              disabled={busy}
            />

            <ActionRow
              icon={Upload}
              title="导入 CodeCourse 数据包"
              description="从桌面端或其他安装端恢复全部数据"
              onClick={onImportDataArchive}
              disabled={busy}
            />
          </div>
        </section>

        <section className="mobile-me-section">
          <h2>外观</h2>

          <div className="mobile-me-action-card">
            <ActionRow
              icon={
                themeMode === "dark"
                  ? Sun
                  : Moon
              }
              title={
                themeMode === "dark"
                  ? "切换到亮色模式"
                  : "切换到暗色模式"
              }
              description={
                themeMode === "dark"
                  ? "当前使用暗色外观"
                  : "当前使用亮色外观"
              }
              onClick={onToggleTheme}
              active={
                themeMode === "dark"
              }
            />
          </div>
        </section>
      </div>
    </section>
  );
}
