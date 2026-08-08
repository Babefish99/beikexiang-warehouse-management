import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, CalendarDays, CheckCircle2, ClipboardCheck, FileSpreadsheet, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminLayout, type WarehouseOption, type WorkspaceUser } from "./layouts/AdminLayout";
import { PageHeader } from "./components/PageHeader";
import { LoginPage } from "./pages/LoginPage";
import { ItemsPage } from "./pages/ItemsPage";
import { WarehousesPage } from "./pages/WarehousesPage";
import { InboundPage } from "./pages/InboundPage";
import { OpeningStockPage } from "./pages/OpeningStockPage";
import { OutboundPage } from "./pages/OutboundPage";
import { TransfersPage } from "./pages/TransfersPage";
import { ReturnsPage } from "./pages/ReturnsPage";
import { StocktakePage } from "./pages/StocktakePage";
import { PeriodClosePage } from "./pages/PeriodClosePage";
import { ReportsPage } from "./pages/ReportsPage";

type WebUser = { id: string; weComUserId: string; name: string; role: "APPLICANT" | "ADMIN" | "FINANCE" };
type AuthMetadata = { authorizeUrl: string; localAuthUrl?: string };
type DashboardCard = { label: string; value: string; hint: string; tone: "inventory" | "approval" | "inbound" | "outbound" };
type ItemRow = { isActive: boolean };
type PendingApproval = { id: string };
type TransactionRow = { quantity: string; amount: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const currentPeriod = new Date().toISOString().slice(0, 7);
const warehouseStorageKey = "warehouse.selectedWarehouseId";
const loadingCards = (): DashboardCard[] => [
  { label: "库存品类", value: "加载中", hint: "标准物品库", tone: "inventory" },
  { label: "待出库审批", value: "加载中", hint: "企业微信已通过", tone: "approval" },
  { label: "本月入库", value: "加载中", hint: "数量 / 金额", tone: "inbound" },
  { label: "本月出库", value: "加载中", hint: "数量 / 金额", tone: "outbound" },
];

const metricIcons = { inventory: Boxes, approval: ClipboardCheck, inbound: ArrowDownToLine, outbound: ArrowUpFromLine };

function summariseTransactions(rows: TransactionRow[]): { quantity: string; amount: string } {
  const totals = rows.reduce((current, row) => ({
    quantity: current.quantity + Number(row.quantity),
    amount: current.amount + Number(row.amount),
  }), { quantity: 0, amount: 0 });
  return { quantity: `${totals.quantity}`, amount: totals.amount.toFixed(2) };
}

function toWorkspaceUser(user: WebUser): WorkspaceUser {
  if (user.role === "FINANCE") return { name: user.name, roleLabel: "财务", role: "FINANCE" };
  return { name: user.name, roleLabel: "库存管理员", role: "ADMIN" };
}

export default function App() {
  const pathname = window.location.pathname;
  const [user, setUser] = useState<WebUser | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState(`${apiBaseUrl}/auth/wecom/authorize`);
  const [localAuthUrl, setLocalAuthUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<DashboardCard[]>(loadingCards);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("all");

  useEffect(() => {
    const loadSession = async () => {
      try {
        const [sessionResponse, authorizeResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/auth/session`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/auth/wecom/authorize?returnTo=${encodeURIComponent(pathname)}`, { credentials: "include" }),
        ]);
        if (sessionResponse.ok) setUser((await sessionResponse.json()).user as WebUser);
        if (authorizeResponse.ok) {
          const metadata = await authorizeResponse.json() as AuthMetadata;
          setAuthorizeUrl(metadata.authorizeUrl);
          setLocalAuthUrl(metadata.localAuthUrl);
        }
      } finally {
        setLoading(false);
      }
    };

    void loadSession();
  }, [pathname]);

  useEffect(() => {
    if (!user || (user.role !== "ADMIN" && user.role !== "FINANCE")) {
      setWarehouses([]);
      setSelectedWarehouseId("all");
      return;
    }

    let active = true;
    const loadWarehouses = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/admin/reports/warehouses`, { credentials: "include" });
        if (!response.ok) throw new Error("warehouse query failed");
        const activeWarehouses = (await response.json() as WarehouseOption[]).filter((warehouse) => warehouse.isActive);
        if (!active) return;
        setWarehouses(activeWarehouses);
        const savedWarehouseId = window.localStorage.getItem(warehouseStorageKey) ?? "all";
        const nextWarehouseId = savedWarehouseId === "all" || activeWarehouses.some((warehouse) => warehouse.id === savedWarehouseId)
          ? savedWarehouseId
          : "all";
        setSelectedWarehouseId(nextWarehouseId);
        window.localStorage.setItem(warehouseStorageKey, nextWarehouseId);
      } catch {
        if (!active) return;
        setWarehouses([]);
        setSelectedWarehouseId("all");
        window.localStorage.setItem(warehouseStorageKey, "all");
      }
    };

    void loadWarehouses();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "ADMIN" || pathname !== "/") return;
    let active = true;
    const loadDashboard = async () => {
      const encodedWarehouseId = encodeURIComponent(selectedWarehouseId);
      try {
        const [itemsResponse, pendingResponse, inboundResponse, outboundResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/admin/items?includeInactive=true`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/outbound/pending`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/reports/transactions?period=${currentPeriod}&type=inbound&warehouseId=${encodedWarehouseId}`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/reports/transactions?period=${currentPeriod}&type=outbound&warehouseId=${encodedWarehouseId}`, { credentials: "include" }),
        ]);
        if (!itemsResponse.ok || !pendingResponse.ok || !inboundResponse.ok || !outboundResponse.ok) throw new Error("dashboard query failed");
        const items = await itemsResponse.json() as ItemRow[];
        const pending = await pendingResponse.json() as PendingApproval[];
        const inbound = summariseTransactions(await inboundResponse.json() as TransactionRow[]);
        const outbound = summariseTransactions(await outboundResponse.json() as TransactionRow[]);
        if (!active) return;
        setCards([
          { label: "库存品类", value: `${items.filter((item) => item.isActive).length}`, hint: "标准物品库", tone: "inventory" },
          { label: "待出库审批", value: `${pending.length}`, hint: "企业微信已通过", tone: "approval" },
          { label: "本月入库", value: `${inbound.quantity} / ${inbound.amount}`, hint: "数量 / 金额", tone: "inbound" },
          { label: "本月出库", value: `${outbound.quantity} / ${outbound.amount}`, hint: "数量 / 金额", tone: "outbound" },
        ]);
      } catch {
        if (!active) return;
        setCards([
          { label: "库存品类", value: "加载失败", hint: "标准物品库", tone: "inventory" },
          { label: "待出库审批", value: "加载失败", hint: "企业微信已通过", tone: "approval" },
          { label: "本月入库", value: "加载失败", hint: "数量 / 金额", tone: "inbound" },
          { label: "本月出库", value: "加载失败", hint: "数量 / 金额", tone: "outbound" },
        ]);
      }
    };

    void loadDashboard();
    return () => {
      active = false;
    };
  }, [pathname, selectedWarehouseId, user]);

  const onSelectWarehouse = (warehouseId: string) => {
    setSelectedWarehouseId(warehouseId);
    window.localStorage.setItem(warehouseStorageKey, warehouseId);
  };

  const renderAdminLayout = (workspaceUser: WorkspaceUser, content: ReactNode) => (
    <AdminLayout
      user={workspaceUser}
      warehouses={warehouses}
      selectedWarehouseId={selectedWarehouseId}
      onSelectWarehouse={onSelectWarehouse}
    >
      {content}
    </AdminLayout>
  );

  if (loading) return <main className="login-page"><p>正在检查企业微信登录状态…</p></main>;
  if (!user) return <LoginPage authorizeUrl={authorizeUrl} localAuthUrl={localAuthUrl} />;
  if (user.role === "APPLICANT") {
    return (
      <main className="login-page">
        <section className="login-card">
          <ShieldAlert size={36} color="var(--orange)" />
          <h1>暂无后台权限</h1>
          <p>当前企业微信账号只能发起和查看领用申请。</p>
        </section>
      </main>
    );
  }

  const workspaceUser = toWorkspaceUser(user);

  if (user.role === "FINANCE" && pathname === "/admin/reports") {
    return renderAdminLayout(workspaceUser, <ReportsPage warehouseId={selectedWarehouseId} />);
  }

  if (user.role === "FINANCE") {
    return renderAdminLayout(
      workspaceUser,
      <div className="page">
        <PageHeader title="报表中心" description="财务可查询和导出已结账期间的库存报表。" />
        <section className="panel">
          <div className="notice">
            <FileSpreadsheet size={24} color="var(--orange)" />
            <strong>月度库存报表</strong>
            <p>财务账号可进入报表中心查询和导出，且不具备库存修改权限。</p>
          </div>
        </section>
      </div>,
    );
  }

  if (pathname === "/admin/items") return renderAdminLayout(workspaceUser, <ItemsPage />);
  if (pathname === "/admin/warehouses") return renderAdminLayout(workspaceUser, <WarehousesPage />);
  if (pathname === "/admin/inbound") return renderAdminLayout(workspaceUser, <InboundPage />);
  if (pathname === "/admin/opening-stock") return renderAdminLayout(workspaceUser, <OpeningStockPage />);
  if (pathname === "/admin/outbound") return renderAdminLayout(workspaceUser, <OutboundPage />);
  if (pathname === "/admin/transfers") return renderAdminLayout(workspaceUser, <TransfersPage />);
  if (pathname === "/admin/returns") return renderAdminLayout(workspaceUser, <ReturnsPage />);
  if (pathname === "/admin/stocktake") return renderAdminLayout(workspaceUser, <StocktakePage />);
  if (pathname === "/admin/period-close") return renderAdminLayout(workspaceUser, <PeriodClosePage />);
  if (pathname === "/admin/reports") return renderAdminLayout(workspaceUser, <ReportsPage warehouseId={selectedWarehouseId} />);

  return renderAdminLayout(
    workspaceUser,
    <div className="page">
      <PageHeader
        title="库存总览"
        description="查看三个仓库的库存状态、待处理业务和本月变动。"
        actions={<button className="button button--secondary" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} />刷新数据</button>}
      />
      <section className="metric-strip" aria-label="库存概览指标">
        {cards.map((card) => {
          const MetricIcon = metricIcons[card.tone];
          return (
            <div className={`metric metric--${card.tone}`} key={card.label}>
              <span className="metric__icon"><MetricIcon size={18} /></span>
              <div className="metric__content">
                <span className="metric__label">{card.label}</span>
                <div className="metric__value">
                  <strong>{card.value}</strong>
                </div>
                <span className="metric__hint">{card.hint}</span>
              </div>
            </div>
          );
        })}
      </section>
      <section className="dashboard-grid">
        <article className="panel">
          <header className="panel__header">
            <div>
              <h2>业务快捷入口</h2>
              <small>管理员常用操作</small>
            </div>
          </header>
          <div className="quick-actions">
            <a href="/admin/inbound"><ArrowDownToLine size={19} /><span>登记入库</span></a>
            <a href="/admin/outbound"><ArrowUpFromLine size={19} /><span>办理出库</span></a>
            <a href="/admin/opening-stock"><ArrowDownToLine size={19} /><span>录入期初库存</span></a>
          </div>
        </article>
        <article className="panel">
          <header className="panel__header">
            <div>
              <h2>当前运行状态</h2>
              <small>管理员工作提示</small>
            </div>
          </header>
          <div className="system-status">
            <div className="system-status__item">
              <span className="system-status__icon system-status__icon--approval"><ClipboardCheck size={17} /></span>
              <div>
                <strong>企业微信审批</strong>
                <p>审批通过后自动进入后台待出库列表。</p>
              </div>
            </div>
            <div className="system-status__item">
              <span className="system-status__icon system-status__icon--outbound"><CheckCircle2 size={17} /></span>
              <div>
                <strong>实际出库登记</strong>
                <p>管理员选择仓库、采购批次和实际出库数量。</p>
              </div>
            </div>
            <div className="system-status__item">
              <span className="system-status__icon system-status__icon--close"><CalendarDays size={17} /></span>
              <div>
                <strong>月末盘点与结账</strong>
                <p>盘点后核对报表，完成当月库存结账。</p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>,
  );
}
