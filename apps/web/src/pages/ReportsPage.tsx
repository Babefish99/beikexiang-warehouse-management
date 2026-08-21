import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type SummaryRow = { itemId: string; quantity: string; amount: string };
type ItemLookup = { id: string; name: string };
type WarehouseLookup = { id: string; name: string };
type TransactionRow = {
  id: string;
  occurredAt: string;
  warehouseId: string;
  itemId: string;
  type: string;
  quantity: string;
  unitCost: string;
  amount: string;
  referenceType: string;
};
type TransactionFilter = "all" | "inbound" | "outbound" | "transfers" | "returns" | "adjustments";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const transactionFilters: Array<{ value: TransactionFilter; label: string }> = [
  { value: "all", label: "全部流水" },
  { value: "inbound", label: "入库" },
  { value: "outbound", label: "出库" },
  { value: "transfers", label: "调拨" },
  { value: "returns", label: "退库" },
  { value: "adjustments", label: "盘点调整" },
];
const transactionTypeLabels: Record<string, string> = {
  INBOUND: "入库",
  OPENING_BALANCE: "期初库存",
  OUTBOUND: "出库",
  TRANSFER_IN: "调拨入库",
  TRANSFER_OUT: "调拨出库",
  RETURN: "退库",
  ADJUSTMENT: "库存调整",
  STOCKTAKE_ADJUSTMENT: "盘点调整",
};
const referenceTypeLabels: Record<string, string> = {
  OPENING_STOCK: "期初库存",
  INBOUND_ORDER: "入库单",
  OUTBOUND_ORDER: "出库单",
  TRANSFER_ORDER: "调拨单",
  OUTBOUND_ALLOCATION: "原出库分配",
  STOCK_ADJUSTMENT: "库存调整",
  STOCKTAKE_ADJUSTMENT: "盘点调整",
};

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "报表请求失败";
}

function readFilename(response: Response, period: string, type: TransactionFilter): string {
  const disposition = response.headers.get("content-disposition");
  const matched = disposition?.match(/filename="([^"]+)"/);
  return matched?.[1] ?? `inventory-report-${period}-${type}.csv`;
}

export function ReportsPage({ warehouseId }: { warehouseId: string }) {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [items, setItems] = useState<ItemLookup[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLookup[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [type, setType] = useState<TransactionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [queryAvailable, setQueryAvailable] = useState(false);
  const encodedWarehouseId = encodeURIComponent(warehouseId);
  const itemNameById = useMemo(() => new Map(items.map((item) => [item.id, item.name])), [items]);
  const warehouseNameById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse.name])), [warehouses]);

  const loadLookups = async () => {
    const [itemResponse, warehouseResponse] = await Promise.all([
      fetch(`${apiBaseUrl}/admin/reports/items`, { credentials: "include" }),
      fetch(`${apiBaseUrl}/admin/reports/warehouses`, { credentials: "include" }),
    ]);
    if (itemResponse.ok) setItems(await itemResponse.json() as ItemLookup[]);
    if (warehouseResponse.ok) setWarehouses(await warehouseResponse.json() as WarehouseLookup[]);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setExportError(null);
    try {
      const [summaryResponse, transactionResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/admin/reports/summary?period=${period}&warehouseId=${encodedWarehouseId}`, { credentials: "include" }),
        fetch(`${apiBaseUrl}/admin/reports/transactions?period=${period}&type=${type}&warehouseId=${encodedWarehouseId}`, { credentials: "include" }),
      ]);
      if (!summaryResponse.ok) throw new Error(await readError(summaryResponse));
      if (!transactionResponse.ok) throw new Error(await readError(transactionResponse));
      setSummary(await summaryResponse.json() as SummaryRow[]);
      setTransactions(await transactionResponse.json() as TransactionRow[]);
      setQueryAvailable(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "报表加载失败");
      setQueryAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [period, type, warehouseId]);

  useEffect(() => {
    void loadLookups();
  }, []);

  const exportReport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/reports/export?period=${period}&type=${type}&warehouseId=${encodedWarehouseId}`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = readFilename(response, period, type);
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setExportError(exportError instanceof Error ? exportError.message : "报表导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page reports-page">
      <PageHeader
        title="报表中心"
        description="按期间和交易类型查询数量与金额；调拨、退库、盘点调整单独列示。"
      />
      <section className="panel report-filter-panel">
        <header className="panel__header report-panel__header">
          <div>
            <h2>查询条件</h2>
            <small>选择期间和流水类型，查看对应库存数据</small>
          </div>
          <div className="report-actions">
            <button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} />刷新查询</button>
            <button className="button button--primary" type="button" disabled={exporting || !queryAvailable} onClick={() => void exportReport()}>
              <FileSpreadsheet size={15} />
              {exporting ? "导出中…" : "导出 Excel 兼容报表"}
            </button>
          </div>
        </header>
        <div className="master-data-toolbar report-toolbar">
          <label className="search-field">
            <span>统计期间</span>
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </label>
          <label className="search-field">
            <span>交易类型</span>
            <select value={type} onChange={(event) => setType(event.target.value as TransactionFilter)}>
              {transactionFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>

        {error ? <div className="form-error report-feedback">{error}</div> : null}
        {exportError ? <div className="form-error report-feedback">{exportError}</div> : null}
      </section>

      {loading ? <section className="panel report-loading-panel"><div className="notice">正在查询……</div></section> : (
        <>
          <section className="panel report-section">
            <header className="panel__header report-panel__header">
              <div>
                <h2>库存汇总</h2>
                <small>截至所选期间末的库存数量与金额</small>
              </div>
              <span className="report-section__meta">{summary.length} 项物品</span>
            </header>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>物品</th>
                    <th>期末数量</th>
                    <th>期末金额</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.length ? summary.map((row) => (
                    <tr key={row.itemId}>
                      <td>{itemNameById.get(row.itemId) ?? row.itemId}</td>
                      <td>{row.quantity}</td>
                      <td>{row.amount}</td>
                    </tr>
                  )) : <tr><td colSpan={3}>当前期间没有汇总数据。</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel report-section">
            <header className="panel__header report-panel__header">
              <div>
                <h2>出入库流水</h2>
                <small>入库、出库、调拨、退库和盘点调整明细</small>
              </div>
              <span className="report-section__meta">{transactions.length} 条流水</span>
            </header>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>仓库</th>
                    <th>物品</th>
                    <th>类型</th>
                    <th>数量</th>
                    <th>单价</th>
                    <th>金额</th>
                    <th>引用类型</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.length ? transactions.map((row) => (
                    <tr key={row.id}>
                      <td>{row.occurredAt.slice(0, 10)}</td>
                      <td>{warehouseNameById.get(row.warehouseId) ?? row.warehouseId}</td>
                      <td>{itemNameById.get(row.itemId) ?? row.itemId}</td>
                      <td>{transactionTypeLabels[row.type] ?? row.type}</td>
                      <td>{row.quantity}</td>
                      <td>{row.unitCost}</td>
                      <td>{row.amount}</td>
                      <td>{referenceTypeLabels[row.referenceType] ?? row.referenceType}</td>
                    </tr>
                  )) : <tr><td colSpan={8}>当前筛选没有交易明细。</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
