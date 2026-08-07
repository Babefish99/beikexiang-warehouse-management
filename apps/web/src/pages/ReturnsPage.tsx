import { PageHeader } from "../components/PageHeader";

export function ReturnsPage() { return <div className="page"><PageHeader title="办理退库" description="退库无需审批，但必须关联原审批单和原出库记录。" /><section className="panel"><div className="notice"><strong>关联原出库</strong><p>选择原出库分配记录，填写实际退回数量和原因；系统按原批次采购单价冲回库存。</p></div></section></div>; }
