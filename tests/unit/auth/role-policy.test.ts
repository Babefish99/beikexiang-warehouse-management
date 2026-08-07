import { describe, expect, it } from "vitest";

import { RolePolicy, type AuthenticatedUser } from "../../../apps/api/src/application/auth/role-service.js";

const applicant: AuthenticatedUser = { id: "u-1", weComUserId: "wx-1", name: "申请人", role: "APPLICANT" };
const admin: AuthenticatedUser = { id: "u-2", weComUserId: "wx-2", name: "管理员", role: "ADMIN" };
const finance: AuthenticatedUser = { id: "u-3", weComUserId: "wx-3", name: "财务", role: "FINANCE" };

describe("role policy", () => {
  it("keeps applicants out of admin routes and mutations", () => {
    expect(RolePolicy.can(applicant, "VIEW_ADMIN")).toBe(false);
    expect(RolePolicy.can(applicant, "CONFIRM_OUTBOUND")).toBe(false);
  });

  it("allows administrators to operate inventory", () => {
    expect(RolePolicy.can(admin, "VIEW_ADMIN")).toBe(true);
    expect(RolePolicy.can(admin, "CONFIRM_OUTBOUND")).toBe(true);
    expect(RolePolicy.can(admin, "CLOSE_PERIOD")).toBe(true);
  });

  it("allows finance to query and export without mutation rights", () => {
    expect(RolePolicy.can(finance, "VIEW_REPORTS")).toBe(true);
    expect(RolePolicy.can(finance, "EXPORT_REPORTS")).toBe(true);
    expect(RolePolicy.can(finance, "EDIT_ITEM")).toBe(false);
    expect(RolePolicy.can(finance, "CONFIRM_OUTBOUND")).toBe(false);
  });
});
