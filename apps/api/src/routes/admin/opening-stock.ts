import type { FastifyInstance } from "fastify";

export function registerOpeningStockRoutes(app: FastifyInstance): void {
  app.post("/admin/opening-stock", async (_request, reply) => {
    return reply.code(410).send({
      error: "单行期初库存录入已停用，请使用固定格式 Excel 导入",
    });
  });
}
