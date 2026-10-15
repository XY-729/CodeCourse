import { useCallback, useEffect, useRef, useState } from "react";
import { listQARecords, type QARecord } from "../api/client";

type Criteria = { projectId: number | null; query: string; favoriteOnly: boolean };

export function useQAHistory(criteria: Criteria) {
  const [qaHistory, setQAHistory] = useState<QARecord[]>([]);
  const [qaHistoryLoading, setLoading] = useState(false);
  const [qaHistoryError, setError] = useState("");
  const current = useRef(criteria);
  current.current = criteria;
  const sequence = useRef(0);

  // Background callbacks can outlive the render that created them. Always use
  // the current filters and accept only the latest request for that scope.
  const refreshQAHistory = useCallback(async (projectId = current.current.projectId) => {
    const scope = current.current;
    if (!projectId || projectId !== scope.projectId) return;
    const request = ++sequence.current;
    const isCurrent = () => request === sequence.current
      && current.current.projectId === projectId
      && current.current.query === scope.query
      && current.current.favoriteOnly === scope.favoriteOnly;
    setLoading(true);
    setError("");
    try {
      const records = await listQARecords(projectId, scope.query, scope.favoriteOnly ? true : undefined);
      if (isCurrent()) setQAHistory(records);
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : "加载历史失败");
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setQAHistory([]);
    setError("");
  }, [criteria.projectId]);

  useEffect(() => {
    setLoading(Boolean(criteria.projectId));
    setError("");
    const timer = window.setTimeout(() => { void refreshQAHistory(); }, 180);
    return () => {
      window.clearTimeout(timer);
      sequence.current += 1;
    };
  }, [criteria.projectId, criteria.query, criteria.favoriteOnly, refreshQAHistory]);

  return { qaHistory, setQAHistory, qaHistoryLoading, qaHistoryError, refreshQAHistory };
}
