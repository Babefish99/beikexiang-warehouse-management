import { describe, expect, it } from "vitest";

describe("application bootstrap", () => {
  it("loads the API health contract", async () => {
    const response = await fetch(process.env.API_BASE_URL ?? "http://localhost:3001/health");
    expect(response.status).toBe(200);
  });
});
