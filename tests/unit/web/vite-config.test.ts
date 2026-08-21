import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import viteConfig from "../../../apps/web/vite.config.js";

describe("web Vite configuration", () => {
  it("loads public environment variables from the repository root", () => {
    const webDirectory = resolve(process.cwd(), "apps/web");
    const environmentDirectory = resolve(webDirectory, viteConfig.envDir ?? ".");

    expect(environmentDirectory).toBe(resolve(process.cwd()));
  });

  it("ships the WeCom ownership proof on the warehouse web host", async () => {
    const webDirectory = resolve(process.cwd(), "apps/web");
    const publicDirectory = resolve(webDirectory, viteConfig.publicDir ?? "public");
    const proofPath = resolve(publicDirectory, "WW_verify_uIghWtRwsuUPacAx.txt");

    expect(existsSync(proofPath)).toBe(true);
    expect(await readFile(proofPath, "utf8")).toBe("uIghWtRwsuUPacAx");
  });
});
