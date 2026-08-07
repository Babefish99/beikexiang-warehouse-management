import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type ItemRow = { id: string; code: string; name: string; specification?: string; unit: string; categoryId: string; weComOptionKey?: string; minimumStock?: string; isActive: boolean };
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function ItemsPage() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/items?includeInactive=true`, { credentials: "include" });
      if (!response.ok) throw new Error("物品列表加载失败");
      setItems(await response.json() as ItemRow[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "物品列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadItems(); }, []);
  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword ? items.filter((item) => [item.code, item.name, item.specification, item.weComOptionKey].some((value) => value?.toLowerCase().includes(keyword))) : items;
  }, [items, search]);

  return <div className="page">
    <PageHeader title="标准物品库" description="管理员维护审批可选物品、单位和企业微信选项映射。" actions={<button className="button button--secondary" type="button" onClick={() => void loadItems()}><RefreshCw size={15} />刷新</button>} />
    <section className="panel master-data-panel">
      <div className="master-data-toolbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索编码、名称或选项 key" /></label><span className="toolbar-count">共 {filteredItems.length} 项</span></div>
      {error ? <div className="notice"><strong>{error}</strong></div> : loading ? <div className="notice">正在加载物品……</div> : <div className="table-wrap"><table><thead><tr><th>编码</th><th>物品名称</th><th>规格</th><th>单位</th><th>企业微信选项 key</th><th>状态</th></tr></thead><tbody>{filteredItems.map((item) => <tr key={item.id}><td>{item.code}</td><td><strong>{item.name}</strong></td><td>{item.specification || "—"}</td><td>{item.unit}</td><td>{item.weComOptionKey || "—"}</td><td><span className={`status-pill ${item.isActive ? "status-pill--active" : ""}`}>{item.isActive ? "启用" : "停用"}</span></td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
