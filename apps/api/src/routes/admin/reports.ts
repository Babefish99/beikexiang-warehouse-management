import type { FastifyInstance } from "fastify";
import type { InventoryReportService, TransactionReportService, TransactionReportType } from "../../application/reports/report-query-service.js";
import { buildExcelCompatibleReport } from "../../infrastructure/export/report-export.js";

interface ReportQuery { period?: string; type?: TransactionReportType; warehouseId?: string }

function readPeriod(period?: string): string {
  return period ?? new Date().toISOString().slice(0, 7);
}

function readType(type?: TransactionReportType): TransactionReportType {
  return type ?? "all";
}

export function registerReportRoutes(app: FastifyInstance, dependencies: { inventoryReportService: InventoryReportService; transactionReportService: TransactionReportService }): void {
  app.get<{ Querystring: ReportQuery }>("/admin/reports/summary", async (request) => dependencies.inventoryReportService.getSummary(readPeriod(request.query.period), request.query.warehouseId));
  app.get<{ Querystring: ReportQuery }>("/admin/reports/transactions", async (request) => {
    return dependencies.transactionReportService.getByType(readPeriod(request.query.period), readType(request.query.type), request.query.warehouseId);
  });
  app.get<{ Querystring: ReportQuery }>("/admin/reports/export", async (request, reply) => {
    const period = readPeriod(request.query.period);
    const type = readType(request.query.type);
    const warehouseId = request.query.warehouseId;
    const [summary, transactions] = await Promise.all([
      dependencies.inventoryReportService.getSummary(period, warehouseId),
      dependencies.transactionReportService.getByType(period, type, warehouseId),
    ]);
    const body = buildExcelCompatibleReport({ period, type, summary, transactions });
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="inventory-report-${period}-${type}.csv"`)
      .send(body);
  });
}
