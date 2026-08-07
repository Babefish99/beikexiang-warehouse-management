import type { FastifyInstance } from "fastify";

import type { WarehouseService } from "../../application/warehouses/warehouse-service.js";

export function registerWarehouseRoutes(app: FastifyInstance, dependencies: { warehouseService: WarehouseService }): void {
  app.get("/admin/warehouses", async () => dependencies.warehouseService.listActive());
}
