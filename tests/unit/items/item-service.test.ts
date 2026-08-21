import { describe, expect, it } from "vitest";

import { InMemoryItemRepository, ItemService } from "../../../apps/api/src/application/items/item-service.js";

const input = { name: "茶叶", specification: "铁观音", unit: "盒", categoryId: "cat-tea", categoryPrefix: "CY" };

describe("item service", () => {
  it("creates an active item with a generated category-prefixed code", async () => {
    const service = new ItemService(new InMemoryItemRepository());

    await expect(service.create(input)).resolves.toMatchObject({ code: "CY-0001", name: "茶叶", isActive: true });
  });

  it("rejects duplicate codes and deactivates instead of deleting", async () => {
    const repository = new InMemoryItemRepository();
    const service = new ItemService(repository);
    const first = await service.create({ ...input, code: "CY-0001" });

    await expect(service.create({ ...input, code: "cy-0001" })).rejects.toThrow("item code already exists: CY-0001");
    await expect(service.deactivate(first.id)).resolves.toBeUndefined();
    await expect(repository.get(first.id)).resolves.toMatchObject({ isActive: false });
  });

  it("reactivates a deactivated item without changing its definition", async () => {
    const repository = new InMemoryItemRepository();
    const service = new ItemService(repository);
    const item = await service.create({ ...input, code: "CY-0001" });

    await service.deactivate(item.id);
    await expect(service.activate(item.id)).resolves.toMatchObject({ id: item.id, isActive: true });
    await expect(repository.get(item.id)).resolves.toMatchObject({ name: input.name, code: "CY-0001", isActive: true });
  });

  it("does not allow a code change after ledger activity", async () => {
    const repository = new InMemoryItemRepository();
    const service = new ItemService(repository);
    const item = await service.create({ ...input, code: "CY-0001" });
    repository.markLedgerActivity(item.id);

    await expect(service.update(item.id, { ...input, code: "CY-0002" })).rejects.toThrow("item code cannot change after ledger activity");
  });
});
