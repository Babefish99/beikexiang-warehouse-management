import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, FileSpreadsheet, RefreshCw, ShieldAlert } from "lucide-react";
import { AdminLayout } from "./layouts/AdminLayout";
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
type DashboardCard = { label: string; value: string; hint: string };
type ItemRow = { isActive: boolean };
type PendingApproval = { id: string };
type TransactionRow = { quantity: string; amount: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const currentPeriod = new Date().toISOString().slice(0, 7);
const loadingCards = (): DashboardCard[] => [
  { label: "库存品类", value: "加载中", hint: "标准物品库" },
  { label: "待出库审批", value: "加载中", hint: "企业微信已通过" },
  { label: "本月入库", value: "加载中", hint: "数量 / 金额" },
  { label: "本月出库", value: "加载中", hint: "数量 / 金额" },
];

function summariseTransactions(rows: TransactionRow[]): { quantity: string; amount: string } {
  const totals = rows.reduce((current, row) => ({
    quantity: current.quantity + Number(row.quantity),
    amount: current.amount + Number(row.amount),
  }), { quantity: 0, amount: 0 });
  return { quantity: `${totals.quantity}`, amount: totals.amount.toFixed(2) };
}

export default function App() {
  const [user, setUser] = useState<WebUser | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState(`${apiBaseUrl}/auth/wecom/authorize`);
  const [localAuthUrl, setLocalAuthUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<DashboardCard[]>(loadingCards);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const [sessionResponse, authorizeResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/auth/session`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/auth/wecom/authorize?returnTo=${encodeURIComponent(window.location.pathname)}`),
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
  }, []);

  useEffect(() => {
    if (!user || user.role !== "ADMIN" || window.location.pathname !== "/") return;
    let active = true;
    const loadDashboard = async () => {
      try {
        const [itemsResponse, pendingResponse, inboundResponse, outboundResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/admin/items?includeInactive=true`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/outbound/pending`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/reports/transactions?period=${currentPeriod}&type=inbound`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/reports/transactions?period=${currentPeriod}&type=outbound`, { credentials: "include" }),
        ]);
        if (!itemsResponse.ok || !pendingResponse.ok || !inboundResponse.ok || !outboundResponse.ok) throw new Error("dashboard query failed");
        const items = await itemsResponse.json() as ItemRow[];
        const pending = await pendingResponse.json() as PendingApproval[];
        const inbound = summariseTransactions(await inboundResponse.json() as TransactionRow[]);
        const outbound = summariseTransactions(await outboundResponse.json() as TransactionRow[]);
        if (!active) return;
        setCards([
          { label: "库存品类", value: `${items.filter((item) => item.isActive).length}`, hint: "标准物品库" },
          { label: "待出库审批", value: `${pending.length}`, hint: "企业微信已通过" },
          { label: "本月入库", value: `${inbound.quantity} / ${inbound.amount}`, hint: "数量 / 金额" },
          { label: "本月出库", value: `${outbound.quantity} / ${outbound.amount}`, hint: "数量 / 金额" },
        ]);
      } catch {
        if (!active) return;
        setCards([
          { label: "库存品类", value: "加载失败", hint: "标准物品库" },
          { label: "待出库审批", value: "加载失败", hint: "企业微信已通过" },
          { label: "本月入库", value: "加载失败", hint: "数量 / 金额" },
          { label: "本月出库", value: "加载失败", hint: "数量 / 金额" },
        ]);
      }
    };
    void loadDashboard();
    return () => {
      active = false;
    };
  }, [user]);

  if (loading) return <main className="login-page"><p>正在检查企业微信登录状态…</p></main>;
  if (!user) return <LoginPage authorizeUrl={authorizeUrl} localAuthUrl={localAuthUrl} />;
  if (user.role === "FINANCE" && window.location.pathname === "/admin/reports") return <AdminLayout user={{ name: user.name, roleLabel: "财务" }}><ReportsPage /></AdminLayout>;
  if (user.role === "APPLICANT") return <main className="login-page"><section className="login-card"><ShieldAlert size={36} color="var(--orange)" /><h1>暂无后台权限</h1><p>当前企业微信账号只能发起和查看领用申请。</p></section></main>;
  if (user.role === "FINANCE") return <AdminLayout user={{ name: user.name, roleLabel: "财务" }}><div className="page"><PageHeader title="报表中心" description="财务可查询和导出已结账期间的库存报表。" /><section className="panel"><div className="notice"><FileSpreadsheet size={24} color="var(--orange)" /><strong>月度库存报表</strong><p>财务账号可进入报表中心查询和导出，且不具备库存修改权限。</p></div></section></div></AdminLayout>;

  if (window.location.pathname === "/admin/items") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><ItemsPage /></AdminLayout>;
  if (window.location.pathname === "/admin/warehouses") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><WarehousesPage /></AdminLayout>;
  if (window.location.pathname === "/admin/inbound") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><InboundPage /></AdminLayout>;
  if (window.location.pathname === "/admin/opening-stock") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><OpeningStockPage /></AdminLayout>;
  if (window.location.pathname === "/admin/outbound") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><OutboundPage /></AdminLayout>;
  if (window.location.pathname === "/admin/transfers") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><TransfersPage /></AdminLayout>;
  if (window.location.pathname === "/admin/returns") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><ReturnsPage /></AdminLayout>;
  if (window.location.pathname === "/admin/stocktake") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><StocktakePage /></AdminLayout>;
  if (window.location.pathname === "/admin/period-close") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><PeriodClosePage /></AdminLayout>;
  if (window.location.pathname === "/admin/reports") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><ReportsPage /></AdminLayout>;

  return (
    <AdminLayout user={{ name: "管理员", roleLabel: "库存管理员" }}>
      <div className="page">
        <PageHeader title="库存总览" description="查看三个仓库的库存状态、待处理业务和本月变动。" actions={<button className="button button--secondary" type="button" onClick={() => window.location.reload()}><RefreshCw size={15} />刷新数据</button>} />
        <section className="metric-strip" aria-label="库存概览指标">
          {cards.map((card) => <div className="metric" key={card.label}><span className="metric__icon"><Boxes size={18} /></span><div><strong>{card.value}</strong><span>{card.label}</span><small>{card.hint}</small></div></div>)}
        </section>
        <section className="dashboard-grid">
          <article className="panel"><header className="panel__header"><div><strong>业务快捷入口</strong><small>管理员常用操作</small></div></header><div className="quick-actions"><a href="/admin/inbound"><ArrowDownToLine size={19} /><span>登记入库</span></a><a href="/admin/outbound"><ArrowUpFromLine size={19} /><span>办理出库</span></a><a href="/admin/opening-stock"><ArrowDownToLine size={19} /><span>录入期初库存</span></a></div></article>
          <article className="panel"><header className="panel__header"><div><strong>系统说明</strong><small>当前阶段</small></div></header><div className="notice"><strong>企业微信审批已接入准出库</strong><p>员工继续在企业微信发起申请，审批通过后自动进入后台待出库列表。管理员实际出库时选择仓库和采购批次。</p></div></article>
        </section>
      </div>
    </AdminLayout>
  );
}
