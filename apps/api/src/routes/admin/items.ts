import type { FastifyInstance } from "fastify";

import type { ItemInput, ItemService } from "../../application/items/item-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

interface ItemQuery {
  search?: string;
  includeInactive?: string;
}

export function registerItemRoutes(app: FastifyInstance, dependencies: { itemService: ItemService }): void {
  app.get<{ Querystring: ItemQuery }>("/admin/items", async (request) => {
    const items = await dependencies.itemService.list(request.query.includeInactive === "true");
    const search = request.query.search?.trim().toLowerCase();
    return search ? items.filter((item) => [item.code, item.name, item.specification, item.weComOptionKey].some((value) => value?.toLowerCase().includes(search))) : items;
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
