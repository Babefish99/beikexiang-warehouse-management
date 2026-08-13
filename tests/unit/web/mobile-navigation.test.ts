import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMobileNavigation,
  isMobileNavigationActive,
  MOBILE_MEDIA_QUERY,
} from "../../../apps/web/src/features/mobile/mobile-navigation";
import {
  getMobileViewportInitialValue,
  subscribeToMobileViewport,
} from "../../../apps/web/src/features/mobile/use-mobile-viewport";

type MatchMediaStub = {
  matches: boolean;
  emitChange(matches: boolean): void;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function stubMatchMedia(initialMatches: boolean): MatchMediaStub {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const media = {
    matches: initialMatches,
    addEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: MediaQueryListEvent) => void) => {
      if (type === "change") listeners.delete(listener);
    }),
    emitChange(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
    },
  };

  vi.stubGlobal("window", {
    matchMedia: vi.fn(() => media),
  });

  return media;
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
  });
});

describe("mobile viewport hook seam", () => {
  it("reads matchMedia matches as the initial value", () => {
    const media = stubMatchMedia(true);

    expect(getMobileViewportInitialValue()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 820px)");
    expect(media.addEventListener).not.toHaveBeenCalled();
  });

  it("synchronizes the value when matchMedia emits a change", () => {
    const media = stubMatchMedia(false);
    const update = vi.fn();
    subscribeToMobileViewport(update);

    media.emitChange(true);

    expect(update).toHaveBeenCalledWith(true);
  });

  it("removes its change listener when unsubscribed", () => {
    const media = stubMatchMedia(false);
    const update = vi.fn();
    const unsubscribe = subscribeToMobileViewport(update);

    unsubscribe();
    media.emitChange(true);

    expect(media.removeEventListener).toHaveBeenCalledWith("change", media.addEventListener.mock.calls[0][1]);
    expect(update).not.toHaveBeenCalled();
  });
});
