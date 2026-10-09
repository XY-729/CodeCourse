import { Loader2 } from "lucide-react";
import { lazy } from "react";
import TeachingReferenceDialog from "../../features/teaching/TeachingReferenceDialog";
import { markAndroidPerformance } from "../../platform/android/performance";
import WorkbenchSurface from "../../workbench/WorkbenchSurface";
import {
  flattenTree,
  taskStatusMessage
} from "../appUtils";
import AppFeedbackLayer from "../shell/AppFeedbackLayer";
import AppOverlayLayer from "../shell/AppOverlayLayer";
import MobileMoreMenu from "../shell/mobile/MobileMoreMenu";
import MobileTopBar from "../shell/mobile/MobileTopBar";
import MobileWorkspaceChrome from "../shell/mobile/MobileWorkspaceChrome";
import TitleBar from "../shell/TitleBar";
import type { AppViewModel } from "./appViewModel";
import { renderAssistantPanel } from "./AssistantView";
import { renderMobileWorkspaceContent } from "./MobileWorkspaceView";
import { renderSidebar } from "./NavigationView";
import { renderGroup } from "./WorkbenchGroupView";
const DesktopToolbar = __ANDROID_BUILD__ ? null : lazy(() => import("../shell/DesktopToolbar"));
const GestureGuide = __ANDROID_BUILD__ ? null : lazy(() => import("../../features/gestures/GestureGuide"));
const DesktopGenerationStatus = __ANDROID_BUILD__ ? null : lazy(() => import("../../features/generation/DesktopGenerationStatus"));
const GenerationSheet = __ANDROID_BUILD__ ? null : lazy(() => import("../../features/generation/GenerationSheet"));

export default function AppView({ model }: { model: AppViewModel }) {
  const {
    project,
    archiveInputRef,
    handleImportArchive,
    dataArchiveInputRef,
    handleImportDataArchive,
    dataTransferBusy,
    taskMessage,
    mobileRuntime,
    projects,
    activeDocumentTitle,
    progressLabel,
    navigationOpen,
    assistantOpen,
    busyProjectId,
    loading,
    generationStarting,
    activeLessonNumber,
    canGenerateFileLesson,
    indexBuilding,
    indexStatus,
    isLearningPlanProject,
    themeMode,
    navigationView,
    setNavigationView,
    setNavigationOpen,
    openProject,
    handleImportRequest,
    handleCreateLearningPlan,
    handleRegenerate,
    handleDelete,
    openGeneration,
    setQAUpperTab,
    setAssistantOpen,
    setCommandPaletteOpen,
    setSettingsOpen,
    openLearnerProfile,
    setPromptEditorOpen,
    setGestureGuideOpen,
    handleExportDataArchive,
    requestDataArchiveImport,
    handleBuildIndex,
    setThemeMode,
    mobileWorkspaceTab,
    toggleMobileProjects,
    toggleMobileCommandPalette,
    toggleMobileMoreMenu,
    moreMenuOpen,
    fileContent,
    setMoreMenuOpen,
    openAssistant,
    toastKind,
    permissionNotice,
    dismissedPermissionStatusRef,
    error,
    showBusy,
    qaInteractionBusy,
    qaBusyLabel,
    activeTask,
    toast,
    desktopDropActive,
    gestureHint,
    handleOpenNotificationSettings,
    handleDismissPermissionNotice,
    setError,
    gestureGuideOpen,
    layout,
    dragState,
    sidebarWidth,
    explainWidth,
    collapseControlledSplit,
    setDragState,
    setProject,
    mobileWorkspaceSheetRef,
    mobilePrimaryDestination,
    courses,
    mobileWorkspaceBusy,
    preloadMobileWorkspaceContent,
    toggleMobileNavigation,
    toggleMobileAssistant,
    toggleMobileMe,
    handleCreateMobileLearningPlan,
    handleCreateCourse,
    mobileWorkspaceMotionRef,
    setMobileWorkspaceTab,
    fileGeneration,
    handleOpenGenerationTask,
    streamingContentRef,
    openItemInGroup,
    activeGroupId,
    openCourseInActiveGroup,
    handleRetryTask,
    contextFilePickerOpen,
    setFilePickerPurpose,
    setContextFilePickerOpen,
    generationOpen,
    generationIntent,
    scopeType,
    selectedScopeFiles,
    generationInstructions,
    generationBusy,
    setGenerationOpen,
    setScopeType,
    setSelectedScopeFiles,
    openMobileNavigation,
    setGenerationInstructions,
    openPrompts,
    runSelectedGeneration,
    termAction,
    setTermAction,
    generateTermExplanation,
    handleTermMastery,
    handleDismissTerm,
    settingsOpen,
    confirmAction,
    openExternal,
    setTerminologyDensity,
    bumpPersonalizationRevision,
    setSettingsDialogBusy,
    closeSettingsDialog,
    learnerProfileOpen,
    setLearnerProfileOpen,
    activeTermScanStatus,
    termDisplay,
    handleRescanCurrentDocumentTerms,
    promptEditorOpen,
    requestClosePromptEditor,
    setPromptEditorDirty,
    setPromptEditorSaving,
    selectionAnchor,
    highlights,
    setSelection,
    handleExplainSelectedTerm,
    resolveAndOpenCallGuide,
    handleToggleHighlight,
    handleDismissSelection,
    commandPaletteOpen,
    commandItems,
    appDialog,
    appDialogValue,
    appDialogSkipChecked,
    handleAppDialogSkipChange,
    setAppDialogValue,
    closeAppDialog,
    handleAppDialogConfirm,
    outlinePreflight,
    outlinePreflightLoading,
    outlinePreflightError,
    handleOutlineQuestionnaireAnswers,
    filePickerPurpose,
    tree,
    contextFiles,
    getActiveOpenItem,
    setScopePathsText,
    setContextFiles,
  } = model;
  return (
    <div className="app-shell">
      <TitleBar />
      <TeachingReferenceDialog projectId={project?.id ?? null} />
      <input ref={archiveInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportArchive(file); }} />
      <input ref={dataArchiveInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleImportDataArchive(file); }} />
      {dataTransferBusy ? (
        <div className="data-transfer-lock" role="status" aria-live="assertive">
          <div className="data-transfer-lock-card">
            <Loader2 className="spin" size={20} aria-hidden="true" />
            <span>{taskMessage || "正在处理 CodeCourse 数据包"}</span>
          </div>
        </div>
      ) : null}
      {!mobileRuntime && DesktopToolbar ? (
        <DesktopToolbar
          project={project}
          projects={projects}
          activeTitle={activeDocumentTitle}
          progressLabel={progressLabel}
          navigationOpen={navigationOpen}
          assistantOpen={assistantOpen}
          busyProjectId={busyProjectId}
          loading={loading || dataTransferBusy || generationStarting}
          canGenerateLesson={Boolean(activeLessonNumber)}
          canGenerateFile={canGenerateFileLesson}
          indexLabel={indexBuilding || indexStatus?.status === "building" ? "正在构建索引" : "构建项目索引"}
          indexDisabled={!project || isLearningPlanProject || indexBuilding}
          themeMode={themeMode}
          onToggleNavigation={() => {
            if (navigationView === "projects") setNavigationView("courses");
            setNavigationOpen((open) => !open);
          }}
          onSelectProject={openProject}
          onImport={handleImportRequest}
          onCreateLearningPlan={handleCreateLearningPlan}
          onRegenerateProject={handleRegenerate}
          onDeleteProject={handleDelete}
          onOpenGeneration={openGeneration}
          onToggleAssistant={() => { setQAUpperTab("history"); setAssistantOpen((open) => !open); }}
          onOpenCommandPalette={() => setCommandPaletteOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenPreferences={openLearnerProfile}
          onOpenPrompts={() => setPromptEditorOpen(true)}
          onOpenGestureGuide={() => setGestureGuideOpen(true)}
          onExportDataArchive={() => { void handleExportDataArchive(); }}
          onImportDataArchive={requestDataArchiveImport}
          onBuildIndex={() => void handleBuildIndex()}
          onToggleTheme={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}
        />
      ) : (
        <MobileTopBar
          projectName={project?.name ?? null}
          projectSheetOpen={mobileWorkspaceTab === "projects"}
          onToggleProjects={toggleMobileProjects}
          onSearch={toggleMobileCommandPalette}
          onMore={toggleMobileMoreMenu}
        />
      )}
      <MobileMoreMenu
        open={mobileRuntime && moreMenuOpen}
        projectAvailable={Boolean(project)}
        generationLabel={activeLessonNumber ? "生成当前课件" : fileContent ? "分析当前文件" : "生成学习内容"}
        onGenerate={() => {
          openGeneration(activeLessonNumber ? "lesson" : fileContent ? "brief" : "outline");
          setMoreMenuOpen(false);
        }}
        onOpenKnowledge={() => { openAssistant("knowledge"); setMoreMenuOpen(false); }}
        onImportRepository={() => { void handleImportRequest(); setMoreMenuOpen(false); }}
        onImportArchive={() => { archiveInputRef.current?.click(); setMoreMenuOpen(false); }}
        onClose={() => setMoreMenuOpen(false)}
      />
      <AppFeedbackLayer
        toastKind={toastKind}
        permissionNotice={permissionNotice}
        permissionNoticeDismissed={Boolean(permissionNotice && dismissedPermissionStatusRef.current === permissionNotice.status)}
        error={mobileRuntime && mobileWorkspaceTab ? "" : error}
        busy={(mobileRuntime ? showBusy && !mobileWorkspaceTab : loading || dataTransferBusy || (qaInteractionBusy && !assistantOpen))}
        label={dataTransferBusy ? taskMessage : qaInteractionBusy ? qaBusyLabel : loading ? "正在处理" : activeTask ? taskStatusMessage(activeTask) : taskMessage}
        progressCurrent={activeTask?.progress_current}
        progressTotal={activeTask?.progress_total}
        toast={mobileRuntime && mobileWorkspaceTab ? "" : toast}
        desktopDropActive={desktopDropActive}
        gestureHint={gestureHint}
        onOpenNotificationSettings={handleOpenNotificationSettings}
        onDismissPermissionNotice={handleDismissPermissionNotice}
        onDismissError={() => setError("")}
      />
      {GestureGuide ? <GestureGuide open={gestureGuideOpen && !mobileRuntime} onClose={() => setGestureGuideOpen(false)} /> : null}
      <WorkbenchSurface
        mobile={mobileRuntime}
        mobilePanelOpen={mobileRuntime && Boolean(navigationOpen || mobileWorkspaceTab)}
        projectAvailable={Boolean(project)}
        projectError={error}
        layout={layout}
        navigationOpen={navigationOpen}
        assistantOpen={assistantOpen}
        navigationResizing={dragState?.kind === "sidebar-width"}
        assistantResizing={dragState?.kind === "explain-width"}
        sidebarWidth={sidebarWidth}
        assistantWidth={explainWidth}
        navigationContent={renderSidebar(model, navigationView === "files" ? "files" : "courses")}
        assistantContent={renderAssistantPanel(model)}
        renderGroup={(group) => renderGroup(model, group)}
        onCollapseSplit={collapseControlledSplit}
        onStartSplitResize={setDragState}
        onStartNavigationResize={(clientX) => setDragState({ kind: "sidebar-width", startX: clientX, startWidth: sidebarWidth })}
        onStartAssistantResize={(clientX) => setDragState({ kind: "explain-width", startX: clientX, startWidth: explainWidth })}
        onRelocateProject={() => { setError(""); handleImportRequest(); }}
        onReturnToProjects={() => {
          setError("");
          setProject(null);
          window.localStorage.removeItem("codecourse-last-project");
        }}
        onImportProject={handleImportRequest}
        onCreateLearningPlan={handleCreateLearningPlan}
      />
      {mobileRuntime ? (
        <MobileWorkspaceChrome
          ref={mobileWorkspaceSheetRef}
          activeDestination={mobilePrimaryDestination}
          tab={mobileWorkspaceTab}
          projectAvailable={Boolean(project)}
          coursesAvailable={courses.length > 0}
          error={error}
          busy={mobileWorkspaceBusy}
          busyLabel={dataTransferBusy ? taskMessage : mobileWorkspaceTab !== "assistant" && qaInteractionBusy ? qaBusyLabel : loading ? "正在处理" : activeTask ? taskStatusMessage(activeTask) : taskMessage}
          progressCurrent={activeTask?.progress_current}
          progressTotal={activeTask?.progress_total}
          toast={toast}
          preloadContent={preloadMobileWorkspaceContent}
          renderContent={(tab) => renderMobileWorkspaceContent(model, tab)}
          onLearn={() => toggleMobileNavigation("courses")}
          onSource={() => toggleMobileNavigation("files")}
          onAsk={() => toggleMobileAssistant("history")}
          onMe={toggleMobileMe}
          onCreateLearningPlan={() => { void handleCreateMobileLearningPlan(); }}
          onCreateCourse={() => { void handleCreateCourse(); }}
          onDismissError={() => setError("")}
          onMotionPhaseChange={(phase) => {
            mobileWorkspaceMotionRef.current = phase;
            document.documentElement.toggleAttribute("data-mobile-sheet-moving", phase !== "open");
            if (phase === "entering") markAndroidPerformance("drawer-first-frame");
            if (phase === "open") markAndroidPerformance("drawer-open");
          }}
          onDismiss={() => {
            document.documentElement.removeAttribute("data-mobile-sheet-moving");
            setMobileWorkspaceTab(null);
          }}
        />
      ) : null}
      {!mobileRuntime && DesktopGenerationStatus && project ? (
        <DesktopGenerationStatus key={project.id}
          task={activeTask?.project_id === project.id ? activeTask : null}
          stream={fileGeneration?.projectId === project.id ? fileGeneration : null}
          starting={generationStarting} message={taskMessage}
          onOpenTask={handleOpenGenerationTask}
          onOpenStream={(filename) => {
            const content = streamingContentRef.current.get(filename);
            if (content !== undefined) {
              openItemInGroup(activeGroupId, { id: `course:${filename}`, type: "course", path: filename, title: "生成中的课件", content });
              return true;
            } else { return openCourseInActiveGroup(project.id, filename); }
          }}
          onRetry={(task) => { void handleRetryTask(task); }}
        />
      ) : null}
      {!mobileRuntime && GenerationSheet ? (
        <GenerationSheet
          pickerOpen={contextFilePickerOpen}
          onOpenFiles={() => { setFilePickerPurpose("generation"); setContextFilePickerOpen(true); }}
          open={generationOpen}
          intent={generationIntent}
          project={project}
          scope={scopeType}
          selectedFileCount={selectedScopeFiles.length}
          instructions={generationInstructions}
          running={generationBusy}
          activeTask={activeTask}
          taskMessage={taskMessage}
          onClose={() => setGenerationOpen(false)}
          onScopeChange={(nextScope) => {
            setScopeType(nextScope);
            if (nextScope !== "files") {
              setSelectedScopeFiles([]);
            } else {
              /*
               * 桌面端以左侧源码侧边栏承载文件选择。面板遮罩（.apple-sheet-layer）
               * 会盖住侧边栏并拦截点击，必须先关闭面板，否则看起来“没有弹出选择窗口”。
               */
              setGenerationOpen(false);
              openMobileNavigation("files");
            }
          }}
          onInstructionsChange={setGenerationInstructions}
          onOpenPrompts={openPrompts}
          onGenerate={runSelectedGeneration}
        />
      ) : null}
      <AppOverlayLayer
        termAction={termAction ? {
          term: termAction.term,
          position: termAction.position,
          onGenerate: () => {
            const term = termAction.term;
            setTermAction(null);
            void generateTermExplanation(term);
          },
          onKnown: () => void handleTermMastery(termAction.term, "known"),
          onUnknown: () => void handleTermMastery(termAction.term, "unknown"),
          onDismiss: () => void handleDismissTerm(termAction.term),
          onClose: () => setTermAction(null),
        } : null}
        settings={{
          open: settingsOpen,
          projectId: project?.id ?? null,
          onConfirm: confirmAction,
          onOpenExternal: openExternal,
          onPreferencesChanged: (density) => {
            setTerminologyDensity(density);
            bumpPersonalizationRevision();
          },
          onBusyChange: setSettingsDialogBusy,
          onClose: closeSettingsDialog,
        }}
        learnerProfile={{
          open: learnerProfileOpen,
          projectId: project?.id ?? null,
          onClose: () => setLearnerProfileOpen(false),
          onChanged: bumpPersonalizationRevision,
          onConfirm: confirmAction,
          termScanStatus: activeTermScanStatus,
          termDiagnostics: termDisplay.diagnostics,
          onRescanTerms: handleRescanCurrentDocumentTerms,
        }}
        promptEditor={promptEditorOpen ? {
          onClose: () => { void requestClosePromptEditor(); },
          onDirtyChange: setPromptEditorDirty,
          onSavingChange: setPromptEditorSaving,
        } : null}
        selectionBar={!mobileRuntime && selectionAnchor?.selectedText ? {
          canHighlight: selectionAnchor.sourceType === "course" || selectionAnchor.sourceType === "qa",
          highlighted: highlights.some((highlight) => (
            highlight.source_type === selectionAnchor.sourceType
            && highlight.source_path === (selectionAnchor.sourcePath ?? "")
            && highlight.selected_text.trim() === selectionAnchor.selectedText.trim()
          )),
          anchorRect: selectionAnchor.anchorRect,
          onAsk: () => {
            setSelection({ ...selectionAnchor });
            openAssistant("history");
          },
          onExplainTerm: () => void handleExplainSelectedTerm(),
          onCallGuide: selectionAnchor.sourceType === "file" && project?.project_type === "repository"
            ? () => void resolveAndOpenCallGuide({
              sourcePath: selectionAnchor.sourcePath,
              line: selectionAnchor.range?.startLineNumber,
              selectedText: selectionAnchor.selectedText,
            })
            : undefined,
          onToggleHighlight: () => {
            if (selectionAnchor.sourceType === "course" || selectionAnchor.sourceType === "qa") {
              void handleToggleHighlight(selectionAnchor.sourceType, selectionAnchor.sourcePath ?? "", selectionAnchor.selectedText);
            }
          },
          onCopy: () => void navigator.clipboard.writeText(selectionAnchor.selectedText),
          onClose: handleDismissSelection,
        } : null}
        commandPalette={{ open: commandPaletteOpen, items: commandItems, onClose: () => setCommandPaletteOpen(false) }}
        appDialog={{
          state: appDialog,
          value: appDialogValue,
          skipChecked: appDialogSkipChecked,
          onSkipChange: handleAppDialogSkipChange,
          onValueChange: setAppDialogValue,
          onCancel: () => closeAppDialog(null),
          onConfirm: handleAppDialogConfirm,
        }}
        outlineQuestionnaire={{
          preflight: outlinePreflight,
          loading: outlinePreflightLoading,
          error: outlinePreflightError,
          onAnswers: handleOutlineQuestionnaireAnswers,
          onClose: () => handleOutlineQuestionnaireAnswers(null),
        }}
        contextFilePicker={{
          purpose: filePickerPurpose,
          open: contextFilePickerOpen,
          files: flattenTree(tree).filter((entry) => entry.type === "file").map((entry) => entry.path),
          selected: filePickerPurpose === "generation" ? selectedScopeFiles : contextFiles,
          currentPath: getActiveOpenItem()?.type === "file" ? getActiveOpenItem()?.path ?? null : null,
          onConfirm: (files) => { if (filePickerPurpose === "generation") { setSelectedScopeFiles(files); setScopePathsText(""); } else setContextFiles(files); setContextFilePickerOpen(false); },
          onClose: () => setContextFilePickerOpen(false),
        }}
      />
    </div>
  );
}
