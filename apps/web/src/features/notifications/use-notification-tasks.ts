import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  BUSINESS_COMPLETED_EVENT,
  getNotificationTasksSnapshot,
  NOTIFICATION_POLL_INTERVAL_MS,
  refreshNotificationTasks,
  subscribeNotificationTasks,
} from "./notification-tasks";

export function useNotificationTasks({ identityKey, enabled, open }: { identityKey: string; enabled: boolean; open: boolean }) {
  const subscribe = useCallback((listener: () => void) => subscribeNotificationTasks(identityKey, listener), [identityKey]);
  const getSnapshot = useCallback(() => getNotificationTasksSnapshot(identityKey), [identityKey]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const wasOpen = useRef(open);
  const refresh = useCallback(() => refreshNotificationTasks({ identityKey, enabled, fresh: true }), [enabled, identityKey]);

  useEffect(() => {
    void refreshNotificationTasks({ identityKey, enabled });
  }, [enabled, identityKey]);

  useEffect(() => {
    if (enabled && open && !wasOpen.current) void refresh();
    wasOpen.current = open;
  }, [enabled, open, refresh]);

  useEffect(() => {
    if (!enabled || !open) return;
    const interval = window.setInterval(() => void refresh(), NOTIFICATION_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, open, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onBusinessCompleted = () => void refreshNotificationTasks({ identityKey, enabled, fresh: true, supersede: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(BUSINESS_COMPLETED_EVENT, onBusinessCompleted);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(BUSINESS_COMPLETED_EVENT, onBusinessCompleted);
    };
  }, [enabled, identityKey, refresh]);

  return { ...snapshot, refresh };
}

export function useNotificationTaskSnapshot(identityKey: string) {
  const subscribe = useCallback((listener: () => void) => subscribeNotificationTasks(identityKey, listener), [identityKey]);
  const getSnapshot = useCallback(() => getNotificationTasksSnapshot(identityKey), [identityKey]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
