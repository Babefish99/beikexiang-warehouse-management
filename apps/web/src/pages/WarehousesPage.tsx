import { useEffect, useState } from "react";
import { RefreshCw, Warehouse } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type WarehouseRow = { id: string; code: string; name: string; isActive: boolean; isPlaceholder?: boolean };
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function WarehousesPage() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWarehouses = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/warehouses`, { credentials: "include" });
      if (response.ok) setWarehouses(await response.json() as WarehouseRow[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadWarehouses(); }, []);

  return <div className="page">
    <PageHeader title="仓库设置" description="集团当前维护 3 个仓库；仓库停用后保留历史流水。" actions={<button className="button button--secondary" type="button" onClick={() => void loadWarehouses()}><RefreshCw size={15} />刷新</button>} />
    <section className="warehouse-card-grid">{loading ? <div className="panel notice">正在加载仓库……</div> : warehouses.map((warehouse) => <article className="panel warehouse-card" key={warehouse.id}><span className="warehouse-card__icon"><Warehouse size={20} /></span><div><strong>{warehouse.name}</strong><small>{warehouse.code}</small></div><span className={`status-pill ${warehouse.isActive ? "status-pill--active" : ""}`}>{warehouse.isActive ? "启用" : "停用"}</span>{warehouse.isPlaceholder ? <p>待管理员补充正式名称</p> : null}</article>)}</section>
  </div>;
}
