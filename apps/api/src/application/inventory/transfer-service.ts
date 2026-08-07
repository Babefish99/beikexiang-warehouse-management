import { Decimal } from "decimal.js";
import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";

export interface MovementBalance { warehouseId: string; itemId: string; batchId: string; remainingQuantity: string; unitCost: string }
export interface IssuedAllocation { id: string; outboundOrderId: string; warehouseId: string; itemId: string; batchId: string; issuedQuantity: string; unitCost: string }

export interface MovementStore {
  transfer(input: { itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: string }): Promise<{ transferId: string; unitCost: string }>;
  returnStock(input: { allocation: IssuedAllocation; quantity: string; reason: string }): Promise<{ returnId: string; unitCost: string }>;
}

export class InMemoryMovementStore implements MovementStore {
  private readonly balances = new Map<string, MovementBalance>();
  private readonly allocations = new Map<string, IssuedAllocation>();
  private readonly returned = new Map<string, Decimal>();
  private readonly entries: InventoryLedgerEntry[] = [];

  seedBalance(balance: MovementBalance): void { this.balances.set(`${balance.warehouseId}:${balance.batchId}`, structuredClone(balance)); }
  seedIssuedAllocation(allocation: IssuedAllocation): void { this.allocations.set(allocation.id, structuredClone(allocation)); }
  balance(warehouseId: string, batchId: string): MovementBalance | undefined { const balance = this.balances.get(`${warehouseId}:${batchId}`); return balance ? structuredClone(balance) : undefined; }
  ledger(): InventoryLedgerEntry[] { return this.entries.map((entry) => ({ ...entry })); }
  getAllocation(id: string): IssuedAllocation | undefined { const allocation = this.allocations.get(id); return allocation ? structuredClone(allocation) : undefined; }

  async transfer(input: { itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: string }): Promise<{ transferId: string; unitCost: string }> {
    if (input.sourceWarehouseId === input.destinationWarehouseId) throw new Error("source and destination warehouses must differ");
    const quantity = new Decimal(input.quantity);
    if (!quantity.isFinite() || !quantity.gt(0)) throw new Error("quantity must be positive");
    const sourceKey = `${input.sourceWarehouseId}:${input.batchId}`;
    const destinationKey = `${input.destinationWarehouseId}:${input.batchId}`;
    const source = this.balances.get(sourceKey);
    if (!source || source.itemId !== input.itemId) throw new Error("source stock balance not found");
    const remaining = new Decimal(source.remainingQuantity).minus(quantity);
    if (remaining.lt(0)) throw new Error("batch balance cannot become negative");
    const destination = this.balances.get(destinationKey) ?? { ...source, warehouseId: input.destinationWarehouseId, remainingQuantity: "0" };
    if (destination.unitCost !== source.unitCost) throw new Error("transferred batch cost cannot change");
    const transferId = crypto.randomUUID();
    this.balances.set(sourceKey, { ...source, remainingQuantity: remaining.toString() });
    this.balances.set(destinationKey, { ...destination, remainingQuantity: new Decimal(destination.remainingQuantity).plus(quantity).toString() });
    const amount = quantity.mul(source.unitCost).toFixed(2);
    this.entries.push({ id: crypto.randomUUID(), warehouseId: input.sourceWarehouseId, itemId: input.itemId, batchId: input.batchId, type: "TRANSFER_OUT", quantity: quantity.negated().toString(), unitCost: source.unitCost, amount, referenceType: "TRANSFER_ORDER", referenceId: transferId, occurredAt: new Date().toISOString() }, { id: crypto.randomUUID(), warehouseId: input.destinationWarehouseId, itemId: input.itemId, batchId: input.batchId, type: "TRANSFER_IN", quantity: quantity.toString(), unitCost: source.unitCost, amount, referenceType: "TRANSFER_ORDER", referenceId: transferId, occurredAt: new Date().toISOString() });
    return { transferId, unitCost: source.unitCost };
  }

  async returnStock(input: { allocation: IssuedAllocation; quantity: string; reason: string }): Promise<{ returnId: string; unitCost: string }> {
    if (!input.reason.trim()) throw new Error("reason is required");
    const quantity = new Decimal(input.quantity);
    const returned = this.returned.get(input.allocation.id) ?? new Decimal(0);
    if (!quantity.isFinite() || !quantity.gt(0)) throw new Error("quantity must be positive");
    if (returned.plus(quantity).gt(new Decimal(input.allocation.issuedQuantity))) throw new Error("return quantity exceeds original issued quantity");
    const key = `${input.allocation.warehouseId}:${input.allocation.batchId}`;
    const balance = this.balances.get(key);
    if (!balance) throw new Error("return stock balance not found");
    const returnId = crypto.randomUUID();
    this.balances.set(key, { ...balance, remainingQuantity: new Decimal(balance.remainingQuantity).plus(quantity).toString() });
    this.returned.set(input.allocation.id, returned.plus(quantity));
    this.entries.push({ id: crypto.randomUUID(), warehouseId: input.allocation.warehouseId, itemId: input.allocation.itemId, batchId: input.allocation.batchId, type: "RETURN", quantity: quantity.toString(), unitCost: input.allocation.unitCost, amount: quantity.mul(input.allocation.unitCost).toFixed(2), referenceType: "OUTBOUND_ALLOCATION", referenceId: input.allocation.id, occurredAt: new Date().toISOString() });
    return { returnId, unitCost: input.allocation.unitCost };
  }
}

export class TransferService {
  constructor(private readonly store: MovementStore) {}

  async complete(input: { itemId: string; batchId: string; sourceWarehouseId: string; destinationWarehouseId: string; quantity: string }): Promise<{ transferId: string; status: "COMPLETED"; unitCost: string }> {
    const result = await this.store.transfer(input);
    return { ...result, status: "COMPLETED" };
  }
}
