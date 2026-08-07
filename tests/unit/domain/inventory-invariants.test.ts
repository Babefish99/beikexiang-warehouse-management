import { describe, expect, it } from "vitest";

import { assertUniqueApprovalNumber } from "../../../apps/api/src/domain/approvals/approval.js";
import { createInventoryTransactionService } from "../../../apps/api/src/domain/inventory/ledger.js";
import {
  createAccountingPeriod,
  createAccountingPeriodService,
} from "../../../apps/api/src/domain/periods/accounting-period.js";

describe("inventory invariants", () => {
  const periodService = createAccountingPeriodService();
  const transactionService = createInventoryTransactionService({ periodService });
  const openPeriod = createAccountingPeriod({ code: "2026-08" });

  it("rejects outbound quantities above the approved amount", () => {
    expect(() =>
      transactionService.recordOutbound({
        period: openPeriod,
        approvalLine: {
          id: "approval-line-1",
          approvalId: "approval-1",
          itemId: "item-1",
          requestedQuantity: "2",
          unit: "box",
        },
        allocations: [
          {
            warehouseId: "warehouse-1",
            itemId: "item-1",
            batchId: "batch-1",
            quantity: "3",
            remainingQuantity: "10",
            unitCost: "12.50",
          },
        ],
      }),
    ).toThrowError(/approved quantity/i);
  });

  it("requires a reason for partial outbound quantities", () => {
    expect(() =>
      transactionService.recordOutbound({
        period: openPeriod,
        approvalLine: {
          id: "approval-line-1",
          approvalId: "approval-1",
          itemId: "item-1",
          requestedQuantity: "3",
          unit: "box",
        },
        allocations: [
          {
            warehouseId: "warehouse-1",
            itemId: "item-1",
            batchId: "batch-1",
            quantity: "2",
            remainingQuantity: "10",
            unitCost: "12.50",
          },
        ],
      }),
    ).toThrowError(/reason/i);
  });

  it("requires a reason when nothing can be issued", () => {
    expect(() =>
      transactionService.recordOutbound({
        period: openPeriod,
        approvalLine: {
          id: "approval-line-1",
          approvalId: "approval-1",
          itemId: "item-1",
          requestedQuantity: "3",
          unit: "box",
        },
        allocations: [],
      }),
    ).toThrowError(/reason/i);
  });

  it("rejects outbound allocations that would make a batch negative", () => {
    expect(() =>
      transactionService.recordOutbound({
        period: openPeriod,
        approvalLine: {
          id: "approval-line-1",
          approvalId: "approval-1",
          itemId: "item-1",
          requestedQuantity: "3",
          unit: "box",
        },
        reason: "urgent fulfillment",
        allocations: [
          {
            warehouseId: "warehouse-1",
            itemId: "item-1",
            batchId: "batch-1",
            quantity: "3",
            remainingQuantity: "2",
            unitCost: "12.50",
          },
        ],
      }),
    ).toThrowError(/negative/i);
  });

  it("rejects returns that exceed the original issued quantity", () => {
    expect(() =>
      transactionService.recordReturn({
        period: openPeriod,
        originalAllocation: {
          outboundAllocationId: "allocation-1",
          warehouseId: "warehouse-1",
          itemId: "item-1",
          batchId: "batch-1",
          issuedQuantity: "4",
          unitCost: "12.50",
        },
        returnQuantity: "5",
        reason: "unused",
      }),
    ).toThrowError(/return quantity/i);
  });

  it("rejects transfers with mismatched source and destination quantities", () => {
    expect(() =>
      transactionService.recordTransfer({
        period: openPeriod,
        referenceId: "transfer-1",
        itemId: "item-1",
        batchId: "batch-1",
        sourceWarehouseId: "warehouse-1",
        destinationWarehouseId: "warehouse-2",
        sourceQuantity: "2",
        destinationQuantity: "1",
        unitCost: "12.50",
        reason: "rebalance",
      }),
    ).toThrowError(/equal/i);
  });

  it("rejects new corrections in a closed accounting period", () => {
    const closedPeriod = periodService.close(createAccountingPeriod({ code: "2026-07" }));

    expect(() =>
      transactionService.recordAdjustment({
        period: closedPeriod,
        warehouseId: "warehouse-1",
        itemId: "item-1",
        batchId: "batch-1",
        quantityDelta: "-1",
        unitCost: "12.50",
        reason: "stocktake correction",
      }),
    ).toThrowError(/closed period/i);
  });

  it("rejects deletion of confirmed records", () => {
    expect(() =>
      transactionService.assertRecordDeletionAllowed({
        confirmed: true,
        referenceType: "OUTBOUND_ORDER",
      }),
    ).toThrowError(/confirmed records cannot be deleted/i);
  });

  it("rejects duplicate approval numbers", () => {
    expect(() =>
      assertUniqueApprovalNumber(new Set(["SP20260807001"]), "SP20260807001"),
    ).toThrowError(/duplicate/i);
  });
});
