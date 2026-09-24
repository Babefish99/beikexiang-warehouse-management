import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileSpreadsheet, ListFilter, PackageSearch, RefreshCw, Search } from "lucide-react";
import { ApprovalMark, InboundMark, InventoryMark, OutboundMark } from "../components/DashboardIcons";
import { PageHeader } from "../components/PageHeader";
import { useMobileViewport } from "../features/mobile/use-mobile-viewport";
import type { WarehouseOption } from "../components/AppShell";
import { useNotificationTaskSnapshot } from "../features/notifications/use-notification-tasks";
import {
  dashboardCategoryLabels,
  dashboardStatusLabels,
  filterDashboardInventoryItems,
  getDashboardInventoryCategory,
  getDashboardInventoryStatus,
  type DashboardInventoryCategory,
  type DashboardInventoryItem,
  type DashboardInventoryStatus,
  type DashboardMovements,
} from "../features/dashboard/inventory-overview";

export type DashboardCard = { label: string; value: string; hint: string; tone: "inventory" | "approval" | "inbound" | "outbound" | "low" | "notification" };

type DashboardPageProps = {
  cards: DashboardCard[];
  loading: boolean;
  notificationIdentityKey: string;
  role: "ADMIN" | "FINANCE";
  warehouses?: WarehouseOption[];
  selectedWarehouseId?: string;
  onSelectWarehouse?(warehouseId: string): void;
  inventoryItems?: DashboardInventoryItem[];
  movements?: DashboardMovements;
};

const metricIcons = { inventory: InventoryMark, approval: ApprovalMark, inbound: InboundMark, outbound: OutboundMark, low: InventoryMark, notification: ApprovalMark };
const categoryOptions = ["all", "alcohol", "tea", "noodles", "other"] as const;
const categoryDescriptions: Record<DashboardInventoryCategory, string> = {
  all: "跨品类查看全部库存",
  alcohol: "白酒与红酒库存",
  tea: "茶饮类库存",
  noodles: "名称含“粉条”的物品",
  other: "其余标准物品",
};
const statusOptions = ["all", "normal", "low", "out"] as const;
const visibleRowLimit = 6;

function cardValue(cards: DashboardCard[], label: string, loading: boolean): string {
  return loading ? "加载中" : cards.find((card) => card.label === label)?.value ?? "0";
}

function formatQuantity(value: string | number): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(numericValue);
}

function movementLabel(itemId: string, movements: DashboardMovements): string {
  const movement = movements[itemId];
  if (!movement || (!movement.inbound && !movement.outbound)) return "本月无变动";
  if (movement.inbound && movement.outbound) return `本月入库 +${formatQuantity(movement.inbound)} · 出库 -${formatQuantity(movement.outbound)}`;
  if (movement.inbound) return `本月入库 +${formatQuantity(movement.inbound)}`;
  return `本月出库 -${formatQuantity(movement.outbound)}`;
}

export function DashboardPage({ cards, loading, notificationIdentityKey, role, warehouses = [], selectedWarehouseId = "all", onSelectWarehouse, inventoryItems = [], movements = {} }: DashboardPageProps) {
  const isMobileViewport = useMobileViewport();
  const notificationSnapshot = useNotificationTaskSnapshot(notificationIdentityKey);
  const [category, setCategory] = useState<DashboardInventoryCategory>("all");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [status, setStatus] = useState<DashboardInventoryStatus>("all");
  const [query, setQuery] = useState("");
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const categoryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!categoryMenuRef.current?.contains(event.target as Node)) setCategoryMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCategoryMenuOpen(false);
      categoryButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryMenuOpen]);

  const categoryItems = useMemo(() => filterDashboardInventoryItems(inventoryItems, { category, status: "all", query }), [category, inventoryItems, query]);
  const filteredItems = useMemo(() => filterDashboardInventoryItems(inventoryItems, { category, status, query }), [category, inventoryItems, query, status]);
  const statusCounts = useMemo(() => ({
    all: categoryItems.length,
    normal: categoryItems.filter((item) => getDashboardInventoryStatus(item) === "normal").length,
    low: categoryItems.filter((item) => getDashboardInventoryStatus(item) === "low").length,
    out: categoryItems.filter((item) => getDashboardInventoryStatus(item) === "out").length,
  }), [categoryItems]);

  if (isMobileViewport) {
    return (
      <div className="page mobile-dashboard">
        <label className="mobile-dashboard__warehouse">
          <span>当前仓库</span>
          <select aria-label="选择仓库" value={selectedWarehouseId} onChange={(event) => onSelectWarehouse?.(event.target.value)}>
            <option value="all">全部仓库</option>
            {warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
          </select>
        </label>
        <header className="mobile-dashboard__greeting">
          <h1>你好，{role === "ADMIN" ? "库存管理员" : "财务同事"}</h1>
          <p>{role === "ADMIN" ? "今天也一起把库存工作处理清楚。" : "查询库存与报表数据。"}</p>
        </header>
        <form className="mobile-dashboard__search" action="/admin/inventory">
          <PackageSearch size={18} aria-hidden="true" />
          <input aria-label="统一搜索" name="query" type="search" placeholder="搜索编码、名称、批次或仓库" />
          <button type="submit">查询</button>
        </form>
        <section className="mobile-dashboard__actions panel" aria-label="快捷操作">
          {role === "ADMIN" ? <>
            <a href="/admin/inbound"><InboundMark size={18} /><span>手机入库</span></a>
            <a href="/admin/outbound"><OutboundMark size={18} /><span>实际出库</span></a>
          </> : <>
            <a href="/admin/inventory"><PackageSearch size={18} /><span>库存查询</span></a>
            <a href="/admin/reports"><FileSpreadsheet size={18} /><span>报表中心</span></a>
          </>}
        </section>
        {role === "ADMIN" ? <section className="mobile-dashboard__overview" aria-label="今日概览">
          <h2>今日概览</h2>
          <div>
            <article><span>待出库</span><strong>{cardValue(cards, "待出库", loading)}</strong></article>
            <article><span>低库存</span><strong>{loading ? "加载中" : notificationSnapshot.tasks.filter((task) => task.kind === "LOW_STOCK").length}</strong></article>
            <article><span>库存品类</span><strong>{cardValue(cards, "库存品类", loading)}</strong></article>
            <article><span>通知</span><strong>{loading ? "加载中" : notificationSnapshot.tasks.length}</strong></article>
          </div>
        </section> : null}
        <p className="mobile-dashboard__hint">复杂的盘点、调拨与结账操作请在电脑端完成。</p>
      </div>
    );
  }

  if (role === "FINANCE") {
    return <div className="page"><PageHeader title="财务工作台" description="查询库存与已结账期间的报表数据。" /><section className="panel"><div className="quick-actions quick-actions--finance"><a href="/admin/inventory"><PackageSearch size={28} /><span>库存查询</span></a><a href="/admin/reports"><FileSpreadsheet size={28} /><span>报表中心</span></a></div></section></div>;
  }

  const desktopCardLabels = new Set(["库存品类", "待出库审批", "本月入库", "本月出库"]);
  const desktopCards = cards.filter((card) => desktopCardLabels.has(card.label));
  return <div className="page dashboard-page">
    <PageHeader title="库存总览" description="查看全部仓库的库存状态、待处理业务和本月变动。" actions={<button className="button button--secondary" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} />刷新数据</button>} />
    <section className="metric-strip" aria-label="库存概览指标">{desktopCards.map((card) => { const MetricIcon = metricIcons[card.tone]; return <div className={`metric metric--${card.tone}`} key={card.label}><span className="metric__icon"><MetricIcon size={26} /></span><div className="metric__content"><span className="metric__label">{card.label}</span><div className="metric__value"><strong>{card.value}</strong></div><span className="metric__hint">{card.hint}</span></div></div>; })}</section>
    <section className="panel dashboard-inventory" aria-labelledby="dashboard-inventory-title">
      <header className="dashboard-inventory__header">
        <div>
          <h2 id="dashboard-inventory-title">全部库存总览</h2>
          <div className="dashboard-inventory__tabs" role="tablist" aria-label="库存状态">
            {statusOptions.map((option) => <button className={status === option ? "is-active" : ""} type="button" role="tab" aria-selected={status === option} onClick={() => setStatus(option)} key={option}>{dashboardStatusLabels[option]} <strong>{statusCounts[option]}</strong></button>)}
          </div>
        </div>
        <div className="dashboard-inventory__tools">
          <div className="topbar-panel dashboard-inventory__category" ref={categoryMenuRef}>
            <button
              className="dashboard-category-selector"
              ref={categoryButtonRef}
              type="button"
              aria-label={`筛选品类：${dashboardCategoryLabels[category]}`}
              aria-haspopup="menu"
              aria-expanded={categoryMenuOpen}
              onClick={() => setCategoryMenuOpen((open) => !open)}
            >
              <ListFilter size={16} aria-hidden="true" />
              <span>{dashboardCategoryLabels[category]}</span>
              <ChevronDown size={16} aria-hidden="true" />
            </button>
            {categoryMenuOpen ? <div className="workspace-popover workspace-popover--menu dashboard-category-menu" role="menu" aria-label="品类筛选">
              {categoryOptions.map((option) => <button
                className={`workspace-menu-item ${category === option ? "is-selected" : ""}`}
                type="button"
                role="menuitemradio"
                aria-checked={category === option}
                onClick={() => {
                  setCategory(option);
                  setCategoryMenuOpen(false);
                }}
                key={option}
              >
                <span>{dashboardCategoryLabels[option]}</span>
                <small>{categoryDescriptions[option]}</small>
              </button>)}
            </div> : null}
          </div>
          <label className="dashboard-inventory__search">
            <Search size={17} aria-hidden="true" />
            <input aria-label="搜索库存物品" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索物品名称或规格" />
          </label>
          <a className="button button--secondary dashboard-inventory__ledger" href="/admin/items"><InventoryMark size={17} />查看库存台账</a>
        </div>
      </header>
      <div className="dashboard-inventory__table-wrap">
        <table className="dashboard-inventory__table">
          <thead><tr><th>物品</th><th>当前库存</th><th>状态</th><th>近期变动</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="dashboard-inventory__empty">正在加载库存…</td></tr> : filteredItems.length === 0 ? <tr><td colSpan={4} className="dashboard-inventory__empty">没有符合条件的库存物品</td></tr> : filteredItems.slice(0, visibleRowLimit).map((item) => {
              const itemStatus = getDashboardInventoryStatus(item);
              const itemCategory = getDashboardInventoryCategory(item);
              return <tr key={item.id}>
                <td><strong>{item.name}</strong><small>规格：{item.specification || "未填写"} · 品类：{dashboardCategoryLabels[itemCategory]}</small></td>
                <td><strong className="dashboard-inventory__quantity">{formatQuantity(item.stockQuantity)}</strong> {item.unit}</td>
                <td><span className={`dashboard-stock-status dashboard-stock-status--${itemStatus}`}>{dashboardStatusLabels[itemStatus]}</span></td>
                <td className="dashboard-inventory__movement">{movementLabel(item.id, movements)}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <footer className="dashboard-inventory__footer">
        <span>显示前 {Math.min(visibleRowLimit, filteredItems.length)} 项 · 共 {filteredItems.length} 项</span>
        <a href="/admin/items">查看全部库存台账</a>
      </footer>
    </section>
  </div>;
}
