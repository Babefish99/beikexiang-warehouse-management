import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BarChart3, Building2, ChevronDown, LayoutDashboard, Menu, PackageSearch, Search, Settings, ShieldCheck, UserCircle, Warehouse, X } from "lucide-react";

export type WarehouseOption = { id: string; code: string; name: string; isActive: boolean };
export type WorkspaceUser = { name: string; roleLabel: string; role: "ADMIN" | "FINANCE" };

type InventorySearchLocation = {
  warehouseId: string;
  warehouseName: string;
  batchId: string;
  batchNo: string;
  quantity: string;
  unitCost: string;
  amount: string;
};

type InventorySearchResult = {
  itemId: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  totalQuantity: string;
  totalAmount: string;
  locations: InventorySearchLocation[];
};

type InventoryNotification = {
  id: string;
  kind: string;
  title: string;
  description: string;
  href: string;
  priority: number;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  activePaths?: string[];
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

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

function toWarehouseLabel(selectedWarehouseId: string, warehouses: WarehouseOption[]): string {
  if (selectedWarehouseId === "all") return "全部仓库";
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === selectedWarehouseId);
  return selectedWarehouse ? `${selectedWarehouse.code} · ${selectedWarehouse.name}` : "全部仓库";
}

export function AppShell({
  children,
  user,
  warehouses,
  selectedWarehouseId,
  onSelectWarehouse,
}: {
  children: ReactNode;
  user: WorkspaceUser;
  warehouses: WarehouseOption[];
  selectedWarehouseId: string;
  onSelectWarehouse(warehouseId: string): void;
}) {
  const pathname = window.location.pathname;
  const currentSection = navItems.find((item) => isActivePath(pathname, item))?.label ?? "工作台";
  const selectedWarehouseLabel = useMemo(
    () => toWarehouseLabel(selectedWarehouseId, warehouses),
    [selectedWarehouseId, warehouses],
  );
  const loginChannel = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost" ? "本地开发登录" : "企业微信登录";

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [warehouseMenuOpen, setWarehouseMenuOpen] = useState(false);
  const [notificationMenuOpen, setNotificationMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<InventorySearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<InventoryNotification[]>([]);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const searchRequestVersion = useRef(0);

  useEffect(() => {
    const query = searchQuery.trim();
    searchRequestVersion.current += 1;
    const requestVersion = searchRequestVersion.current;
    setSearchResults([]);
    setSearchError(null);

    if (!query) {
      setSearchLoading(false);
      setSearchPopoverOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({
          query,
          warehouseId: selectedWarehouseId,
        });
        const response = await fetch(`${apiBaseUrl}/admin/reports/inventory-search?${params.toString()}`, {
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("全局搜索加载失败");
        const payload = await response.json() as InventorySearchResult[];
        if (controller.signal.aborted || searchRequestVersion.current !== requestVersion) return;
        setSearchResults(payload);
      } catch (error) {
        if (controller.signal.aborted || searchRequestVersion.current !== requestVersion) return;
        setSearchResults([]);
        setSearchError(error instanceof Error ? error.message : "全局搜索加载失败");
      } finally {
        if (!controller.signal.aborted && searchRequestVersion.current === requestVersion) setSearchLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [searchQuery, selectedWarehouseId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mobileMenuOpen) {
        setMobileMenuOpen(false);
        return;
      }
      if (warehouseMenuOpen) {
        setWarehouseMenuOpen(false);
        return;
      }
      if (searchPopoverOpen) {
        setSearchPopoverOpen(false);
        return;
      }
      if (notificationMenuOpen) {
        setNotificationMenuOpen(false);
        return;
      }
      if (userMenuOpen) {
        setUserMenuOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen, notificationMenuOpen, searchPopoverOpen, userMenuOpen, warehouseMenuOpen]);

  useEffect(() => {
    if (user.role !== "ADMIN") {
      setNotifications([]);
      setNotificationError(null);
      setHasUnreadNotifications(false);
      return;
    }

    let active = true;
    const loadNotifications = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/admin/notifications`, { credentials: "include" });
        if (!response.ok) throw new Error("通知中心加载失败");
        if (!active) return;
        const payload = await response.json() as InventoryNotification[];
        setNotifications(payload);
        setNotificationError(null);
        setHasUnreadNotifications(payload.length > 0);
      } catch (error) {
        if (!active) return;
        setNotifications([]);
        setNotificationError(error instanceof Error ? error.message : "通知中心加载失败");
        setHasUnreadNotifications(false);
      }
    };

    void loadNotifications();
    return () => {
      active = false;
    };
  }, [user.role]);

  const showSearchPopover = searchPopoverOpen && searchQuery.trim().length > 0;

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
    setSearchPopoverOpen(false);
  };

  const navigateToSearchResult = (code: string) => {
    clearSearch();
    window.location.assign(`/admin/items?search=${encodeURIComponent(code)}`);
  };

  const closeDrawer = () => {
    setMobileMenuOpen(false);
  };

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
        <div className="sidebar__footer">
          <strong>库存数据安全运行中</strong>
          <small>三仓库统一管理</small>
        </div>
      </aside>

      {mobileMenuOpen ? (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="移动导航">
          <button className="mobile-drawer__backdrop" type="button" aria-label="关闭菜单" onClick={closeDrawer} />
          <div className="mobile-drawer__panel">
            <div className="mobile-drawer__header">
              <div>
                <strong>集团仓库</strong>
                <small>Inventory Center</small>
              </div>
              <button className="topbar-icon-button" type="button" aria-label="关闭菜单" onClick={closeDrawer}>
                <X size={18} />
              </button>
            </div>
            <nav className="mobile-drawer__nav" aria-label="移动主导航">
              {navItems.map(({ label, href, icon: Icon, ...item }) => {
                const active = isActivePath(pathname, { label, href, icon: Icon, ...item });
                return (
                  <a
                    className={`nav-item ${active ? "is-active" : ""}`}
                    key={`mobile-${label}`}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={closeDrawer}
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{label}</span>
                  </a>
                );
              })}
            </nav>
          </div>
        </div>
      ) : null}

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__leading">
            <button className="topbar-icon-button mobile-nav-toggle" type="button" aria-label="打开菜单" onClick={() => setMobileMenuOpen(true)}>
              <Menu size={18} />
            </button>
            <div className="topbar__crumb">
              <span>集团仓库管理系统</span>
              <strong>{currentSection}</strong>
            </div>
            <div className="topbar-panel">
              <button
                className="topbar-selector"
                type="button"
                aria-haspopup="menu"
                aria-expanded={warehouseMenuOpen}
                onClick={() => {
                  setWarehouseMenuOpen((open) => !open);
                  setSearchPopoverOpen(false);
                  setNotificationMenuOpen(false);
                  setUserMenuOpen(false);
                }}
              >
                <Building2 size={16} />
                <span>{selectedWarehouseLabel}</span>
                <ChevronDown size={16} />
              </button>
              {warehouseMenuOpen ? (
                <div className="workspace-popover workspace-popover--menu" role="menu" aria-label="仓库切换">
                  <button
                    className={`workspace-menu-item ${selectedWarehouseId === "all" ? "is-selected" : ""}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedWarehouseId === "all"}
                    onClick={() => {
                      onSelectWarehouse("all");
                      setWarehouseMenuOpen(false);
                      if (searchQuery.trim()) setSearchPopoverOpen(true);
                    }}
                  >
                    <span>全部仓库</span>
                    <small>跨仓查看集团库存</small>
                  </button>
                  {warehouses.map((warehouse) => (
                    <button
                      className={`workspace-menu-item ${selectedWarehouseId === warehouse.id ? "is-selected" : ""}`}
                      key={warehouse.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selectedWarehouseId === warehouse.id}
                      onClick={() => {
                        onSelectWarehouse(warehouse.id);
                        setWarehouseMenuOpen(false);
                        if (searchQuery.trim()) setSearchPopoverOpen(true);
                      }}
                    >
                      <span>{warehouse.code} · {warehouse.name}</span>
                      <small>{warehouse.isActive ? "启用中" : "已停用"}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="topbar__center">
            <div className="workspace-search">
              <Search size={16} className="workspace-search__icon" />
              <input
                aria-label="全局搜索"
                aria-expanded={showSearchPopover}
                type="search"
                value={searchQuery}
                placeholder="搜索编码、名称、批次或仓库"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchPopoverOpen(event.target.value.trim().length > 0);
                }}
                onFocus={() => {
                  if (searchQuery.trim()) setSearchPopoverOpen(true);
                  setWarehouseMenuOpen(false);
                  setNotificationMenuOpen(false);
                  setUserMenuOpen(false);
                }}
              />
              {searchQuery ? (
                <button className="workspace-search__clear" type="button" aria-label="清空搜索" onClick={clearSearch}>
                  <X size={14} />
                </button>
              ) : null}
              {showSearchPopover ? (
                <div className="workspace-popover workspace-popover--search">
                  {searchLoading ? <p className="workspace-popover__empty">正在搜索库存…</p> : null}
                  {!searchLoading && searchError ? <p className="workspace-popover__empty">{searchError}</p> : null}
                  {!searchLoading && !searchError && !searchResults.length ? <p className="workspace-popover__empty">未找到匹配的库存结果</p> : null}
                  {!searchLoading && !searchError && searchResults.length ? (
                    <div className="workspace-search-results">
                      {searchResults.map((result) => (
                        <button
                          className="workspace-search-result"
                          key={result.itemId}
                          type="button"
                          onClick={() => navigateToSearchResult(result.code)}
                        >
                          <div className="workspace-search-result__title">
                            <strong>{result.code}</strong>
                            <span>{result.name}</span>
                          </div>
                          {result.specification ? <small>{result.specification} · {result.unit}</small> : <small>{result.unit}</small>}
                          {result.locations.map((location) => (
                            <span className="workspace-search-result__meta" key={`${result.itemId}-${location.warehouseId}-${location.batchId}`}>
                              {location.warehouseName} · 批次 {location.batchNo} · 数量 {location.quantity} · 金额 {location.amount}
                            </span>
                          ))}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          <div className="topbar__actions">
            {user.role === "ADMIN" ? (
              <div className="topbar-panel">
                <button
                  className="topbar-icon-button"
                  type="button"
                  aria-label="通知中心"
                  aria-expanded={notificationMenuOpen}
                  onClick={() => {
                    setNotificationMenuOpen((open) => !open);
                    setWarehouseMenuOpen(false);
                    setSearchPopoverOpen(false);
                    setUserMenuOpen(false);
                  }}
                >
                  <Bell size={18} />
                  {hasUnreadNotifications ? <span className="workspace-icon-button__badge" /> : null}
                </button>
                {notificationMenuOpen ? (
                  <div className="workspace-popover workspace-popover--notifications">
                    <div className="workspace-popover__header">
                      <strong>通知中心</strong>
                      <button className="workspace-link-button" type="button" onClick={() => setHasUnreadNotifications(false)}>全部已读</button>
                    </div>
                    {notificationError ? <p className="workspace-popover__empty">{notificationError}</p> : null}
                    {!notificationError && !notifications.length ? <p className="workspace-popover__empty">暂无待处理通知</p> : null}
                    {!notificationError && notifications.length ? (
                      <div className="workspace-notification-list">
                        {notifications.map((notification) => (
                          <a className="workspace-notification" key={notification.id} href={notification.href}>
                            <strong>{notification.title}</strong>
                            <p>{notification.description}</p>
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="topbar-panel">
              <button
                className="workspace-user-button"
                type="button"
                aria-haspopup="dialog"
                aria-expanded={userMenuOpen}
                onClick={() => {
                  setUserMenuOpen((open) => !open);
                  setWarehouseMenuOpen(false);
                  setSearchPopoverOpen(false);
                  setNotificationMenuOpen(false);
                }}
              >
                <UserCircle size={22} />
                <span>
                  <strong>{user.name}</strong>
                  <small>{user.roleLabel}</small>
                </span>
                <ChevronDown size={16} />
              </button>
              {userMenuOpen ? (
                <div className="workspace-popover workspace-popover--user">
                  <div className="workspace-user-card">
                    <strong>{user.name}</strong>
                    <small>{user.roleLabel}</small>
                  </div>
                  <div className="workspace-info-row">
                    <ShieldCheck size={16} />
                    <div>
                      <strong>登录信息</strong>
                      <small>{loginChannel} · 当前仅提供查看，不支持壳层内修改</small>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="main-content">{children}</main>
      </div>
    </div>
  );
}
