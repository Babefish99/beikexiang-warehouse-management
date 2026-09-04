import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInventoryMemoryState } from "../../../apps/api/src/application/inventory/inventory-memory-state.js";
import {
  OutboundService,
  InMemoryOutboundStore,
  type PendingApproval,
} from "../../../apps/api/src/application/inventory/outbound-service.js";
import { InMemoryAuditService } from "../../../apps/api/src/infrastructure/audit/audit-service.js";
import { createPersistenceAdapters } from "../../../apps/api/src/infrastructure/db/runtime.js";
import { registerOutboundRoutes } from "../../../apps/api/src/routes/admin/outbound.js";
import { buildServer } from "../../../apps/api/src/server.js";

function makeService() {
  const store = new InMemoryOutboundStore();
  store.seedApproval({
    id: "approval-1",
    weComSpNo: "202607230021",
    status: "PENDING_OUTBOUND",
    lines: [{
      id: "line-1",
      requestedItemName: "Tea leaves",
      requestedQuantity: "10",
      unit: "box",
      itemId: "item-1",
      legacyResolutionStatus: "EXACT_LOCKED",
    }],
  });
  store.seedItem({ id: "item-1", code: "TEA-0001", name: "Tea leaves", unit: "box", isActive: true });
  store.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" });
  return { store, service: new OutboundService(store) };
}

function seedIntentApproval(store: InMemoryOutboundStore, overrides: Partial<PendingApproval> = {}): void {
  store.seedApproval({
    id: "intent-approval",
    weComSpNo: "202609040001",
    status: "PENDING_OUTBOUND",
    lines: [{
      id: "intent-line",
      requestedItemName: "白酒",
      requestedQuantity: "2",
      unit: "　瓶　",
      note: "宴请使用",
      legacyResolutionStatus: "NOT_APPLICABLE",
    }],
    ...overrides,
  });
}

function seedSingleQuantityApproval(store: InMemoryOutboundStore): void {
  store.seedApproval({
    id: "approval-1",
    weComSpNo: "202607230021",
    status: "PENDING_OUTBOUND",
    lines: [{
      id: "line-1",
      requestedItemName: "Tea leaves",
      requestedQuantity: "1",
      unit: "box",
      itemId: "item-1",
      legacyResolutionStatus: "EXACT_LOCKED",
    }],
  });
}

async function createSessionCookie(app: ReturnType<typeof buildServer>, role: "ADMIN" | "FINANCE"): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/auth/local?returnTo=/admin/outbound&role=${role}`, remoteAddress: "127.0.0.1", headers: { host: "localhost:3001" } });
  return response.headers["set-cookie"] as string;
}

function addAdminActor(app: ReturnType<typeof Fastify>, id = "local-admin"): void {
  app.decorateRequest("adminUser", undefined);
  app.addHook("onRequest", async (request) => {
    request.adminUser = { id, weComUserId: id, name: "Local Administrator", role: "ADMIN" };
  });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
  vi.stubEnv("API_BASE_URL", "http://localhost:3001");
  vi.stubEnv("WEB_BASE_URL", "http://localhost:5174");
  vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("outbound service", () => {
  it("lists only positive-stock candidates for an intent line and keeps its source facts immutable", async () => {
    const store = new InMemoryOutboundStore();
    seedIntentApproval(store);
    store.seedItem({ id: "item-exact", code: "ZZ0001", name: "白酒", unit: "瓶", isActive: true });
    store.seedItem({ id: "item-substring", code: "YY0001", name: "陈年白酒", unit: "瓶", isActive: true });
    store.seedItem({ id: "item-maotai", code: "BJ0002", name: "飞天茅台", unit: "瓶", isActive: true });
    store.seedItem({ id: "item-tea", code: "CY0001", name: "茶叶", unit: "盒", isActive: true });
    store.seedItem({ id: "item-inactive", code: "AA0001", name: "停用白酒", unit: "瓶", isActive: false });
    store.seedItem({ id: "item-empty", code: "AB0001", name: "无库存白酒", unit: "瓶", isActive: true });
    store.seedBatch({ id: "batch-exact", warehouseId: "wh-1", itemId: "item-exact", remainingQuantity: "1", unitCost: "18" });
    store.seedBatch({ id: "batch-substring", warehouseId: "wh-2", itemId: "item-substring", remainingQuantity: "2", unitCost: "19" });
    store.seedBatch({ id: "batch-maotai", warehouseId: "wh-1", itemId: "item-maotai", remainingQuantity: "3", unitCost: "20" });
    store.seedBatch({ id: "batch-tea", warehouseId: "wh-1", itemId: "item-tea", remainingQuantity: "4", unitCost: "8" });
    store.seedBatch({ id: "batch-inactive", warehouseId: "wh-1", itemId: "item-inactive", remainingQuantity: "5", unitCost: "6" });
    store.seedBatch({ id: "batch-empty", warehouseId: "wh-1", itemId: "item-empty", remainingQuantity: "0", unitCost: "5" });
    const service = new OutboundService(store);

    await expect(service.listOptions("intent-approval")).resolves.toEqual({
      approvalId: "intent-approval",
      lines: [{
        approvalLineId: "intent-line",
        items: [
          { id: "item-exact", code: "ZZ0001", name: "白酒", unit: "瓶", isActive: true, availableQuantity: "1" },
          { id: "item-substring", code: "YY0001", name: "陈年白酒", unit: "瓶", isActive: true, availableQuantity: "2" },
          { id: "item-maotai", code: "BJ0002", name: "飞天茅台", unit: "瓶", isActive: true, availableQuantity: "3" },
        ],
      }],
      batches: [
        { batchId: "batch-exact", warehouseId: "wh-1", itemId: "item-exact", remainingQuantity: "1", unitCost: "18" },
        { batchId: "batch-substring", warehouseId: "wh-2", itemId: "item-substring", remainingQuantity: "2", unitCost: "19" },
        { batchId: "batch-maotai", warehouseId: "wh-1", itemId: "item-maotai", remainingQuantity: "3", unitCost: "20" },
      ],
    });
    await expect(service.listPending()).resolves.toEqual([{
      id: "intent-approval",
      weComSpNo: "202609040001",
      status: "PENDING_OUTBOUND",
      lines: [{
        id: "intent-line",
        requestedItemName: "白酒",
        requestedQuantity: "2",
        unit: "　瓶　",
        note: "宴请使用",
        legacyResolutionStatus: "NOT_APPLICABLE",
      }],
    }]);
  });

  it("ranks a code match before otherwise eligible same-unit items without selecting it", async () => {
    const store = new InMemoryOutboundStore();
    seedIntentApproval(store, {
      lines: [{
        id: "intent-line",
        requestedItemName: "BJ0002",
        requestedQuantity: "2",
        unit: "瓶",
        legacyResolutionStatus: "NOT_APPLICABLE",
      }],
    });
    store.seedItem({ id: "item-other", code: "AA0001", name: "高粱酒", unit: "瓶", isActive: true });
    store.seedItem({ id: "item-code", code: "BJ0002", name: "飞天茅台", unit: "瓶", isActive: true });
    store.seedBatch({ id: "batch-other", warehouseId: "wh-1", itemId: "item-other", remainingQuantity: "1", unitCost: "10" });
    store.seedBatch({ id: "batch-code", warehouseId: "wh-1", itemId: "item-code", remainingQuantity: "1", unitCost: "20" });

    const options = await new OutboundService(store).listOptions("intent-approval");

    expect(options.lines[0]?.items.map((item) => item.id)).toEqual(["item-code", "item-other"]);
    await expect(store.getApproval("intent-approval")).resolves.toMatchObject({
      lines: [{ id: "intent-line", itemId: undefined }],
    });
  });

  it("locks eligible legacy options to the historical item", async () => {
    const { store, service } = makeService();

    store.seedBatch({ id: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" });
    store.seedItem({ id: "item-2", code: "TEA-0002", name: "Other tea", unit: "box", isActive: true });
    store.seedBatch({ id: "batch-other-item", warehouseId: "wh-3", itemId: "item-2", remainingQuantity: "8", unitCost: "30" });
    store.seedBatch({ id: "batch-empty", warehouseId: "wh-4", itemId: "item-1", remainingQuantity: "0", unitCost: "15" });

    await expect(service.listOptions("approval-1")).resolves.toEqual({
      approvalId: "approval-1",
      lines: [{
        approvalLineId: "line-1",
        items: [{ id: "item-1", code: "TEA-0001", name: "Tea leaves", unit: "box", isActive: true, availableQuantity: "13" }],
      }],
      batches: [
        { batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" },
        { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" },
      ],
    });
  });

  it("rejects when listing batches for an unknown approval", async () => {
    const { service } = makeService();

    await expect(service.listOptions("missing-approval")).rejects.toThrow("approval not found: missing-approval");
  });

  it.each(["COMPLETED", "VOIDED"] as const)("rejects when listing batches for a %s approval", async (status) => {
    const { store, service } = makeService();
    store.seedApproval({
      id: "approval-1",
      weComSpNo: "202607230021",
      status,
      lines: [{ id: "line-1", requestedItemName: "Tea leaves", itemId: "item-1", requestedQuantity: "10", unit: "box", legacyResolutionStatus: "EXACT_LOCKED" }],
    });

    await expect(service.listOptions("approval-1")).rejects.toThrow("approval is already closed");
  });

  it("keeps reapply-required approvals visible but rejects their options", async () => {
    const store = new InMemoryOutboundStore();
    store.seedApproval({
      id: "reapply-approval",
      weComSpNo: "202609040002",
      status: "REAPPLY_REQUIRED",
      lines: [{
        id: "reapply-line",
        requestedItemName: "旧占位物品",
        requestedQuantity: "1",
        unit: "瓶",
        legacyResolutionStatus: "REAPPLY_REQUIRED",
      }],
    });
    const service = new OutboundService(store);

    await expect(service.listPending()).resolves.toMatchObject([{ id: "reapply-approval", status: "REAPPLY_REQUIRED" }]);
    await expect(service.listOptions("reapply-approval")).rejects.toThrow("旧审批信息不完整，需重新申请");
  });

  it("confirms a batch-aware issue and posts one negative ledger entry", async () => {
    const { store, service } = makeService();

    await expect(service.confirm({
      approvalId: "approval-1",
      operatorId: "operator-1",
      decisions: [{
        approvalLineId: "line-1",
        selectedItemId: "item-1",
        allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }],
      }],
    })).resolves.toMatchObject({ status: "COMPLETED", amount: "200.00" });
    expect(store.batch("batch-1")?.remainingQuantity).toBe("0");
    expect(store.ledger()).toMatchObject([{ type: "OUTBOUND", quantity: "-10", unitCost: "20", amount: "200.00" }]);
    expect(store.decisions()).toMatchObject([{
      approvalLineId: "line-1",
      selectedItemId: "item-1",
      actualQuantity: "10",
      varianceReason: undefined,
      decidedBy: "operator-1",
    }]);
  });

  it("preserves each allocation's decision when two lines use the same item and batch", async () => {
    const state = createInventoryMemoryState();
    const store = new InMemoryOutboundStore(state);
    store.seedApproval({
      id: "approval-1",
      weComSpNo: "multi-line-1",
      status: "PENDING_OUTBOUND",
      lines: [
        { id: "line-1", requestedItemName: "Shared item", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" },
        { id: "line-2", requestedItemName: "Shared item", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" },
      ],
    });
    store.seedItem({ id: "item-1", code: "ITEM-1", name: "Shared item", unit: "box", isActive: true });
    store.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "2", unitCost: "20" });

    await new OutboundService(store).confirm({
      approvalId: "approval-1",
      operatorId: "operator-1",
      decisions: [
        { approvalLineId: "line-1", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] },
        { approvalLineId: "line-2", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] },
      ],
    });

    const decisions = [...state.outboundDecisions.values()];
    expect([...state.issuedAllocations.values()]).toMatchObject([
      { outboundDecisionLineId: decisions[0]?.id, itemId: "item-1", batchId: "batch-1" },
      { outboundDecisionLineId: decisions[1]?.id, itemId: "item-1", batchId: "batch-1" },
    ]);
  });

  it("sums persisted two-decimal allocation amounts for the order total", async () => {
    const state = createInventoryMemoryState();
    const store = new InMemoryOutboundStore(state);
    store.seedApproval({
      id: "approval-1",
      weComSpNo: "rounding-1",
      status: "PENDING_OUTBOUND",
      lines: [
        { id: "line-1", requestedItemName: "Fractional item", requestedQuantity: "1", unit: "piece", legacyResolutionStatus: "NOT_APPLICABLE" },
        { id: "line-2", requestedItemName: "Fractional item", requestedQuantity: "1", unit: "piece", legacyResolutionStatus: "NOT_APPLICABLE" },
      ],
    });
    store.seedItem({ id: "item-1", code: "ITEM-1", name: "Fractional item", unit: "piece", isActive: true });
    store.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "2", unitCost: "0.005" });

    const order = await new OutboundService(store).confirm({
      approvalId: "approval-1",
      operatorId: "operator-1",
      decisions: [
        { approvalLineId: "line-1", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] },
        { approvalLineId: "line-2", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] },
      ],
    });

    expect(order.amount).toBe("0.02");
    expect([...state.issuedAllocations.values()]).toMatchObject([{ amount: "0.01" }, { amount: "0.01" }]);
    expect(store.ledger()).toMatchObject([{ amount: "0.01" }, { amount: "0.01" }]);
  });

  it("closes a partial issue and prevents a later top-up on the same approval", async () => {
    const { store, service } = makeService();

    await expect(service.confirm({
      approvalId: "approval-1",
      operatorId: "operator-2",
      decisions: [{
        approvalLineId: "line-1",
        selectedItemId: "item-1",
        allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "4" }],
        varianceReason: "按实际需要少出",
      }],
    })).resolves.toMatchObject({ status: "PARTIALLY_ISSUED" });
    expect(store.decisions()).toMatchObject([{ varianceReason: "按实际需要少出", decidedBy: "operator-2" }]);
    await expect(service.confirm({
      approvalId: "approval-1",
      operatorId: "operator-2",
      decisions: [{
        approvalLineId: "line-1",
        selectedItemId: "item-1",
        allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "6" }],
      }],
    })).rejects.toThrow("approval is already closed");
  });

  it("stores one zero decision without inventory effects and closes the order as unavailable", async () => {
    const { store, service } = makeService();

    await expect(service.confirm({
      approvalId: "approval-1",
      operatorId: "operator-zero",
      decisions: [{ approvalLineId: "line-1", allocations: [], varianceReason: "暂时无法供应" }],
    })).resolves.toMatchObject({ status: "UNAVAILABLE", actualQuantity: "0", amount: "0.00" });
    expect(store.batch("batch-1")?.remainingQuantity).toBe("10");
    expect(store.ledger()).toHaveLength(0);
    expect(store.decisions()).toMatchObject([{
      approvalLineId: "line-1",
      selectedItemId: undefined,
      actualQuantity: "0",
      varianceReason: "暂时无法供应",
      decidedBy: "operator-zero",
    }]);
  });

  it("cancels an unissued approval with a required reason and no ledger entry", async () => {
    const { store, service } = makeService();

    await expect(service.cancelBeforeIssue({ approvalId: "approval-1", reason: "申请人取消领用" })).resolves.toMatchObject({ status: "VOIDED" });
    expect(store.ledger()).toHaveLength(0);
  });
});

describe("in-memory outbound operational counts", () => {
  it("counts reapplication work and post-issue revocation exceptions separately", async () => {
    const persistence = createPersistenceAdapters({ driver: "memory" });

    try {
      await persistence.inventory.approvalSyncStore.save({
        id: "reapply-approval",
        weComSpNo: "2026090400000101",
        sourceTemplateId: "legacy-template",
        status: "APPROVED",
        outboundStatus: "REAPPLY_REQUIRED",
        applicantUserId: "applicant-1",
        applicantName: "Applicant One",
        purpose: "Legacy request",
        submittedAt: "2026-09-04T00:00:00.000Z",
        lines: [{ requestedItemName: "Legacy item", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "REAPPLY_REQUIRED" }],
      });
      await persistence.inventory.approvalSyncStore.save({
        id: "revoked-approval",
        weComSpNo: "2026090400000102",
        sourceTemplateId: "intent-template",
        status: "REVOKED",
        outboundStatus: "COMPLETED",
        applicantUserId: "applicant-2",
        applicantName: "Applicant Two",
        purpose: "Revoked request",
        submittedAt: "2026-09-04T00:00:00.000Z",
        lines: [{ requestedItemName: "Issued item", requestedQuantity: "1", unit: "box", legacyResolutionStatus: "NOT_APPLICABLE" }],
      });

      await expect(persistence.inventory.readSource.getPendingOutboundCount()).resolves.toBe(1);
      await expect(persistence.inventory.readSource.getApprovalExceptionCount()).resolves.toBe(1);
    } finally {
      await persistence.disconnect();
    }
  });
});

describe("outbound options route", () => {
  it("uses the approvalId path parameter and returns options", async () => {
    const app = Fastify();
    const { store, service } = makeService();
    store.seedBatch({ id: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" });
    store.seedBatch({ id: "batch-empty", warehouseId: "wh-4", itemId: "item-1", remainingQuantity: "0", unitCost: "15" });
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/outbound/approval-1/options" });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        approvalId: "approval-1",
        lines: [{
          approvalLineId: "line-1",
          items: [{ id: "item-1", code: "TEA-0001", name: "Tea leaves", unit: "box", isActive: true, availableQuantity: "13" }],
        }],
        batches: [
          { batchId: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "10", unitCost: "20" },
          { batchId: "batch-2", warehouseId: "wh-2", itemId: "item-1", remainingQuantity: "3", unitCost: "25" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("returns the service error for an unknown approval", async () => {
    const app = Fastify();
    registerOutboundRoutes(app, { outboundService: new OutboundService(new InMemoryOutboundStore()) });

    try {
      const response = await app.inject({ method: "GET", url: "/admin/outbound/missing-approval/options" });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: "approval not found: missing-approval" });
    } finally {
      await app.close();
    }
  });

  it("rejects unauthenticated access to the options route", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({ method: "GET", url: "/admin/outbound/approval-1/options" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    } finally {
      await app.close();
    }
  });
});

describe("outbound mutation routes", () => {
  it("forwards only decision input and the authenticated administrator identity", async () => {
    const app = Fastify();
    addAdminActor(app);
    const { store, service } = makeService();
    seedSingleQuantityApproval(store);
    const confirm = vi.spyOn(service, "confirm");
    registerOutboundRoutes(app, { outboundService: service });
    const decisions = [{
      approvalLineId: "line-1",
      selectedItemId: "item-1",
      allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }],
    }];

    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: { approvalId: "approval-1", decisions, operatorId: "forged-client-actor" },
      });

      expect(response.statusCode).toBe(200);
      expect(confirm).toHaveBeenCalledWith({ approvalId: "approval-1", operatorId: "local-admin", decisions });
      expect(store.decisions()).toMatchObject([{ approvalLineId: "line-1", decidedBy: "local-admin" }]);
    } finally { await app.close(); }
  });

  it("records only allowlisted confirmation request and result fields in the mutation audit", async () => {
    const app = Fastify();
    addAdminActor(app);
    const auditService = new InMemoryAuditService();
    app.decorate("auditService", auditService);
    const { store, service } = makeService();
    seedSingleQuantityApproval(store);
    registerOutboundRoutes(app, { outboundService: service });
    const decisions = [{
      approvalLineId: "line-1",
      selectedItemId: "item-1",
      allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }],
    }];

    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: {
          approvalId: "approval-1",
          decisions,
          callbackPayload: "sensitive-callback-payload",
          EncodingAESKey: "sensitive-aes-key",
          headers: { authorization: "Bearer sensitive-access-token" },
        },
      });
      const result = response.json();

      expect(response.statusCode).toBe(200);
      expect(auditService.events).toHaveLength(1);
      expect(auditService.events[0]?.afterData).toEqual({
        request: { approvalId: "approval-1", decisions },
        result: {
          id: result.id,
          approvalId: "approval-1",
          status: "COMPLETED",
          actualQuantity: "1",
          amount: "20.00",
        },
      });
      expect(JSON.stringify(auditService.events)).not.toMatch(/sensitive|callbackPayload|EncodingAESKey|authorization/i);
    } finally { await app.close(); }
  });

  it("defensively rejects confirmation when the administrator hook did not attach an actor", async () => {
    const app = Fastify();
    const { store, service } = makeService();
    seedSingleQuantityApproval(store);
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: {
          approvalId: "approval-1",
          decisions: [{
            approvalLineId: "line-1",
            selectedItemId: "item-1",
            allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }],
          }],
        },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: "unauthorized" });
    } finally { await app.close(); }
  });

  it("rejects the removed flat allocation request instead of assigning a system actor", async () => {
    const app = Fastify();
    addAdminActor(app);
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: {
          approvalId: "approval-1",
          allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }],
        },
      });

      expect(response.statusCode).toBe(400);
    } finally { await app.close(); }
  });

  it.each([
    {
      name: "a null decision",
      decisions: [null],
      error: "decisions[0] must be an object",
    },
    {
      name: "a non-string approval line id",
      decisions: [{ approvalLineId: 7, allocations: [] }],
      error: "decisions[0].approvalLineId must be a non-empty string",
    },
    {
      name: "a non-string selected item id",
      decisions: [{ approvalLineId: "line-1", selectedItemId: 7, allocations: [] }],
      error: "decisions[0].selectedItemId must be a non-empty string",
    },
    {
      name: "a non-string variance reason",
      decisions: [{ approvalLineId: "line-1", allocations: [], varianceReason: 7 }],
      error: "decisions[0].varianceReason must be a string",
    },
    {
      name: "missing allocations",
      decisions: [{ approvalLineId: "line-1" }],
      error: "decisions[0].allocations must be an array",
    },
    {
      name: "non-array allocations",
      decisions: [{ approvalLineId: "line-1", allocations: {} }],
      error: "decisions[0].allocations must be an array",
    },
    {
      name: "a null allocation",
      decisions: [{ approvalLineId: "line-1", allocations: [null] }],
      error: "decisions[0].allocations[0] must be an object",
    },
    {
      name: "an allocation missing its warehouse id",
      decisions: [{ approvalLineId: "line-1", allocations: [{ batchId: "batch-1", quantity: "1" }] }],
      error: "decisions[0].allocations[0].warehouseId must be a non-empty string",
    },
    {
      name: "an allocation missing its batch id",
      decisions: [{ approvalLineId: "line-1", allocations: [{ warehouseId: "wh-1", quantity: "1" }] }],
      error: "decisions[0].allocations[0].batchId must be a non-empty string",
    },
    {
      name: "a numeric allocation quantity",
      decisions: [{ approvalLineId: "line-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: 1 }] }],
      error: "decisions[0].allocations[0].quantity must be a non-empty string",
    },
    {
      name: "an allocation missing its quantity",
      decisions: [{ approvalLineId: "line-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1" }] }],
      error: "decisions[0].allocations[0].quantity must be a non-empty string",
    },
  ])("returns a stable 400 for $name", async ({ decisions, error }) => {
    const app = Fastify();
    addAdminActor(app);
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: { approvalId: "approval-1", decisions },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error });
    } finally { await app.close(); }
  });

  it("keeps malformed confirmation details out of failed mutation audits", async () => {
    const app = Fastify();
    addAdminActor(app);
    const auditService = new InMemoryAuditService();
    app.decorate("auditService", auditService);
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: {
          approvalId: "approval-1",
          decisions: [{
            approvalLineId: "line-1",
            allocations: { password: "private-password" },
            Authorization: "Bearer private-token",
          }],
          callbackPayload: { apiKey: "private-api-key" },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(auditService.events).toEqual([expect.objectContaining({
        status: "FAILED",
        errorMessage: "decisions[0].allocations must be an array",
        afterData: {
          request: {
            approvalId: "approval-1",
            decisions: [{ approvalLineId: "line-1", allocations: [] }],
          },
        },
      })]);
      expect(JSON.stringify(auditService.events)).not.toMatch(/private-|password|authorization|callbackPayload|apiKey/i);
    } finally { await app.close(); }
  });

  it("cancels only a pending approval with a reason", async () => {
    const app = Fastify();
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });
    try {
      const response = await app.inject({ method: "POST", url: "/admin/outbound/approval-1/cancel", payload: { reason: "申请人撤回" } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ approvalId: "approval-1", status: "VOIDED" });
    } finally { await app.close(); }
  });

  it("rejects an empty cancel reason without closing the approval", async () => {
    const app = Fastify();
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });
    try {
      const response = await app.inject({ method: "POST", url: "/admin/outbound/approval-1/cancel", payload: { reason: "   " } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "reason is required" });
      await expect(service.listOptions("approval-1")).resolves.toMatchObject({ approvalId: "approval-1" });
    } finally { await app.close(); }
  });

  it("keeps duplicate confirmation and changed stock as conflicts", async () => {
    const app = Fastify();
    addAdminActor(app);
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });
    try {
      const payload = {
        approvalId: "approval-1",
        decisions: [{
          approvalLineId: "line-1",
          selectedItemId: "item-1",
          allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }],
        }],
      };
      expect((await app.inject({ method: "POST", url: "/admin/outbound/confirm", payload })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/admin/outbound/confirm", payload })).statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it.each([
    {
      name: "non-integer quantity",
      prepare: (_store: InMemoryOutboundStore) => undefined,
      decision: { approvalLineId: "line-1", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1.5" }] },
      error: "approval quantity must be a positive integer",
    },
    {
      name: "unit mismatch",
      prepare: (store: InMemoryOutboundStore) => {
        store.seedItem({ id: "item-each", code: "EACH-1", name: "Each item", unit: "each", isActive: true });
        store.seedBatch({ id: "batch-each", warehouseId: "wh-1", itemId: "item-each", remainingQuantity: "1", unitCost: "20" });
      },
      decision: { approvalLineId: "line-1", selectedItemId: "item-each", allocations: [{ warehouseId: "wh-1", batchId: "batch-each", quantity: "1" }] },
      error: "selected item unit does not match approval unit",
    },
    {
      name: "unknown approval line",
      prepare: (_store: InMemoryOutboundStore) => undefined,
      decision: { approvalLineId: "line-other", selectedItemId: "item-1", allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "1" }] },
      error: "approval decision lines must exactly match approval lines",
    },
  ])("maps $name to a 400 business response", async ({ prepare, decision, error }) => {
    const app = Fastify();
    addAdminActor(app);
    const { store, service } = makeService();
    prepare(store);
    registerOutboundRoutes(app, { outboundService: service });

    try {
      const response = await app.inject({ method: "POST", url: "/admin/outbound/confirm", payload: { approvalId: "approval-1", decisions: [decision] } });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error });
    } finally { await app.close(); }
  });

  it("returns 409 when stock changes between route validation and commit", async () => {
    const app = Fastify();
    addAdminActor(app);
    const { store } = makeService();
    const service = new OutboundService({
      getApproval: (approvalId) => store.getApproval(approvalId),
      listPending: () => store.listPending(),
      listCandidateItems: () => store.listCandidateItems(),
      listBatches: (itemIds) => store.listBatches(itemIds),
      cancelApproval: (approvalId, reason) => store.cancelApproval(approvalId, reason),
      commitOutbound: (approval, validation, operatorId) => {
        store.seedBatch({ id: "batch-1", warehouseId: "wh-1", itemId: "item-1", remainingQuantity: "9", unitCost: "20" });
        return store.commitOutbound(approval, validation, operatorId);
      },
    });
    registerOutboundRoutes(app, { outboundService: service });
    try {
      const response = await app.inject({
        method: "POST",
        url: "/admin/outbound/confirm",
        payload: {
          approvalId: "approval-1",
          decisions: [{
            approvalLineId: "line-1",
            selectedItemId: "item-1",
            allocations: [{ warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }],
          }],
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: "stock balance changed; retry transaction" });
      expect(store.batch("batch-1")?.remainingQuantity).toBe("9");
      expect(store.ledger()).toHaveLength(0);
      expect(store.decisions()).toHaveLength(0);
    } finally { await app.close(); }
  });

  it("keeps mutation routes administrator-only", async () => {
    const app = buildServer();
    try {
      expect((await app.inject({ method: "POST", url: "/admin/outbound/approval-1/cancel", payload: { reason: "申请人撤回" } })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/admin/outbound/confirm", payload: {} })).statusCode).toBe(401);
      const financeCookie = await createSessionCookie(app, "FINANCE");
      expect((await app.inject({ method: "POST", url: "/admin/outbound/approval-1/cancel", headers: { cookie: financeCookie }, payload: { reason: "申请人撤回" } })).statusCode).toBe(403);
      expect((await app.inject({ method: "POST", url: "/admin/outbound/confirm", headers: { cookie: financeCookie }, payload: {} })).statusCode).toBe(403);
    } finally { await app.close(); }
  });
});
