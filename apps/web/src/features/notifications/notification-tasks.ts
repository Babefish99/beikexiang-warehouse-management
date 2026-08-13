export type NotificationTaskKind = "PENDING_OUTBOUND" | "LOW_STOCK" | "STOCKTAKE" | "PERIOD_CLOSE" | "ANOMALY";

export type NotificationTask = {
  id: string;
  kind: NotificationTaskKind;
  title: string;
  description: string;
  href: string;
  priority: number;
};

export const NOTIFICATION_POLL_INTERVAL_MS = 30_000;
export const BUSINESS_COMPLETED_EVENT = "warehouse:business-completed";
export const OPEN_NOTIFICATION_CENTER_EVENT = "warehouse:open-notification-center";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

type Snapshot = { tasks: NotificationTask[]; loading: boolean; error: string | null };
let snapshot: Snapshot = { tasks: [], loading: false, error: null };
let requestSequence = 0;
let inFlight: { promise: Promise<void>; forced: boolean } | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getNotificationTasksSnapshot(): Snapshot {
  return snapshot;
}

export function subscribeNotificationTasks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshNotificationTasks({ fresh = false, supersede = false }: { fresh?: boolean; supersede?: boolean } = {}): Promise<void> {
  if (inFlight && !supersede && (!fresh || inFlight.forced)) return inFlight.promise;

  requestSequence += 1;
  const sequence = requestSequence;
  publish({ ...snapshot, loading: true, error: null });

  const promise = fetch(`${apiBaseUrl}/admin/notifications`, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) throw new Error("通知中心加载失败");
      const tasks = await response.json() as NotificationTask[];
      if (sequence === requestSequence) publish({ tasks, loading: false, error: null });
    })
    .catch((error: unknown) => {
      if (sequence === requestSequence) {
        publish({ tasks: [], loading: false, error: error instanceof Error ? error.message : "通知中心加载失败" });
      }
    })
    .finally(() => {
      if (inFlight?.promise === promise) inFlight = null;
    });

  inFlight = { promise, forced: fresh };
  return promise;
}

export async function loadInventoryNotifications(): Promise<NotificationTask[]> {
  await refreshNotificationTasks();
  while (inFlight) await inFlight.promise;
  const current = getNotificationTasksSnapshot();
  if (current.error) throw new Error(current.error);
  return current.tasks;
}

export function announceBusinessCompleted(): void {
  window.dispatchEvent(new Event(BUSINESS_COMPLETED_EVENT));
}
