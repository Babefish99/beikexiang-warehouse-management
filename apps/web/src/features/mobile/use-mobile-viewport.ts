import { useSyncExternalStore } from "react";
import { MOBILE_MEDIA_QUERY } from "./mobile-navigation";

export type MobileViewportStore = {
  getSnapshot(): boolean;
  subscribe(listener: () => void): () => void;
};

export function createMobileViewportStore(target: Pick<Window, "matchMedia">): MobileViewportStore {
  const media = target.matchMedia(MOBILE_MEDIA_QUERY);
  return {
    getSnapshot: () => media.matches,
    subscribe(listener) {
      media.addEventListener("change", listener);
      return () => media.removeEventListener("change", listener);
    },
  };
}

let browserStore: MobileViewportStore | undefined;

export function useMobileViewport(): boolean {
  browserStore ??= createMobileViewportStore(window);
  return useSyncExternalStore(browserStore.subscribe, browserStore.getSnapshot, browserStore.getSnapshot);
}
