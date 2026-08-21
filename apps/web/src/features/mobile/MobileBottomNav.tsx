import { BarChart3, Ellipsis, Home, PackageCheck, PackagePlus, Search, type LucideIcon } from "lucide-react";
import { getMobileNavigation, isMobileNavigationActive, type MobileNavigationItem } from "./mobile-navigation";

const icons: Record<MobileNavigationItem["label"], LucideIcon> = {
  首页: Home,
  查询: Search,
  入库: PackagePlus,
  出库: PackageCheck,
  报表: BarChart3,
  更多: Ellipsis,
};

export function MobileBottomNav({
  role,
  pathname,
  onOpenMore,
}: {
  role: "ADMIN" | "FINANCE";
  pathname: string;
  onOpenMore(): void;
}) {
  return (
    <nav className="mobile-bottom-nav" aria-label="手机任务导航">
      {getMobileNavigation(role).map((item) => {
        const Icon = icons[item.label];
        if (item.action === "more") {
          return (
            <button key={item.label} type="button" onClick={onOpenMore}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        }

        const active = isMobileNavigationActive(pathname, item);
        return (
          <a key={item.label} href={item.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>
            <Icon size={18} strokeWidth={1.8} />
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
