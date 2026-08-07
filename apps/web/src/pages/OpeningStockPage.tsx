import { FormEvent, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function OpeningStockPage() {
  const [row, setRow] = useState({ warehouseId: "", itemId: "", batchNo: "", quantity: "", unitCost: "", remark: "" });
  const [verifiedBy, setVerifiedBy] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch(`${apiBaseUrl}/admin/opening-stock`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ verifiedBy, rows: [row] }) });
    setMessage(response.ok ? `期初库存已登记：${(await response.json() as { batchIds: string[] }).batchIds.join("、")}` : "期初库存登记失败，请检查字段和权限。");
  };

  return <div className="page"><PageHeader title="录入期初库存" description="先完成实盘，再录入系统；本操作不导入历史 Excel 交易流水。" /><section className="panel form-panel"><form className="form-grid" onSubmit={submit}><label><span>盘点人 *</span><input required value={verifiedBy} onChange={(event) => setVerifiedBy(event.target.value)} /></label><label><span>仓库 *</span><input required value={row.warehouseId} onChange={(event) => setRow({ ...row, warehouseId: event.target.value })} /></label><label><span>物品 *</span><input required value={row.itemId} onChange={(event) => setRow({ ...row, itemId: event.target.value })} /></label><label><span>批次号 *</span><input required value={row.batchNo} onChange={(event) => setRow({ ...row, batchNo: event.target.value })} /></label><label><span>实盘数量 *</span><input required type="number" min="0" step="0.001" value={row.quantity} onChange={(event) => setRow({ ...row, quantity: event.target.value })} /></label><label><span>确认单价 *</span><input required type="number" min="0" step="0.01" value={row.unitCost} onChange={(event) => setRow({ ...row, unitCost: event.target.value })} /></label><label className="form-grid__wide"><span>差异/实盘说明</span><textarea value={row.remark} onChange={(event) => setRow({ ...row, remark: event.target.value })} /></label><div className="form-grid__wide form-actions"><button className="button button--primary" type="submit">保存期初库存</button></div></form>{message ? <div className="success-notice"><CheckCircle2 size={18} />{message}</div> : null}</section></div>;
}
