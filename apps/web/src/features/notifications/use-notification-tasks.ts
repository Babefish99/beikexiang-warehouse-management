import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import {
  BUSINESS_COMPLETED_EVENT,
  getNotificationTasksSnapshot,
  NOTIFICATION_POLL_INTERVAL_MS,
  refreshNotificationTasks,
  subscribeNotificationTasks,
} from "./notification-tasks";

export function useNotificationTasks({ enabled, open }: { enabled: boolean; open: boolean }) {
  const snapshot = useSyncExternalStore(subscribeNotificationTasks, getNotificationTasksSnapshot);
  const wasOpen = useRef(open);
  const refresh = useCallback(() => refreshNotificationTasks({ fresh: true }), []);

  useEffect(() => {
    if (enabled) void refreshNotificationTasks();
  }, [enabled]);

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
    const onBusinessCompleted = () => void refreshNotificationTasks({ fresh: true, supersede: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener(BUSINESS_COMPLETED_EVENT, onBusinessCompleted);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener(BUSINESS_COMPLETED_EVENT, onBusinessCompleted);
    };
  }, [enabled, refresh]);

  return { ...snapshot, refresh };
}

export function useNotificationTaskSnapshot() {
  return useSyncExternalStore(subscribeNotificationTasks, getNotificationTasksSnapshot);
}
