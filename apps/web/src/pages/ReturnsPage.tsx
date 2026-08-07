import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type ReturnAllocation = { id: string; outboundOrderId: string; warehouseId: string; itemId: string; batchId: string; issuedQuantity: string; remainingReturnableQuantity: string; unitCost: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

export function ReturnsPage() {
  const [allocations, setAllocations] = useState<ReturnAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [form, setForm] = useState({ outboundAllocationId: "", quantity: "", reason: "" });

  const loadOptions = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/returns/options`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { allocations: ReturnAllocation[] };
      setAllocations(payload.allocations);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取退库选项失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOptions();
  }, []);

  const selectedAllocation = allocations.find((allocation) => allocation.id === form.outboundAllocationId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    const response = await fetch(`${apiBaseUrl}/admin/returns`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const payload = await response.json() as { returnId: string; unitCost: string; status: string };
    setResult(`退库已完成：${payload.returnId}（状态 ${payload.status}，单价 ${payload.unitCost}）`);
    await loadOptions();
  };

  return (
    <div className="page">
      <PageHeader title="办理退库" description="退库无需审批，但必须关联原出库分配记录，且不能超过可退数量。" actions={<button className="button button--secondary" type="button" onClick={() => void loadOptions()}><RefreshCw size={15} />刷新选项</button>} />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={submit}>
          <label className="form-grid__wide">
            <span>原出库分配 *</span>
            <select required value={form.outboundAllocationId} onChange={(event) => setForm({ ...form, outboundAllocationId: event.target.value })}>
              <option value="">请选择原出库分配</option>
              {allocations.map((allocation) => <option key={allocation.id} value={allocation.id}>{`${allocation.outboundOrderId} / ${allocation.itemId} / ${allocation.batchId}`}</option>)}
            </select>
          </label>
          <label>
            <span>退回数量 *</span>
            <input required type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })} />
          </label>
          <label className="form-grid__wide">
            <span>退库原因 *</span>
            <textarea required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </label>
          <div className="form-grid__wide notice">
            <strong>{loading ? "正在读取可退分配……" : selectedAllocation ? `最多可退 ${selectedAllocation.remainingReturnableQuantity}` : "请选择原出库分配"}</strong>
            <p>{selectedAllocation ? `原仓库 ${selectedAllocation.warehouseId}，原出库数量 ${selectedAllocation.issuedQuantity}，系统会按原批次单价 ${selectedAllocation.unitCost} 冲回库存。` : "仅展示仍可退回的原出库分配。"}</p>
          </div>
          <div className="form-grid__wide form-actions">
            <button className="button button--primary" type="submit" disabled={loading || !allocations.length}>提交退库</button>
          </div>
        </form>
        {result ? <div className="success-notice"><CheckCircle2 size={18} />{result}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
      </section>
    </div>
  );
}
