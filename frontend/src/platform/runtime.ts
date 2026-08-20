import { Capacitor, registerPlugin } from "@capacitor/core";

type SecureStorePlugin = {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
};

export type NotificationPermissionStatus =
  | "granted" | "denied" | "denied_permanently"
  | "notifications_disabled" | "not_required" | "no_activity" | "error";

export type NotificationPermissionResult = {
  granted: boolean;
  status: NotificationPermissionStatus;
  canAskAgain: boolean;
};

export type CompletionNavigation = {
  projectId: number;
  taskId: number;
  taskType: string;
  outputPath: string;
  navigationId: string;
};

export const CodeCourseSecureStore = registerPlugin<SecureStorePlugin>("CodeCourseSecureStore");
export const CodeCourseNative = registerPlugin<{
  openExternal(options: { url: string }): Promise<void>;
  notifyCompletion(options: {
    taskId: number; projectId?: number; taskType?: string;
    outputPath?: string; label: string;
  }): Promise<void>;
  moveToBackground(): Promise<void>;
  requestNotificationPermission(): Promise<NotificationPermissionResult>;
  getNotificationPermissionStatus(): Promise<NotificationPermissionResult>;
  openNotificationSettings(): Promise<void>;
  consumePendingCompletionNavigation(): Promise<CompletionNavigation | null>;
  ackCompletionNavigation(options: { navigationId: string }): Promise<void>;
}>("CodeCourseNative");

export function isNativeAndroidRuntime(): boolean {
  // `isNativePlatform()` can briefly report false while the Android bridge is
  // being attached. `getPlatform()` is backed by the injected Capacitor
  // platform marker and is the more reliable signal during the first render.
  return Capacitor.getPlatform() === "android";
}

export function isAndroidRuntime(): boolean {
  if (isNativeAndroidRuntime()) return true;
  if (typeof window === "undefined") return false;

  // Keep the Android layout active in the packaged WebView even if the native
  // bridge is momentarily unavailable. This also prevents the mobile app from
  // falling back to desktop drawers during a cold start.
  const androidWebView = /\bAndroid\b/i.test(window.navigator.userAgent)
    && (/\bwv\b/i.test(window.navigator.userAgent) || window.location.hostname === "localhost");
  if (androidWebView) return true;

  const localAndroidPreview = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
    && new URLSearchParams(window.location.search).get("preview") === "android";
  return localAndroidPreview;
}

export function applyPlatformClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("platform-android", isAndroidRuntime());
}
