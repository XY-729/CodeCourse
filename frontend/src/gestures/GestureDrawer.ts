export interface GesturePoint {
  x: number;
  y: number;
  timestamp: number;
}

export interface GesturePath {
  points: GesturePoint[];
}

export interface GestureDrawerOptions {
  lineWidth?: number;
  color?: string;
  opacity?: number;
}

const DEFAULT_OPTIONS: Required<GestureDrawerOptions> = {
  lineWidth: 4,
  color: "#16826b",
  opacity: 0.68,
};

/**
 * Records pointer coordinates and renders a temporary, smoothed path.
 * It deliberately contains no gesture recognition or application behavior.
 */
export class GestureDrawer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private options: Required<GestureDrawerOptions>;
  private currentPath: GesturePath = { points: [] };
  private completedPath: GesturePath | null = null;
  private drawing = false;
  private frameId: number | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;

  constructor(canvas: HTMLCanvasElement, options: GestureDrawerOptions = {}) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("GestureDrawer requires a 2D canvas context.");
    }

    this.canvas = canvas;
    this.context = context;
    this.options = this.normalizeOptions({ ...DEFAULT_OPTIONS, ...options });
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  start(x: number, y: number): void {
    this.cancelScheduledDraw();
    this.clearCanvas();
    this.currentPath = { points: [this.createPoint(x, y)] };
    this.drawing = true;
    this.scheduleDraw();
  }

  move(x: number, y: number): void {
    if (!this.drawing) return;
    this.currentPath.points.push(this.createPoint(x, y));
    this.scheduleDraw();
  }

  end(): GesturePath {
    this.drawing = false;
    this.completedPath = this.clonePath(this.currentPath);
    this.drawNow();
    return this.clonePath(this.completedPath);
  }

  /** Clears only the temporary canvas. The last completed path remains available. */
  clear(): void {
    this.cancelScheduledDraw();
    this.clearCanvas();
  }

  getLastPath(): GesturePath | null {
    return this.completedPath ? this.clonePath(this.completedPath) : null;
  }

  /** Returns a snapshot for live recognition without exposing mutable state. */
  getCurrentPath(): GesturePath {
    return this.clonePath(this.currentPath);
  }

  configure(options: GestureDrawerOptions): void {
    this.options = this.normalizeOptions({ ...this.options, ...options });
    if (this.drawing) this.scheduleDraw();
  }

  resize(width: number, height: number, pixelRatio = window.devicePixelRatio || 1): void {
    this.viewportWidth = Math.max(1, Math.round(width));
    this.viewportHeight = Math.max(1, Math.round(height));
    const ratio = Math.max(1, pixelRatio);

    this.canvas.width = Math.round(this.viewportWidth * ratio);
    this.canvas.height = Math.round(this.viewportHeight * ratio);
    this.canvas.style.width = `${this.viewportWidth}px`;
    this.canvas.style.height = `${this.viewportHeight}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (this.drawing) this.scheduleDraw();
  }

  private createPoint(x: number, y: number): GesturePoint {
    return { x, y, timestamp: Date.now() };
  }

  private normalizeOptions(options: Required<GestureDrawerOptions>): Required<GestureDrawerOptions> {
    return {
      lineWidth: Math.min(32, Math.max(1, options.lineWidth)),
      color: options.color || DEFAULT_OPTIONS.color,
      opacity: Math.min(1, Math.max(0, options.opacity)),
    };
  }

  private clonePath(path: GesturePath): GesturePath {
    return { points: path.points.map((point) => ({ ...point })) };
  }

  private scheduleDraw(): void {
    if (this.frameId !== null) return;
    this.frameId = window.requestAnimationFrame(() => {
      this.frameId = null;
      this.drawNow();
    });
  }

  private cancelScheduledDraw(): void {
    if (this.frameId === null) return;
    window.cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private clearCanvas(): void {
    this.context.clearRect(0, 0, this.viewportWidth, this.viewportHeight);
  }

  private drawNow(): void {
    this.cancelScheduledDraw();
    this.clearCanvas();

    const points = this.currentPath.points;
    if (points.length === 0) return;

    const context = this.context;
    context.save();
    context.globalAlpha = this.options.opacity;
    context.strokeStyle = this.options.color;
    context.fillStyle = this.options.color;
    context.lineWidth = this.options.lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";

    if (points.length === 1) {
      context.beginPath();
      context.arc(points[0].x, points[0].y, this.options.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
      context.restore();
      return;
    }

    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      context.lineTo(points[1].x, points[1].y);
    } else {
      for (let index = 1; index < points.length - 1; index += 1) {
        const point = points[index];
        const next = points[index + 1];
        const midpointX = (point.x + next.x) / 2;
        const midpointY = (point.y + next.y) / 2;
        context.quadraticCurveTo(point.x, point.y, midpointX, midpointY);
      }
      const last = points[points.length - 1];
      context.lineTo(last.x, last.y);
    }

    context.stroke();
    context.restore();
  }
}

export default GestureDrawer;
