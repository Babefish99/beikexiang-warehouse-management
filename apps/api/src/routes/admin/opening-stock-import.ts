import { basename, extname } from "node:path";

import type { FastifyInstance, FastifyRequest } from "fastify";

import { BusinessRuleError } from "../../application/errors/business-rule-error.js";
import type { OpeningStockImportService } from "../../application/inventory/opening-stock-import-service.js";
import { withAdminMutationAudit } from "./admin-mutation-route.js";

interface OpeningStockUpload {
  buffer: Buffer;
  fileName: string;
  fields: Map<string, string>;
}

const COMMIT_FIELDS = new Set(["previewToken", "financeReviewer", "confirmed"]);

function safeUploadFileName(fileName: string): string {
  return basename(fileName.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .slice(0, 255);
}

async function readOpeningStockUpload(
  request: FastifyRequest,
  allowedFields: ReadonlySet<string>,
): Promise<OpeningStockUpload> {
  if (!request.isMultipart()) {
    throw new BusinessRuleError("请求必须使用 multipart/form-data", 400);
  }

  const fields = new Map<string, string>();
  const duplicateFields = new Set<string>();
  const unknownFields = new Set<string>();
  const files: Array<{ buffer: Buffer; fileName: string; fieldName: string }> = [];

  for await (const part of request.parts()) {
    if (part.type === "file") {
      files.push({
        buffer: await part.toBuffer(),
        fileName: part.filename,
        fieldName: part.fieldname,
      });
      continue;
    }

    if (fields.has(part.fieldname)) duplicateFields.add(part.fieldname);
    if (!allowedFields.has(part.fieldname)) unknownFields.add(part.fieldname);
    if (part.valueTruncated || typeof part.value !== "string") {
      throw new BusinessRuleError(`字段 ${part.fieldname} 超出长度限制或格式无效`, 400);
    }
    fields.set(part.fieldname, part.value);
  }

  if (files.length !== 1 || files[0]?.fieldName !== "file") {
    throw new BusinessRuleError("必须且只能上传一个名为 file 的 Excel 文件", 400);
  }
  if (duplicateFields.size > 0) {
    throw new BusinessRuleError(`字段不能重复：${[...duplicateFields].join("、")}`, 400);
  }
  if (unknownFields.size > 0) {
    throw new BusinessRuleError(`包含未知字段：${[...unknownFields].join("、")}`, 400);
  }

  const fileName = safeUploadFileName(files[0].fileName);
  if (extname(fileName).toLowerCase() !== ".xlsx") {
    throw new BusinessRuleError("仅支持扩展名为 .xlsx 的期初库存文件", 400);
  }

  return { buffer: files[0].buffer, fileName, fields };
}

export function registerOpeningStockImportRoutes(
  app: FastifyInstance,
  dependencies: { openingStockImportService: OpeningStockImportService },
): void {
  app.get("/admin/opening-stock/import/status", async () => {
    return dependencies.openingStockImportService.getStatus();
  });

  app.post("/admin/opening-stock/import/preview", async (request) => {
    const upload = await readOpeningStockUpload(request, new Set());
    return dependencies.openingStockImportService.preview({
      actorId: request.adminUser!.id,
      fileName: upload.fileName,
      buffer: upload.buffer,
    });
  });

  app.post(
    "/admin/opening-stock/import/commit",
    withAdminMutationAudit(app, {
      action: "OPENING_STOCK_IMPORTED",
      entityType: "OPENING_STOCK_IMPORT",
      getEntityId: ({ result, request }) => result?.id ?? request.id,
      getAfterData: ({ result }) => result,
    }, async (request, reply) => {
      const upload = await readOpeningStockUpload(request, COMMIT_FIELDS);
      const missingFields = [...COMMIT_FIELDS].filter((field) => !upload.fields.has(field));
      if (missingFields.length > 0) {
        throw new BusinessRuleError(`缺少必填字段：${missingFields.join("、")}`, 400);
      }

      const result = await dependencies.openingStockImportService.commit({
        actorId: request.adminUser!.id,
        fileName: upload.fileName,
        buffer: upload.buffer,
        previewToken: upload.fields.get("previewToken")!,
        financeReviewer: upload.fields.get("financeReviewer")!,
        confirmed: upload.fields.get("confirmed") === "true",
      });
      reply.code(201);
      return result;
    }),
  );
}
