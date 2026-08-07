import { type FormEvent, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type SelectorWarehouse = { id: string; code: string; name: string };
type SelectorItem = { id: string; code: string; name: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

export function InboundPage() {
  const [warehouses, setWarehouses] = useState<SelectorWarehouse[]>([]);
  const [items, setItems] = useState<SelectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ warehouseId: "", itemId: "", batchNo: "", quantity: "", unitCost: "", purchasedAt: new Date().toISOString().slice(0, 10), purchaser: "", remark: "" });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOptions = async () => {
      setLoading(true);
      setError(null);
      try {
        const [warehouseResponse, itemResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/admin/warehouses`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/items`, { credentials: "include" }),
        ]);
        if (!warehouseResponse.ok) throw new Error(await readError(warehouseResponse));
        if (!itemResponse.ok) throw new Error(await readError(itemResponse));
        setWarehouses(await warehouseResponse.json() as SelectorWarehouse[]);
        setItems(await itemResponse.json() as SelectorItem[]);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "标准数据加载失败");
      } finally {
        setLoading(false);
      }
    };

    void loadOptions();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const response = await fetch(`${apiBaseUrl}/admin/inbound`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    if (!response.ok) {
      setError(await readError(response));
      setResult(null);
      return;
    }
    const data = await response.json() as { inboundId: string; batchIds: string[] };
    setResult(`入库已登记：${data.inboundId}，批次 ${data.batchIds.join("、")}`);
  };

  return (
    <div className="page">
      <PageHeader title="登记入库" description="管理员按实际采购和收货情况登记批次，仓库与物品从标准数据选择。" />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>仓库 *</span>
            <select required value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value })}>
              <option value="">请选择仓库</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
            </select>
          </label>
          <label>
            <span>物品 *</span>
            <select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value })}>
              <option value="">请选择标准物品</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
          </label>
          <label><span>批次号 *</span><input required value={form.batchNo} onChange={(event) => setForm({ ...form, batchNo: event.target.value })} /></label>
          <label><span>入库数量 *</span><input required type="number" min="0" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} /></label>
          <label><span>采购单价 *</span><input required type="number" min="0" step="0.01" value={form.unitCost} onChange={(event) => setForm({ ...form, unitCost: event.target.value })} /></label>
          <label><span>采购日期 *</span><input required type="date" value={form.purchasedAt} onChange={(event) => setForm({ ...form, purchasedAt: event.target.value })} /></label>
          <label><span>采购人</span><input value={form.purchaser} onChange={(event) => setForm({ ...form, purchaser: event.target.value })} /></label>
          <label className="form-grid__wide"><span>备注（单价为 0 时必填）</span><textarea value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label>
          <div className="form-grid__wide notice">
            <strong>{loading ? "正在加载标准数据……" : "请从标准仓库和标准物品中选择"}</strong>
            <p>失败时会保留已填写内容，便于修正后重试。</p>
          </div>
          <div className="form-grid__wide form-actions"><button className="button button--primary" type="submit" disabled={loading || !warehouses.length || !items.length}>保存入库</button></div>
        </form>
        {result ? <div className="success-notice"><CheckCircle2 size={18} />{result}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
      </section>
    </div>
  );
}
