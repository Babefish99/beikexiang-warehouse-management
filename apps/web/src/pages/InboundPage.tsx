import { FormEvent, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function InboundPage() {
  const [form, setForm] = useState({ warehouseId: "", itemId: "", batchNo: "", quantity: "", unitCost: "", purchasedAt: new Date().toISOString().slice(0, 10), purchaser: "", remark: "" });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const response = await fetch(`${apiBaseUrl}/admin/inbound`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    if (!response.ok) { setError("入库登记失败，请检查字段和权限。"); setResult(null); return; }
    const data = await response.json() as { inboundId: string; batchIds: string[] };
    setError(null); setResult(`入库已登记：${data.inboundId}，批次 ${data.batchIds.join("、")}`);
  };

  return <div className="page"><PageHeader title="登记入库" description="管理员按实际采购和收货情况登记批次，采购金额作为出库金额依据。" /><section className="panel form-panel"><form className="form-grid" onSubmit={submit}><label><span>仓库 *</span><input required value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })} placeholder="选择仓库编码" /></label><label><span>物品 *</span><input required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })} placeholder="选择标准物品" /></label><label><span>批次号 *</span><input required value={form.batchNo} onChange={(event) => setForm({ ...form, batchNo: event.target.value })} /></label><label><span>入库数量 *</span><input required type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label><label><span>采购单价 *</span><input required type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></label><label><span>采购日期 *</span><input required type="date" value={form.purchasedAt} onChange={(event) => setForm({ ...form, purchasedAt: event.target.value })} /></label><label><span>采购人</span><input value={form.purchaser} onChange={(event) => setForm({ ...form, purchaser: event.target.value })} /></label><label className="form-grid__wide"><span>备注（单价为 0 时必填）</span><textarea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label><div className="form-grid__wide form-actions"><button className="button button--primary" type="submit">保存入库</button></div></form>{result ? <div className="success-notice"><CheckCircle2 size={18} />{result}</div> : null}{error ? <div className="form-error">{error}</div> : null}</section></div>;
}
