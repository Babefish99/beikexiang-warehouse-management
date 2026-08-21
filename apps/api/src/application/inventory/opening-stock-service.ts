import { assertNonNegative, decimal } from "../../domain/inventory/invariants.js";
import { assertActiveMasterData, type InventoryEntryStore, type InventoryMasterDataServices } from "./inbound-service.js";

export interface OpeningStockRow {
  warehouseId: string;
  itemId: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  remark?: string;
}

export class OpeningStockService {
  constructor(private readonly store: InventoryEntryStore, private readonly masterData: InventoryMasterDataServices, private readonly assertPeriodOpen?: () => void | Promise<void>) {}

  async create(input: { verifiedBy: string; rows: OpeningStockRow[] }): Promise<{ batchIds: string[] }> {
    if (!input.verifiedBy.trim()) throw new Error("verified by is required");
    if (!input.rows.length) throw new Error("opening stock rows are required");
    const occurredAt = new Date().toISOString();
    const rows = [];
    for (const row of input.rows) {
      if (!row.warehouseId.trim()) throw new Error("warehouse is required");
      if (!row.itemId.trim()) throw new Error("item is required");
      await assertActiveMasterData(this.masterData, row.warehouseId, row.itemId);
      if (!row.batchNo.trim()) throw new Error("batch number is required");
      const quantity = assertNonNegative(row.quantity, "quantity");
      const unitCost = assertNonNegative(row.unitCost, "unit cost");
      if (unitCost.isZero() && !row.remark?.trim()) throw new Error("remark is required when unit cost is zero");
      rows.push({ warehouseId: row.warehouseId, itemId: row.itemId, batchNo: row.batchNo, quantity: quantity.toString(), unitCost: decimal(unitCost).toString(), purchasedAt: occurredAt, remark: row.remark });
    }
    await this.assertPeriodOpen?.();
    const result = await this.store.recordOpeningStock({ operatorId: input.verifiedBy, referenceId: `opening-${crypto.randomUUID()}`, occurredAt, rows });
    return { batchIds: result.batchIds };
  }
}
