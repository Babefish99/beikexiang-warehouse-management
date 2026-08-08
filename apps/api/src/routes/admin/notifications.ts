import type { FastifyInstance } from "fastify";

import type { NotificationService } from "../../application/inventory/notification-service.js";

export function registerNotificationRoutes(app: FastifyInstance, dependencies: { notificationService: NotificationService }): void {
  app.get("/admin/notifications", async () => dependencies.notificationService.list());
}
