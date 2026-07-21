import type { GesturePath, GesturePoint } from "./GestureDrawer";

export type GestureShape =
  | "left"
  | "right"
  | "up"
  | "down"
  | "up-right"
  | "up-left"
  | "down-right"
  | "down-left"
  | "invalid";

export interface GestureRecognizerOptions {
  minStraightLength?: number;
  minCompoundLegLength?: number;
  straightDominance?: number;
  minStraightEfficiency?: number;
  minCompoundEfficiency?: number;
}

const DEFAULT_OPTIONS: Required<GestureRecognizerOptions> = {
  minStraightLength: 60,
  minCompoundLegLength: 42,
  straightDominance: 1.7,
  minStraightEfficiency: 0.76,
  minCompoundEfficiency: 0.68,
};

type PathSample = {
  points: GesturePoint[];
  cumulative: number[];
  length: number;
};

function distance(first: GesturePoint, second: GesturePoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

/** Removes pointer jitter while retaining the corners needed by compound gestures. */
function samplePath(path: GesturePath): PathSample {
  const points: GesturePoint[] = [];
  for (const point of path.points) {
    const previous = points[points.length - 1];
    if (!previous || distance(previous, point) >= 2) {
      points.push(point);
    }
  }

  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] ?? 0 };
}

function recognizeCompound(
  sample: PathSample,
  options: Required<GestureRecognizerOptions>,
): "up-right" | "up-left" | "down-right" | "down-left" | null {
  const { points, cumulative, length } = sample;
  if (points.length < 3 || length < options.minCompoundLegLength * 2) return null;

  const start = points[0];
  const end = points[points.length - 1];
  let best: {
    shape: "up-right" | "up-left" | "down-right" | "down-left";
    score: number;
  } | null = null;

  for (let index = 1; index < points.length - 1; index += 1) {
    const firstLength = cumulative[index];
    const secondLength = length - firstLength;
    if (firstLength < length * 0.24 || secondLength < length * 0.24) continue;

    const corner = points[index];
    const firstDx = corner.x - start.x;
    const firstDy = corner.y - start.y;
    const secondDx = end.x - corner.x;
    const secondDy = end.y - corner.y;
    const firstDisplacement = Math.hypot(firstDx, firstDy);
    const secondDisplacement = Math.hypot(secondDx, secondDy);

    const firstIsVertical =
      Math.abs(firstDy) >= options.minCompoundLegLength &&
      Math.abs(firstDy) >= Math.abs(firstDx) * options.straightDominance;
    const secondIsHorizontal =
      Math.abs(secondDx) >= options.minCompoundLegLength &&
      Math.abs(secondDx) >= Math.abs(secondDy) * options.straightDominance;
    const legsAreIntentional =
      firstDisplacement / firstLength >= options.minCompoundEfficiency &&
      secondDisplacement / secondLength >= options.minCompoundEfficiency;

    if (!firstIsVertical || !secondIsHorizontal || !legsAreIntentional) continue;

    const efficiency = (firstDisplacement + secondDisplacement) / length;
    const cornerBalance = 1 - Math.abs(firstLength - secondLength) / length;
    const score = efficiency + cornerBalance * 0.15;
    const verticalDirection = firstDy > 0 ? "down" : "up";
    const horizontalDirection = secondDx > 0 ? "right" : "left";
    const shape = `${verticalDirection}-${horizontalDirection}` as
      | "up-right"
      | "up-left"
      | "down-right"
      | "down-left";
    if (!best || score > best.score) best = { shape, score };
  }

  return best?.shape ?? null;
}

/**
 * Recognizes only the small, deliberate gesture vocabulary used by CodeCourse.
 * Direct diagonals, short paths, and inefficient scribbles are invalid.
 */
export function recognizeGesture(path: GesturePath, overrides: GestureRecognizerOptions = {}): GestureShape {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const sample = samplePath(path);
  if (sample.points.length < 2) return "invalid";

  const compound = recognizeCompound(sample, options);
  if (compound) return compound;

  const start = sample.points[0];
  const end = sample.points[sample.points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const displacement = Math.hypot(dx, dy);
  if (
    displacement < options.minStraightLength ||
    displacement / sample.length < options.minStraightEfficiency
  ) {
    return "invalid";
  }

  if (Math.abs(dx) >= Math.abs(dy) * options.straightDominance) {
    return dx > 0 ? "right" : "left";
  }
  if (dy > 0 && dy >= Math.abs(dx) * options.straightDominance) {
    return "down";
  }
  if (dy < 0 && Math.abs(dy) >= Math.abs(dx) * options.straightDominance) {
    return "up";
  }
  return "invalid";
}

export default recognizeGesture;
