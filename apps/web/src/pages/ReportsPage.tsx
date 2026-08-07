import { useEffect, useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function ReportsPage() {
  const [summary, setSummary] = useState<Array<{ itemId: string; quantity: string; amount: string }>>([]);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); const response = await fetch(`${apiBaseUrl}/admin/reports/summary?period=${period}`, { credentials: "include" }); if (response.ok) setSummary(await response.json() as Array<{ itemId: string; quantity: string; amount: string }>); setLoading(false); };
  useEffect(() => { void load(); }, [period]);
  return <div className="page"><PageHeader title="报表中心" description="按已结账期间查询数量和金额；调拨、退库、盘点调整单独列示。" actions={<button className="button button--secondary" type="button" onClick={() => void load()}><RefreshCw size={15} />刷新</button>} /><section className="panel"><div className="master-data-toolbar"><label className="search-field"><span>期间</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label><button className="button button--secondary" type="button" disabled title="工作区 @oai/artifact-tool 尚不可用"><FileSpreadsheet size={15} />导出 Excel（待运行时接入）</button></div>{loading ? <div className="notice">正在查询……</div> : <div className="table-wrap"><table><thead><tr><th>物品</th><th>期末数量</th><th>期末金额</th></tr></thead><tbody>{summary.map((row) => <tr key={row.itemId}><td>{row.itemId}</td><td>{row.quantity}</td><td>{row.amount}</td></tr>)}</tbody></table></div>}</section></div>;
}
