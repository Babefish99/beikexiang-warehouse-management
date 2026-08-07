import { describe, expect, it } from "vitest";

import { SessionService } from "../../../apps/api/src/application/auth/session-service.js";

describe("session service", () => {
  it("round-trips an encrypted authenticated session", () => {
    const service = new SessionService("a-session-secret-that-is-long-enough");
    const user = { id: "u-1", weComUserId: "wx-1", name: "管理员", role: "ADMIN" as const };
    const token = service.createSession(user);

    expect(token).not.toContain(user.name);
    expect(service.readSession(token)).toEqual(user);
    expect(service.readSession(`${token}tampered`)).toBeNull();
  });

  it("rejects an expired session", () => {
    const service = new SessionService("a-session-secret-that-is-long-enough", -1);
    const token = service.createSession({ id: "u-1", weComUserId: "wx-1", name: "管理员", role: "ADMIN" });

    expect(service.readSession(token)).toBeNull();
  });
});
