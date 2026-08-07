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

export function OpeningStockPage() {
  const [warehouses, setWarehouses] = useState<SelectorWarehouse[]>([]);
  const [items, setItems] = useState<SelectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [row, setRow] = useState({ warehouseId: "", itemId: "", batchNo: "", quantity: "", unitCost: "", remark: "" });
  const [verifiedBy, setVerifiedBy] = useState("");
  const [message, setMessage] = useState<string | null>(null);
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
    const response = await fetch(`${apiBaseUrl}/admin/opening-stock`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ verifiedBy, rows: [row] }) });
    if (!response.ok) {
      setError(await readError(response));
      setMessage(null);
      return;
    }
    setMessage(`期初库存已登记：${(await response.json() as { batchIds: string[] }).batchIds.join("、")}`);
  };

  return (
    <div className="page">
      <PageHeader title="录入期初库存" description="先完成实盘，再录入系统；仓库与物品从标准数据选择。" />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label><span>盘点人 *</span><input required value={verifiedBy} onChange={(event) => setVerifiedBy(event.target.value)} /></label>
          <label>
            <span>仓库 *</span>
            <select required value={row.warehouseId} onChange={(event) => setRow({ ...row, warehouseId: event.target.value })}>
              <option value="">请选择仓库</option>
              {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
            </select>
          </label>
          <label>
            <span>物品 *</span>
            <select required value={row.itemId} onChange={(event) => setRow({ ...row, itemId: event.target.value })}>
              <option value="">请选择标准物品</option>
              {items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
            </select>
          </label>
          <label><span>批次号 *</span><input required value={row.batchNo} onChange={(event) => setRow({ ...row, batchNo: event.target.value })} /></label>
          <label><span>实盘数量 *</span><input required type="number" min="0" step="0.001" value={row.quantity} onChange={(event) => setRow({ ...row, quantity: event.target.value })} /></label>
          <label><span>确认单价 *</span><input required type="number" min="0" step="0.01" value={row.unitCost} onChange={(event) => setRow({ ...row, unitCost: event.target.value })} /></label>
          <label className="form-grid__wide"><span>差异/实盘说明</span><textarea value={row.remark} onChange={(event) => setRow({ ...row, remark: event.target.value })} /></label>
          <div className="form-grid__wide notice">
            <strong>{loading ? "正在加载标准数据……" : "只支持固定仓库集合内的期初录入"}</strong>
            <p>提交失败时保留仓库、物品和已填写字段。</p>
          </div>
          <div className="form-grid__wide form-actions"><button className="button button--primary" type="submit" disabled={loading || !warehouses.length || !items.length}>保存期初库存</button></div>
        </form>
        {message ? <div className="success-notice"><CheckCircle2 size={18} />{message}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
      </section>
    </div>
  );
}
