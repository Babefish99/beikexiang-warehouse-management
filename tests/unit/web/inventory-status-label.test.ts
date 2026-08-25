import { describe, expect, it } from "vitest";

import { inventoryStatusLabel } from "../../../apps/web/src/features/inventory/inventory-status-label";

describe("inventory status label", () => {
  it.each([
    ["PENDING_OUTBOUND", "待出库"],
    ["COMPLETED", "已完成"],
    ["PARTIALLY_ISSUED", "部分出库"],
    ["UNAVAILABLE", "无法出库"],
    ["VOIDED", "已取消"],
    ["PENDING", "待处理"],
    ["APPROVED", "已通过"],
    ["REJECTED", "已拒绝"],
    ["REVOKED", "已撤回"],
    ["CANCELED", "已取消"],
  ])("renders %s as %s", (status, label) => {
    expect(inventoryStatusLabel(status)).toBe(label);
  });

  it("does not expose an unknown English enum to the user", () => {
    expect(inventoryStatusLabel("NEW_BACKEND_STATUS")).toBe("状态待确认");
  });
});
