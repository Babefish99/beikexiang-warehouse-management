import { PageHeader } from "../components/PageHeader";

export function StocktakePage() { return <div className="page"><PageHeader title="月度盘点" description="每月底盘点一次；盘盈盘亏调整必须填写差异原因并保留前后数量。" /><section className="panel"><div className="notice"><strong>三仓库盘点</strong><p>系统将按仓库、物品和批次展示账面数量，管理员录入实盘数量后提交差异调整。</p></div></section></div>; }
