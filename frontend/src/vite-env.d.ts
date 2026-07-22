/// <reference types="vite/client" />

type CodeCourseDesktopShortcut = "new-project" | "global-search" | "command-palette" | "settings";

interface CodeCourseDesktopAPI {
  apiBase?: string;
  openExternal?: (url: string) => Promise<boolean>;
  getPathForFile?: (file: File) => string;
  notify?: (payload: { title: string; body: string }) => Promise<boolean>;
  detachTab?: (payload: { type: "file" | "course" | "qa"; path: string; title: string; content: string; language?: string }) => Promise<boolean>;
  getDetachedPayload?: () => Promise<{ type: "file" | "course" | "qa"; path: string; title: string; content: string; language?: string } | null>;
  windowMinimize?: () => void;
  windowMaximize?: () => void;
  windowClose?: () => void;
  windowToggleFullscreen?: () => void;
  toggleDevTools?: () => void;
  onWindowMaximizeChange?: (callback: (isMaximized: boolean) => void) => () => void;
  onShortcut?: (callback: (action: CodeCourseDesktopShortcut) => void) => () => void;
}

interface Window {
  codecourseDesktop?: CodeCourseDesktopAPI;
  __CODECOURSE_API_BASE__?: string;
}
