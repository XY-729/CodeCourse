import { useEffect, useRef, useState } from 'react';
import type { Application } from 'pixi.js';
import type { Live2DModel as Live2DModelInstance } from 'pixi-live2d-display';
import './live2d-stage.css';

export type Live2DStageState = 'idle' | 'loading' | 'ready' | 'missing' | 'error';

type Props = {
  /** Keep this false in the reading workbench. The stage is decorative only. */
  visible?: boolean;
  reducedMotion?: boolean;
  modelUrl?: string;
  className?: string;
};

const defaultModelUrl = `${import.meta.env.BASE_URL}live2d/models/board-muse/board-muse.model3.json`;

/**
 * The model stage is deliberately isolated from DirectionShell until a licensed
 * model + Cubism Core file is available. It fails closed to the existing art
 * layer, so a missing model can never create a black overlay or block input.
 */
export default function Live2DStage({
  visible = true,
  reducedMotion = false,
  modelUrl = defaultModelUrl,
  className = '',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<Live2DStageState>('idle');

  useEffect(() => {
    if (!visible || reducedMotion) {
      setState('idle');
      return;
    }

    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let disposed = false;
    let app: Application | undefined;
    let model: Live2DModelInstance | undefined;
    const onResize = () => {
      if (!model || !host.clientWidth || !host.clientHeight) return;
      const anchor = model.anchor;
      anchor?.set(0.5, 1);
      model.x = host.clientWidth * 0.72;
      model.y = host.clientHeight * 1.02;
    };

    const load = async () => {
      setState('loading');
      try {
        // Cubism Core is intentionally a local, user-supplied asset. Do not
        // attempt to fetch a runtime from a CDN or silently install one.
        if (!(window as Window & { Live2DCubismCore?: unknown }).Live2DCubismCore) {
          setState('missing');
          return;
        }
        const response = await fetch(modelUrl, { cache: 'no-store' });
        if (!response.ok) {
          setState('missing');
          return;
        }
        const [{ Application }, cubism4] = await Promise.all([
          import('pixi.js'),
          // The package exports this subpath at runtime; its legacy type
          // package only understands NodeNext/bundler resolution.
          // @ts-expect-error -- see comment above
          import('pixi-live2d-display/cubism4'),
        ]);
        if (disposed) return;
        const pixi = new Application({
          view: canvas,
          resizeTo: host,
          transparent: true,
          antialias: true,
          autoStart: true,
        });
        app = pixi;
        cubism4.startUpCubism4();
        const loadedModel = await cubism4.Live2DModel.from(modelUrl, { autoInteract: false });
        model = loadedModel;
        if (disposed) return;
        pixi.stage.addChild(loadedModel);
        const fit = Math.min(host.clientWidth / Math.max(loadedModel.width, 1), host.clientHeight / Math.max(loadedModel.height, 1)) * 0.86;
        loadedModel.scale.set(fit);
        onResize();
        loadedModel.motion?.('Idle', 0);
        setState('ready');
      } catch {
        if (!disposed) setState('error');
      }
    };

    const observer = new ResizeObserver(onResize);
    observer.observe(host);
    void load();
    return () => {
      disposed = true;
      observer.disconnect();
      try { app?.destroy(true, { children: true }); } catch { /* best-effort cleanup */ }
      app = undefined;
      model = undefined;
    };
  }, [modelUrl, reducedMotion, visible]);

  return (
    <div
      ref={hostRef}
      className={`live2d-stage live2d-stage-${state} ${visible ? '' : 'is-hidden'} ${className}`.trim()}
      aria-hidden="true"
      data-live2d-state={state}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
