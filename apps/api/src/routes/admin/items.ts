import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";

import type { ItemInput, ItemService } from "../../application/items/item-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

interface ItemQuery {
  search?: string;
  includeInactive?: string;
  warehouseId?: string;
}

interface ItemBalanceSnapshot {
  warehouseId: string;
  itemId: string;
  remainingQuantity: string;
}

export function registerItemRoutes(app: FastifyInstance, dependencies: {
  itemService: ItemService;
  listBalances(): Promise<ItemBalanceSnapshot[]>;
}): void {
  app.get<{ Querystring: ItemQuery }>("/admin/items", async (request) => {
    const [items, balances] = await Promise.all([
      dependencies.itemService.list(request.query.includeInactive === "true"),
      dependencies.listBalances(),
    ]);
    const warehouseId = request.query.warehouseId;
    const totals = new Map<string, Decimal>();
    for (const balance of balances) {
      if (warehouseId && warehouseId !== "all" && balance.warehouseId !== warehouseId) continue;
      totals.set(balance.itemId, (totals.get(balance.itemId) ?? new Decimal(0)).plus(balance.remainingQuantity));
    }
    const itemsWithStock = items.map((item) => ({
      ...item,
      stockQuantity: (totals.get(item.id) ?? new Decimal(0)).toString(),
    }));
    const search = request.query.search?.trim().toLowerCase();
    return search
      ? itemsWithStock.filter((item) => [item.code, item.name, item.specification, item.weComOptionKey, ...(item.aliases ?? [])].some((value) => value?.toLowerCase().includes(search)))
      : itemsWithStock;
  });

  app.post<{ Body: ItemInput }>(
    "/admin/items",
    withAdminMutationAudit(app, {
      action: "ITEM_CREATED",
      entityType: "ITEM",
      getEntityId: ({ result, request }) => result?.id ?? request.id,
    }, async (request, reply) => {
      reply.code(201);
      return dependencies.itemService.create(request.body);
    }),
  );

  app.patch<{ Params: { id: string }; Body: ItemInput }>(
    "/admin/items/:id",
    withAdminMutationAudit(app, {
      action: "ITEM_UPDATED",
      entityType: "ITEM",
      getEntityId: ({ request }) => request.params.id,
    }, async (request) => dependencies.itemService.update(request.params.id, request.body)),
  );

  app.post<{ Params: { id: string } }>(
    "/admin/items/:id/activate",
    withAdminMutationAudit(app, {
      action: "ITEM_ACTIVATED",
      entityType: "ITEM",
      getEntityId: ({ request }) => request.params.id,
    }, async (request) => dependencies.itemService.activate(request.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    "/admin/items/:id/deactivate",
    withAdminMutationAudit(app, {
      action: "ITEM_DEACTIVATED",
      entityType: "ITEM",
      getEntityId: ({ request }) => request.params.id,
      getAfterData: ({ request }) => ({ id: request.params.id, isActive: false }),
    }, async (request, reply) => {
      await dependencies.itemService.deactivate(request.params.id);
      reply.code(204);
      return undefined;
    }),
  );
}
