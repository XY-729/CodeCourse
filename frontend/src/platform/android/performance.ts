export type AndroidPerformanceMode = "full" | "reduced";

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

const LONG_TASK_LIMIT = 3;
const LONG_TASK_WINDOW_MS = 8_000;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function initialMode(): AndroidPerformanceMode {
  const navigatorWithMemory = navigator as NavigatorWithMemory;
  const lowCpu = typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;
  const lowMemory = typeof navigatorWithMemory.deviceMemory === "number" && navigatorWithMemory.deviceMemory <= 4;
  return prefersReducedMotion() || lowCpu || lowMemory ? "reduced" : "full";
}

function applyMode(mode: AndroidPerformanceMode): void {
  document.documentElement.dataset.androidPerformance = mode;
  document.documentElement.classList.toggle("android-reduced-effects", mode === "reduced");
}

export function markAndroidPerformance(name: string): void {
  performance.mark?.(`codecourse:${name}`);
}

export function initializeAndroidPerformanceMode(): () => void {
  applyMode(initialMode());
  if (!("PerformanceObserver" in window) || prefersReducedMotion()) return () => undefined;

  const longTasks: number[] = [];
  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => {
      const now = performance.now();
      for (const entry of list.getEntries()) {
        if (entry.duration >= 50) longTasks.push(now);
      }
      while (longTasks.length && now - longTasks[0] > LONG_TASK_WINDOW_MS) longTasks.shift();
      if (longTasks.length >= LONG_TASK_LIMIT) applyMode("reduced");
    });
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    observer = null;
  }
  return () => observer?.disconnect();
}

export function scheduleAfterInteractiveFrame(task: () => void): () => void {
  let cancelled = false;
  let idleId: number | null = null;
  const frameIds: number[] = [];
  const firstFrame = window.requestAnimationFrame(() => {
    const secondFrame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const requestIdle = window.requestIdleCallback;
      if (requestIdle) {
        idleId = requestIdle(() => !cancelled && task(), { timeout: 350 });
      } else {
        window.setTimeout(() => !cancelled && task(), 0);
      }
    });
    frameIds.push(secondFrame);
  });
  frameIds.push(firstFrame);
  return () => {
    cancelled = true;
    for (const frame of frameIds) window.cancelAnimationFrame(frame);
    if (idleId !== null) window.cancelIdleCallback?.(idleId);
  };
}
