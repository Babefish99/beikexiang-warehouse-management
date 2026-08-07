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

type WebUser = { id: string; weComUserId: string; name: string; role: "APPLICANT" | "ADMIN" | "FINANCE" };
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const cards = [
  { label: "库存品类", value: "—", hint: "标准物品库" },
  { label: "待出库审批", value: "—", hint: "企业微信已通过" },
  { label: "本月入库", value: "—", hint: "数量 / 金额" },
  { label: "本月出库", value: "—", hint: "数量 / 金额" },
];

export default function App() {
  const [user, setUser] = useState<WebUser | null>(null);
  const [authorizeUrl, setAuthorizeUrl] = useState(`${apiBaseUrl}/auth/wecom/authorize`);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const [sessionResponse, authorizeResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/auth/session`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/auth/wecom/authorize?returnTo=${encodeURIComponent(window.location.pathname)}`),
        ]);
        if (sessionResponse.ok) setUser((await sessionResponse.json()).user as WebUser);
        if (authorizeResponse.ok) setAuthorizeUrl((await authorizeResponse.json()).authorizeUrl);
      } finally {
        setLoading(false);
      }
    };
    void loadSession();
  }, []);

  if (loading) return <main className="login-page"><p>正在检查企业微信登录状态…</p></main>;
  if (!user) return <LoginPage authorizeUrl={authorizeUrl} />;
  if (user.role === "APPLICANT") return <main className="login-page"><section className="login-card"><ShieldAlert size={36} color="var(--orange)" /><h1>暂无后台权限</h1><p>当前企业微信账号只能发起和查看领用申请。</p></section></main>;
  if (user.role === "FINANCE") return <AdminLayout user={{ name: user.name, roleLabel: "财务" }}><div className="page"><PageHeader title="报表中心" description="财务可查询和导出已结账期间的库存报表。" /><section className="panel"><div className="notice"><FileSpreadsheet size={24} color="var(--orange)" /><strong>月度库存报表</strong><p>报表下载功能将在月结账后开放，财务账号不具备库存修改权限。</p></div></section></div></AdminLayout>;

  if (window.location.pathname === "/admin/items") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><ItemsPage /></AdminLayout>;
  if (window.location.pathname === "/admin/warehouses") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><WarehousesPage /></AdminLayout>;
  if (window.location.pathname === "/admin/inbound") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><InboundPage /></AdminLayout>;
  if (window.location.pathname === "/admin/opening-stock") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><OpeningStockPage /></AdminLayout>;
  if (window.location.pathname === "/admin/outbound") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><OutboundPage /></AdminLayout>;
  if (window.location.pathname === "/admin/transfers") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><TransfersPage /></AdminLayout>;
  if (window.location.pathname === "/admin/returns") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><ReturnsPage /></AdminLayout>;
  if (window.location.pathname === "/admin/stocktake") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><StocktakePage /></AdminLayout>;
  if (window.location.pathname === "/admin/period-close") return <AdminLayout user={{ name: user.name, roleLabel: "库存管理员" }}><PeriodClosePage /></AdminLayout>;

  return (
    <AdminLayout user={{ name: "管理员", roleLabel: "库存管理员" }}>
      <div className="page">
        <PageHeader title="库存总览" description="查看三个仓库的库存状态、待处理业务和本月变动。" actions={<button className="button button--secondary" type="button"><RefreshCw size={15} />刷新数据</button>} />
        <section className="metric-strip" aria-label="库存概览指标">
          {cards.map((card) => <div className="metric" key={card.label}><span className="metric__icon"><Boxes size={18} /></span><div><strong>{card.value}</strong><span>{card.label}</span><small>{card.hint}</small></div></div>)}
        </section>
        <section className="dashboard-grid">
          <article className="panel"><header className="panel__header"><div><strong>业务快捷入口</strong><small>管理员常用操作</small></div></header><div className="quick-actions"><button type="button"><ArrowDownToLine size={19} /><span>登记入库</span></button><button type="button"><ArrowUpFromLine size={19} /><span>办理出库</span></button><button type="button"><ArrowDownToLine size={19} /><span>录入期初库存</span></button></div></article>
          <article className="panel"><header className="panel__header"><div><strong>系统说明</strong><small>当前阶段</small></div></header><div className="notice"><strong>企业微信审批已接入准备</strong><p>员工继续在企业微信发起申请，审批通过后自动进入后台待出库列表。管理员实际出库时选择仓库和采购批次。</p></div></article>
        </section>
      </div>
    </AdminLayout>
  );
}
