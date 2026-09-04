import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { inventoryStatusLabel } from "../inventory/inventory-status-label";
import { OutboundDecisionEditor } from "./OutboundDecisionEditor";
import {
  normalizeDecisions,
  reconcileOutboundOptions,
  validateDecisionStep,
  type DecisionDraft,
  type NormalizedDecision,
  type OutboundDraft,
  type OutboundOptions,
  type PendingApproval,
} from "./outbound-workflow";
import type { OutboundResult } from "./DesktopOutboundTable";

function initialDecision(line: PendingApproval["lines"][number]): DecisionDraft {
  return {
    approvalLineId: line.id,
    selectedItemId: line.legacyResolutionStatus === "EXACT_LOCKED" ? line.itemId ?? "" : "",
    zeroIssue: false,
    varianceReason: "",
    allocations: [{ id: crypto.randomUUID(), warehouseId: "", batchId: "", quantity: "" }],
  };
}

function createDraft(approval: PendingApproval): OutboundDraft {
  return { approvalId: approval.id, step: "allocate", decisions: approval.lines.map(initialDecision) };
}

export function MobileOutboundFlow({ pending, onReloadOptions, onConfirm, onCancel, onCompleted }: {
  userId: string;
  pending: PendingApproval[];
  pendingState: "loading" | "loaded" | "error";
  onReloadOptions(approvalId: string): Promise<OutboundOptions>;
  onConfirm(input: { approvalId: string; decisions: NormalizedDecision[] }): Promise<OutboundResult>;
  onCancel(approvalId: string, reason: string): Promise<{ approvalId: string; status: string }>;
  onCompleted(approvalId: string): void;
}) {
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [draft, setDraft] = useState<OutboundDraft | null>(null);
  const [options, setOptions] = useState<OutboundOptions | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OutboundResult | null>(null);

  const start = async (selected: PendingApproval) => {
    const nextDraft = createDraft(selected);
    setApproval(selected);
    setDraft(nextDraft);
    setOptions(null);
    setErrors({});
    setMessage(null);
    setLoading(true);
    try {
      setOptions(await onReloadOptions(selected.id));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取出库选项失败");
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!approval || !draft || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const latest = await onReloadOptions(approval.id);
      const reconciled = reconcileOutboundOptions(draft, latest);
      const nextErrors = validateDecisionStep(approval, reconciled.draft.decisions, latest);
      for (const lineId of reconciled.staleSelectedItemLineIds) nextErrors[`line:${lineId}`] = "所选标准物品已失效，请重新选择";
      for (const allocationId of reconciled.staleAllocationIds) nextErrors[allocationId] = "库存已变化，请重新选择";
      setOptions(latest);
      setDraft(reconciled.draft);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) return;
      const completed = await onConfirm({ approvalId: approval.id, decisions: normalizeDecisions(reconciled.draft.decisions) });
      setResult(completed);
      onCompleted(approval.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "出库提交失败，草稿已保留");
    } finally {
      setLoading(false);
    }
  };

  const cancel = async (selected: PendingApproval) => {
    const reason = window.prompt("请输入取消待办原因");
    if (!reason?.trim()) return;
    setLoading(true);
    try {
      await onCancel(selected.id, reason.trim());
      onCompleted(selected.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消待办失败");
    } finally {
      setLoading(false);
    }
  };

  if (result) return <section className="outbound-flow"><h2>出库完成</h2><div className="success-notice" role="status"><CheckCircle2 size={18} />{result.id} · {inventoryStatusLabel(result.status)} · 实际数量 {result.actualQuantity} · 金额 {result.amount}</div></section>;

  return <section className="outbound-flow">
    {!approval ? <div className="outbound-card-list">{pending.map((item) => {
      const requiresReapplication = item.lines.some((line) => line.legacyResolutionStatus === "REAPPLY_REQUIRED");
      return <article className="outbound-card" key={item.id}><strong>{item.weComSpNo}</strong><span>{item.lines.length} 个审批意向 · {inventoryStatusLabel(item.status)}</span>{requiresReapplication ? <span>旧审批信息不完整，需重新申请</span> : <div className="outbound-card__actions"><button className="button button--primary" type="button" onClick={() => void start(item)}>办理出库</button><button className="button button--danger" type="button" onClick={() => void cancel(item)}>取消待办</button></div>}</article>;
    })}</div> : null}
    {message ? <div className="form-error" role="alert">{message}</div> : null}
    {approval && draft && options ? <><OutboundDecisionEditor approval={approval} options={options} draft={draft} errors={errors} onChange={(next) => { setDraft(next); setErrors({}); setMessage(null); }} /><div className="outbound-flow__actions"><button className="button button--secondary" type="button" onClick={() => { setApproval(null); setDraft(null); setOptions(null); setErrors({}); }}>返回待办</button><button className="button button--primary" type="button" disabled={loading} onClick={() => void confirm()}>{loading ? "校验中…" : "确认出库"}</button></div></> : null}
    {approval && loading && !options ? <div className="notice">正在读取最新出库选项…</div> : null}
  </section>;
}
