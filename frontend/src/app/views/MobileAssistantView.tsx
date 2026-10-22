import { lazy } from "react";
import { requestConversationLabel } from "../qaConversation";
import type { AppViewModel } from "./appViewModel";
import { renderKnowledgeGraph } from "./KnowledgeView";
const MobileAssistantPanel = lazy(() => import("../../features/assistant/mobile/MobileAssistantPanel"));

export function renderMobileAssistantPanel(model: AppViewModel) {
  const {
    includeContext, setIncludeContext, activeQASessionId, canStopQAAnswer, stopQAAnswer, returnToQASource, qaFollowUpTarget, setQAFollowUpRecord,
    mobileAssistantView,
    setMobileAssistantView,
    selection,
    assistantContextSummary,
    contextFiles,
    setFilePickerPurpose,
    setContextFilePickerOpen,
    setContextFiles,
    qaQuestionInput,
    qaResetToken,
    qaInteractionBusy,
    qaBusyLabel,
    visibleQAGeneration,
    qaHistory,
    qaHistoryLoading,
    qaHistoryError,
    refreshQAHistory,
    qaThreads,
    qaContinuity,
    qaHistoryQuery,
    qaFavoriteOnly,
    selectedQA,
    project,
    llmSettings,
    qaPanelError,
    mobileWorkspaceMotionRef,
    handleQAQuestionChange,
    handleSelectionTextChange,
    handleClearSelection,
    handleAsk,
    handleNewConversation,
    setQAHistoryQuery,
    setQAFavoriteOnly,
    setSelectedQA,
    setQASessionId,
    handleFollowUp,
    openQAInActiveGroup,
    handleDeleteQA,
    handleRenameQA,
    handleToggleFavorite,
    handleResumeContinuity,
    handleOpenContinuitySource,
    handleDismissContinuity,
    handleTeachingNextAction,
    openSettings,
  } = model;

  return (
    <MobileAssistantPanel
      includeContext={includeContext}
      onIncludeContextChange={setIncludeContext}
      conversationActive={Boolean(activeQASessionId)}
      conversationLabel={qaInteractionBusy && visibleQAGeneration?.request ? requestConversationLabel(visibleQAGeneration.request, qaHistory) : undefined}
      canStopAnswer={canStopQAAnswer}
      onStopAnswer={() => stopQAAnswer()}
      onReturnToSource={record => { void returnToQASource(record); }}
      view={mobileAssistantView}
      onViewChange={setMobileAssistantView}
      selection={selection}
      contextSummary={assistantContextSummary}
      contextFiles={contextFiles}
      onOpenFilePicker={() => { setFilePickerPurpose("context"); setContextFilePickerOpen(true); }}
      onRemoveContextFile={(path) => setContextFiles((current) => current.filter((item) => item !== path))}
      question={qaQuestionInput}
      resetToken={qaResetToken}
      loading={qaInteractionBusy}
      loadingLabel={qaBusyLabel}
      streamContent={visibleQAGeneration?.partial}
      history={qaHistory}
      historyLoading={qaHistoryLoading}
      historyError={qaHistoryError}
      onRetryHistory={() => { void refreshQAHistory(); }}
      threads={qaThreads}
      continuity={qaContinuity}
      historyQuery={qaHistoryQuery}
      favoriteOnly={qaFavoriteOnly}
      selectedRecord={selectedQA}
      followUpRecord={qaFollowUpTarget}
      selectedRecordReadOnly={Boolean(selectedQA && project && selectedQA.project_id !== project.id)}
      settings={llmSettings}
      panelError={qaPanelError}
      knowledgeDisabled={!project}
      knowledgeContent={mobileAssistantView === "knowledge" && mobileWorkspaceMotionRef.current === "open" && project ? renderKnowledgeGraph(model) : null}
      onQuestionChange={handleQAQuestionChange}
      onSelectionTextChange={handleSelectionTextChange}
      onClearSelection={handleClearSelection}
      onAsk={handleAsk}
      onNewConversation={handleNewConversation}
      onHistoryQueryChange={setQAHistoryQuery}
      onFavoriteOnlyChange={setQAFavoriteOnly}
      onSelectRecord={(record) => { setSelectedQA(record); setQAFollowUpRecord(null); setQASessionId(record.session_id ?? null); }}
      onFollowUp={handleFollowUp}
      onOpenRecord={(record) => { void openQAInActiveGroup(record); }}
      onDeleteRecord={handleDeleteQA}
      onRenameRecord={handleRenameQA}
      onToggleFavorite={handleToggleFavorite}
      onResumeContinuity={(handoff) => { void handleResumeContinuity(handoff); }}
      onOpenContinuitySource={(handoff) => { void handleOpenContinuitySource(handoff); }}
      onDismissContinuity={(handoff) => { void handleDismissContinuity(handoff); }}
      onTeachingNextAction={handleTeachingNextAction}
      onOpenSettings={openSettings}
    />
  );

}
