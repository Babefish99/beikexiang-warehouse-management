import { afterEach, describe, expect, it, vi } from "vitest";
import { createMobileViewportStore } from "../../../apps/web/src/features/mobile/use-mobile-viewport";
import {
  getMobileNavigation,
  isMobileNavigationActive,
  MOBILE_MEDIA_QUERY,
} from "../../../apps/web/src/features/mobile/mobile-navigation";

type MatchMediaStub = {
  matches: boolean;
  media: Array<MediaQueryList & { emitChange(matches: boolean): void }>;
  emitChange(matches: boolean): void;
};

function stubMatchMedia(initialMatches: boolean): MatchMediaStub {
  const media: Array<MediaQueryList & { emitChange(matches: boolean): void }> = [];
  vi.stubGlobal(
    "window",
    {
      matchMedia: vi.fn(() => {
        const listeners = new Set<(event: MediaQueryListEvent) => void>();
        const query = {
          matches: initialMatches,
          addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
            if (type === "change") listeners.add(listener);
          }),
          removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
            if (type === "change") listeners.delete(listener);
          }),
          emitChange(matches: boolean) {
            query.matches = matches;
            for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
          },
        } as MediaQueryList & { emitChange(matches: boolean): void };
        media.push(query);
        return query;
      }),
    },
  );

  return { matches: initialMatches, media, emitChange: (matches) => media[0].emitChange(matches) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mobile navigation", () => {
  it("gives admins the five approved task entries", () => {
    expect(getMobileNavigation("ADMIN").map((item) => item.label)).toEqual([
      "首页",
      "查询",
      "入库",
      "出库",
      "更多",
    ]);
  });

  it("removes mutation entries for finance", () => {
    expect(getMobileNavigation("FINANCE").map((item) => item.label)).toEqual([
      "首页",
      "查询",
      "报表",
      "更多",
    ]);
  });

  it("uses the inclusive 820px boundary and exact route matching", () => {
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 820px)");
    const inventory = getMobileNavigation("ADMIN").find((item) => item.label === "查询")!;
    expect(isMobileNavigationActive("/admin/inventory", inventory)).toBe(true);
    expect(isMobileNavigationActive("/admin/items", inventory)).toBe(false);
    const root = getMobileNavigation("ADMIN").find((item) => item.label === "首页")!;
    const more = getMobileNavigation("ADMIN").find((item) => item.label === "更多")!;
    expect(isMobileNavigationActive("/", root)).toBe(true);
    expect(isMobileNavigationActive("/admin/inventory", root)).toBe(false);
    expect(isMobileNavigationActive("/", more)).toBe(false);
    expect(isMobileNavigationActive("/admin/inventory", more)).toBe(false);
  });
});

describe("mobile viewport store", () => {
  it("reads matchMedia matches as its initial value", () => {
    const media = stubMatchMedia(true);
    const store = createMobileViewportStore(window);

    expect(store.getSnapshot()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 820px)");
    expect(media.media).toHaveLength(1);
  });

  it("synchronizes React state when matchMedia emits a change", () => {
    const media = stubMatchMedia(false);
    const store = createMobileViewportStore(window);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    media.emitChange(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBe(true);
    unsubscribe();
  });

  it("removes its change listener when unmounted", () => {
    const media = stubMatchMedia(false);
    const store = createMobileViewportStore(window);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    media.emitChange(true);

    expect(media.media[0].removeEventListener).toHaveBeenCalledWith(
      "change",
      media.media[0].addEventListener.mock.calls[0][1],
    );
    expect(listener).not.toHaveBeenCalled();
  });
});
