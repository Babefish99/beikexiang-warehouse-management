import type { Page } from "@playwright/test";

export const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
export const webBaseUrl = process.env.WEB_BASE_URL ?? "http://127.0.0.1:5174";

export function apiUrl(path: string): string {
  return new URL(path, apiBaseUrl).toString();
}

export function apiUrlPattern(pathPattern: string): RegExp {
  const escapedBaseUrl = apiBaseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedBaseUrl}${pathPattern}`);
}

export async function loginAs(page: Page, returnTo: string, role: "ADMIN" | "FINANCE"): Promise<void> {
  await page.goto(`${apiBaseUrl}/auth/local?returnTo=${encodeURIComponent(returnTo)}&role=${role}`);
  await page.goto(new URL(returnTo, webBaseUrl).toString());
}
