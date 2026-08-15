type DesktopMetricDetail = Record<string, string | number | boolean | null | undefined>;

const startedAt = typeof performance === "undefined" ? 0 : performance.now();

export function markDesktopPerformance(name: string, detail: DesktopMetricDetail = {}) {
  if (document.documentElement.classList.contains("platform-android")) return;
  const elapsedMs = typeof performance === "undefined" ? 0 : Math.round(performance.now() - startedAt);
  performance.mark?.(`codecourse:${name}`);
  void window.codecourseDesktop?.reportDiagnostic?.({
    type: "performance",
    name,
    elapsed_ms: elapsedMs,
    ...detail,
  });
}

export function measureDesktopInteraction(name: string, started: number, detail: DesktopMetricDetail = {}) {
  markDesktopPerformance(name, {
    duration_ms: Math.max(0, Math.round(performance.now() - started)),
    ...detail,
  });
}
