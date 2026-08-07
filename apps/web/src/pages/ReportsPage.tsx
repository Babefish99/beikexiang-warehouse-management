import { useEffect, useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type SummaryRow = { itemId: string; quantity: string; amount: string };
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

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "报表请求失败";
}

function readFilename(response: Response, period: string, type: TransactionFilter): string {
  const disposition = response.headers.get("content-disposition");
  const matched = disposition?.match(/filename="([^"]+)"/);
  return matched?.[1] ?? `inventory-report-${period}-${type}.csv`;
}

export function ReportsPage() {
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [type, setType] = useState<TransactionFilter>("all");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queryAvailable, setQueryAvailable] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, transactionResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/admin/reports/summary?period=${period}`, { credentials: "include" }),
        fetch(`${apiBaseUrl}/admin/reports/transactions?period=${period}&type=${type}`, { credentials: "include" }),
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
  }, [period, type]);

  const exportReport = async () => {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/reports/export?period=${period}&type=${type}`, { credentials: "include" });
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
      setQueryAvailable(true);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "报表导出失败");
      setQueryAvailable(false);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="报表中心"
        description="按期间和交易类型查询数量与金额；调拨、退库、盘点调整单独列示。"
        actions={<button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} />刷新</button>}
      />
      <section className="panel">
        <div className="master-data-toolbar">
          <label className="search-field">
            <span>期间</span>
            <input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </label>
          <label className="search-field">
            <span>交易类型</span>
            <select value={type} onChange={(event) => setType(event.target.value as TransactionFilter)}>
              {transactionFilters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="button button--secondary" type="button" disabled={exporting || !queryAvailable} onClick={() => void exportReport()}>
            <FileSpreadsheet size={15} />
            {exporting ? "导出中…" : "导出 Excel 兼容报表"}
          </button>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        {loading ? <div className="notice">正在查询……</div> : (
          <>
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
                      <td>{row.itemId}</td>
                      <td>{row.quantity}</td>
                      <td>{row.amount}</td>
                    </tr>
                  )) : <tr><td colSpan={3}>当前期间没有汇总数据。</td></tr>}
                </tbody>
              </table>
            </div>

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
                      <td>{row.warehouseId}</td>
                      <td>{row.itemId}</td>
                      <td>{row.type}</td>
                      <td>{row.quantity}</td>
                      <td>{row.unitCost}</td>
                      <td>{row.amount}</td>
                      <td>{row.referenceType}</td>
                    </tr>
                  )) : <tr><td colSpan={8}>当前筛选没有交易明细。</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
