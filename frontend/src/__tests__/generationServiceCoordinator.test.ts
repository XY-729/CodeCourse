import { describe, expect, it, vi } from "vitest";
import {
  GenerationServiceCoordinator,
  type GenerationNativeBridge,
} from "../platform/android/generationServiceCoordinator";
import type {
  ForegroundTaskSwitchResult,
  GenerationServiceState,
  SetGenerationActiveOptions,
} from "../platform/runtime";

class NativeBridgeMock implements GenerationNativeBridge {
  state: GenerationServiceState = { active: false, sessionId: 0, taskId: 0 };
  startCalls: SetGenerationActiveOptions[] = [];
  progressCalls: Array<Record<string, unknown>> = [];
  switchCalls: Array<{ sessionId: number; taskId: number }> = [];
  readyAfterQueries = 0;
  queryCount = 0;
  failSwitch = false;
  failStop = false;
  failQuery = false;

  async setGenerationActive(options: SetGenerationActiveOptions): Promise<void> {
    this.startCalls.push(options);
    if (!options.active) {
      if (this.failStop) throw new Error("stop failed");
      this.state = { active: false, sessionId: 0, taskId: 0 };
      return;
    }
    this.state = {
      active: this.readyAfterQueries === 0,
      sessionId: options.sessionId,
      taskId: options.taskId,
    };
  }

  async getGenerationServiceState(): Promise<GenerationServiceState> {
    if (this.failQuery) throw new Error("query failed");
    this.queryCount += 1;
    if (!this.state.active && this.state.sessionId > 0 && this.queryCount > this.readyAfterQueries) {
      this.state = { ...this.state, active: true };
    }
    return { ...this.state };
  }

  async switchForegroundTask(
    options: { sessionId: number; taskId: number },
  ): Promise<ForegroundTaskSwitchResult> {
    this.switchCalls.push(options);
    if (this.failSwitch) throw new Error("switch failed");
    this.state = { active: true, ...options };
    return { switched: true, ...options };
  }

  async updateGenerationProgress(options: Record<string, unknown>): Promise<void> {
    this.progressCalls.push(options);
  }

  heartbeatCalls: Array<Record<string, unknown>> = [];
  pendingProgress = false;

  async updateGenerationHeartbeat(options: Record<string, unknown>): Promise<void> {
    this.heartbeatCalls.push(options);
  }

  async hasGenerationPendingProgress(): Promise<{ pending: boolean }> {
    return { pending: this.pendingProgress };
  }
}

function task(taskId: number, startedAt = taskId) {
  return {
    taskId,
    startedAt,
    projectId: 1,
    taskType: "outline",
    projectName: "Atlas",
    sourcePath: null,
  };
}

function coordinator(native: NativeBridgeMock) {
  return new GenerationServiceCoordinator(native, {
    readyTimeoutMs: 20,
    readyPollMs: 1,
    sleep: async () => undefined,
    logger: { warn: vi.fn(), error: vi.fn() },
  });
}

describe("GenerationServiceCoordinator production lifecycle", () => {
  it("does not report progress when native start resolves but never becomes active", async () => {
    const native = new NativeBridgeMock();
    native.readyAfterQueries = Number.MAX_SAFE_INTEGER;
    const service = coordinator(native);
    service.registerTask(task(1));
    await expect(service.sync()).rejects.toThrow("did not become ready");
    expect(service.snapshot().state).toBe("failed");
    expect(native.progressCalls).toHaveLength(0);
  });

  it("waits for delayed readiness and sends sequence 1", async () => {
    const native = new NativeBridgeMock();
    native.readyAfterQueries = 2;
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.sync();
    expect(native.queryCount).toBeGreaterThanOrEqual(3);
    expect(native.progressCalls.at(-1)).toMatchObject({ taskId: 1, sequence: 1 });
  });

  it("starts native service once for two parallel tasks", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1, 1));
    service.registerTask(task(2, 2));
    await service.sync();
    await service.sync();
    expect(native.startCalls.filter((call) => call.active)).toHaveLength(1);
  });

  it("switches foreground only after native confirms", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1, 1));
    service.registerTask(task(2, 2));
    await service.sync();
    service.unregisterTask(1);
    await service.sync();
    expect(service.snapshot().foregroundTaskId).toBe(2);
    expect(native.switchCalls).toEqual([{ sessionId: 1, taskId: 2 }]);
  });

  it("keeps local foreground ownership when native switch fails", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1, 1));
    service.registerTask(task(2, 2));
    await service.sync();
    native.failSwitch = true;
    service.unregisterTask(1);
    await expect(service.sync()).rejects.toThrow("switch failed");
    expect(service.snapshot().foregroundTaskId).toBe(1);
  });

  it("immediately resends the latest switched task snapshot as sequence 1", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1, 1));
    service.registerTask(task(2, 2));
    await service.sync();
    await service.reportProgress(2, {
      stageLabel: "生成第 3/8 章",
      current: 3,
      total: 8,
      indeterminate: false,
    });
    service.unregisterTask(1);
    await service.sync();
    expect(native.progressCalls.at(-1)).toMatchObject({
      taskId: 2,
      sequence: 1,
      stageLabel: "生成第 3/8 章",
      current: 3,
      total: 8,
    });
  });

  it("restarts after the native service is removed by the system", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.sync();
    native.state = { active: false, sessionId: 0, taskId: 0 };
    await service.reconcile();
    expect(native.startCalls.filter((call) => call.active)).toHaveLength(2);
    expect(service.snapshot()).toMatchObject({ state: "running", foregroundTaskId: 1 });
  });

  it("leaves state unknown after bounded stop and cleans it on resume", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.sync();
    service.unregisterTask(1);
    native.failStop = true;
    await expect(service.sync()).rejects.toThrow("remained active");
    expect(service.snapshot().state).toBe("unknown");

    native.failStop = false;
    await service.reconcile();
    expect(service.snapshot()).toMatchObject({ state: "stopped", foregroundTaskId: 0 });
  });

  it("recovers when stop state queries fail before a later resume", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.sync();
    service.unregisterTask(1);
    native.failQuery = true;
    await expect(service.sync()).rejects.toThrow("remained active");
    native.failQuery = false;
    await service.reconcile();
    expect(service.snapshot().state).toBe("stopped");
  });

  it("preserves the foreground snapshot while another task completes", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1, 1));
    service.registerTask(task(2, 2));
    await service.sync();
    await service.reportProgress(1, {
      stageLabel: "等待模型",
      current: 0,
      total: 1,
      indeterminate: true,
    });
    service.unregisterTask(2);
    await service.sync();
    expect(service.snapshot().foregroundTaskId).toBe(1);
    expect(native.switchCalls).toHaveLength(0);
  });
});

describe("GenerationServiceCoordinator heartbeat", () => {
  it("sends heartbeat only for the foreground task while running", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1, 1));
    service.registerTask(task(2, 2));
    await service.sync();

    await service.heartbeat(2, "章节计划已完成");
    expect(native.heartbeatCalls).toHaveLength(0);

    await service.heartbeat(1, "生成学习总纲");
    expect(native.heartbeatCalls).toEqual([
      { sessionId: 1, taskId: 1, stageLabel: "生成学习总纲" },
    ]);
  });

  it("reports pending progress only when the Service accepted nothing yet", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.sync();
    native.pendingProgress = true;
    await expect(service.hasPendingProgress()).resolves.toBe(true);
    native.pendingProgress = false;
    await expect(service.hasPendingProgress()).resolves.toBe(false);
  });

  it("heartbeatPaused resends an honest label while the task runs", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.sync();
    await service.heartbeatPaused();
    expect(native.startCalls.at(-1)).toMatchObject({
      active: true,
      sessionId: 1,
      taskId: 1,
      label: "应用在后台挂起，回到应用后继续生成",
    });
  });

  it("heartbeatPaused is a no-op when the Service is not running", async () => {
    const native = new NativeBridgeMock();
    const service = coordinator(native);
    service.registerTask(task(1));
    await service.heartbeatPaused();
    expect(native.startCalls).toHaveLength(0);
  });
});
