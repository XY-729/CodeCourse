import { isAndroidRuntime } from "./runtime";

export interface CodeCourseProvider {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}

class HttpProvider implements CodeCourseProvider {
  constructor(private readonly apiBase: string) {}

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const hasBody = init?.body != null;
    const response = await fetch(`${this.apiBase}${path}`, {
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      ...init,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: response.statusText }));
      const detail = Array.isArray(body.detail)
        ? body.detail.map((item: { msg?: string }) => item.msg).join("; ")
        : body.detail;
      if (detail === "Not Found") throw new Error("接口未找到，请重启后端服务后重试。");
      throw new Error(detail ?? (response.status === 404 ? "请求的资源不存在或已被删除。" : response.statusText));
    }
    return response.json() as Promise<T>;
  }
}

let providerPromise: Promise<CodeCourseProvider> | null = null;

function configuredApiBase(): string {
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

export function getCodeCourseProvider(): Promise<CodeCourseProvider> {
  if (!providerPromise) {
    providerPromise = isAndroidRuntime()
      ? import("./android/localProvider").then(({ AndroidLocalProvider }) => AndroidLocalProvider.create())
      : Promise.resolve(new HttpProvider(configuredApiBase()));
  }
  return providerPromise;
}

export async function providerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return (await getCodeCourseProvider()).request<T>(path, init);
}
