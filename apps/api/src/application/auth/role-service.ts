export type UserRole = "APPLICANT" | "ADMIN" | "FINANCE";

export interface AuthenticatedUser {
  id: string;
  weComUserId: string;
  name: string;
  role: UserRole;
}

export function parseConfiguredWeComUserIds(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((userId) => userId.trim())
    .filter((userId) => Boolean(userId) && !userId.toLowerCase().startsWith("replace-with-"));
}

export type Permission =
  | "VIEW_ADMIN"
  | "VIEW_REPORTS"
  | "EXPORT_REPORTS"
  | "EDIT_ITEM"
  | "EDIT_WAREHOUSE"
  | "RECORD_INBOUND"
  | "CONFIRM_OUTBOUND"
  | "TRANSFER_STOCK"
  | "RECORD_RETURN"
  | "RECORD_STOCKTAKE"
  | "CLOSE_PERIOD"
  | "RESYNC_APPROVAL";

const permissions: Record<UserRole, ReadonlySet<Permission>> = {
  APPLICANT: new Set(),
  ADMIN: new Set([
    "VIEW_ADMIN", "VIEW_REPORTS", "EXPORT_REPORTS", "EDIT_ITEM", "EDIT_WAREHOUSE",
    "RECORD_INBOUND", "CONFIRM_OUTBOUND", "TRANSFER_STOCK", "RECORD_RETURN",
    "RECORD_STOCKTAKE", "CLOSE_PERIOD", "RESYNC_APPROVAL",
  ]),
  FINANCE: new Set(["VIEW_REPORTS", "EXPORT_REPORTS"]),
};

export const RolePolicy = {
  can(user: AuthenticatedUser, permission: Permission): boolean {
    return permissions[user.role].has(permission);
  },
};
