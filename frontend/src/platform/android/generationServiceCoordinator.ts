import type {
  ForegroundTaskSwitchResult,
  GenerationServiceState,
  SetGenerationActiveOptions,
} from "../runtime";
import { shouldSendProgress, type ServiceState } from "./generationState";

export type ProgressSnapshot = {
  stageLabel: string;
  current: number;
  total: number;
  indeterminate: boolean;
};

type LastSentSnapshot = {
  stageLabel: string;
  percent: number | null;
  indeterminate: boolean;
  sentAt: number;
};

export type GenerationTaskRegistration = {
  taskId: number;
  startedAt: number;
  projectId: number;
  taskType: string;
  projectName: string;
  sourcePath: string | null;
};

type CoordinatedTask = GenerationTaskRegistration & {
  sequence: number;
  latest: ProgressSnapshot;
  lastSent: LastSentSnapshot | null;
  progressFailures: number;
};

export type GenerationNativeBridge = {
  setGenerationActive(options: SetGenerationActiveOptions): Promise<void>;
  getGenerationServiceState(): Promise<GenerationServiceState>;
  switchForegroundTask(options: { sessionId: number; taskId: number }): Promise<ForegroundTaskSwitchResult>;
  updateGenerationProgress(options: {
    sessionId: number;
    taskId: number;
    sequence: number;
    current: number;
    total: number;
    indeterminate?: boolean;
    stageLabel?: string;
    activeTaskCount?: number;
  }): Promise<void>;
  updateGenerationHeartbeat(options: {
    sessionId: number;
    taskId: number;
    stageLabel?: string;
  }): Promise<void>;
  hasGenerationPendingProgress(): Promise<{ pending: boolean }>;
};

type CoordinatorOptions = {
  readyTimeoutMs?: number;
  readyPollMs?: number;
  stopAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  logger?: Pick<Console, "warn" | "error">;
};

/**
 * Owns the Android foreground Service lifecycle for all generation tasks.
 * The provider registers work and reports snapshots; this coordinator alone
 * starts, switches, reconciles and stops the native Service.
 */
export class GenerationServiceCoordinator {
  private readonly tasks = new Map<number, CoordinatedTask>();
  private state: ServiceState = "stopped";
  private mutex: Promise<void> = Promise.resolve();
  private generationSessionId = 0;
  private foregroundTaskId = 0;
  private readonly readyTimeoutMs: number;
  private readonly readyPollMs: number;
  private readonly stopAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly logger: Pick<Console, "warn" | "error">;

  constructor(
    private readonly native: GenerationNativeBridge,
    options: CoordinatorOptions = {},
  ) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? 2000;
    this.readyPollMs = options.readyPollMs ?? 80;
    this.stopAttempts = options.stopAttempts ?? 3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? console;
  }

  registerTask(task: GenerationTaskRegistration): void {
    this.tasks.set(task.taskId, {
      ...task,
      sequence: 0,
      latest: { stageLabel: "preparing", current: 0, total: 1, indeterminate: true },
      lastSent: null,
      progressFailures: 0,
    });
  }

  unregisterTask(taskId: number): void {
    this.tasks.delete(taskId);
  }

  hasTask(taskId: number): boolean {
    return this.tasks.has(taskId);
  }

  snapshot() {
    return {
      state: this.state,
      sessionId: this.generationSessionId,
      foregroundTaskId: this.foregroundTaskId,
      activeTaskCount: this.tasks.size,
    };
  }

  async sync(): Promise<void> {
    return this.serialize(() => this.reconcileUnsafe());
  }

  async reconcile(): Promise<void> {
    return this.serialize(() => this.reconcileUnsafe());
  }

  async reportProgress(taskId: number, snapshot: ProgressSnapshot): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.latest = snapshot;
    if (taskId !== this.foregroundTaskId || this.state !== "running") return;
    await this.sendSnapshot(task, false, true);
  }

  /**
   * Keep-alive tick while a task is mid-LLM-call. Refreshes the native
   * notification text so it stays visibly alive even when the throttled
   * progress path has nothing new to say.
   */
  async heartbeat(taskId: number, stageLabel: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || taskId !== this.foregroundTaskId || this.state !== "running") return;
    await this.native.updateGenerationHeartbeat({
      sessionId: this.generationSessionId,
      taskId,
      stageLabel,
    });
  }

  /** True while the native Service is active but accepted no progress yet. */
  async hasPendingProgress(): Promise<boolean> {
    try {
      const state = await this.native.hasGenerationPendingProgress();
      return Boolean(state?.pending);
    } catch {
      return false;
    }
  }

  /**
   * Mark the notification as "paused" while the app was backgrounded and JS
   * could not make progress (renderer suspended). Re-sends the same start
   * payload with an honest label; the native side refreshes the text.
   */
  async heartbeatPaused(): Promise<void> {
    if (this.state !== "running" || this.foregroundTaskId <= 0) return;
    const task = this.tasks.get(this.foregroundTaskId);
    if (!task) return;
    try {
      await this.native.setGenerationActive({
        active: true,
        label: "应用在后台挂起，回到应用后继续生成",
        sessionId: this.generationSessionId,
        taskId: this.foregroundTaskId,
        activeTaskCount: this.tasks.size,
      });
    } catch (error) {
      this.logger.warn("Generation paused heartbeat failed", error);
    }
  }

  private async serialize(operation: () => Promise<void>): Promise<void> {
    const run = this.mutex.then(operation, operation);
    this.mutex = run.catch(() => undefined);
    return run;
  }

  private async reconcileUnsafe(): Promise<void> {
    let nativeState: GenerationServiceState | null = null;
    try {
      nativeState = await this.native.getGenerationServiceState();
    } catch (error) {
      this.state = "unknown";
      this.logger.warn("Unable to query generation Service state", error);
    }

    if (this.tasks.size === 0) {
      if (nativeState?.active || this.state !== "stopped") {
        await this.stopAndVerify();
      } else {
        this.state = "stopped";
        this.foregroundTaskId = 0;
      }
      return;
    }

    const bestTaskId = this.pickForegroundTask();
    if (bestTaskId <= 0) return;

    if (
      nativeState?.active
      && nativeState.sessionId === this.generationSessionId
      && nativeState.taskId > 0
    ) {
      this.state = "running";
      this.foregroundTaskId = nativeState.taskId;
      if (bestTaskId !== nativeState.taskId) {
        await this.switchForegroundTask(bestTaskId);
      }
      return;
    }

    await this.startAndVerify(bestTaskId);
  }

  private async startAndVerify(taskId: number): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.state = "starting";
    const sessionId = Math.max(1, this.generationSessionId + 1);
    try {
      await this.native.setGenerationActive({
        active: true,
        label: task.projectName || "正在生成学习内容",
        sessionId,
        taskId,
        activeTaskCount: this.tasks.size,
      });
      const ready = await this.waitForReady(sessionId, taskId);
      if (!ready) {
        this.state = "failed";
        throw new Error(`Generation Service did not become ready for ${sessionId}:${taskId}`);
      }
      this.generationSessionId = sessionId;
      this.foregroundTaskId = taskId;
      this.state = "running";
      task.sequence = 0;
      task.lastSent = null;
      task.progressFailures = 0;
      await this.sendSnapshot(task, true, false);
    } catch (error) {
      this.state = "failed";
      this.logger.error("Failed to start generation Service", error);
      throw error;
    }
  }

  private async switchForegroundTask(taskId: number): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const result = await this.native.switchForegroundTask({
      sessionId: this.generationSessionId,
      taskId,
    });
    let confirmed = result.switched
      && result.sessionId === this.generationSessionId
      && result.taskId === taskId;
    if (!confirmed) {
      const state = await this.native.getGenerationServiceState();
      confirmed = state.active
        && state.sessionId === this.generationSessionId
        && state.taskId === taskId;
    }
    if (!confirmed) {
      throw new Error(`Native foreground task switch rejected for task ${taskId}`);
    }

    // Local ownership moves only after native confirmation.
    this.foregroundTaskId = taskId;
    task.sequence = 0;
    task.lastSent = null;
    task.progressFailures = 0;
    await this.sendSnapshot(task, true, false);
  }

  private async stopAndVerify(): Promise<void> {
    this.state = "stopping";
    for (let attempt = 0; attempt < this.stopAttempts; attempt += 1) {
      try {
        await this.native.setGenerationActive({ active: false });
        const nativeState = await this.native.getGenerationServiceState();
        if (!nativeState.active) {
          this.state = "stopped";
          this.generationSessionId += 1;
          this.foregroundTaskId = 0;
          return;
        }
      } catch (error) {
        this.logger.warn(`Generation Service stop attempt ${attempt + 1} failed`, error);
      }
      if (attempt + 1 < this.stopAttempts) {
        await this.sleep((attempt + 1) * 150);
      }
    }
    // Keep session/task ownership intact until native inactivity is confirmed.
    this.state = "unknown";
    throw new Error("Generation Service remained active after bounded stop attempts");
  }

  private async waitForReady(sessionId: number, taskId: number): Promise<boolean> {
    const deadline = this.now() + this.readyTimeoutMs;
    do {
      try {
        const state = await this.native.getGenerationServiceState();
        if (state.active && state.sessionId === sessionId && state.taskId === taskId) return true;
      } catch {
        // A transient query failure is retried until the bounded deadline.
      }
      await this.sleep(this.readyPollMs);
    } while (this.now() < deadline);
    return false;
  }

  private pickForegroundTask(): number {
    let earliestId = 0;
    let earliestTime = Number.POSITIVE_INFINITY;
    for (const task of this.tasks.values()) {
      if (task.startedAt < earliestTime) {
        earliestTime = task.startedAt;
        earliestId = task.taskId;
      }
    }
    return earliestId;
  }

  private async sendSnapshot(
    task: CoordinatedTask,
    force: boolean,
    reconcileAfterRepeatedFailure: boolean,
  ): Promise<void> {
    const snapshot = task.latest;
    const now = this.now();
    const percent = !snapshot.indeterminate && snapshot.total > 0
      ? Math.round((snapshot.current * 100) / snapshot.total)
      : null;
    const firstUpdate = task.lastSent === null;
    const labelChanged = task.lastSent !== null && snapshot.stageLabel !== task.lastSent.stageLabel;
    const indeterminateChanged = task.lastSent !== null
      && snapshot.indeterminate !== task.lastSent.indeterminate;
    const complete = !snapshot.indeterminate
      && snapshot.total > 0
      && snapshot.current >= snapshot.total;
    const stale = task.lastSent !== null && now - task.lastSent.sentAt > 1500;
    const enoughProgress = percent !== null
      && task.lastSent?.percent !== null
      && task.lastSent?.percent !== undefined
      && Math.abs(percent - task.lastSent.percent) >= 1;
    if (!force && !shouldSendProgress(
      firstUpdate,
      labelChanged,
      indeterminateChanged,
      complete,
      stale,
      enoughProgress,
    )) return;

    const sequence = task.sequence + 1;
    try {
      await this.native.updateGenerationProgress({
        sessionId: this.generationSessionId,
        taskId: task.taskId,
        sequence,
        current: snapshot.current,
        total: snapshot.total,
        indeterminate: snapshot.indeterminate,
        stageLabel: snapshot.stageLabel,
        activeTaskCount: this.tasks.size,
      });
      task.sequence = sequence;
      task.lastSent = {
        stageLabel: snapshot.stageLabel,
        percent,
        indeterminate: snapshot.indeterminate,
        sentAt: now,
      };
      task.progressFailures = 0;
    } catch (error) {
      task.progressFailures += 1;
      this.logger.warn("Generation progress update failed", error);
      if (reconcileAfterRepeatedFailure && task.progressFailures >= 2) {
        await this.reconcile();
      }
    }
  }
}
