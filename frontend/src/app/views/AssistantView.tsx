import ExplainPanel from "../../features/assistant/ExplainPanel";
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
    qaFollowUpRecord,
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
      followUpRecord={qaFollowUpRecord}
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
      onSelectRecord={(record) => { setSelectedQA(record); setQASessionId(record.session_id ?? null); }}
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
