import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AuthenticatedUser } from "./role-service.js";

interface SessionPayload extends AuthenticatedUser {
  exp: number;
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}

export class SessionService {
  private readonly key: Buffer;

  constructor(private readonly secret: string, private readonly ttlSeconds = 8 * 60 * 60) {
    if (secret.length < 16) throw new Error("session secret must be at least 16 characters");
    this.key = createHash("sha256").update(secret).digest();
  }

  createSession(user: AuthenticatedUser): string {
    const payload: SessionPayload = { ...user, exp: Math.floor(Date.now() / 1000) + this.ttlSeconds };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
  }

  readSession(token: string): AuthenticatedUser | null {
    try {
      const [ivValue, tagValue, encryptedValue] = token.split(".");
      if (!ivValue || !tagValue || !encryptedValue) return null;
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivValue, "base64url"));
      decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
      const payload = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8")) as SessionPayload;
      if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
      return { id: payload.id, weComUserId: payload.weComUserId, name: payload.name, role: payload.role };
    } catch {
      return null;
    }
  }

  cookieOptions(secure = true): SessionCookieOptions {
    return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: this.ttlSeconds };
  }
}
