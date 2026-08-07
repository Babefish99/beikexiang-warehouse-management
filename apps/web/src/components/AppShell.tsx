import type { ReactNode } from "react";
import { BarChart3, LayoutDashboard, PackageSearch, Settings, Warehouse } from "lucide-react";

const navItems = [
  { label: "首页", icon: LayoutDashboard },
  { label: "库存台账", icon: PackageSearch },
  { label: "出入库管理", icon: Warehouse },
  { label: "报表中心", icon: BarChart3 },
  { label: "系统设置", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="brand-mark">库</span>
          <span><strong>集团仓库</strong><small>Inventory Center</small></span>
        </div>
        <nav className="sidebar__nav" aria-label="主导航">
          {navItems.map(({ label, icon: Icon }, index) => (
            <button className={`nav-item ${index === 0 ? "is-active" : ""}`} key={label} type="button">
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </button>
          ))}
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
