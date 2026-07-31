import { isNativeAndroidRuntime } from "./runtime";
import type { NotificationPermissionResult } from "./runtime";
import type { PermissionNotice } from "./android/generationState";

export interface CodeCourseProvider {
  request<T>(path: string, init?: RequestInit): Promise<T>;
  reconcileGenerationServiceState?(): Promise<void>;
  getNotificationPermissionStatus?(): Promise<NotificationPermissionResult>;
  invalidatePermissionCache?(): void;
  setPermissionNoticeHandler?(handler: ((notice: PermissionNotice) => void) | null): void;
}

class HttpProvider implements CodeCourseProvider {
  constructor(private readonly apiBase: string) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const body = init?.body;
    const hasBody = body != null;
    const isBinaryBody = typeof Blob !== "undefined" && body instanceof Blob;
    const isFormBody = typeof FormData !== "undefined" && body instanceof FormData;
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        ...(hasBody && !isBinaryBody && !isFormBody ? { "Content-Type": "application/json" } : {}),
        ...(isBinaryBody && body.type ? { "Content-Type": body.type } : {}),
        ...init?.headers,
      },
      ...init,
    });
    if (!response.ok) {
      const rawBody = await response.text();
      let detail: unknown = null;

      if (rawBody.trim()) {
        try {
          const parsed = JSON.parse(rawBody) as { detail?: unknown };
          detail = parsed.detail;
        } catch {
          detail = rawBody.trim();
        }
      }

      const detailText = Array.isArray(detail)
        ? detail
            .map((item) => {
              if (typeof item === "string") return item;
              if (item && typeof item === "object" && "msg" in item) {
                return String((item as { msg?: unknown }).msg ?? "");
              }
              return "";
            })
            .filter(Boolean)
            .join("; ")
        : typeof detail === "string"
          ? detail
          : "";

      if (detailText === "Not Found") {
        throw new Error("接口未找到，请重启后端服务后重试。");
      }

      if (detailText && detailText !== "Internal Server Error") {
        throw new Error(detailText);
      }

      if (response.status >= 500) {
        throw new Error("服务器处理请求失败，请查看后端日志中的具体异常。");
      }

      throw new Error(
        response.status === 404
          ? "请求的资源不存在或已被删除。"
          : response.statusText || "请求失败",
      );
    }
    return response.json() as Promise<T>;
  }
}

let providerPromise: Promise<CodeCourseProvider> | null = null;

export function configuredApiBase(): string {
  const desktopWindow = window as Window & {
    codecourseDesktop?: { apiBase?: string };
    __CODECOURSE_API_BASE__?: string;
  };
  return (
    desktopWindow.codecourseDesktop?.apiBase ||
    desktopWindow.__CODECOURSE_API_BASE__ ||
    import.meta.env.VITE_API_BASE_URL ||
    "/api"
  ).replace(/\/$/, "");
}

export function httpApiUrl(path: string): string {
  return `${configuredApiBase()}${path}`;
}

export function getCodeCourseProvider(): Promise<CodeCourseProvider> {
  if (!providerPromise) {
    providerPromise = isNativeAndroidRuntime()
      ? import("./android/localProvider").then(({ AndroidLocalProvider }) => AndroidLocalProvider.create())
      : Promise.resolve(new HttpProvider(configuredApiBase()));
  }
  return providerPromise;
}

export async function providerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return (await getCodeCourseProvider()).request<T>(path, init);
}
