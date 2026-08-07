import { type FormEvent, useEffect, useState } from "react";
import { RefreshCw, Warehouse } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  isPlaceholder?: boolean;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingWarehouseId, setEditingWarehouseId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", disabled: false });

  const loadWarehouses = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/warehouses?includeInactive=true`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      setWarehouses(await response.json() as WarehouseRow[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "仓库列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWarehouses();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingWarehouseId) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/warehouses/${editingWarehouseId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name, isActive: !form.disabled }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const updated = await response.json() as WarehouseRow;
      setWarehouses((current) => current.map((warehouse) => warehouse.id === updated.id ? updated : warehouse));
      setMessage("仓库已更新");
      setEditingWarehouseId(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "仓库更新失败");
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="仓库设置"
        description="当前只维护固定 3 个仓库；支持补全名称与启停，不扩展不存在的业务。"
        actions={<button className="button button--secondary" type="button" onClick={() => void loadWarehouses()}><RefreshCw size={15} />刷新</button>}
      />
      {editingWarehouseId ? (
        <section className="panel form-panel master-data-form-panel">
          <header className="panel__header">
            <div>
              <strong>编辑仓库</strong>
              <small>固定仓库集合内做轻量维护。</small>
            </div>
          </header>
          <form className="form-grid" onSubmit={submit}>
            <label><span>仓库名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label className="checkbox-field"><input type="checkbox" checked={form.disabled} onChange={(event) => setForm({ ...form, disabled: event.target.checked })} /><span>停用</span></label>
            <div className="form-grid__wide form-actions form-actions--split">
              <button className="button button--secondary" type="button" onClick={() => setEditingWarehouseId(null)}>取消</button>
              <button className="button button--primary" type="submit">保存仓库</button>
            </div>
          </form>
        </section>
      ) : null}
      {message ? <div className="success-notice">{message}</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      <section className="warehouse-card-grid">
        {loading ? <div className="panel notice">正在加载仓库……</div> : warehouses.map((warehouse) => (
          <article className="panel warehouse-card" key={warehouse.id}>
            <span className="warehouse-card__icon"><Warehouse size={20} /></span>
            <div>
              <strong>{warehouse.name}</strong>
              <small>{warehouse.code}</small>
            </div>
            <span className={`status-pill ${warehouse.isActive ? "status-pill--active" : ""}`}>{warehouse.isActive ? "启用" : "停用"}</span>
            {warehouse.isPlaceholder ? <p>待管理员补充正式名称</p> : <p>仅维护名称与启停状态，历史流水保留。</p>}
            <div className="warehouse-card__actions">
              <button
                className="button button--secondary button--small"
                type="button"
                onClick={() => {
                  setEditingWarehouseId(warehouse.id);
                  setForm({ name: warehouse.name, disabled: !warehouse.isActive });
                  setError(null);
                  setMessage(null);
                }}
              >
                编辑 {warehouse.code}
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
