import { describe, expect, it } from "vitest";

import type { AuthenticatedUser } from "../../../apps/api/src/application/auth/role-service.js";
import { isLocalAuthEnabled, isLoopbackAddress, localAdminUser } from "../../../apps/api/src/application/auth/local-auth.js";

describe("local auth policy", () => {
  it("enables local auth only when the flag is true outside production", () => {
    expect(isLocalAuthEnabled({ bypassEnabled: true, nodeEnv: "development" })).toBe(true);
    expect(isLocalAuthEnabled({ bypassEnabled: false, nodeEnv: "development" })).toBe(false);
    expect(isLocalAuthEnabled({ bypassEnabled: true, nodeEnv: "production" })).toBe(false);
  });

  it("recognizes only loopback IP addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
  });

  it("returns the fixed local administrator identity", () => {
    const user = localAdminUser();

    expect(user).toEqual<AuthenticatedUser>({
      id: "local-admin",
      weComUserId: "local-admin",
      name: "本地管理员",
      role: "ADMIN",
    });
    expect(localAdminUser()).not.toBe(user);
  });
});
