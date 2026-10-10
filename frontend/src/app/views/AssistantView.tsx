import ExplainPanel from "../../features/assistant/ExplainPanel";
import { requestConversationLabel } from "../qaConversation";
import type { AppViewModel } from "./appViewModel";
import { renderKnowledgeGraph } from "./KnowledgeView";


export function renderAssistantPanel(model: AppViewModel) {
  const {
    qaUpperTab,
    project,
    includeContext,
    setIncludeContext,
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
    mobileRuntime,
    visibleQAGeneration,
    qaHistory,
    qaThreads,
    qaContinuity,
    qaHistoryQuery,
    qaFavoriteOnly,
    selectedQA,
    qaFollowUpTarget,
    activeQASessionId,
    canStopQAAnswer,
    stopQAAnswer,
    returnToQASource,
    dynamicSurvey,
    diagnosticItem,
    diagnosticResult,
    llmSettings,
    qaPanelError,
    setQAUpperTab,
    handleQAQuestionChange,
    handleSelectionTextChange,
    handleClearSelection,
    handleAsk,
    handleNewConversation,
    setQAHistoryQuery,
    setQAFavoriteOnly,
    setSelectedQA,
    setQAFollowUpRecord,
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
    handleDynamicSurveyAnswer,
    handleDynamicSurveyDismiss,
    handleDisableDynamicSurveys,
    handleDiagnosticAnswer,
    handleDiagnosticDismiss,
    handleDiagnosticFlag,
    setAssistantOpen,
  } = model;

  const showKnowledgeGraph = qaUpperTab === "knowledge" && Boolean(project);
  return (
    <ExplainPanel
      includeContext={includeContext}
      onIncludeContextChange={setIncludeContext}
      selection={selection}
      contextSummary={assistantContextSummary}
      contextFiles={contextFiles}
      onOpenFilePicker={() => { setFilePickerPurpose("context"); setContextFilePickerOpen(true); }}
      onRemoveContextFile={(path) => setContextFiles((current) => current.filter((item) => item !== path))}
      question={qaQuestionInput}
      questionInput={qaQuestionInput}
      resetToken={qaResetToken}
      loading={qaInteractionBusy}
      loadingLabel={qaBusyLabel}
      streamContent={mobileRuntime ? visibleQAGeneration?.partial : undefined}
      history={qaHistory}
      threads={qaThreads}
      continuity={qaContinuity}
      historyQuery={qaHistoryQuery}
      favoriteOnly={qaFavoriteOnly}
      selectedRecord={selectedQA}
      followUpRecord={qaFollowUpTarget}
      conversationActive={Boolean(activeQASessionId)}
      conversationLabel={qaInteractionBusy && visibleQAGeneration?.request ? requestConversationLabel(visibleQAGeneration.request, qaHistory) : undefined}
      canStopAnswer={canStopQAAnswer}
      onStopAnswer={() => stopQAAnswer()}
      onReturnToSource={record => { void returnToQASource(record); }}
      selectedRecordReadOnly={Boolean(selectedQA && project && selectedQA.project_id !== project.id)}
      surveyCandidate={dynamicSurvey}
      diagnosticItem={diagnosticItem}
      diagnosticResult={diagnosticResult}
      settings={llmSettings}
      panelError={qaPanelError}
      upperTab={qaUpperTab}
      onUpperTabChange={setQAUpperTab}
      knowledgeDisabled={!project}
      knowledgeContent={showKnowledgeGraph ? renderKnowledgeGraph(model) : null}
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
      onAnswerSurvey={(choice) => { void handleDynamicSurveyAnswer(choice); }}
      onDismissSurvey={() => { void handleDynamicSurveyDismiss(); }}
      onDisableSurveys={() => { void handleDisableDynamicSurveys(); }}
      onAnswerDiagnostic={(answer) => { void handleDiagnosticAnswer(answer); }}
      onDismissDiagnostic={() => { void handleDiagnosticDismiss(); }}
      onFlagDiagnostic={() => { void handleDiagnosticFlag(); }}
      onClose={() => setAssistantOpen(false)}
    />
  );

}
