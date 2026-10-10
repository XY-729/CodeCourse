import type {
  EditorGroup
} from "../../workbench/layout";
import {
  countGroups,
  detectDropZone,
  updateEveryGroup
} from "../../workbench/layout";
import WorkbenchEditorGroup from "../../workbench/WorkbenchEditorGroup";
import type { AppViewModel } from "./appViewModel";



export function renderGroup(model: AppViewModel, group: EditorGroup) {
  const {
    deferredEditorMounts,
    openingDocument,
    activeGroupId,
    mobileRuntime,
    project,
    courses,
    editingCourseItemId,
    workspaceMenuGroupId,
    layoutHistoryRef,
    layout,
    mobileCodeSearchRequestId,
    retryQAPreview,
    canStopQAAnswer,
    qaInteractionBusy,
    stopQAAnswer,
    returnToQASource,
    activeTermSource,
    highlights,
    knowledgeLinks,
    activeTermRawTerms,
    termDisplay,
    activeTermScanStatus,
    handleRescanCurrentDocumentTerms,
    selectionAnchor,
    qaHighlightDraft,
    callGuides,
    callGuideBusyId,
    knowledgeRefreshKey,
    learningStates,
    getActiveOpenItem,
    selectedQA,
    setActiveGroupId,
    setWorkspaceMenuGroupId,
    activateItem,
    closeItemInGroup,
    clearDropPreview,
    handleTabDragEnd,
    undoWorkspaceLayout,
    equalizeWorkspaceLayout,
    mergeWorkspaceGroups,
    closeWorkspaceGroup,
    setMobileCodeSearchRequestId,
    openCourseInActiveGroup,
    toggleLessonComplete,
    setEditingCourseItemId,
    saveEditedCourseItem,
    cancelEditedCourseItem,
    updateQAItemContent,
    handleSelection,
    updateQAWorkspaceSelection,
    setLayout,
    queueLearningUpdate,
    handleToggleFavorite,
    handleCreateHighlight,
    handleSaveQAItem,
    bumpPersonalizationRevision,
    handleOpenKnowledgeLink,
    handleOpenQAReference,
    handleGenerateTerm,
    handleTermAction,
    handleGenerateOutlineLesson,
    generationInstructions,
    handleCallGuideSelection,
    openFileInActiveGroup,
    handleExplainCallGuide,
    handleRefreshCallGuide,
    handleDeleteCallGuide,
    requestText,
    confirmAction,
    refreshCourses,
    refreshQAHistory,
    setKnowledgeRefreshKey,
    openQAById,
    setError,
    dropPreviewRef,
    showDropPreview,
    handleGroupDrop,
  } = model;

  const activeItem = group.items.find((item) => item.id === group.activeItemId) ?? null;
  const editorMountDeferred = activeItem ? deferredEditorMounts.has(`${group.id}:${activeItem.id}`) : false;
  return (
    <WorkbenchEditorGroup
      openingTitle={openingDocument?.groupId === group.id ? openingDocument.title : undefined}
      key={group.id}
      group={group}
      activeGroupId={activeGroupId}
      mobile={mobileRuntime}
      projectId={project?.id ?? null}
      courses={courses}
      editingCourseItemId={editingCourseItemId}
      editorMountDeferred={editorMountDeferred}
      workspaceMenuOpen={workspaceMenuGroupId === group.id}
      canUndoLayout={layoutHistoryRef.current.length > 0}
      canManageGroups={countGroups(layout) > 1}
      mobileCodeSearchRequestId={mobileCodeSearchRequestId}
      onRetryQAPreview={retryQAPreview}
      canStopQAPreview={canStopQAAnswer}
      qaBusy={qaInteractionBusy}
      onStopQAPreview={key => stopQAAnswer(key)}
      onReturnQASource={id => { void returnToQASource(id); }}
      activeTermSourceKey={activeTermSource ? `${activeTermSource.sourceType}:${activeTermSource.sourcePath}` : ""}
      highlights={highlights}
      knowledgeLinks={knowledgeLinks}
      documentTerms={activeTermRawTerms}
      visibleTermCandidateIds={termDisplay.visibleCandidateIds}
      termDisplayTiers={termDisplay.tiersByCandidateId}
      termScanStatus={group.id === activeGroupId ? activeTermScanStatus : null}
      onRescanTerms={handleRescanCurrentDocumentTerms}
      selectionAnchor={selectionAnchor}
      qaHighlightDraft={qaHighlightDraft}
      callGuides={callGuides}
      callGuideBusyId={callGuideBusyId}
      knowledgeRefreshKey={knowledgeRefreshKey}
      learningStates={learningStates}
      knowledgeFocusRef={(() => {
        const item = getActiveOpenItem();
        if (item && item.type !== "knowledge_graph") {
          if (item.qaRecordId) return { ref_type: "qa", ref_id: item.qaRecordId };
          if (item.type === "course") return { ref_type: "course", ref_path: item.path };
          if (item.type === "file") return { ref_type: "file", ref_path: item.path };
        }
        return selectedQA ? { ref_type: "qa", ref_id: selectedQA.id } : null;
      })()}
      isOutlineCourse={(path) => courses.some((course) => (
        course.filename === path
        && (course.is_outline || course.filename === "outline.md" || course.filename.startsWith("sub-outline-"))
      ))}
      onActivatePane={() => {
        setActiveGroupId(group.id);
        if (workspaceMenuGroupId) setWorkspaceMenuGroupId(null);
      }}
      onActivateItem={(item) => activateItem(group.id, item)}
      onCloseItem={(itemId) => closeItemInGroup(group.id, itemId)}
      onTabDragEnd={(event, item) => { clearDropPreview(); void handleTabDragEnd(event, group.id, item); }}
      onToggleWorkspaceMenu={() => setWorkspaceMenuGroupId((current) => current === group.id ? null : group.id)}
      onUndoLayout={undoWorkspaceLayout}
      onEqualize={equalizeWorkspaceLayout}
      onMergeGroups={() => mergeWorkspaceGroups(group.id)}
      onCloseGroup={() => closeWorkspaceGroup(group.id)}
      onMobileCodeSearch={() => setMobileCodeSearchRequestId((current) => current + 1)}
      onOpenCourse={(path) => { if (project) void openCourseInActiveGroup(project.id, path); }}
      onToggleLessonComplete={toggleLessonComplete}
      onSetEditingCourse={setEditingCourseItemId}
      onSaveEditedCourse={saveEditedCourseItem}
      onCancelEditedCourse={(targetGroup, item) => { void cancelEditedCourseItem(targetGroup, item); }}
      onUpdateItemContent={updateQAItemContent}
      onSelectionChange={handleSelection}
      onQASelectionChange={updateQAWorkspaceSelection}
      onCodeJumpConsumed={(itemId, requestId) => {
        setLayout((current) => updateEveryGroup(current, (editorGroup) => ({
          ...editorGroup,
          items: editorGroup.items.map((item) => (
            item.id === itemId && item.jumpRequest?.id === requestId
              ? { ...item, jumpRequest: undefined }
              : item
          )),
        })));
      }}
      onLearningPosition={(sourceType, path, positionKind, value) => queueLearningUpdate(sourceType, path, positionKind, value)}
      onToggleFavorite={(item) => { void handleToggleFavorite(item); }}
      onCreateHighlight={(sourceType, sourcePath, selectedText) => { void handleCreateHighlight(sourceType, sourcePath, selectedText); }}
      onSaveQA={handleSaveQAItem}
      onPersonalizationChanged={bumpPersonalizationRevision}
      onOpenKnowledgeLink={(term, links) => { void handleOpenKnowledgeLink(term, links); }}
      onOpenQAReference={(referenceProjectId, qaRecordId) => { void handleOpenQAReference(referenceProjectId, qaRecordId); }}
      onGenerateTerm={handleGenerateTerm}
      onTermAction={handleTermAction}
      onGenerateLesson={(lessonNumber, title, outlinePath) => { void handleGenerateOutlineLesson(lessonNumber, title, generationInstructions, outlinePath); }}
      onCallGuideSelection={(guide, nodeId, visitedNodeIds) => { void handleCallGuideSelection(guide, nodeId, visitedNodeIds); }}
      onOpenCallGuideSource={(node) => { if (project) void openFileInActiveGroup(project.id, node.path, node.start_line); }}
      onExplainCallGuide={(guide, node, routeNodeIds) => { void handleExplainCallGuide(guide, node, routeNodeIds); }}
      onRefreshCallGuide={(guide) => { void handleRefreshCallGuide(guide); }}
      onDeleteCallGuide={(guide) => { void handleDeleteCallGuide(guide); }}
      onRequestText={requestText}
      onConfirm={confirmAction}
      onKnowledgeContentChanged={() => {
        if (!project) return;
        void Promise.all([refreshCourses(project.id), refreshQAHistory(project.id)]);
      }}
      onKnowledgeGraphChanged={() => setKnowledgeRefreshKey((value) => value + 1)}
      onOpenKnowledgeQA={(qaId) => { void openQAById(qaId).catch((caught) => setError(caught instanceof Error ? caught.message : "打开回答失败")); }}
      onOpenKnowledgeCourse={(path) => { if (project) void openCourseInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开课件失败")); }}
      onOpenKnowledgeFile={(path) => { if (project) void openFileInActiveGroup(project.id, path).catch((caught) => setError(caught instanceof Error ? caught.message : "打开文件失败")); }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const previousZone = dropPreviewRef.current?.groupId === group.id
          ? dropPreviewRef.current.zone
          : undefined;
        const zone = detectDropZone(event, previousZone);
        showDropPreview(event.currentTarget, group.id, zone);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          if (dropPreviewRef.current?.groupId === group.id) clearDropPreview();
        }
      }}
      onDrop={(event) => handleGroupDrop(event, group.id)}
    />
  );

}
