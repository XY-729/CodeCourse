import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCallGuide,
  getCourseContent,
  getProjectFile,
  getQARecord,
} from "../api/client";
import {
  WORKBENCH_STORAGE_VERSION,
  androidWorkbenchStorageKey,
  restoreStoredWorkbench,
  workbenchStorageKey,
  type StoredWorkbench,
} from "./persistence";
import { ROOT_GROUP_ID, type LayoutNode, type OpenItem } from "./layout";

vi.mock("../api/client", () => ({
  getCallGuide: vi.fn(),
  getCourseContent: vi.fn(),
  getProjectFile: vi.fn(),
  getQARecord: vi.fn(),
}));

const mockedGetCallGuide = vi.mocked(getCallGuide);
const mockedGetCourseContent = vi.mocked(getCourseContent);
const mockedGetProjectFile = vi.mocked(getProjectFile);
const mockedGetQARecord = vi.mocked(getQARecord);

function item(overrides: Partial<OpenItem> & Pick<OpenItem, "id" | "type" | "path">): OpenItem {
  return { title: overrides.path, content: "", ...overrides };
}

function group(items: OpenItem[], activeItemId: string | null, id = ROOT_GROUP_ID): LayoutNode {
  return { type: "group", group: { id, items, activeItemId } };
}

function store(key: string, layout: LayoutNode, overrides: Partial<StoredWorkbench> = {}) {
  window.localStorage.setItem(key, JSON.stringify({
    version: WORKBENCH_STORAGE_VERSION,
    layout,
    activeGroupId: ROOT_GROUP_ID,
    navigationView: "courses",
    navigationOpen: true,
    sidebarWidth: 280,
    ...overrides,
  } satisfies StoredWorkbench));
}

const baseOptions = {
  projectId: 7,
  courses: [{ filename: "course.md", title: "课程", group: "课程" }],
  projectTree: {
    name: "root",
    path: "",
    type: "directory" as const,
    is_key_file: false,
    children: [{ name: "active.ts", path: "active.ts", type: "file" as const, children: [], is_key_file: false }],
  },
  normalizeIds: (layout: LayoutNode) => layout,
  findLearningState: () => undefined,
};

describe("workbench persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockedGetProjectFile.mockResolvedValue({ path: "active.ts", content: "active", language: "typescript" });
    mockedGetCourseContent.mockResolvedValue({ filename: "course.md", content: "# Course" });
    mockedGetQARecord.mockResolvedValue({ id: 9, answer_md: "answer", display_title: "Answer" } as never);
    mockedGetCallGuide.mockResolvedValue({ id: 4, title: "Guide" } as never);
  });

  it("hydrates only the active Android tab", async () => {
    store(androidWorkbenchStorageKey(7), group([
      item({ id: "file:active.ts", type: "file", path: "active.ts" }),
      item({ id: "course:course.md", type: "course", path: "course.md" }),
    ], "file:active.ts"));

    const restored = await restoreStoredWorkbench({ ...baseOptions, mobile: true });

    expect(mockedGetProjectFile).toHaveBeenCalledOnce();
    expect(mockedGetCourseContent).not.toHaveBeenCalled();
    expect(restored?.activeItem?.content).toBe("active");
    if (restored?.layout.type === "group") {
      expect(restored.layout.group.items[1]).toMatchObject({ hydrated: false, content: "" });
    }
  });

  it("hydrates a saved call guide by id", async () => {
    const onCallGuide = vi.fn();
    store(workbenchStorageKey(7), group([
      item({ id: "call-guide:4", type: "call_guide", path: "call-guide:4", callGuideId: 4 }),
    ], "call-guide:4"));

    const restored = await restoreStoredWorkbench({ ...baseOptions, mobile: false, onCallGuide });

    expect(mockedGetCallGuide).toHaveBeenCalledWith(7, 4);
    expect(onCallGuide).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    expect(restored?.activeItem).toMatchObject({ title: "Guide", hydrated: true });
  });

  it("removes missing files and courses from an Android restore", async () => {
    store(androidWorkbenchStorageKey(7), group([
      item({ id: "file:missing.ts", type: "file", path: "missing.ts" }),
      item({ id: "course:missing.md", type: "course", path: "missing.md" }),
      item({ id: "file:active.ts", type: "file", path: "active.ts" }),
    ], "file:active.ts"));

    const restored = await restoreStoredWorkbench({ ...baseOptions, mobile: true });

    if (restored?.layout.type !== "group") throw new Error("expected a single Android group");
    expect(restored.layout.group.items.map((entry) => entry.id)).toEqual(["file:active.ts"]);
  });

  it("migrates a desktop split without overwriting the desktop layout", async () => {
    const desktopLayout: LayoutNode = {
      type: "split",
      id: "split-1",
      direction: "row",
      ratio: 0.5,
      first: group([item({ id: "file:active.ts", type: "file", path: "active.ts" })], "file:active.ts"),
      second: group([item({ id: "course:course.md", type: "course", path: "course.md" })], "course:course.md", "group-2"),
    };
    store(workbenchStorageKey(7), desktopLayout);
    const desktopBefore = window.localStorage.getItem(workbenchStorageKey(7));

    const restored = await restoreStoredWorkbench({ ...baseOptions, mobile: true });

    expect(restored?.layout.type).toBe("group");
    expect(window.localStorage.getItem(workbenchStorageKey(7))).toBe(desktopBefore);
    const android = JSON.parse(window.localStorage.getItem(androidWorkbenchStorageKey(7)) ?? "null") as StoredWorkbench;
    expect(android.layout.type).toBe("group");
    expect(mockedGetProjectFile).toHaveBeenCalledOnce();
    expect(mockedGetCourseContent).not.toHaveBeenCalled();
  });

  it("ignores malformed stored JSON", async () => {
    window.localStorage.setItem(workbenchStorageKey(7), "{broken");
    await expect(restoreStoredWorkbench({ ...baseOptions, mobile: false })).resolves.toBeNull();
  });
});
