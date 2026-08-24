import { createHmac, timingSafeEqual } from "node:crypto";

import { BusinessRuleError } from "../errors/business-rule-error.js";

const TOKEN_PREFIX = "v1";
const SIGNATURE_CONTEXT = "opening-stock-preview.v1";
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const INVALID_TOKEN_MESSAGE = "期初库存预览凭证无效，请重新预览";
const EXPIRED_TOKEN_MESSAGE = "期初库存预览凭证已过期，请重新预览";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface OpeningStockPreviewTokenPayload {
  version: 1;
  actorId: string;
  fileSha256: string;
  issuedAt: string;
  expiresAt: string;
}

export interface OpeningStockPreviewTokenServiceOptions {
  now?: () => Date;
  ttlMs?: number;
}

function invalidToken(): BusinessRuleError {
  return new BusinessRuleError(INVALID_TOKEN_MESSAGE, 409);
}

function isStrictIsoTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isTokenPayload(value: unknown): value is OpeningStockPreviewTokenPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).length !== 5) return false;
  return (
    payload.version === 1 &&
    typeof payload.actorId === "string" &&
    payload.actorId.length > 0 &&
    typeof payload.fileSha256 === "string" &&
    SHA256_PATTERN.test(payload.fileSha256) &&
    typeof payload.issuedAt === "string" &&
    isStrictIsoTimestamp(payload.issuedAt) &&
    typeof payload.expiresAt === "string" &&
    isStrictIsoTimestamp(payload.expiresAt) &&
    new Date(payload.expiresAt).getTime() > new Date(payload.issuedAt).getTime()
  );
}

export class OpeningStockPreviewTokenService {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(
    private readonly secret: string,
    options: OpeningStockPreviewTokenServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    if (this.secret.length === 0 || !Number.isSafeInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error("opening stock preview token configuration is invalid");
    }
  }

  issue(input: { actorId: string; fileSha256: string }): { token: string; expiresAt: string } {
    if (input.actorId.length === 0 || !SHA256_PATTERN.test(input.fileSha256)) throw invalidToken();
    const issuedAtDate = this.now();
    if (Number.isNaN(issuedAtDate.getTime())) throw new Error("opening stock preview clock is invalid");
    const payload: OpeningStockPreviewTokenPayload = {
      version: 1,
      actorId: input.actorId,
      fileSha256: input.fileSha256,
      issuedAt: issuedAtDate.toISOString(),
      expiresAt: new Date(issuedAtDate.getTime() + this.ttlMs).toISOString(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encodedPayload);
    return {
      token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
      expiresAt: payload.expiresAt,
    };
  }

  verify(
    token: string,
    expected: { actorId: string; fileSha256: string },
  ): OpeningStockPreviewTokenPayload {
    const segments = token.split(".");
    if (
      segments.length !== 3 ||
      segments[0] !== TOKEN_PREFIX ||
      !segments[1] ||
      !segments[2] ||
      !BASE64URL_PATTERN.test(segments[1]) ||
      !BASE64URL_PATTERN.test(segments[2])
    ) {
      throw invalidToken();
    }

    const encodedPayload = segments[1];
    const actualSignature = Buffer.from(segments[2], "base64url");
    const expectedSignature = Buffer.from(this.sign(encodedPayload), "base64url");
    if (
      actualSignature.length !== expectedSignature.length ||
      !timingSafeEqual(actualSignature, expectedSignature)
    ) {
      throw invalidToken();
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
      throw invalidToken();
    }
    if (
      !isTokenPayload(decoded) ||
      decoded.actorId !== expected.actorId ||
      decoded.fileSha256 !== expected.fileSha256
    ) {
      throw invalidToken();
    }
    if (this.now().getTime() >= new Date(decoded.expiresAt).getTime()) {
      throw new BusinessRuleError(EXPIRED_TOKEN_MESSAGE, 409);
    }
    return decoded;
  }

  private sign(encodedPayload: string): string {
    return createHmac("sha256", this.secret)
      .update(`${SIGNATURE_CONTEXT}.${encodedPayload}`)
      .digest("base64url");
  }
}
