import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type PendingApproval = { id: string; weComSpNo: string; status: string; lines: Array<{ id: string; itemId: string; requestedQuantity: string }> };
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function OutboundPage() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPending = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/outbound/pending`, { credentials: "include" });
      if (response.ok) setPending(await response.json() as PendingApproval[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPending(); }, []);
  return <div className="page"><PageHeader title="办理出库" description="按审批单选择实际仓库和入库批次；可少出但不能超过审批数量。" actions={<button className="button button--secondary" type="button" onClick={() => void loadPending()}><RefreshCw size={15} />刷新</button>} /><section className="panel"><div className="notice"><ShieldCheck size={24} color="var(--orange)" /><strong>{loading ? "正在读取待出库审批……" : pending.length ? `待处理 ${pending.length} 张审批单` : "当前没有待出库审批"}</strong><p>管理员确认实际数量后系统即时检查并扣减库存，少出或零出必须填写原因；本次结案后不能补出。</p></div>{pending.length ? <div className="table-wrap"><table><thead><tr><th>审批编号</th><th>申请行数</th><th>状态</th></tr></thead><tbody>{pending.map((approval) => <tr key={approval.id}><td>{approval.weComSpNo}</td><td>{approval.lines.length} 行</td><td>{approval.status}</td></tr>)}</tbody></table></div> : null}</section></div>;
}
