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
type RefreshOptions = { identityKey: string; enabled: boolean; fresh?: boolean; supersede?: boolean };
type FetchNotifications = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const emptySnapshot: Snapshot = { tasks: [], loading: false, error: null };

export function notificationIdentityKey(userId: string, role: "ADMIN" | "FINANCE"): string {
  return `${userId}:${role}`;
}

export function createNotificationTaskStore(fetchNotifications: FetchNotifications) {
  let snapshot = emptySnapshot;
  let activeIdentityKey: string | null = null;
  let activeEnabled = false;
  let generation = 0;
  let requestSequence = 0;
  let inFlight: { identityKey: string; generation: number; promise: Promise<void>; forced: boolean } | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: Snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const selectIdentity = (identityKey: string, enabled: boolean) => {
    if (activeIdentityKey === identityKey && activeEnabled === enabled) return;
    activeIdentityKey = identityKey;
    activeEnabled = enabled;
    generation += 1;
    requestSequence += 1;
    inFlight = null;
    publish(emptySnapshot);
  };

  const getSnapshot = (identityKey: string): Snapshot => activeIdentityKey === identityKey ? snapshot : emptySnapshot;

  const subscribe = (identityKey: string, listener: () => void): (() => void) => {
    const notifyIdentity = () => listener();
    listeners.add(notifyIdentity);
    return () => listeners.delete(notifyIdentity);
  };

  const refresh = ({ identityKey, enabled, fresh = false, supersede = false }: RefreshOptions): Promise<void> => {
    selectIdentity(identityKey, enabled);
    if (!enabled) return Promise.resolve();
    if (inFlight && !supersede && (!fresh || inFlight.forced)) return inFlight.promise;

    requestSequence += 1;
    const sequence = requestSequence;
    const requestGeneration = generation;
    publish({ ...snapshot, loading: true, error: null });

    const promise = fetchNotifications(`${apiBaseUrl}/admin/notifications`, { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error("通知中心加载失败");
        const tasks = await response.json() as NotificationTask[];
        if (activeEnabled && identityKey === activeIdentityKey && requestGeneration === generation && sequence === requestSequence) {
          publish({ tasks, loading: false, error: null });
        }
      })
      .catch((error: unknown) => {
        if (activeEnabled && identityKey === activeIdentityKey && requestGeneration === generation && sequence === requestSequence) {
          publish({ tasks: [], loading: false, error: error instanceof Error ? error.message : "通知中心加载失败" });
        }
      })
      .finally(() => {
        if (inFlight?.promise === promise) inFlight = null;
      });

    inFlight = { identityKey, generation: requestGeneration, promise, forced: fresh };
    return promise;
  };

  const load = async (identityKey: string): Promise<NotificationTask[]> => {
    await refresh({ identityKey, enabled: true });
    while (inFlight?.identityKey === identityKey && inFlight.generation === generation) await inFlight.promise;
    const current = getSnapshot(identityKey);
    if (current.error) throw new Error(current.error);
    return current.tasks;
  };

  return { getSnapshot, subscribe, refresh, load };
}

const notificationTaskStore = createNotificationTaskStore((input, init) => fetch(input, init));

export const getNotificationTasksSnapshot = notificationTaskStore.getSnapshot;
export const subscribeNotificationTasks = notificationTaskStore.subscribe;
export const refreshNotificationTasks = notificationTaskStore.refresh;
export const loadInventoryNotifications = notificationTaskStore.load;

export function announceBusinessCompleted(): void {
  window.dispatchEvent(new Event(BUSINESS_COMPLETED_EVENT));
}
