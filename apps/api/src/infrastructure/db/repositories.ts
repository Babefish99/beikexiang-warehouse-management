import type { InventoryLedgerEntry } from "../../domain/inventory/ledger.js";

export interface InventoryLedgerRepository {
  append(entry: InventoryLedgerEntry): Promise<InventoryLedgerEntry>;
  listByReference(referenceType: string, referenceId: string): Promise<InventoryLedgerEntry[]>;
}

export class InMemoryInventoryLedgerRepository implements InventoryLedgerRepository {
  private readonly entries: InventoryLedgerEntry[] = [];

  async append(entry: InventoryLedgerEntry): Promise<InventoryLedgerEntry> {
    this.entries.push(entry);
    return entry;
  }

  async listByReference(referenceType: string, referenceId: string): Promise<InventoryLedgerEntry[]> {
    return this.entries.filter((entry) => entry.referenceType === referenceType && entry.referenceId === referenceId);
  }
}
