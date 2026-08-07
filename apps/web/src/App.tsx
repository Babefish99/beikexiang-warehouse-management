import { ArrowDownToLine, ArrowUpFromLine, Boxes, RefreshCw } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { PageHeader } from "./components/PageHeader";

const cards = [
  { label: "库存品类", value: "—", hint: "标准物品库" },
  { label: "待出库审批", value: "—", hint: "企业微信已通过" },
  { label: "本月入库", value: "—", hint: "数量 / 金额" },
  { label: "本月出库", value: "—", hint: "数量 / 金额" },
];

export default function App() {
  return (
    <AppShell>
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
    </AppShell>
  );
}
