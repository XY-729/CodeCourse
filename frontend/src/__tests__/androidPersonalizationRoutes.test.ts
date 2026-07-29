import { describe, expect, it, vi } from "vitest";
import {
  createAndroidPersonalizationRoutes,
  type AndroidPersonalizationHandlers,
} from "../platform/android/personalizationRoutes";
import { dispatchAndroidRoutes } from "../platform/android/routeRegistry";

function handlers() {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const proxy = new Proxy({}, {
    get: (_target, property: string) => {
      if (!calls.has(property)) calls.set(property, vi.fn(async (...args: unknown[]) => ({ property, args })));
      return calls.get(property);
    },
  }) as AndroidPersonalizationHandlers;
  return { proxy, calls };
}

async function dispatch(
  routeHandlers: AndroidPersonalizationHandlers,
  path: string,
  method = "GET",
  body: Record<string, unknown> = {},
) {
  const url = new URL(path, "https://codecourse.local");
  return dispatchAndroidRoutes(createAndroidPersonalizationRoutes(routeHandlers), {
    path: url.pathname,
    method,
    searchParams: url.searchParams,
    body,
  });
}

describe("Android personalization route contract", () => {
  it("routes teaching detail and manual feedback with desktop-compatible values", async () => {
    const { proxy, calls } = handlers();

    await dispatch(proxy, "/projects/12/personalization/teaching/34");
    await dispatch(
      proxy,
      "/projects/12/personalization/teaching/34/feedback",
      "POST",
      {
        result: "partially_successful",
        idempotency_key: "feedback:34",
        reason: "Need one more example",
      },
    );

    expect(calls.get("getTeachingTrial")).toHaveBeenCalledWith(12, 34);
    expect(calls.get("submitTeachingFeedback")).toHaveBeenCalledWith(
      12,
      34,
      "partially_successful",
      "feedback:34",
      "Need one more example",
    );
  });

  it("keeps profile reset scope explicit", async () => {
    const { proxy, calls } = handlers();

    await dispatch(proxy, "/projects/7/personalization/profile?scope=global", "DELETE");
    await dispatch(proxy, "/projects/7/personalization/profile?scope=all", "DELETE");
    await dispatch(proxy, "/projects/7/personalization/profile", "DELETE");

    expect(calls.get("resetProfile")).toHaveBeenNthCalledWith(1, 7, "global");
    expect(calls.get("resetProfile")).toHaveBeenNthCalledWith(2, 7, "all");
    expect(calls.get("resetProfile")).toHaveBeenNthCalledWith(3, 7, "project");
  });

  it("does not consume unrelated Android API paths", async () => {
    const { proxy } = handlers();
    const result = await dispatch(proxy, "/projects/2/course");
    expect(result).toEqual({ handled: false });
  });

  it("rejects unsupported teaching feedback instead of silently storing it", async () => {
    const { proxy } = handlers();
    await expect(dispatch(
      proxy,
      "/projects/1/personalization/teaching/2/feedback",
      "POST",
      { result: "maybe" },
    )).rejects.toThrow("Unsupported teaching feedback result");
  });
});
