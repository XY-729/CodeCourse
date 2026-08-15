import {
  getCallGuide,
  getCourseContent,
  getProjectFile,
  getQARecord,
  type CallGuide,
  type CourseFile,
  type LearningState,
  type TreeNode,
} from "../api/client";
import { titleFromMarkdown } from "../utils/titleFromMarkdown";
import type { NavigationView } from "../components/Sidebar";
import {
  ROOT_GROUP_ID,
  countLayoutItems,
  findGroup,
  firstGroupId,
  hasGroup,
  normalizeToSingleGroup,
  stripLayoutContent,
  type LayoutNode,
  type OpenItem,
} from "./layout";

export const WORKBENCH_STORAGE_VERSION = 1;

export type StoredWorkbench = {
  version: number;
  layout: LayoutNode;
  activeGroupId: string;
  navigationView: NavigationView;
  navigationOpen: boolean;
  sidebarWidth: number;
};

export type RestoredWorkbench = {
  layout: LayoutNode;
  activeGroupId: string;
  activeItem: OpenItem | null;
  navigationView: NavigationView;
  navigationOpen: boolean;
  sidebarWidth: number;
};

export function workbenchStorageKey(projectId: number) {
  return `codecourse.workbench.v${WORKBENCH_STORAGE_VERSION}.${projectId}`;
}

export function androidWorkbenchStorageKey(projectId: number) {
  return `codecourse.android.workbench.v${WORKBENCH_STORAGE_VERSION}.${projectId}`;
}

function parseStoredWorkbench(raw: string | null): StoredWorkbench | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredWorkbench;
  } catch {
    return null;
  }
}

function qaTitle(record: Awaited<ReturnType<typeof getQARecord>>) {
  return record.display_title?.trim() || `回答 #${record.id}`;
}

export async function hydrateStoredItem(
  item: OpenItem,
  projectId: number,
  availableCourses: CourseFile[],
  findLearningState: (sourceType: LearningState["source_type"], sourcePath: string) => LearningState | undefined,
  onCallGuide?: (guide: CallGuide) => void,
): Promise<OpenItem | null> {
  try {
    if (item.type === "file") {
      const file = await getProjectFile(projectId, item.path);
      const saved = findLearningState("file", item.path);
      return {
        ...item, content: file.content, language: file.language, dirty: false, hydrated: true,
        restoreLine: saved?.position_kind === "line" ? saved.position_value : 1,
        jumpRequest: undefined,
      };
    }
    if (item.type === "course") {
      const course = await getCourseContent(projectId, item.path);
      let title = availableCourses.find((entry) => entry.filename === item.path)?.title
        ?? titleFromMarkdown(item.path, course.content);
      if (item.qaRecordId) {
        const record = await getQARecord(projectId, item.qaRecordId).catch(() => null);
        if (record) title = qaTitle(record);
      }
      return { ...item, title, content: course.content, dirty: false, hydrated: true };
    }
    if (item.type === "qa" && item.qaRecordId) {
      const record = await getQARecord(projectId, item.qaRecordId);
      return {
        ...item, title: qaTitle(record), content: record.answer_md, favorite: record.favorite,
        dirty: false, hydrated: true,
      };
    }
    if (item.type === "call_guide" && item.callGuideId) {
      const guide = await getCallGuide(projectId, item.callGuideId);
      onCallGuide?.(guide);
      return { ...item, title: guide.title, content: "", dirty: false, hydrated: true };
    }
    if (item.type === "knowledge_graph") return { ...item, content: "", hydrated: true };
  } catch {
    return null;
  }
  return null;
}

export async function hydrateStoredLayout(
  node: LayoutNode,
  options: {
    projectId: number;
    availableCourses: CourseFile[];
    findLearningState: (sourceType: LearningState["source_type"], sourcePath: string) => LearningState | undefined;
    activeOnly?: boolean;
    availableFilePaths?: Set<string>;
    onCallGuide?: (guide: CallGuide) => void;
  },
): Promise<LayoutNode> {
  if (node.type === "group") {
    const hydrated = await Promise.all(node.group.items.map((item) => {
      if (!options.activeOnly || item.id === node.group.activeItemId) {
        return hydrateStoredItem(
          item, options.projectId, options.availableCourses, options.findLearningState, options.onCallGuide,
        );
      }
      if (item.type === "file" && options.availableFilePaths && !options.availableFilePaths.has(item.path)) return null;
      if (item.type === "course" && !options.availableCourses.some((course) => course.filename === item.path)) return null;
      return Promise.resolve({ ...item, content: "", dirty: false, hydrated: false });
    }));
    const items = hydrated.filter((item): item is OpenItem => Boolean(item));
    const activeItemId = items.some((item) => item.id === node.group.activeItemId)
      ? node.group.activeItemId
      : items.at(-1)?.id ?? null;
    return { ...node, group: { ...node.group, items, activeItemId } };
  }
  const [first, second] = await Promise.all([
    hydrateStoredLayout(node.first, options),
    hydrateStoredLayout(node.second, options),
  ]);
  return { ...node, first, second };
}

function availablePaths(tree?: TreeNode | null) {
  const result = new Set<string>();
  const visit = (node: TreeNode) => {
    if (node.type === "file") result.add(node.path);
    node.children.forEach(visit);
  };
  if (tree) visit(tree);
  return result;
}

export async function restoreStoredWorkbench(options: {
  projectId: number;
  courses: CourseFile[];
  projectTree?: TreeNode | null;
  mobile: boolean;
  normalizeIds: (layout: LayoutNode) => LayoutNode;
  findLearningState: (sourceType: LearningState["source_type"], sourcePath: string) => LearningState | undefined;
  onCallGuide?: (guide: CallGuide) => void;
}): Promise<RestoredWorkbench | null> {
  const filePaths = options.projectTree ? availablePaths(options.projectTree) : undefined;
  let stored: StoredWorkbench | null = null;
  let migratedLayout: LayoutNode | null = null;
  if (options.mobile) {
    const androidRaw = window.localStorage.getItem(androidWorkbenchStorageKey(options.projectId));
    if (androidRaw) {
      stored = parseStoredWorkbench(androidRaw);
    } else {
      const desktopRaw = window.localStorage.getItem(workbenchStorageKey(options.projectId));
      const desktop = parseStoredWorkbench(desktopRaw);
      if (desktop?.version === WORKBENCH_STORAGE_VERSION && desktop.layout) {
        const mergedStored = normalizeToSingleGroup(
          desktop.layout,
          desktop.activeGroupId ? findGroup(desktop.layout, desktop.activeGroupId)?.activeItemId : null,
        );
        const merged = await hydrateStoredLayout(mergedStored, {
          ...options, availableCourses: options.courses, activeOnly: true, availableFilePaths: filePaths,
        });
        try {
          window.localStorage.setItem(androidWorkbenchStorageKey(options.projectId), JSON.stringify({
            version: WORKBENCH_STORAGE_VERSION, layout: stripLayoutContent(merged), activeGroupId: ROOT_GROUP_ID,
            navigationView: "courses", navigationOpen: false, sidebarWidth: 264,
          } satisfies StoredWorkbench));
        } catch { /* storage full */ }
        migratedLayout = merged;
        stored = {
          version: WORKBENCH_STORAGE_VERSION, layout: merged, activeGroupId: ROOT_GROUP_ID,
          navigationView: "courses", navigationOpen: false, sidebarWidth: 264,
        };
      }
    }
    if (!stored || stored.version !== WORKBENCH_STORAGE_VERSION || !stored.layout) return null;
    const single = stored.layout.type === "split"
      ? normalizeToSingleGroup(stored.layout, findGroup(stored.layout, stored.activeGroupId)?.activeItemId)
      : stored.layout;
    const layout = options.normalizeIds(migratedLayout ?? await hydrateStoredLayout(single, {
      ...options, availableCourses: options.courses, activeOnly: true, availableFilePaths: filePaths,
    }));
    if (countLayoutItems(layout) === 0) return null;
    const group = findGroup(layout, ROOT_GROUP_ID);
    return {
      layout, activeGroupId: ROOT_GROUP_ID,
      activeItem: group?.items.find((item) => item.id === group.activeItemId) ?? null,
      navigationView: "courses", navigationOpen: false, sidebarWidth: 264,
    };
  }

  const raw = window.localStorage.getItem(workbenchStorageKey(options.projectId));
  stored = parseStoredWorkbench(raw);
  if (!stored || stored.version !== WORKBENCH_STORAGE_VERSION || !stored.layout) return null;
  const layout = options.normalizeIds(await hydrateStoredLayout(stored.layout, {
    ...options, availableCourses: options.courses,
  }));
  if (countLayoutItems(layout) === 0) return null;
  const activeGroupId = hasGroup(layout, stored.activeGroupId) ? stored.activeGroupId : firstGroupId(layout);
  const group = findGroup(layout, activeGroupId);
  return {
    layout,
    activeGroupId,
    activeItem: group?.items.find((item) => item.id === group.activeItemId) ?? null,
    navigationView: stored.navigationView ?? "courses",
    navigationOpen: Boolean(stored.navigationOpen),
    sidebarWidth: Math.min(360, Math.max(240, stored.sidebarWidth || 264)),
  };
}
