import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type StocktakeBalance = { warehouseId: string; itemId: string; batchId: string; bookQuantity: string; unitCost: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

export function StocktakePage() {
  const [balances, setBalances] = useState<StocktakeBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState({ periodCode: new Date().toISOString().slice(0, 7), warehouseId: "", itemId: "", batchId: "", bookQuantity: "", actualQuantity: "", reason: "" });

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/stocktake/options`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { balances: StocktakeBalance[] };
      setBalances(payload.balances);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取盘点选项失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOptions();
  }, []);

  const warehouseIds = useMemo(() => [...new Set(balances.map((balance) => balance.warehouseId))], [balances]);
  const itemIds = useMemo(() => [...new Set(balances.map((balance) => balance.itemId))], [balances]);
  const batchOptions = useMemo(
    () => balances.filter((balance) => (!form.warehouseId || balance.warehouseId === form.warehouseId) && (!form.itemId || balance.itemId === form.itemId)),
    [balances, form.itemId, form.warehouseId],
  );
  const selectedBalance = batchOptions.find((balance) => balance.batchId === form.batchId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    const response = await fetch(`${apiBaseUrl}/admin/stocktake`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        period: { code: form.periodCode, status: "OPEN" },
        warehouseId: form.warehouseId,
        itemId: form.itemId,
        batchId: form.batchId,
        bookQuantity: form.bookQuantity,
        actualQuantity: form.actualQuantity,
        reason: form.reason,
      }),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const payload = await response.json() as { stocktakeId: string; difference: string };
    setResult(`盘点调整已记录：${payload.stocktakeId}（差异 ${payload.difference}）`);
    await loadOptions();
  };

  return (
    <div className="page">
      <PageHeader title="月度盘点" description="盘盈盘亏必须填写差异原因；系统保留调整审计并更新期末库存。" actions={<button className="button button--secondary" type="button" onClick={() => void loadOptions()}><RefreshCw size={15} />刷新选项</button>} />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>期间 *</span>
            <input required type="month" value={form.periodCode} onChange={(event) => setForm({ ...form, periodCode: event.target.value })} />
          </label>
          <label>
            <span>仓库 *</span>
            <select required value={form.warehouseId} onChange={(event) => setForm({ ...form, warehouseId: event.target.value, batchId: "", bookQuantity: "" })}>
              <option value="">请选择仓库</option>
              {warehouseIds.map((warehouseId) => <option key={warehouseId} value={warehouseId}>{warehouseId}</option>)}
            </select>
          </label>
          <label>
            <span>物品 *</span>
            <select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value, batchId: "", bookQuantity: "" })}>
              <option value="">请选择物品</option>
              {itemIds.map((itemId) => <option key={itemId} value={itemId}>{itemId}</option>)}
            </select>
          </label>
          <label>
            <span>批次 *</span>
            <select
              required
              value={form.batchId}
              onChange={(event) => {
                const balance = batchOptions.find((candidate) => candidate.batchId === event.target.value);
                setForm({ ...form, batchId: event.target.value, bookQuantity: balance?.bookQuantity ?? "" });
              }}
            >
              <option value="">请选择批次</option>
              {batchOptions.map((balance) => <option key={`${balance.warehouseId}:${balance.batchId}`} value={balance.batchId}>{balance.batchId}</option>)}
            </select>
          </label>
          <label>
            <span>账面数量 *</span>
            <input required readOnly value={form.bookQuantity} />
          </label>
          <label>
            <span>实盘数量 *</span>
            <input required type="number" min="0" step="0.001" value={form.actualQuantity} onChange={(event) => setForm({ ...form, actualQuantity: event.target.value })} />
          </label>
          <label className="form-grid__wide">
            <span>差异原因 *</span>
            <textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </label>
          <div className="form-grid__wide notice">
            <strong>{loading ? "正在读取账面库存……" : selectedBalance ? `当前账面数量 ${selectedBalance.bookQuantity}` : "请选择仓库、物品和批次"}</strong>
            <p>{selectedBalance ? `系统将按批次单价 ${selectedBalance.unitCost} 记录盘点差异。` : "盘点提交后会留下前后数量审计记录。"}</p>
          </div>
          <div className="form-grid__wide form-actions">
            <button className="button button--primary" type="submit" disabled={loading || !balances.length}>提交盘点</button>
          </div>
        </form>
        {result ? <div className="success-notice"><CheckCircle2 size={18} />{result}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
      </section>
    </div>
  );
}
