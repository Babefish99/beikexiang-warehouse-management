import { describe, expect, it } from "vitest";

import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";

describe("audit service", () => {
  it("keeps an immutable copy of before and after data", async () => {
    const service = new InMemoryAuditService();
    const before = { quantity: 3 };
    const after = { quantity: 2 };
    await service.record({
      actorUserId: "u-1",
      actorRole: "ADMIN",
      action: "ADJUST",
      entityType: "STOCK",
      entityId: "s-1",
      requestId: "req-1",
      beforeData: before,
      afterData: after,
      occurredAt: "2026-08-07T00:00:00.000Z",
      status: "FAILED",
      errorMessage: "quantity mismatch",
    });
    before.quantity = 0;
    after.quantity = 0;

    expect(service.events[0].beforeData).toEqual({ quantity: 3 });
    expect(service.events[0].afterData).toEqual({ quantity: 2 });
    expect(service.events[0]).toMatchObject({
      actorRole: "ADMIN",
      requestId: "req-1",
      occurredAt: "2026-08-07T00:00:00.000Z",
      status: "FAILED",
      errorMessage: "quantity mismatch",
    });
  });
});
