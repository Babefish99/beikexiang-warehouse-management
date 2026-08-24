import { useSyncExternalStore } from "react";

export const COMPACT_SIDEBAR_MEDIA_QUERY = "(min-width: 821px) and (max-width: 1180px)";

export type CompactSidebarViewportStore = {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
};

export function createCompactSidebarViewportStore(
  target: Pick<Window, "matchMedia">,
): CompactSidebarViewportStore {
  const media = target.matchMedia(COMPACT_SIDEBAR_MEDIA_QUERY);
  return {
    getSnapshot: () => media.matches,
    subscribe(listener) {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
  };
}

let browserStore: CompactSidebarViewportStore | undefined;

export function useCompactSidebarViewport(): boolean {
  browserStore ??= createCompactSidebarViewportStore(window);
  return useSyncExternalStore(browserStore.subscribe, browserStore.getSnapshot, browserStore.getSnapshot);
}

export function getCompactSidebarShellClasses(isCompact: boolean, isPinned: boolean): string[] {
  if (!isCompact) return [];
  return isPinned
    ? ["app-shell--compact-sidebar", "app-shell--compact-sidebar-pinned"]
    : ["app-shell--compact-sidebar"];
}
