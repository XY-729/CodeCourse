type SpringOptions = {
  damping?: number;
  response?: number;
  velocity?: number;
  onUpdate?: (position: number) => void;
  onComplete?: () => void;
};

const activeAnimations = new WeakMap<HTMLElement, number>();

export function project(initialVelocity: number, decelerationRate = 0.99): number {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function sheetOpenProgress(position: number, closedPosition: number): number {
  if (closedPosition <= 0) return position <= 0 ? 1 : 0;
  return Math.max(0, Math.min(1, 1 - position / closedPosition));
}

export function sheetBackdropProgress(position: number, closedPosition: number): number {
  const openProgress = sheetOpenProgress(position, closedPosition);
  // Clear the document quickly: by the time the sheet is halfway down, the
  // backdrop is fully transparent and unblurred.
  return Math.max(0, Math.min(1, (openProgress - 0.5) * 2));
}

export function readTranslateY(element: HTMLElement): number {
  const transform = window.getComputedStyle(element).transform;
  if (!transform || transform === "none") return 0;
  const match = transform.match(/^matrix(?:3d)?\((.+)\)$/);
  if (match) {
    const values = match[1].split(",").map(Number);
    return values.length === 16 ? values[13] || 0 : values[5] || 0;
  }
  const translate = transform.match(
    /^translate(?:3d|Y)?\(\s*(?:[^,]+,\s*)?(-?\d+(?:\.\d+)?)px(?:\s*,[^)]*)?\)$/i,
  );
  return translate ? Number(translate[1]) || 0 : 0;
}

export function cancelSpring(element: HTMLElement): void {
  const frame = activeAnimations.get(element);
  if (frame !== undefined) {
    window.cancelAnimationFrame(frame);
    activeAnimations.delete(element);
  }
}

export function animateSpringY(element: HTMLElement, target: number, options: SpringOptions = {}): void {
  cancelSpring(element);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.style.transform = `translate3d(0, ${target}px, 0)`;
    options.onUpdate?.(target);
    options.onComplete?.();
    return;
  }

  const damping = options.damping ?? 1;
  const response = options.response ?? 0.36;
  const angularFrequency = (2 * Math.PI) / response;
  let position = readTranslateY(element);
  let velocity = options.velocity ?? 0;
  let previous = performance.now();

  element.style.willChange = "transform";
  options.onUpdate?.(position);

  const step = (now: number) => {
    const delta = Math.min((now - previous) / 1000, 1 / 30);
    previous = now;

    const displacement = position - target;
    const acceleration =
      -(angularFrequency * angularFrequency * displacement)
      - (2 * damping * angularFrequency * velocity);

    velocity += acceleration * delta;
    position += velocity * delta;
    element.style.transform = `translate3d(0, ${position}px, 0)`;
    options.onUpdate?.(position);

    if (Math.abs(position - target) < 0.35 && Math.abs(velocity) < 3) {
      element.style.transform = `translate3d(0, ${target}px, 0)`;
      options.onUpdate?.(target);
      element.style.willChange = "";
      activeAnimations.delete(element);
      options.onComplete?.();
      return;
    }

    activeAnimations.set(element, window.requestAnimationFrame(step));
  };

  activeAnimations.set(element, window.requestAnimationFrame(step));
}
