import { describe, expect, it } from "vitest";
import {
  getMobileNavigation,
  isMobileNavigationActive,
  MOBILE_MEDIA_QUERY,
} from "../../../apps/web/src/features/mobile/mobile-navigation";

describe("mobile navigation", () => {
  it("gives admins the five approved task entries", () => {
    expect(getMobileNavigation("ADMIN").map((item) => item.label)).toEqual([
      "首页",
      "查询",
      "入库",
      "出库",
      "更多",
    ]);
  });

  it("removes mutation entries for finance", () => {
    expect(getMobileNavigation("FINANCE").map((item) => item.label)).toEqual([
      "首页",
      "查询",
      "报表",
      "更多",
    ]);
  });

  it("uses the inclusive 820px boundary and exact route matching", () => {
    expect(MOBILE_MEDIA_QUERY).toBe("(max-width: 820px)");
    const inventory = getMobileNavigation("ADMIN").find((item) => item.label === "查询")!;
    expect(isMobileNavigationActive("/admin/inventory", inventory)).toBe(true);
    expect(isMobileNavigationActive("/admin/items", inventory)).toBe(false);
  });
});
