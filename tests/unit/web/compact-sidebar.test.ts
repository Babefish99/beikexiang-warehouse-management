import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPACT_SIDEBAR_MEDIA_QUERY,
  createCompactSidebarViewportStore,
  getCompactSidebarShellClasses,
} from "../../../apps/web/src/features/layout/compact-sidebar";

function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initialMatches,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
    emit(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener();
    },
  };
  return { matchMedia: vi.fn(() => media), media };
}

afterEach(() => vi.restoreAllMocks());

describe("compact sidebar", () => {
  it("uses the desktop-only range between mobile and full navigation", () => {
    expect(COMPACT_SIDEBAR_MEDIA_QUERY).toBe("(min-width: 821px) and (max-width: 1180px)");
  });

  it("updates the compact state when the media query changes", () => {
    const target = stubMatchMedia(true);
    const store = createCompactSidebarViewportStore(target);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    expect(store.getSnapshot()).toBe(true);
    expect(target.matchMedia).toHaveBeenCalledWith(COMPACT_SIDEBAR_MEDIA_QUERY);
    target.media.emit(false);
    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBe(false);

    unsubscribe();
  });

  it("adds the pinned workspace class only for a pinned compact sidebar", () => {
    expect(getCompactSidebarShellClasses(false, true)).toEqual([]);
    expect(getCompactSidebarShellClasses(true, false)).toEqual(["app-shell--compact-sidebar"]);
    expect(getCompactSidebarShellClasses(true, true)).toEqual([
      "app-shell--compact-sidebar",
      "app-shell--compact-sidebar-pinned",
    ]);
  });
});
