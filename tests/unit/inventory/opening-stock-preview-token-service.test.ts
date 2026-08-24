import { beforeEach, describe, expect, it } from "vitest";

import { OpeningStockPreviewTokenService } from "../../../apps/api/src/application/inventory/opening-stock-preview-token-service.js";

describe("OpeningStockPreviewTokenService", () => {
  let currentTime: Date;
  let service: OpeningStockPreviewTokenService;

  beforeEach(() => {
    currentTime = new Date("2026-08-24T08:00:00.000Z");
    service = new OpeningStockPreviewTokenService("test-session-secret", {
      now: () => new Date(currentTime),
      ttlMs: 30 * 60 * 1000,
    });
  });

  function expectTokenError(run: () => unknown, message: string): void {
    let thrown: unknown;
    try {
      run();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ message, statusCode: 409 });
  }

  it("binds a token to actor and file for thirty minutes", () => {
    const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });

    expect(issued.expiresAt).toBe("2026-08-24T08:30:00.000Z");
    expect(issued.token.split(".")).toHaveLength(3);
    expect(issued.token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(
      service.verify(issued.token, { actorId: "admin-1", fileSha256: "a".repeat(64) }),
    ).toMatchObject({ version: 1, actorId: "admin-1" });
  });

  it.each([
    ["another admin", { actorId: "admin-2", fileSha256: "a".repeat(64) }],
    ["another file", { actorId: "admin-1", fileSha256: "b".repeat(64) }],
  ])("rejects %s", (_label, expected) => {
    const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });

    expect(() => service.verify(issued.token, expected)).toThrowError(
      "期初库存预览凭证无效，请重新预览",
    );
  });

  it("rejects a tampered signature", () => {
    const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });
    const replacement = issued.token.endsWith("x") ? "y" : "x";

    expectTokenError(
      () =>
        service.verify(`${issued.token.slice(0, -1)}${replacement}`, {
          actorId: "admin-1",
          fileSha256: "a".repeat(64),
        }),
      "期初库存预览凭证无效，请重新预览",
    );
  });

  it("rejects malformed token shapes and prefixes uniformly", () => {
    const expected = { actorId: "admin-1", fileSha256: "a".repeat(64) };

    for (const token of ["", "v1.payload", "v2.payload.signature", "v1.payload.signature.extra"]) {
      expectTokenError(
        () => service.verify(token, expected),
        "期初库存预览凭证无效，请重新预览",
      );
    }
  });

  it("rejects an expired token", () => {
    const issued = service.issue({ actorId: "admin-1", fileSha256: "a".repeat(64) });
    currentTime = new Date("2026-08-24T08:30:00.001Z");

    expectTokenError(
      () =>
        service.verify(issued.token, {
          actorId: "admin-1",
          fileSha256: "a".repeat(64),
        }),
      "期初库存预览凭证已过期，请重新预览",
    );
  });
});
