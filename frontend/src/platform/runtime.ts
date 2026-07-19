import { Capacitor, registerPlugin } from "@capacitor/core";

type SecureStorePlugin = {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
};

export const CodeCourseSecureStore = registerPlugin<SecureStorePlugin>("CodeCourseSecureStore");
export const CodeCourseNative = registerPlugin<{ openExternal(options: { url: string }): Promise<void> }>("CodeCourseNative");

export function isNativeAndroidRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function isAndroidRuntime(): boolean {
  if (isNativeAndroidRuntime()) return true;
  return import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("preview") === "android";
}

export function applyPlatformClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("platform-android", isAndroidRuntime());
}
