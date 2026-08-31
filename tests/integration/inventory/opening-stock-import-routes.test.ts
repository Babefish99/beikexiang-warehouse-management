import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildServer } from "../../../apps/api/src/server.js";
import { multipartPayload } from "../../helpers/multipart.js";
import { buildOpeningStockWorkbook } from "../../helpers/opening-stock-workbook.js";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function createSessionCookie(
  app: ReturnType<typeof buildServer>,
  role: "ADMIN" | "FINANCE" | "APPLICANT" = "ADMIN",
): Promise<string> {
  const response = await app.inject({
    method: "GET",
    url: `/auth/local?returnTo=/admin/opening-stock&role=${role}`,
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:3001" },
  });
  if (response.statusCode !== 302) throw new Error(`local login failed: ${response.statusCode}`);
  const cookie = response.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0]! : cookie!;
}

async function configureFormalWarehouses(
  app: ReturnType<typeof buildServer>,
  cookie: string,
): Promise<void> {
  for (const [id, name] of [
    ["warehouse-1", "集团二楼仓库"],
    ["warehouse-2", "内区1号仓库"],
    ["warehouse-3", "1区车库后仓库"],
  ] as const) {
    const response = await app.inject({
      method: "PATCH",
      url: `/admin/warehouses/${id}`,
      headers: { cookie },
      payload: { name, isActive: true },
    });
    if (response.statusCode !== 200) throw new Error(`warehouse setup failed: ${id}`);
  }
}

function workbookPart(buffer: Buffer, fileName = "期初库存.xlsx") {
  return {
    file: { fileName, contentType: XLSX_CONTENT_TYPE, buffer },
  };
}

function replaceMultipartHeader(payload: Buffer, from: string, to: string): Buffer {
  const search = Buffer.from(from, "utf8");
  const index = payload.indexOf(search);
  if (index < 0) throw new Error(`multipart header not found: ${from}`);
  return Buffer.concat([
    payload.subarray(0, index),
    Buffer.from(to, "utf8"),
    payload.subarray(index + search.length),
  ]);
}

describe("opening-stock import routes", () => {
  let app: ReturnType<typeof buildServer>;

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PERSISTENCE_DRIVER", "memory");
    vi.stubEnv("LOCAL_AUTH_BYPASS", "true");
    vi.stubEnv("API_BASE_URL", "http://localhost:3001");
    vi.stubEnv("WEB_BASE_URL", "http://localhost:5174");
    vi.stubEnv("SESSION_SECRET", "local-development-session-secret");
    vi.stubEnv("WE_COM_CORP_ID", "wx-test-corp");
    vi.stubEnv("WE_COM_AGENT_ID", "1000001");
    vi.stubEnv("WE_COM_SECRET", "test-secret");
    vi.stubEnv("WE_COM_CALLBACK_TOKEN", "test-token");
    vi.stubEnv("WE_COM_ENCODING_AES_KEY", "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
    app = buildServer();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it("previews and commits the same workbook for an authenticated admin", async () => {
    const cookie = await createSessionCookie(app, "ADMIN");
    await configureFormalWarehouses(app, cookie);
    const file = await buildOpeningStockWorkbook();
    const previewBody = multipartPayload(workbookPart(file));

    const preview = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/preview",
      headers: { cookie, ...previewBody.headers },
      payload: previewBody.payload,
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      canCommit: true,
      previewToken: expect.any(String),
      previewExpiresAt: expect.any(String),
    });
    const commitBody = multipartPayload({
      fields: {
        previewToken: preview.json<{ previewToken: string }>().previewToken,
        financeReviewer: "财务甲",
        confirmed: "true",
      },
      ...workbookPart(file),
    });
    const commit = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/commit",
      headers: { cookie, ...commitBody.headers },
      payload: commitBody.payload,
    });

    expect(commit.statusCode).toBe(201);
    expect(commit.json()).toMatchObject({
      id: "INITIAL_OPENING_STOCK",
      operatorId: "local-admin",
      financeReviewer: "财务甲",
      inventoryRowCount: 243,
      positiveRowCount: 1,
      zeroRowCount: 242,
    });
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(status.json()).toMatchObject({ availability: "COMPLETED", completedImport: commit.json() });
  });

  it("rejects anonymous and authenticated non-admin preview and commit requests", async () => {
    const file = await buildOpeningStockWorkbook();
    const previewBody = multipartPayload(workbookPart(file));
    const commitBody = multipartPayload({
      fields: { previewToken: "token", financeReviewer: "财务甲", confirmed: "true" },
      ...workbookPart(file),
    });
    const financeCookie = await createSessionCookie(app, "FINANCE");

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: previewBody.headers,
        payload: previewBody.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: commitBody.headers,
        payload: commitBody.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie: financeCookie, ...previewBody.headers },
        payload: previewBody.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: { cookie: financeCookie, ...commitBody.headers },
        payload: commitBody.payload,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401, 403, 403]);
    const adminCookie = await createSessionCookie(app, "ADMIN");
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie: adminCookie },
    });
    expect(status.json()).toEqual({ availability: "AVAILABLE" });
  });

  it("rejects non-xlsx names, missing files and multiple files without changing state", async () => {
    const cookie = await createSessionCookie(app);
    const file = await buildOpeningStockWorkbook();
    const wrongName = multipartPayload(workbookPart(file, "期初库存.xls"));
    const missingFile = multipartPayload({});
    const firstFile = multipartPayload(workbookPart(file));
    const secondFile = multipartPayload({
      file: { fieldName: "file2", fileName: "第二份.xlsx", contentType: XLSX_CONTENT_TYPE, buffer: file },
    });
    const closing = Buffer.from(`--${firstFile.boundary}--\r\n`, "utf8");
    const multipleFilesPayload = Buffer.concat([
      firstFile.payload.subarray(0, firstFile.payload.length - closing.length),
      secondFile.payload,
    ]);

    const [wrongNameResponse, missingFileResponse, multipleFilesResponse] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie, ...wrongName.headers },
        payload: wrongName.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie, ...missingFile.headers },
        payload: missingFile.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie, ...firstFile.headers },
        payload: multipleFilesPayload,
      }),
    ]);

    expect(wrongNameResponse.statusCode).toBe(400);
    expect(wrongNameResponse.body).toContain(".xlsx");
    expect(missingFileResponse.statusCode).toBe(400);
    expect(multipleFilesResponse.statusCode).toBe(400);
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(status.json()).toEqual({ availability: "AVAILABLE" });
  });

  it("rejects extra, duplicate, unknown and missing scalar fields", async () => {
    const cookie = await createSessionCookie(app);
    const file = await buildOpeningStockWorkbook();
    const extraPreview = multipartPayload({ fields: { unexpected: "value" }, ...workbookPart(file) });
    const unknownCommit = multipartPayload({
      fields: { previewToken: "token", financeReviewer: "财务甲", unexpected: "true" },
      ...workbookPart(file),
    });
    const duplicateCommitBase = multipartPayload({
      fields: {
        previewToken: "token-one",
        financeReviewer: "财务甲",
        duplicatePreviewToken: "token-two",
      },
      ...workbookPart(file),
    });
    const duplicateCommit = replaceMultipartHeader(
      duplicateCommitBase.payload,
      'name="duplicatePreviewToken"',
      'name="previewToken"',
    );
    const missingCommit = multipartPayload({
      fields: { previewToken: "token" },
      ...workbookPart(file),
    });

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/preview",
        headers: { cookie, ...extraPreview.headers },
        payload: extraPreview.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: { cookie, ...unknownCommit.headers },
        payload: unknownCommit.payload,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: { cookie, ...duplicateCommitBase.headers },
        payload: duplicateCommit,
      }),
      app.inject({
        method: "POST",
        url: "/admin/opening-stock/import/commit",
        headers: { cookie, ...missingCommit.headers },
        payload: missingCommit.payload,
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400]);
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(status.json()).toEqual({ availability: "AVAILABLE" });
  });

  it("returns stable parse and file-size errors while keeping the server usable", async () => {
    const cookie = await createSessionCookie(app);
    const invalid = multipartPayload(workbookPart(Buffer.from("not an xlsx")));
    const oversized = multipartPayload(
      workbookPart(Buffer.alloc(5 * 1024 * 1024 + 1, 0x61)),
    );

    const invalidResponse = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/preview",
      headers: { cookie, ...invalid.headers },
      payload: invalid.payload,
    });
    const oversizedResponse = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/preview",
      headers: { cookie, ...oversized.headers },
      payload: oversized.payload,
    });

    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json()).toEqual({ error: "无法解析期初库存 Excel" });
    expect(oversizedResponse.statusCode).toBe(413);
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ availability: "AVAILABLE" });
  });

  it("rejects changed bytes and mismatched tokens without inventory writes", async () => {
    const cookie = await createSessionCookie(app);
    await configureFormalWarehouses(app, cookie);
    const file = await buildOpeningStockWorkbook();
    const previewBody = multipartPayload(workbookPart(file));
    const preview = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/preview",
      headers: { cookie, ...previewBody.headers },
      payload: previewBody.payload,
    });
    const token = preview.json<{ previewToken: string }>().previewToken;
    const changedCommit = multipartPayload({
      fields: { previewToken: token, financeReviewer: "财务甲", confirmed: "true" },
      ...workbookPart(Buffer.concat([file, Buffer.from([0])])),
    });
    const signatureStart = token.lastIndexOf(".") + 1;
    const replacement = token[signatureStart] === "x" ? "y" : "x";
    const mismatchedCommit = multipartPayload({
      fields: {
        previewToken: `${token.slice(0, signatureStart)}${replacement}${token.slice(signatureStart + 1)}`,
        financeReviewer: "财务甲",
        confirmed: "true",
      },
      ...workbookPart(file),
    });

    const changed = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/commit",
      headers: { cookie, ...changedCommit.headers },
      payload: changedCommit.payload,
    });
    const mismatched = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/commit",
      headers: { cookie, ...mismatchedCommit.headers },
      payload: mismatchedCommit.payload,
    });

    expect(changed.statusCode).toBe(409);
    expect(mismatched.statusCode).toBe(409);
    expect(changed.json()).toEqual({ error: "期初库存文件或系统状态已变化，请重新预览" });
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    const balances = await app.inject({
      method: "GET",
      url: "/admin/transfers/options",
      headers: { cookie },
    });
    expect(status.json()).toEqual({ availability: "AVAILABLE" });
    expect(balances.json()).toEqual({ balances: [] });
  });

  it("allows one valid commit and rejects a second without duplicating inventory", async () => {
    const cookie = await createSessionCookie(app);
    await configureFormalWarehouses(app, cookie);
    const file = await buildOpeningStockWorkbook();
    const previewBody = multipartPayload(workbookPart(file));
    const preview = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/preview",
      headers: { cookie, ...previewBody.headers },
      payload: previewBody.payload,
    });
    const commitBody = multipartPayload({
      fields: {
        previewToken: preview.json<{ previewToken: string }>().previewToken,
        financeReviewer: "财务甲",
        confirmed: "true",
      },
      ...workbookPart(file),
    });

    const first = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/commit",
      headers: { cookie, ...commitBody.headers },
      payload: commitBody.payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/admin/opening-stock/import/commit",
      headers: { cookie, ...commitBody.headers },
      payload: commitBody.payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    const balances = await app.inject({
      method: "GET",
      url: "/admin/transfers/options",
      headers: { cookie },
    });
    expect(balances.json<{ balances: unknown[] }>().balances).toHaveLength(1);
  });

  it("reports fresh and inventory-activity status without creating an import marker", async () => {
    const cookie = await createSessionCookie(app);
    const fresh = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(fresh.json()).toEqual({ availability: "AVAILABLE" });
    const item = await app.inject({
      method: "POST",
      url: "/admin/items",
      headers: { cookie },
      payload: { code: "UNRELATED-0001", name: "无关物品", unit: "个", categoryId: "category-wp" },
    });
    const inbound = await app.inject({
      method: "POST",
      url: "/admin/inbound",
      headers: { cookie },
      payload: {
        warehouseId: "warehouse-1",
        itemId: item.json<{ id: string }>().id,
        quantity: "1",
        unitCost: "1",
        purchasedAt: new Date().toISOString(),
      },
    });
    expect(inbound.statusCode).toBe(201);

    const blocked = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(blocked.json()).toEqual({ availability: "BLOCKED_BY_ACTIVITY" });
  });

  it("retires the legacy single-row endpoint without changing inventory", async () => {
    const cookie = await createSessionCookie(app);
    const before = await app.inject({
      method: "GET",
      url: "/admin/transfers/options",
      headers: { cookie },
    });

    const response = await app.inject({
      method: "POST",
      url: "/admin/opening-stock",
      headers: { cookie },
      payload: {
        verifiedBy: "local-admin",
        rows: [
          {
            warehouseId: "warehouse-1",
            itemId: "item-1",
            batchNo: "LEGACY-OPENING",
            quantity: "1",
            unitCost: "1",
          },
        ],
      },
    });

    expect(response.statusCode).toBe(410);
    expect(response.body).toContain("Excel");
    const after = await app.inject({
      method: "GET",
      url: "/admin/transfers/options",
      headers: { cookie },
    });
    const status = await app.inject({
      method: "GET",
      url: "/admin/opening-stock/import/status",
      headers: { cookie },
    });
    expect(after.json()).toEqual(before.json());
    expect(status.json()).toEqual({ availability: "AVAILABLE" });
  });
});
