import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  webServer: [
    { command: "corepack pnpm --filter @warehouse/api dev", url: "http://localhost:3001/health", reuseExistingServer: true },
    { command: "corepack pnpm --filter @warehouse/web dev", url: "http://localhost:5174", reuseExistingServer: true },
  ],
  use: {
    baseURL: process.env.WEB_BASE_URL ?? "http://127.0.0.1:5174",
  },
});
