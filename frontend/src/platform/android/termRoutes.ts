import type { AndroidRoute } from "./routeRegistry";

export type AndroidTermHandlers = {
  list: (projectId: number, params: URLSearchParams) => Promise<unknown>;
  status: (projectId: number, params: URLSearchParams, force?: boolean) => Promise<unknown>;
  setStatus: (termId: number, status: "known" | "dismissed") => Promise<unknown>;
};

export function createAndroidTermRoutes(handlers: AndroidTermHandlers): AndroidRoute[] {
  return [
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/terms\/status$/,
      handle: (match, request) => handlers.status(Number(match[1]), request.searchParams),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/terms\/rescan$/,
      handle: (match, request) => handlers.status(Number(match[1]), request.searchParams, true),
    },
    {
      method: "GET",
      pattern: /^\/projects\/(\d+)\/terms$/,
      handle: (match, request) => handlers.list(Number(match[1]), request.searchParams),
    },
    {
      method: "POST",
      pattern: /^\/projects\/(\d+)\/terms\/(\d+)\/(known|dismiss)$/,
      handle: (match) => handlers.setStatus(
        Number(match[2]),
        match[3] === "known" ? "known" : "dismissed",
      ),
    },
  ];
}
