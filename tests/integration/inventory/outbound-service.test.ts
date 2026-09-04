import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OutboundService,
  InMemoryOutboundStore,
  type PendingApproval,
} from "../../../apps/api/src/application/inventory/outbound-service.js";
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

async function createSessionCookie(app: ReturnType<typeof buildServer>, role: "ADMIN" | "FINANCE"): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/auth/local?returnTo=/admin/outbound&role=${role}`, remoteAddress: "127.0.0.1", headers: { host: "localhost:3001" } });
  return response.headers["set-cookie"] as string;
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
    const { service } = makeService();
    registerOutboundRoutes(app, { outboundService: service });
    try {
      const payload = { approvalId: "approval-1", allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }] };
      expect((await app.inject({ method: "POST", url: "/admin/outbound/confirm", payload })).statusCode).toBe(200);
      expect((await app.inject({ method: "POST", url: "/admin/outbound/confirm", payload })).statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it("returns 409 when stock changes between route validation and commit", async () => {
    const app = Fastify();
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
          allocations: [{ approvalLineId: "line-1", warehouseId: "wh-1", batchId: "batch-1", quantity: "10" }],
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
