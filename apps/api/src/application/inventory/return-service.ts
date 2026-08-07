import type { InMemoryMovementStore, MovementStore } from "./transfer-service.js";

export class ReturnService {
  constructor(private readonly store: MovementStore & Pick<InMemoryMovementStore, "getAllocation">) {}

  async create(input: { outboundAllocationId: string; quantity: string; reason: string }): Promise<{ returnId: string; status: "COMPLETED"; unitCost: string }> {
    const allocation = this.store.getAllocation(input.outboundAllocationId);
    if (!allocation) throw new Error(`outbound allocation not found: ${input.outboundAllocationId}`);
    const result = await this.store.returnStock({ allocation, quantity: input.quantity, reason: input.reason });
    return { ...result, status: "COMPLETED" };
  }
}
