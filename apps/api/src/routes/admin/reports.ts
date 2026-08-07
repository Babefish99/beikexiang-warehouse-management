import type { FastifyInstance } from "fastify";
import type { InventoryReportService, TransactionReportService } from "../../application/reports/report-query-service.js";

interface ReportQuery { period?: string; type?: string }

export function registerReportRoutes(app: FastifyInstance, dependencies: { inventoryReportService: InventoryReportService; transactionReportService: TransactionReportService }): void {
  app.get<{ Querystring: ReportQuery }>("/admin/reports/summary", async (request) => dependencies.inventoryReportService.getSummary(request.query.period ?? new Date().toISOString().slice(0, 7)));
  app.get<{ Querystring: ReportQuery }>("/admin/reports/transactions", async (request) => {
    const period = request.query.period ?? new Date().toISOString().slice(0, 7);
    switch (request.query.type) {
      case "inbound": return dependencies.transactionReportService.getInbound(period);
      case "outbound": return dependencies.transactionReportService.getOutbound(period);
      case "transfers": return dependencies.transactionReportService.getTransfers(period);
      case "returns": return dependencies.transactionReportService.getReturns(period);
      case "adjustments": return dependencies.transactionReportService.getAdjustments(period);
      default: return { error: "transaction report type is required" };
    }
  });
}
