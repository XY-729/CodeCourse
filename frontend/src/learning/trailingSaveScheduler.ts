export class TrailingSaveScheduler {
  private readonly timers = new Map<string, number>();

  constructor(private readonly delayMs = 800) {}

  schedule(key: string, callback: () => void): void {
    this.cancel(key);
    const timer = window.setTimeout(() => {
      this.timers.delete(key);
      callback();
    }, this.delayMs);
    this.timers.set(key, timer);
  }

  flush(key: string, callback: () => void): void {
    this.cancel(key);
    callback();
  }

  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer == null) return;
    window.clearTimeout(timer);
    this.timers.delete(key);
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
  }
}
