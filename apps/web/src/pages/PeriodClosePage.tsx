import { useState } from "react";
import { PageHeader } from "../components/PageHeader";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export function PeriodClosePage() {
  const [message, setMessage] = useState<string | null>(null);
  const close = async () => {
    const response = await fetch(`${apiBaseUrl}/admin/period-close`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ period: { code: new Date().toISOString().slice(0, 7), status: "OPEN" }, pendingOutboundCount: 0, unpostedAdjustmentCount: 0 }) });
    setMessage(response.ok ? "本月已结账，后续库存变动需进入新期间。" : "结账失败，请先处理待出库和未过账调整。");
  };
  return <div className="page"><PageHeader title="月度结账" description="结账前检查待出库和未过账调整；结账后禁止修改当期库存流水。" /><section className="panel"><div className="notice"><strong>结账确认</strong><p>系统将锁定当前会计期间。历史期间只能通过新的更正记录调整，不能删除或直接替换。</p><button className="button button--primary" type="button" onClick={() => void close()}>确认结账</button>{message ? <p>{message}</p> : null}</div></section></div>;
}
