import { useCallback, useState } from "react";

type Options = { projectId: number | null };

/** Refreshes authoritative knowledge readers after an explicit learning action. */
export function usePersonalizationController({ projectId }: Options) {
  const [revision, setRevision] = useState(0);
  const bumpRevision = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);
  const scheduleRefresh = useCallback(() => {
    if (projectId != null) bumpRevision();
  }, [bumpRevision, projectId]);

  return { revision, bumpRevision, scheduleRefresh };
}
