import { describe, expect, it, vi } from "vitest";
import { dispatchAndroidRoutes } from "../routeRegistry";
import { createAndroidTermRoutes } from "../termRoutes";

function request(path: string, method = "GET") {
  const url = new URL(`https://codecourse.local${path}`);
  return {
    path: url.pathname,
    method,
    searchParams: url.searchParams,
    body: {},
  };
}

describe("Android term route contract", () => {
  it("keeps list, status and rescan endpoints distinct", async () => {
    const handlers = {
      list: vi.fn().mockResolvedValue(["term"]),
      status: vi.fn().mockResolvedValue({ scan_status: "completed" }),
      setStatus: vi.fn(),
    };
    const routes = createAndroidTermRoutes(handlers);

    await dispatchAndroidRoutes(routes, request("/projects/7/terms?source_type=course&source_path=outline.md"));
    await dispatchAndroidRoutes(routes, request("/projects/7/terms/status?source_type=course&source_path=outline.md"));
    await dispatchAndroidRoutes(routes, request("/projects/7/terms/rescan?source_type=course&source_path=outline.md", "POST"));

    expect(handlers.list).toHaveBeenCalledTimes(1);
    expect(handlers.status).toHaveBeenNthCalledWith(1, 7, expect.any(URLSearchParams));
    expect(handlers.status).toHaveBeenNthCalledWith(2, 7, expect.any(URLSearchParams), true);
  });

  it("maps known and dismiss feedback to persisted statuses", async () => {
    const handlers = {
      list: vi.fn(),
      status: vi.fn(),
      setStatus: vi.fn().mockResolvedValue({}),
    };
    const routes = createAndroidTermRoutes(handlers);
    await dispatchAndroidRoutes(routes, request("/projects/7/terms/11/known", "POST"));
    await dispatchAndroidRoutes(routes, request("/projects/7/terms/11/dismiss", "POST"));
    expect(handlers.setStatus).toHaveBeenNthCalledWith(1, 11, "known");
    expect(handlers.setStatus).toHaveBeenNthCalledWith(2, 11, "dismissed");
  });
});
