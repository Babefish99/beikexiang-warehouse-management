import { FormEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type TransferBalance = { warehouseId: string; itemId: string; batchId: string; remainingQuantity: string; unitCost: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

export function TransfersPage() {
  const [balances, setBalances] = useState<TransferBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState({ sourceWarehouseId: "", destinationWarehouseId: "", itemId: "", batchId: "", quantity: "", reason: "" });

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/transfers/options`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { balances: TransferBalance[] };
      setBalances(payload.balances);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取调拨选项失败");
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
    () => balances.filter((balance) => (!form.itemId || balance.itemId === form.itemId) && (!form.sourceWarehouseId || balance.warehouseId === form.sourceWarehouseId)),
    [balances, form.itemId, form.sourceWarehouseId],
  );
  const selectedBalance = batchOptions.find((balance) => balance.batchId === form.batchId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    const response = await fetch(`${apiBaseUrl}/admin/transfers`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const payload = await response.json() as { transferId: string; unitCost: string; status: string };
    setResult(`调拨已完成：${payload.transferId}（状态 ${payload.status}，单价 ${payload.unitCost}）`);
    await loadOptions();
  };

  return (
    <div className="page">
      <PageHeader title="仓库调拨" description="调拨无需审批；管理员一次提交，必须完整填写调出/调入仓库、物品、批次、数量和原因。" actions={<button className="button button--secondary" type="button" onClick={() => void loadOptions()}><RefreshCw size={15} />刷新选项</button>} />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label>
            <span>物品 *</span>
            <select required value={form.itemId} onChange={(event) => setForm({ ...form, itemId: event.target.value, batchId: "" })}>
              <option value="">请选择物品</option>
              {itemIds.map((itemId) => <option key={itemId} value={itemId}>{itemId}</option>)}
            </select>
          </label>
          <label>
            <span>调出仓库 *</span>
            <select required value={form.sourceWarehouseId} onChange={(event) => setForm({ ...form, sourceWarehouseId: event.target.value, batchId: "" })}>
              <option value="">请选择仓库</option>
              {warehouseIds.map((warehouseId) => <option key={warehouseId} value={warehouseId}>{warehouseId}</option>)}
            </select>
          </label>
          <label>
            <span>批次 *</span>
            <select required value={form.batchId} onChange={(event) => setForm({ ...form, batchId: event.target.value })}>
              <option value="">请选择批次</option>
              {batchOptions.map((balance) => <option key={`${balance.warehouseId}:${balance.batchId}`} value={balance.batchId}>{balance.batchId}</option>)}
            </select>
          </label>
          <label>
            <span>调入仓库 *</span>
            <select required value={form.destinationWarehouseId} onChange={(event) => setForm({ ...form, destinationWarehouseId: event.target.value })}>
              <option value="">请选择仓库</option>
              {warehouseIds.filter((warehouseId) => warehouseId !== form.sourceWarehouseId).map((warehouseId) => <option key={warehouseId} value={warehouseId}>{warehouseId}</option>)}
            </select>
          </label>
          <label>
            <span>调拨数量 *</span>
            <input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          </label>
          <label className="form-grid__wide">
            <span>调拨原因 *</span>
            <textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </label>
          <div className="form-grid__wide notice">
            <strong>{loading ? "正在读取可调拨库存……" : selectedBalance ? `可用数量 ${selectedBalance.remainingQuantity}` : "请先选择物品、调出仓库和批次"}</strong>
            <p>{selectedBalance ? `当前批次单价 ${selectedBalance.unitCost}，系统会沿用原批次成本。` : "仅展示仍有结余的库存批次。"}</p>
          </div>
          <div className="form-grid__wide form-actions">
            <button className="button button--primary" type="submit" disabled={loading || !balances.length}>提交调拨</button>
          </div>
        </form>
        {result ? <div className="success-notice"><CheckCircle2 size={18} />{result}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
      </section>
    </div>
  );
}
