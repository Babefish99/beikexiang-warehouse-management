import type { Page } from "@playwright/test";

export async function loginAs(page: Page, returnTo: string, role: "ADMIN" | "FINANCE"): Promise<void> {
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
  await page.goto(`${apiBaseUrl}/auth/local?returnTo=${encodeURIComponent(returnTo)}&role=${role}`);
  const webBaseUrl = process.env.WEB_BASE_URL ?? "http://127.0.0.1:5174";
  await page.goto(new URL(returnTo, webBaseUrl).toString());
}
