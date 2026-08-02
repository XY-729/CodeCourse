import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getDocumentTermStatus,
  getTermDisplayProfiles,
  listDocumentTerms,
  rescanDocumentTerms,
  type DocumentTerm,
  type TermScanStatus,
} from "../api/client";
import { useTermDisplay, type TermDisplayDiagnostics } from "./useTermDisplay";

type SourceType = "course" | "qa";

type Params = {
  projectId: number | null;
  sourceType: SourceType | null;
  sourcePath: string;
  content: string;
  terminologyDensity: number;
  profileRevision: number;
  onError?: (message: string) => void;
};

function sourceKey(sourceType: SourceType, sourcePath: string): string {
  return `${sourceType}:${sourcePath}`;
}

export function shouldPollTermScan(status: TermScanStatus | null | undefined): boolean {
  return Boolean(status && ["idle", "queued", "running"].includes(status.scan_status));
}

export type DocumentTermsController = {
  rawTerms: DocumentTerm[];
  scanStatus: TermScanStatus | null;
  display: ReturnType<typeof useTermDisplay>;
  refreshDocumentTerms: (sourceType: SourceType, sourcePath: string, projectId?: number | null) => Promise<void>;
  rescanActiveDocumentTerms: () => Promise<void>;
};

export function useDocumentTermsController(params: Params): DocumentTermsController {
  const {
    projectId,
    sourceType,
    sourcePath,
    content,
    terminologyDensity,
    profileRevision,
    onError,
  } = params;
  const [termsBySource, setTermsBySource] = useState<Record<string, DocumentTerm[]>>({});
  const [statusBySource, setStatusBySource] = useState<Record<string, TermScanStatus>>({});
  const activeRequestRef = useRef(new Map<string, number>());
  const pollTimerRef = useRef<number | null>(null);

  const refreshDocumentTerms = useCallback(async (
    nextSourceType: SourceType,
    nextSourcePath: string,
    overrideProjectId: number | null = projectId,
  ) => {
    if (!overrideProjectId || !nextSourcePath) return;
    const key = sourceKey(nextSourceType, nextSourcePath);
    const requestId = (activeRequestRef.current.get(key) ?? 0) + 1;
    activeRequestRef.current.set(key, requestId);
    try {
      const terms = await listDocumentTerms(overrideProjectId, nextSourceType, nextSourcePath);
      const status = await getDocumentTermStatus(overrideProjectId, nextSourceType, nextSourcePath);
      if (activeRequestRef.current.get(key) !== requestId) return;
      setTermsBySource((current) => ({ ...current, [key]: terms }));
      setStatusBySource((current) => ({ ...current, [key]: status }));
    } catch (error) {
      onError?.(error instanceof Error ? error.message : "加载陌生术语失败");
    }
  }, [onError, projectId]);

  const activeKey = sourceType && sourcePath ? sourceKey(sourceType, sourcePath) : "";
  const rawTerms = activeKey ? termsBySource[activeKey] ?? [] : [];
  const scanStatus = activeKey ? statusBySource[activeKey] ?? null : null;
  const display = useTermDisplay({
    projectId,
    sourceKey: activeKey,
    content,
    rawTerms,
    terminologyDensity,
    profileRevision,
    loadProfiles: getTermDisplayProfiles,
  });

  useEffect(() => {
    if (!projectId || !sourceType || !sourcePath) return;
    void refreshDocumentTerms(sourceType, sourcePath, projectId);
  }, [projectId, sourceType, sourcePath, refreshDocumentTerms]);

  useEffect(() => {
    if (pollTimerRef.current != null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (!projectId || !sourceType || !sourcePath || !shouldPollTermScan(scanStatus)) return;
    pollTimerRef.current = window.setTimeout(() => {
      pollTimerRef.current = null;
      void refreshDocumentTerms(sourceType, sourcePath, projectId);
    }, display.diagnostics.visibleCount > 0 ? 3200 : 1600);
    return () => {
      if (pollTimerRef.current != null) window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [display.diagnostics.visibleCount, projectId, refreshDocumentTerms, scanStatus, sourcePath, sourceType]);

  const rescanActiveDocumentTerms = useCallback(async () => {
    if (!projectId || !sourceType || !sourcePath) return;
    const status = await rescanDocumentTerms(projectId, sourceType, sourcePath);
    setStatusBySource((current) => ({ ...current, [sourceKey(sourceType, sourcePath)]: status }));
    await refreshDocumentTerms(sourceType, sourcePath, projectId);
  }, [projectId, refreshDocumentTerms, sourcePath, sourceType]);

  return useMemo(() => ({
    rawTerms,
    scanStatus,
    display,
    refreshDocumentTerms,
    rescanActiveDocumentTerms,
  }), [display, rawTerms, refreshDocumentTerms, rescanActiveDocumentTerms, scanStatus]);
}

export type { TermDisplayDiagnostics };
