export const MOBILE_MEDIA_QUERY = "(max-width: 820px)";

export type MobileNavigationItem = {
  label: "首页" | "查询" | "入库" | "出库" | "报表" | "更多";
  href?: string;
  action?: "more";
};

const adminItems: readonly MobileNavigationItem[] = [
  { label: "首页", href: "/" },
  { label: "查询", href: "/admin/inventory" },
  { label: "入库", href: "/admin/inbound" },
  { label: "出库", href: "/admin/outbound" },
  { label: "更多", action: "more" },
];

const financeItems: readonly MobileNavigationItem[] = [
  { label: "首页", href: "/" },
  { label: "查询", href: "/admin/inventory" },
  { label: "报表", href: "/admin/reports" },
  { label: "更多", action: "more" },
];

export function getMobileNavigation(role: "ADMIN" | "FINANCE"): readonly MobileNavigationItem[] {
  return role === "ADMIN" ? adminItems : financeItems;
}

export function isMobileNavigationActive(pathname: string, item: MobileNavigationItem): boolean {
  if (!item.href) return false;
  return item.href === "/" ? pathname === "/" : pathname === item.href;
}
