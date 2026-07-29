import { afterEach, describe, expect, it, vi } from "vitest";

const getPlatform = vi.fn<() => string>(() => "web");

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform,
    isNativePlatform: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({})),
}));

const originalUserAgent = window.navigator.userAgent;

async function loadRuntime() {
  vi.resetModules();
  return import("../platform/runtime");
}

afterEach(() => {
  getPlatform.mockReturnValue("web");
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: originalUserAgent,
  });
  document.documentElement.classList.remove("platform-android");
});

describe("Android runtime detection", () => {
  it("trusts Capacitor's Android platform marker even before native readiness", async () => {
    getPlatform.mockReturnValue("android");
    const runtime = await loadRuntime();

    expect(runtime.isNativeAndroidRuntime()).toBe(true);
    expect(runtime.isAndroidRuntime()).toBe(true);
  });

  it("keeps packaged Android WebViews in the mobile layout if the bridge is late", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP3A) AppleWebKit/537.36 Version/4.0 Chrome/130 Mobile Safari/537.36 wv",
    });
    const runtime = await loadRuntime();

    expect(runtime.isAndroidRuntime()).toBe(true);
    runtime.applyPlatformClass();
    expect(document.documentElement.classList.contains("platform-android")).toBe(true);
  });

  it("does not apply the Android layout to a desktop browser", async () => {
    const runtime = await loadRuntime();

    expect(runtime.isAndroidRuntime()).toBe(false);
  });
});
