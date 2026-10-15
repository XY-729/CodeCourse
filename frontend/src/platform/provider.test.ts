import { beforeEach, describe, expect, it, vi } from "vitest";

const create = vi.hoisted(() => vi.fn());
vi.mock("./runtime", () => ({ isNativeAndroidRuntime: () => true }));
vi.mock("./android/localProvider", () => ({ AndroidLocalProvider: { create } }));

beforeEach(() => { vi.resetModules(); create.mockReset(); });

describe("Android provider initialization", () => {
  it("shares a failed startup and lets a page retry using a fresh provider", async () => {
    const failure = new Error("Temporary database failure");
    const provider = { request: vi.fn().mockResolvedValue([]) };
    create.mockRejectedValueOnce(failure).mockResolvedValueOnce(provider);
    const { getCodeCourseProvider, providerRequest } = await import("./provider");
    const initial = getCodeCourseProvider();
    expect(getCodeCourseProvider()).toBe(initial);
    await expect(initial).rejects.toBe(failure);
    await expect(providerRequest("/projects/1/qa")).resolves.toEqual([]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(await getCodeCourseProvider()).toBe(provider);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
