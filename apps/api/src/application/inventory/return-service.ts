import { Decimal } from "decimal.js";
import type { MovementStore } from "./transfer-service.js";

export class ReturnService {
  constructor(private readonly store: MovementStore, private readonly assertPeriodOpen?: () => void | Promise<void>) {}

  async listOptions(): Promise<{ allocations: Array<{ id: string; outboundOrderId: string; warehouseId: string; itemId: string; batchId: string; issuedQuantity: string; remainingReturnableQuantity: string; unitCost: string }> }> {
    const allocations = await this.store.listIssuedAllocations();
    return {
      allocations: allocations
        .map((allocation) => ({
          ...allocation,
          remainingReturnableQuantity: new Decimal(allocation.issuedQuantity).minus(this.store.getReturnedQuantity(allocation.id)).toString(),
        }))
        .filter((allocation) => new Decimal(allocation.remainingReturnableQuantity).gt(0)),
    };
  }

  async create(input: { outboundAllocationId: string; quantity: string; reason: string }): Promise<{ returnId: string; status: "COMPLETED"; unitCost: string }> {
    if (!input.outboundAllocationId.trim()) throw new Error("outbound allocation is required");
    const allocation = this.store.getAllocation(input.outboundAllocationId);
    if (!allocation) throw new Error(`outbound allocation not found: ${input.outboundAllocationId}`);
    await this.assertPeriodOpen?.();
    const result = await this.store.returnStock({ allocation, quantity: input.quantity, reason: input.reason });
    return { ...result, status: "COMPLETED" };
  }
}
