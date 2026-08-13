import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { searchInventory, type InventorySearchResult } from "../features/inventory/inventory-api";
import { useMobileViewport } from "../features/mobile/use-mobile-viewport";

export function InventoryQueryPage({ warehouseId, role: _role }: { warehouseId: string; role: "ADMIN" | "FINANCE" }) {
  const isMobileViewport = useMobileViewport();
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get("query") ?? "");
  const [results, setResults] = useState<InventorySearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmedQuery = query.trim();
    setResults([]);
    setError(null);
    if (!trimmedQuery) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        setResults(await searchInventory({ query: trimmedQuery, warehouseId, signal: controller.signal }));
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "库存查询加载失败");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, warehouseId]);

  return (
    <div className="page inventory-query-page">
      <PageHeader title="库存查询" description="按物品编码、名称、批次或仓库查询库存。" />
      <section className="panel inventory-query-panel">
        <label className="inventory-query-search">
          <Search size={18} aria-hidden="true" />
          <input aria-label="查询库存" type="search" value={query} placeholder="搜索编码、名称、批次或仓库" onChange={(event) => setQuery(event.target.value)} />
        </label>
        {loading ? <p className="inventory-query-state">正在查询库存…</p> : null}
        {!loading && error ? <p className="inventory-query-state inventory-query-state--error">{error}</p> : null}
        {!loading && !error && query.trim() && !results.length ? <p className="inventory-query-state">未找到匹配的库存结果</p> : null}
        {!loading && !error && results.length ? isMobileViewport ? (
          <div className="inventory-query-cards">
            {results.map((result) => (
              <article className="inventory-query-card" key={result.itemId} aria-label={`${result.code} ${result.name}`}>
                <header><div><strong>{result.code}</strong><h2>{result.name}</h2></div><span>合计 {result.totalQuantity} {result.unit}</span></header>
                {result.specification ? <p>{result.specification}</p> : null}
                <div className="inventory-query-locations">
                  {result.locations.map((location) => (
                    <section className="inventory-query-location" key={`${location.warehouseId}-${location.batchId}`}>
                      <strong>{location.warehouseName}</strong>
                      <span>批次 {location.batchNo}</span>
                      <span>数量 {location.quantity} {result.unit}</span>
                      <span>单价 {location.unitCost}</span>
                      <span>金额 {location.amount}</span>
                    </section>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="table-wrap inventory-query-table-wrap">
            <table>
              <thead><tr><th>物品</th><th>仓库</th><th>批次</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
              <tbody>{results.flatMap((result) => result.locations.map((location) => (
                <tr key={`${result.itemId}-${location.warehouseId}-${location.batchId}`}>
                  <td><strong>{result.code}</strong><small>{result.name}</small></td><td>{location.warehouseName}</td><td>{location.batchNo}</td><td>{location.quantity} {result.unit}</td><td>{location.unitCost}</td><td>{location.amount}</td>
                </tr>
              )))}</tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
