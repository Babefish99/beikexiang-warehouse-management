import { describe, expect, it } from "vitest";

import { createInventoryTransactionService } from "../../../apps/api/src/domain/inventory/ledger.js";
import { createAccountingPeriod, createAccountingPeriodService } from "../../../apps/api/src/domain/periods/accounting-period.js";
import { createInMemoryStockBalanceRepository } from "../../../apps/api/src/infrastructure/db/repositories.js";

describe("atomic stock balance operations", () => {
  it("rejects outbound when the selected batch has no stock balance", () => {
    const stock = createInMemoryStockBalanceRepository();
    const service = createInventoryTransactionService({ periodService: createAccountingPeriodService(), stockBalanceRepository: stock });

    expect(() => service.recordOutbound({
      period: createAccountingPeriod({ code: "2026-08" }),
      approvalLine: { id: "line-1", approvalId: "approval-1", itemId: "item-1", requestedQuantity: "3", unit: "box" },
      allocations: [{ warehouseId: "warehouse-1", itemId: "item-1", batchId: "missing", quantity: "3", remainingQuantity: "3", unitCost: "12.50" }],
    })).toThrowError(/stock balance batch not found/i);
  });

  it("decrements the selected batch before returning outbound ledger entries", () => {
    const stock = createInMemoryStockBalanceRepository();
    stock.seed({ batchId: "batch-1", warehouseId: "warehouse-1", itemId: "item-1", remainingQuantity: "10", unitCost: "12.50" });
    const service = createInventoryTransactionService({ periodService: createAccountingPeriodService(), stockBalanceRepository: stock });

    service.recordOutbound({
      period: createAccountingPeriod({ code: "2026-08" }),
      approvalLine: { id: "line-1", approvalId: "approval-1", itemId: "item-1", requestedQuantity: "3", unit: "box" },
      allocations: [{ warehouseId: "warehouse-1", itemId: "item-1", batchId: "batch-1", quantity: "3", remainingQuantity: "10", unitCost: "12.50" }],
    });

    expect(stock.get("warehouse-1", "batch-1")?.remainingQuantity).toBe("7");
  });

  it("leaves every batch unchanged when one outbound balance snapshot is stale", () => {
    const stock = createInMemoryStockBalanceRepository();
    stock.seed({ batchId: "batch-1", warehouseId: "warehouse-1", itemId: "item-1", remainingQuantity: "5", unitCost: "12.50" });
    stock.seed({ batchId: "batch-2", warehouseId: "warehouse-1", itemId: "item-1", remainingQuantity: "5", unitCost: "12.50" });
    const service = createInventoryTransactionService({ periodService: createAccountingPeriodService(), stockBalanceRepository: stock });

    expect(() => service.recordOutbound({
      period: createAccountingPeriod({ code: "2026-08" }),
      approvalLine: { id: "line-1", approvalId: "approval-1", itemId: "item-1", requestedQuantity: "4", unit: "box" },
      allocations: [
        { warehouseId: "warehouse-1", itemId: "item-1", batchId: "batch-1", quantity: "2", remainingQuantity: "5", unitCost: "12.50" },
        { warehouseId: "warehouse-1", itemId: "item-1", batchId: "batch-2", quantity: "2", remainingQuantity: "4", unitCost: "12.50" },
      ],
    })).toThrowError(/stock balance changed.*retry/i);
    expect(stock.get("warehouse-1", "batch-1")?.remainingQuantity).toBe("5");
    expect(stock.get("warehouse-1", "batch-2")?.remainingQuantity).toBe("5");
  });

  it("moves the same batch quantity and cost between warehouses atomically", () => {
    const stock = createInMemoryStockBalanceRepository();
    stock.seed({ batchId: "batch-1", warehouseId: "warehouse-1", itemId: "item-1", remainingQuantity: "5", unitCost: "12.50" });
    const service = createInventoryTransactionService({ periodService: createAccountingPeriodService(), stockBalanceRepository: stock });

    service.recordTransfer({
      period: createAccountingPeriod({ code: "2026-08" }),
      referenceId: "transfer-1",
      itemId: "item-1",
      batchId: "batch-1",
      sourceWarehouseId: "warehouse-1",
      destinationWarehouseId: "warehouse-2",
      sourceQuantity: "2",
      destinationQuantity: "2",
      unitCost: "12.50",
      reason: "rebalance",
    });

    expect(stock.get("warehouse-1", "batch-1")?.remainingQuantity).toBe("3");
    expect(stock.get("warehouse-2", "batch-1")?.remainingQuantity).toBe("2");
  });
});
