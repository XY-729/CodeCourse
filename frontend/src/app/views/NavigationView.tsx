import Sidebar, { type NavigationView } from "../../features/navigation/Sidebar";
import type { AppViewModel } from "./appViewModel";



export function renderSidebar(model: AppViewModel, view: NavigationView, embedded = false) {
  const {
    projects,
    project,
    tree,
    courses,
    fileContent,
    selectedScopeFiles,
    selectedCourse,
    isLearningPlanProject,
    scopeType,
    busyProjectId,
    mobileRuntime,
    handleSelectMobileProject,
    openProject,
    handleCreateLearningPlan,
    handleRegenerate,
    handleDelete,
    handleSelectFile,
    handleOpenFile,
    handleSelectCourse,
    handleCreateCourse,
    handleDeleteCourse,
    handleRenameCourse,
    learningStates,
    openCourseInActiveGroup,
    prefetchDropItem,
    setNavigationView,
  } = model;

  return (
    <Sidebar
      embedded={embedded}
      view={view}
      projects={projects}
      currentProjectId={project?.id ?? null}
      tree={tree}
      courses={courses}
      selectedPath={fileContent?.path ?? null}
      selectedScopePaths={selectedScopeFiles}
      selectedCourse={selectedCourse}
      projectType={project?.project_type ?? "repository"}
      fileSelectionMode={!isLearningPlanProject && scopeType === "files"}
      busyProjectId={busyProjectId}
      onSelectProject={mobileRuntime && embedded ? handleSelectMobileProject : openProject}
      onCreateLearningPlan={handleCreateLearningPlan}
      onRegenerateProject={handleRegenerate}
      onDeleteProject={handleDelete}
      onSelectFile={handleSelectFile}
      onOpenFile={handleOpenFile}
      onSelectCourse={handleSelectCourse}
      onCreateCourse={handleCreateCourse}
      onDeleteCourse={handleDeleteCourse}
      onRenameCourse={handleRenameCourse}
      learningStates={learningStates}
      onContinueLearning={(filename) => project && void openCourseInActiveGroup(project.id, filename)}
      onDragItem={prefetchDropItem}
      onViewChange={!embedded && !mobileRuntime ? (nextView) => setNavigationView(nextView) : undefined}
    />
  );

}
