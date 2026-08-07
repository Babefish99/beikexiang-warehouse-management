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

function normalizeHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("?") || trimmed.includes("#")) {
    return null;
  }

  try {
    const url = new URL(`http://${trimmed}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }

    return url.host.toLowerCase();
  } catch {
    return null;
  }
}

function loopbackHostsFor(apiBaseUrl: string): Set<string> {
  const url = new URL(apiBaseUrl);
  const suffix = url.port ? `:${url.port}` : "";

  return new Set([
    `localhost${suffix}`,
    `127.0.0.1${suffix}`,
    `[::1]${suffix}`,
  ]);
}

export function isAllowedLocalAuthHost(options: { hostHeader?: string; apiBaseUrl: string }): boolean {
  if (!options.hostHeader) return false;

  const requestHost = normalizeHost(options.hostHeader);
  const apiHost = normalizeHost(new URL(options.apiBaseUrl).host);

  if (!requestHost || !apiHost) return false;
  if (requestHost === apiHost) return true;

  return loopbackHostsFor(options.apiBaseUrl).has(requestHost);
}

export function localAdminUser(): AuthenticatedUser {
  return { ...LOCAL_ADMIN_USER };
}
