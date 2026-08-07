import type { AuthenticatedUser } from "./role-service.js";

const LOCAL_ADMIN_USER: AuthenticatedUser = {
  id: "local-admin",
  weComUserId: "local-admin",
  name: "本地管理员",
  role: "ADMIN",
};

export function isLocalAuthEnabled(options: { bypassEnabled: boolean; nodeEnv?: string }): boolean {
  if (!options.bypassEnabled) return false;
  return (options.nodeEnv ?? "development").toLowerCase() !== "production";
}

export function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function localAdminUser(): AuthenticatedUser {
  return { ...LOCAL_ADMIN_USER };
}
