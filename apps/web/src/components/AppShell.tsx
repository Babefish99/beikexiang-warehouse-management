import type { ReactNode } from "react";
import { BarChart3, LayoutDashboard, PackageSearch, Settings, Warehouse } from "lucide-react";

type NavigationItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  activePaths?: string[];
};

const navItems: NavigationItem[] = [
  { label: "首页", href: "/", icon: LayoutDashboard },
  { label: "库存台账", href: "/admin/items", icon: PackageSearch },
  {
    label: "出入库管理",
    href: "/admin/outbound",
    icon: Warehouse,
    activePaths: ["/admin/inbound", "/admin/outbound", "/admin/transfers", "/admin/returns", "/admin/opening-stock", "/admin/stocktake", "/admin/period-close"],
  },
  { label: "报表中心", href: "/admin/reports", icon: BarChart3 },
  { label: "系统设置", href: "/admin/warehouses", icon: Settings },
];

function isActivePath(pathname: string, item: NavigationItem): boolean {
  return [item.href, ...(item.activePaths ?? [])].some((path) => path === "/" ? pathname === path : pathname.startsWith(path));
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = window.location.pathname;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="brand-mark">库</span>
          <span><strong>集团仓库</strong><small>Inventory Center</small></span>
        </div>
        <nav className="sidebar__nav" aria-label="主导航">
          {navItems.map(({ label, href, icon: Icon, ...item }) => {
            const active = isActivePath(pathname, { label, href, icon: Icon, ...item });
            return (
              <a className={`nav-item ${active ? "is-active" : ""}`} key={label} href={href} aria-current={active ? "page" : undefined}>
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar__footer"><strong>库存数据安全运行中</strong><small>三仓库统一管理</small></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar__crumb">集团仓库管理系统</div>
          <div className="topbar__actions"><span className="status-dot" />管理员</div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
