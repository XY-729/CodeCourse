import { useEffect, useRef, useState } from "react";

type Handlers = {
  onLocalPath: (path: string) => void | Promise<void>;
  onArchive: (file: File) => void | Promise<void>;
  onRejected: (message: string) => void;
};

function isExternalFileDrag(event: globalThis.DragEvent) {
  const types = Array.from(event.dataTransfer?.types ?? []);
  return types.includes("Files") && !types.includes("application/codecourse-item");
}

export function useDesktopImportDrop(enabled: boolean, handlers: Handlers) {
  const [active, setActive] = useState(false);
  const dragDepthRef = useRef(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || !window.codecourseDesktop?.getPathForFile) return;

    const onDragEnter = (event: globalThis.DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setActive(true);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setActive(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      const localPath = window.codecourseDesktop?.getPathForFile?.(file) ?? "";
      if (localPath) void handlersRef.current.onLocalPath(localPath);
      else if (file.name.toLowerCase().endsWith(".zip")) void handlersRef.current.onArchive(file);
      else handlersRef.current.onRejected("请拖入本地项目文件夹或 ZIP 压缩包");
    };
    const clear = () => {
      dragDepthRef.current = 0;
      setActive(false);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("blur", clear);
    };
  }, [enabled]);

  return active;
}
