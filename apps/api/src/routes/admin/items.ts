import type { FastifyInstance } from "fastify";

import type { ItemInput, ItemService } from "../../application/items/item-service.js";

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

  app.post<{ Body: ItemInput }>("/admin/items", async (request, reply) => {
    const item = await dependencies.itemService.create(request.body);
    return reply.code(201).send(item);
  });

  app.patch<{ Params: { id: string }; Body: ItemInput }>("/admin/items/:id", async (request) => dependencies.itemService.update(request.params.id, request.body));

  app.post<{ Params: { id: string } }>("/admin/items/:id/deactivate", async (request, reply) => {
    await dependencies.itemService.deactivate(request.params.id);
    return reply.code(204).send();
  });
}
