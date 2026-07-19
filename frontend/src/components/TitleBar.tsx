import { useEffect, useState } from "react";
import { Minus, Square, X, Maximize } from "lucide-react";

type DesktopAPI = {
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  windowToggleFullscreen: () => void;
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => void;
};

const api: DesktopAPI | undefined = (window as any).codecourseDesktop;

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (!api?.onWindowMaximizeChange) return;
    api.onWindowMaximizeChange(setIsMaximized);
  }, []);

  if (!api?.windowMinimize) return null;

  return (
    <div className="apple-titlebar">
      <div className="apple-titlebar-drag" />
      <div className="apple-titlebar-actions">
        <button onClick={() => api.windowMinimize()} title="最小化" aria-label="最小化">
          <Minus size={13} strokeWidth={2} />
        </button>
        <button onClick={() => api.windowMaximize()} title={isMaximized ? "还原" : "最大化"} aria-label={isMaximized ? "还原" : "最大化"}>
          <Square size={11} strokeWidth={2.5} />
        </button>
        <button onClick={() => api.windowToggleFullscreen()} title="全屏" aria-label="全屏">
          <Maximize size={12} strokeWidth={2} />
        </button>
        <button className="apple-titlebar-close" onClick={() => api.windowClose()} title="关闭" aria-label="关闭">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
