import type { FastifyInstance } from "fastify";

import type { WarehouseService, WarehouseUpdateInput } from "../../application/warehouses/warehouse-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

interface WarehouseQuery {
  includeInactive?: string;
}

export function registerWarehouseRoutes(app: FastifyInstance, dependencies: { warehouseService: WarehouseService }): void {
  app.get<{ Querystring: WarehouseQuery }>("/admin/warehouses", async (request) => dependencies.warehouseService.list(request.query.includeInactive === "true"));

  app.patch<{ Params: { id: string }; Body: WarehouseUpdateInput }>(
    "/admin/warehouses/:id",
    withAdminMutationAudit(app, {
      action: "WAREHOUSE_UPDATED",
      entityType: "WAREHOUSE",
      getEntityId: ({ request }) => request.params.id,
    }, async (request) => dependencies.warehouseService.update(request.params.id, request.body)),
  );
}
