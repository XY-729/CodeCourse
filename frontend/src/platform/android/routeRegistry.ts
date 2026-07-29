export type AndroidRouteRequest = {
  path: string;
  method: string;
  searchParams: URLSearchParams;
  body: Record<string, unknown>;
};

export type AndroidRoute = {
  method: string | readonly string[];
  pattern: RegExp;
  handle: (
    match: RegExpMatchArray,
    request: AndroidRouteRequest,
  ) => Promise<unknown> | unknown;
};

export type AndroidRouteResult =
  | { handled: false }
  | { handled: true; value: unknown };

function acceptsMethod(route: AndroidRoute, method: string): boolean {
  return Array.isArray(route.method)
    ? route.method.includes(method)
    : route.method === method;
}

export async function dispatchAndroidRoutes(
  routes: readonly AndroidRoute[],
  request: AndroidRouteRequest,
): Promise<AndroidRouteResult> {
  for (const route of routes) {
    if (!acceptsMethod(route, request.method)) continue;
    const match = request.path.match(route.pattern);
    if (!match) continue;
    return {
      handled: true,
      value: await route.handle(match, request),
    };
  }
  return { handled: false };
}
