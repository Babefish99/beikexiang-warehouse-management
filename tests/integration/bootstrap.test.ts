import { describe, expect, it } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";

describe("application bootstrap", () => {
  it("loads the API health contract", async () => {
    const app = buildServer();

    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
