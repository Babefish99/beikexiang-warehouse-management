import { describe, expect, it } from "vitest";

import { InMemoryInventoryEntryStore } from "../../../apps/api/src/application/inventory/inbound-service.js";
import { OpeningStockService } from "../../../apps/api/src/application/inventory/opening-stock-service.js";

describe("opening stock service", () => {
  it("records physically verified opening balances as opening ledger entries", async () => {
    const store = new InMemoryInventoryEntryStore();
    const service = new OpeningStockService(store);

    const result = await service.create({
      verifiedBy: "admin-1",
      rows: [{ warehouseId: "wh-1", itemId: "item-1", batchNo: "OPEN-01", quantity: "8", unitCost: "20", remark: "2026-08-07 实盘" }],
    });

    expect(result.batchIds).toHaveLength(1);
    expect(store.ledger()).toMatchObject([{ type: "OPENING_BALANCE", referenceType: "OPENING_STOCK", quantity: "8" }]);
    expect(store.ledger()[0]).not.toHaveProperty("historicalDate");
  });
});
