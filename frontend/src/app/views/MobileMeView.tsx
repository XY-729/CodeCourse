import { lazy } from "react";
import {
  indexStatusMessage
} from "../appUtils";
import type { AppViewModel } from "./appViewModel";

const MobileMePanel = lazy(() => import("../../features/settings/mobile/MobileMePanel"));

export function renderMobileMePanel(model: AppViewModel) {
  const {
    llmSettings,
    project,
    isLearningPlanProject,
    indexStatus,
    completedLessonCount,
    lessonFilesForProgress,
    terminologyDensity,
    indexBuilding,
    learningStates,
    mobileMeBusy,
    themeMode,
    rejectMobileMeActionWhileBusy,
    setMobileWorkspaceTab,
    openLearnerProfileFromMobileMe,
    openSettingsFromMobileMe,
    openPromptsFromMobileMe,
    handleBuildIndex,
    handleResetLearningProgress,
    handleExportDataArchive,
    requestDataArchiveImport,
    setThemeMode,
  } = model;

  const modelReady =
    Boolean(
      llmSettings?.enabled &&
      llmSettings.has_api_key,
    );

  const modelLabel =
    llmSettings
      ? modelReady
        ? `${llmSettings.provider} / ${llmSettings.model}`
        : "模型尚未启用或没有 API Key"
      : "尚未读取到模型配置";

  const meIndexLabel =
    !project
      ? "打开项目后可查看索引状态"
      : isLearningPlanProject
        ? "学习计划无需代码索引"
        : indexStatusMessage(
          indexStatus,
        );

  return (
    <MobileMePanel
      projectName={
        project?.name ?? null
      }

      projectType={
        project?.project_type ??
        null
      }

      completedLessons={
        completedLessonCount
      }

      totalLessons={
        lessonFilesForProgress
          .length
      }

      modelReady={modelReady}
      modelLabel={modelLabel}

      terminologyDensity={
        project
          ? terminologyDensity
          : null
      }

      indexLabel={meIndexLabel}

      indexBusy={
        indexBuilding ||
        indexStatus?.status ===
        "building"
      }

      hasLearningProgress={
        learningStates.length > 0
      }

      busy={mobileMeBusy}

      themeMode={themeMode}

      onOpenProjects={() => {
        if (
          rejectMobileMeActionWhileBusy()
        ) {
          return;
        }

        setMobileWorkspaceTab(
          "projects",
        );
      }}

      onOpenProfile={
        openLearnerProfileFromMobileMe
      }

      onOpenSettings={
        openSettingsFromMobileMe
      }

      onOpenPrompts={
        openPromptsFromMobileMe
      }

      onBuildIndex={() => {
        if (
          rejectMobileMeActionWhileBusy() ||
          indexBuilding
        ) {
          return;
        }

        void handleBuildIndex();
      }}

      onResetLearningProgress={() => {
        if (
          rejectMobileMeActionWhileBusy()
        ) {
          return;
        }

        void handleResetLearningProgress();
      }}

      onExportDataArchive={() => {
        void handleExportDataArchive();
      }}

      onImportDataArchive={
        requestDataArchiveImport
      }

      onToggleTheme={() => {
        setThemeMode(
          (current) =>
            current === "dark"
              ? "light"
              : "dark",
        );
      }}
    />
  );

}
