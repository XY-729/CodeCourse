import { lazy } from "react";
import type { AppViewModel } from "./appViewModel";

const MobileGenerationPanel = lazy(() => import("../../features/generation/mobile/MobileGenerationPanel"));

export function renderMobileGenerationPanel(model: AppViewModel) {
  const {
    mobileGenerationView,
    project,
    tree,
    generationIntent,
    isLearningPlanProject,
    scopeType,
    selectedScopeFiles,
    generationInstructions,
    fileContent,
    activeLessonNumber,
    activeLessonTitle,
    generationTasks,
    generationBusy,
    generationStarting,
    retryingTaskId,
    canStartGeneration,
    generationValidationMessage,
    setMobileGenerationView,
    setGenerationIntent,
    setScopeType,
    setSelectedScopeFiles,
    setScopePathsText,
    setGenerationInstructions,
    runSelectedGeneration,
    handleRetryTask,
    handleOpenGenerationTask,
    openPromptsFromMobileGeneration,
  } = model;

  return (
    <MobileGenerationPanel
      view={mobileGenerationView}
      projectName={project?.name ?? null}
      projectType={project?.project_type ?? null}
      tree={tree}
      intent={generationIntent}
      scope={isLearningPlanProject ? "learning_plan" : scopeType}
      selectedFiles={selectedScopeFiles}
      instructions={generationInstructions}
      currentFilePath={fileContent?.path ?? null}
      currentLesson={activeLessonNumber ? { number: activeLessonNumber, title: activeLessonTitle || `第 ${activeLessonNumber} 课` } : null}
      tasks={generationTasks}
      generationBusy={generationBusy}
      generationStarting={generationStarting}
      retryingTaskId={retryingTaskId}
      canGenerate={canStartGeneration}
      validationMessage={generationValidationMessage}
      onViewChange={setMobileGenerationView}
      onIntentChange={setGenerationIntent}
      onScopeChange={(nextScope) => { setScopeType(nextScope); if (nextScope !== "files") setSelectedScopeFiles([]); }}
      onToggleFile={(path) => { setSelectedScopeFiles((items) => items.includes(path) ? items.filter((item) => item !== path) : [...items, path]); setScopePathsText(""); }}
      onClearFiles={() => { setSelectedScopeFiles([]); setScopePathsText(""); }}
      onInstructionsChange={setGenerationInstructions}
      onGenerate={runSelectedGeneration}
      onRetry={(task) => { void handleRetryTask(task); }}
      onOpenTask={(task) => { void handleOpenGenerationTask(task); }}
      onOpenPrompts={openPromptsFromMobileGeneration}
    />
  );

}
