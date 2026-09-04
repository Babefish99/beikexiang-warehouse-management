import { useEffect, useRef, useState } from "react";
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
  const mounted = useRef(true);
  const operationEpoch = useRef(0);
  const operationActive = useRef(false);
  const activeApprovalId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operationEpoch.current += 1;
      operationActive.current = false;
      activeApprovalId.current = null;
    };
  }, []);

  const beginOperation = (approvalId: string) => {
    operationEpoch.current += 1;
    operationActive.current = true;
    activeApprovalId.current = approvalId;
    return operationEpoch.current;
  };
  const isCurrentOperation = (epoch: number, approvalId: string) => mounted.current
    && operationEpoch.current === epoch
    && activeApprovalId.current === approvalId;
  const finishOperation = (epoch: number, approvalId: string) => {
    if (!isCurrentOperation(epoch, approvalId)) return;
    operationActive.current = false;
    setLoading(false);
  };

  const start = async (selected: PendingApproval) => {
    if (operationActive.current) return;
    const nextDraft = createDraft(selected);
    const epoch = beginOperation(selected.id);
    setApproval(selected);
    setDraft(nextDraft);
    setOptions(null);
    setErrors({});
    setMessage(null);
    setLoading(true);
    try {
      const nextOptions = await onReloadOptions(selected.id);
      if (!isCurrentOperation(epoch, selected.id)) return;
      setOptions(nextOptions);
    } catch (error) {
      if (!isCurrentOperation(epoch, selected.id)) return;
      setMessage(error instanceof Error ? error.message : "读取出库选项失败");
    } finally {
      finishOperation(epoch, selected.id);
    }
  };

  const confirm = async () => {
    if (!approval || !draft || operationActive.current) return;
    const approvalId = approval.id;
    const epoch = beginOperation(approvalId);
    setLoading(true);
    setMessage(null);
    try {
      const latest = await onReloadOptions(approvalId);
      if (!isCurrentOperation(epoch, approvalId)) return;
      const reconciled = reconcileOutboundOptions(draft, latest);
      const nextErrors = validateDecisionStep(approval, reconciled.draft.decisions, latest);
      for (const lineId of reconciled.staleSelectedItemLineIds) nextErrors[`line:${lineId}`] = "所选标准物品已失效，请重新选择";
      for (const allocationId of reconciled.staleAllocationIds) nextErrors[allocationId] = "库存已变化，请重新选择";
      setOptions(latest);
      setDraft(reconciled.draft);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) return;
      if (!isCurrentOperation(epoch, approvalId)) return;
      const completed = await onConfirm({ approvalId, decisions: normalizeDecisions(reconciled.draft.decisions, approval) });
      if (!isCurrentOperation(epoch, approvalId)) return;
      setResult(completed);
      onCompleted(approvalId);
    } catch (error) {
      if (!isCurrentOperation(epoch, approvalId)) return;
      setMessage(error instanceof Error ? error.message : "出库提交失败，草稿已保留");
    } finally {
      finishOperation(epoch, approvalId);
    }
  };

  const cancel = async (selected: PendingApproval) => {
    if (operationActive.current) return;
    const reason = window.prompt("请输入取消待办原因");
    if (!reason?.trim()) return;
    const epoch = beginOperation(selected.id);
    setLoading(true);
    try {
      await onCancel(selected.id, reason.trim());
      if (!isCurrentOperation(epoch, selected.id)) return;
      onCompleted(selected.id);
    } catch (error) {
      if (!isCurrentOperation(epoch, selected.id)) return;
      setMessage(error instanceof Error ? error.message : "取消待办失败");
    } finally {
      finishOperation(epoch, selected.id);
    }
  };

  const leave = () => {
    if (operationActive.current) return;
    operationEpoch.current += 1;
    activeApprovalId.current = null;
    setApproval(null);
    setDraft(null);
    setOptions(null);
    setErrors({});
    setMessage(null);
  };

  if (result) return <section className="outbound-flow"><h2>出库完成</h2><div className="success-notice" role="status"><CheckCircle2 size={18} />{result.id} · {inventoryStatusLabel(result.status)} · 实际数量 {result.actualQuantity} · 金额 {result.amount}</div></section>;

  return <section className="outbound-flow">
    {!approval ? <div className="outbound-card-list">{pending.map((item) => {
      const requiresReapplication = item.lines.some((line) => line.legacyResolutionStatus === "REAPPLY_REQUIRED");
      return <article className="outbound-card" key={item.id}><strong>{item.weComSpNo}</strong><span>{item.lines.length} 个审批意向 · {inventoryStatusLabel(item.status)}</span>{requiresReapplication ? <span>旧审批信息不完整，需重新申请</span> : <div className="outbound-card__actions"><button className="button button--primary" type="button" disabled={loading} onClick={() => void start(item)}>办理出库</button><button className="button button--danger" type="button" disabled={loading} onClick={() => void cancel(item)}>取消待办</button></div>}</article>;
    })}</div> : null}
    {message ? <div className="form-error" role="alert">{message}</div> : null}
    {approval && draft && options ? <><OutboundDecisionEditor approval={approval} options={options} draft={draft} errors={errors} disabled={loading} onChange={(next) => { if (operationActive.current) return; setDraft(next); setErrors({}); setMessage(null); }} /><div className="outbound-flow__actions"><button className="button button--secondary" type="button" disabled={loading} onClick={leave}>返回待办</button><button className="button button--primary" type="button" disabled={loading} onClick={() => void confirm()}>{loading ? "校验中…" : "确认出库"}</button></div></> : null}
    {approval && loading && !options ? <div className="notice">正在读取最新出库选项…</div> : null}
    {approval && !loading && !options ? <div className="outbound-flow__actions"><button className="button button--secondary" type="button" onClick={leave}>返回待办</button><button className="button button--primary" type="button" onClick={() => void start(approval)}>重试</button></div> : null}
  </section>;
}
