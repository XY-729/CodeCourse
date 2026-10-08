import { useEffect, useRef, type MutableRefObject } from "react";
import type { NavigationView } from "../components/Sidebar";
import type { LayoutNode, OpenItem } from "./layout";
import { stripLayoutContent } from "./layout";
import {
  WORKBENCH_STORAGE_VERSION,
  androidWorkbenchStorageKey,
  workbenchStorageKey,
  type StoredWorkbench,
} from "./persistence";

type Options = {
  projectId: number | null;
  restoringProjectId: number | null;
  loading: boolean;
  mobile: boolean;
  layout: LayoutNode;
  activeGroupId: string;
  navigationView: NavigationView;
  navigationOpen: boolean;
  sidebarWidth: number;
  closedItemsRef: MutableRefObject<Array<{ groupId: string; item: OpenItem }>>;
};

export function useWorkbenchPersistence(options: Options) {
  const lastSavedRef = useRef<{ key: string; snapshot: string } | null>(null);
  useEffect(() => {
    options.closedItemsRef.current = [];
  }, [options.projectId]);

  useEffect(() => {
    if (!options.projectId || options.loading || options.restoringProjectId === options.projectId) return;
    const stored: StoredWorkbench = {
      version: WORKBENCH_STORAGE_VERSION,
      layout: stripLayoutContent(options.layout),
      activeGroupId: options.activeGroupId,
      navigationView: options.navigationView,
      navigationOpen: options.navigationOpen,
      sidebarWidth: options.sidebarWidth,
    };
    try {
      const key = options.mobile
        ? androidWorkbenchStorageKey(options.projectId)
        : workbenchStorageKey(options.projectId);
      const snapshot = JSON.stringify(stored);
      if (lastSavedRef.current?.key === key && lastSavedRef.current.snapshot === snapshot) return;
      window.localStorage.setItem(key, snapshot);
      lastSavedRef.current = { key, snapshot };
    } catch {
      // Reading must continue when browser storage is unavailable or full.
    }
  }, [
    options.activeGroupId,
    options.layout,
    options.loading,
    options.mobile,
    options.navigationOpen,
    options.navigationView,
    options.projectId,
    options.restoringProjectId,
    options.sidebarWidth,
  ]);
}
