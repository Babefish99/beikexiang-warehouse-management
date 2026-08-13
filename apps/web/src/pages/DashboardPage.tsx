import { CalendarDays, CheckCircle2, ClipboardCheck, FileSpreadsheet, PackageSearch, RefreshCw } from "lucide-react";
import { ApprovalMark, InboundMark, InventoryMark, OutboundMark } from "../components/DashboardIcons";
import { PageHeader } from "../components/PageHeader";
import { useMobileViewport } from "../features/mobile/use-mobile-viewport";
import type { WarehouseOption } from "../components/AppShell";
import { useNotificationTaskSnapshot } from "../features/notifications/use-notification-tasks";

export type DashboardCard = { label: string; value: string; hint: string; tone: "inventory" | "approval" | "inbound" | "outbound" | "low" | "notification" };

const metricIcons = { inventory: InventoryMark, approval: ApprovalMark, inbound: InboundMark, outbound: OutboundMark, low: InventoryMark, notification: ApprovalMark };

function cardValue(cards: DashboardCard[], label: string, loading: boolean): string {
  return loading ? "加载中" : cards.find((card) => card.label === label)?.value ?? "0";
}

export function DashboardPage({ cards, loading, notificationIdentityKey, role, warehouses = [], selectedWarehouseId = "all", onSelectWarehouse }: { cards: DashboardCard[]; loading: boolean; notificationIdentityKey: string; role: "ADMIN" | "FINANCE"; warehouses?: WarehouseOption[]; selectedWarehouseId?: string; onSelectWarehouse?(warehouseId: string): void }) {
  const isMobileViewport = useMobileViewport();
  const notificationSnapshot = useNotificationTaskSnapshot(notificationIdentityKey);

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
  return <div className="page">
    <PageHeader title="库存总览" description="查看三个仓库的库存状态、待处理业务和本月变动。" actions={<button className="button button--secondary" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} />刷新数据</button>} />
    <section className="metric-strip" aria-label="库存概览指标">{desktopCards.map((card) => { const MetricIcon = metricIcons[card.tone]; return <div className={`metric metric--${card.tone}`} key={card.label}><span className="metric__icon"><MetricIcon size={26} /></span><div className="metric__content"><span className="metric__label">{card.label}</span><div className="metric__value"><strong>{card.value}</strong></div><span className="metric__hint">{card.hint}</span></div></div>; })}</section>
    <section className="dashboard-grid"><article className="panel"><header className="panel__header"><div><h2>业务快捷入口</h2><small>管理员常用操作</small></div></header><div className="quick-actions"><a href="/admin/inbound"><InboundMark size={28} /><span>登记入库</span></a><a href="/admin/outbound"><OutboundMark size={28} /><span>办理出库</span></a><a href="/admin/opening-stock"><InventoryMark size={28} /><span>录入期初库存</span></a></div></article>
      <article className="panel"><header className="panel__header"><div><h2>当前运行状态</h2><small>管理员工作提示</small></div></header><div className="system-status"><div className="system-status__item"><span className="system-status__icon system-status__icon--approval"><ClipboardCheck size={17} /></span><div><strong>企业微信审批</strong><p>审批通过后自动进入后台待出库列表。</p></div></div><div className="system-status__item"><span className="system-status__icon system-status__icon--outbound"><CheckCircle2 size={17} /></span><div><strong>实际出库登记</strong><p>管理员选择仓库、采购批次和实际出库数量。</p></div></div><div className="system-status__item"><span className="system-status__icon system-status__icon--close"><CalendarDays size={17} /></span><div><strong>月末盘点与结账</strong><p>盘点后核对报表，完成当月库存结账。</p></div></div></div></article></section>
  </div>;
}
