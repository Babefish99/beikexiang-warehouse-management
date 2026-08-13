import * as React from "../../../apps/web/node_modules/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMobileViewport } from "../../../apps/web/src/features/mobile/use-mobile-viewport";
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

const hookRuntime = vi.hoisted(() => {
  let initialized = false;
  let effectInstalled = false;
  let value: unknown;
  let cleanup: (() => void) | undefined;

  return {
    reset() {
      initialized = false;
      effectInstalled = false;
      cleanup = undefined;
    },
    useState(initialValue: unknown | (() => unknown)) {
      if (!initialized) {
        value = typeof initialValue === "function" ? initialValue() : initialValue;
        initialized = true;
      }
      return [value, (nextValue: unknown) => (value = nextValue)] as const;
    },
    useEffect(effect: () => (() => void) | void) {
      if (!effectInstalled) {
        effectInstalled = true;
        cleanup = effect();
      }
    },
    unmount() {
      cleanup?.();
    },
  };
});

function renderMobileViewportHook(): {
  current(): boolean;
  rerender(): void;
  unmount(): void;
} {
  hookRuntime.reset();
  (React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown }).H = {
    useEffect: hookRuntime.useEffect as never,
    useState: hookRuntime.useState as never,
  };
  let rendered: boolean;
  const rerender = () => {
    rendered = useMobileViewport();
  };
  rerender();

  return {
    current: () => rendered,
    rerender,
    unmount: () => hookRuntime.unmount(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  (React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as { H: unknown }).H = null;
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

describe("useMobileViewport", () => {
  it("reads matchMedia matches as its initial value", () => {
    const media = stubMatchMedia(true);
    const hook = renderMobileViewportHook();

    expect(hook.current()).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 820px)");
    expect(media.media).toHaveLength(1);
  });

  it("synchronizes React state when matchMedia emits a change", () => {
    const media = stubMatchMedia(false);
    const hook = renderMobileViewportHook();

    media.emitChange(true);
    hook.rerender();

    expect(hook.current()).toBe(true);
  });

  it("removes its change listener when unmounted", () => {
    const media = stubMatchMedia(false);
    const hook = renderMobileViewportHook();

    hook.unmount();
    media.emitChange(true);
    hook.rerender();

    expect(media.media[0].removeEventListener).toHaveBeenCalledWith(
      "change",
      media.media[0].addEventListener.mock.calls[0][1],
    );
    expect(hook.current()).toBe(false);
  });
});
