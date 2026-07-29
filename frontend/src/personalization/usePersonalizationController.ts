import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerDiagnostic,
  answerDynamicSurvey,
  dismissDiagnostic,
  dismissDynamicSurvey,
  flagDiagnostic,
  getPendingDiagnostic,
  getPersonalizationProfile,
  updateLearnerPreferences,
} from "../api/client";
import type { DiagnosticItem, DynamicSurveyCandidate } from "../api/client";

type Options = {
  projectId: number | null;
  onError: (message: string) => void;
  onToast: (message: string) => void;
};

export function usePersonalizationController({
  projectId,
  onError,
  onToast,
}: Options) {
  const [revision, setRevision] = useState(0);
  const [surveyCandidate, setSurveyCandidate] = useState<DynamicSurveyCandidate | null>(null);
  const [diagnosticItem, setDiagnosticItem] = useState<DiagnosticItem | null>(null);
  const [diagnosticResult, setDiagnosticResult] = useState<boolean | null>(null);
  const refreshTimersRef = useRef<number[]>([]);

  const clearScheduledRefreshes = useCallback(() => {
    for (const timer of refreshTimersRef.current) window.clearTimeout(timer);
    refreshTimersRef.current = [];
  }, []);

  const bumpRevision = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setSurveyCandidate(null);
      setDiagnosticItem(null);
      setDiagnosticResult(null);
      return;
    }
    try {
      const [profile, diagnostic] = await Promise.all([
        getPersonalizationProfile(projectId),
        getPendingDiagnostic(projectId),
      ]);
      setSurveyCandidate(profile.surveyCandidate ?? null);
      setDiagnosticItem(diagnostic.item);
      setDiagnosticResult(null);
    } catch {
      setSurveyCandidate(null);
      setDiagnosticItem(null);
    }
  }, [projectId]);

  const scheduleRefresh = useCallback(() => {
    if (!projectId) return;
    clearScheduledRefreshes();
    refreshTimersRef.current = [1800, 5000, 10_000].map((delay) => window.setTimeout(() => {
      void refresh();
    }, delay));
  }, [clearScheduledRefreshes, projectId, refresh]);

  const answerSurvey = useCallback(async (choice: string) => {
    if (!projectId || !surveyCandidate) return;
    try {
      await answerDynamicSurvey(projectId, surveyCandidate.id, choice);
      setSurveyCandidate(null);
      bumpRevision();
    } catch (error) {
      onError(error instanceof Error ? error.message : "保存风格选择失败");
    }
  }, [bumpRevision, onError, projectId, surveyCandidate]);

  const dismissSurvey = useCallback(async () => {
    if (!projectId || !surveyCandidate) return;
    await dismissDynamicSurvey(projectId, surveyCandidate.id).catch(() => undefined);
    setSurveyCandidate(null);
  }, [projectId, surveyCandidate]);

  const disableSurveys = useCallback(async () => {
    if (!projectId) return;
    if (surveyCandidate) {
      await dismissDynamicSurvey(projectId, surveyCandidate.id).catch(() => undefined);
    }
    try {
      await updateLearnerPreferences(projectId, {
        survey_enabled: false,
        scope: "global",
      });
      setSurveyCandidate(null);
      onToast("已关闭风格选择题，可在设置中重新开启");
    } catch (error) {
      onError(error instanceof Error ? error.message : "关闭风格选择题失败");
    }
  }, [onError, onToast, projectId, surveyCandidate]);

  const submitDiagnostic = useCallback(async (answer: unknown) => {
    if (!projectId || !diagnosticItem) return;
    try {
      const result = await answerDiagnostic(projectId, diagnosticItem.id, answer);
      setDiagnosticResult(result.correct);
      bumpRevision();
    } catch (error) {
      onError(error instanceof Error ? error.message : "提交理解检查失败");
    }
  }, [bumpRevision, diagnosticItem, onError, projectId]);

  const dismissCurrentDiagnostic = useCallback(async () => {
    if (!projectId || !diagnosticItem) return;
    await dismissDiagnostic(projectId, diagnosticItem.id).catch(() => undefined);
    setDiagnosticItem(null);
    setDiagnosticResult(null);
  }, [diagnosticItem, projectId]);

  const flagCurrentDiagnostic = useCallback(async () => {
    if (!projectId || !diagnosticItem) return;
    try {
      await flagDiagnostic(projectId, diagnosticItem.id);
      setDiagnosticItem(null);
      setDiagnosticResult(null);
      bumpRevision();
      onToast("已撤销这道题产生的学习证据");
    } catch (error) {
      onError(error instanceof Error ? error.message : "撤销理解检查失败");
    }
  }, [bumpRevision, diagnosticItem, onError, onToast, projectId]);

  useEffect(() => {
    clearScheduledRefreshes();
    setSurveyCandidate(null);
    setDiagnosticItem(null);
    setDiagnosticResult(null);
    void refresh();
    return clearScheduledRefreshes;
  }, [clearScheduledRefreshes, projectId, refresh]);

  return {
    revision,
    bumpRevision,
    surveyCandidate,
    diagnosticItem,
    diagnosticResult,
    refresh,
    scheduleRefresh,
    answerSurvey,
    dismissSurvey,
    disableSurveys,
    submitDiagnostic,
    dismissDiagnostic: dismissCurrentDiagnostic,
    flagDiagnostic: flagCurrentDiagnostic,
  };
}
