import { PageHeader } from "../components/PageHeader";

export function TransfersPage() { return <div className="page"><PageHeader title="仓库调拨" description="调拨无需审批；管理员确认后一次完成，沿用原入库批次和采购单价。" /><section className="panel"><div className="notice"><strong>一键调拨</strong><p>选择调出仓库、调入仓库、物品、批次和数量后提交。系统会同时写调出与调入流水。</p></div></section></div>; }
