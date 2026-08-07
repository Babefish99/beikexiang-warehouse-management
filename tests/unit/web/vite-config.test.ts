import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import viteConfig from "../../../apps/web/vite.config.js";

describe("web Vite configuration", () => {
  it("loads public environment variables from the repository root", () => {
    const webDirectory = resolve(process.cwd(), "apps/web");
    const environmentDirectory = resolve(webDirectory, viteConfig.envDir ?? ".");

    expect(environmentDirectory).toBe(resolve(process.cwd()));
  });
});
