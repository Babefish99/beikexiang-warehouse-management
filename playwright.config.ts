import { defineConfig } from "@playwright/test";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:3001";
const webBaseUrl = process.env.WEB_BASE_URL ?? "http://127.0.0.1:5174";
const apiPort = new URL(apiBaseUrl).port || "3001";
const webPort = new URL(webBaseUrl).port || "5174";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: [
    { command: `corepack pnpm --filter @warehouse/api dev`, url: `${apiBaseUrl}/health`, reuseExistingServer: true, env: { API_PORT: apiPort, API_BASE_URL: apiBaseUrl, WEB_BASE_URL: webBaseUrl } },
    { command: `corepack pnpm --filter @warehouse/web exec vite --host 0.0.0.0 --port ${webPort}`, url: webBaseUrl, reuseExistingServer: true, env: { VITE_API_BASE_URL: apiBaseUrl } },
  ],
  use: {
    baseURL: webBaseUrl,
  },
});
