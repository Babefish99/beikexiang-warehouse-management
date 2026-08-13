import { describe, expect, it, vi } from "vitest";

import {
  createNotificationTaskStore,
} from "../../../apps/web/src/features/notifications/notification-tasks.js";

const adminATasks = [{
  id: "admin-a-task",
  kind: "PENDING_OUTBOUND" as const,
  title: "Admin A task",
  description: "Only Admin A should see this",
  href: "/admin/outbound",
  priority: 1,
}];

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("notification task identity isolation", () => {
  it("invalidates an Admin A response when notifications become disabled", async () => {
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    const store = createNotificationTaskStore(fetchMock);

    const adminRequest = store.refresh({ identityKey: "admin-a:ADMIN", enabled: true });
    const disabledRequest = store.refresh({ identityKey: "finance-a:FINANCE", enabled: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot("finance-a:FINANCE")).toEqual({ tasks: [], loading: false, error: null });

    pending.resolve(response(adminATasks));
    await Promise.all([adminRequest, disabledRequest]);

    expect(store.getSnapshot("finance-a:FINANCE")).toEqual({ tasks: [], loading: false, error: null });
  });

  it("clears Admin A tasks before Admin B's request completes", async () => {
    const adminBPending = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(adminATasks))
      .mockImplementationOnce(() => adminBPending.promise);
    const store = createNotificationTaskStore(fetchMock);

    await store.refresh({ identityKey: "admin-a:ADMIN", enabled: true });
    expect(store.getSnapshot("admin-a:ADMIN").tasks).toEqual(adminATasks);

    const adminBRequest = store.refresh({ identityKey: "admin-b:ADMIN", enabled: true });

    expect(store.getSnapshot("admin-b:ADMIN")).toEqual({ tasks: [], loading: true, error: null });
    expect(store.getSnapshot("admin-b:ADMIN").tasks).not.toContainEqual(expect.objectContaining({ id: "admin-a-task" }));

    adminBPending.resolve(response([]));
    await adminBRequest;
  });

  it("does not request notifications for a disabled identity", async () => {
    const fetchMock = vi.fn();
    const store = createNotificationTaskStore(fetchMock);

    await store.refresh({ identityKey: "finance-a:FINANCE", enabled: false });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
