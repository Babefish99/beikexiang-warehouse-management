import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { ModalDialog } from "../../components/ModalDialog";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "../drafts/session-draft";
import { inventoryStatusLabel } from "../inventory/inventory-status-label";
import { OutboundDecisionEditor } from "./OutboundDecisionEditor";
import {
  addOutboundDraftIndexEntry,
  isOutboundDraft,
  normalizeDecisions,
  outboundDraftIndexKey,
  outboundDraftKey,
  pruneOutboundDraftIndex,
  readIndexedOutboundDrafts,
  reconcileOutboundOptions,
  removeOutboundDraftIndexEntry,
  summarizeOutbound,
  validateDecisionStep,
  type DecisionDraft,
  type IndexedOutboundDraft,
  type NormalizedDecision,
  type OutboundDraft,
  type OutboundOptions,
  type PendingApproval,
} from "./outbound-workflow";
import type { OutboundResult } from "./DesktopOutboundTable";

const draftVersion = 2;

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

export function MobileOutboundFlow({ userId, pending, pendingState, onReloadOptions, onConfirm, onCancel, onCompleted }: {
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
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<OutboundResult | null>(null);
  const [staleDrafts, setStaleDrafts] = useState<IndexedOutboundDraft[]>([]);
  const mounted = useRef(true);
  const operationEpoch = useRef(0);
  const operationActive = useRef(false);
  const activeApprovalId = useRef<string | null>(null);
  const submitLock = useRef(false);
  const completedApprovalIds = useRef(new Set<string>());
  const suppressedRestoreId = useRef<string | null>(null);

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
  const invalidateOperation = () => {
    operationEpoch.current += 1;
    operationActive.current = false;
    activeApprovalId.current = null;
    setLoading(false);
  };

  const persistDraft = (next: OutboundDraft, selected?: PendingApproval) => {
    writeSessionDraft(window.sessionStorage, outboundDraftKey(userId, next.approvalId), { version: draftVersion, userId, value: next });
    const currentApproval = selected ?? pending.find((candidate) => candidate.id === next.approvalId) ?? approval;
    addOutboundDraftIndexEntry(window.sessionStorage, userId, {
      approvalId: next.approvalId,
      weComSpNo: currentApproval?.weComSpNo ?? next.approvalId,
    });
    setDraft(next);
  };

  const clearPersistedDraft = (approvalId: string) => {
    clearSessionDraft(window.sessionStorage, outboundDraftKey(userId, approvalId));
    removeOutboundDraftIndexEntry(window.sessionStorage, userId, approvalId);
    const indexed = readIndexedOutboundDrafts(window.sessionStorage, userId);
    pruneOutboundDraftIndex(window.sessionStorage, userId, indexed);
    if (!indexed.length) clearSessionDraft(window.sessionStorage, outboundDraftIndexKey(userId));
    setStaleDrafts((current) => current.filter(({ entry }) => entry.approvalId !== approvalId));
  };

  const staleErrors = (reconciled: ReturnType<typeof reconcileOutboundOptions>) => {
    const nextErrors: Record<string, string> = {};
    for (const lineId of reconciled.staleSelectedItemLineIds) nextErrors[`line:${lineId}`] = "所选标准物品已失效，请重新选择";
    for (const allocationId of reconciled.staleAllocationIds) nextErrors[allocationId] = "库存已变化，请重新选择";
    return nextErrors;
  };

  const openDraft = async (selected: PendingApproval, next: OutboundDraft) => {
    if (operationActive.current || completedApprovalIds.current.has(selected.id)) return;
    suppressedRestoreId.current = null;
    setApproval(selected);
    persistDraft(next, selected);
    setOptions(null);
    setErrors({});
    setMessage(null);
    setLoading(true);
    const epoch = beginOperation(selected.id);
    try {
      const latest = await onReloadOptions(selected.id);
      if (!isCurrentOperation(epoch, selected.id)) return;
      const reconciled = reconcileOutboundOptions(next, latest);
      const nextErrors = staleErrors(reconciled);
      const hasStaleSelection = Object.keys(nextErrors).length > 0;
      const nextDraft = {
        ...reconciled.draft,
        step: next.step === "select" || (next.step === "review" && hasStaleSelection) ? "allocate" as const : next.step,
      };
      setOptions(latest);
      setErrors(nextErrors);
      persistDraft(nextDraft, selected);
      if (hasStaleSelection) setMessage("库存选项已变化，请重新选择标记项");
    } catch (error) {
      if (!isCurrentOperation(epoch, selected.id)) return;
      setMessage(error instanceof Error ? error.message : "读取出库选项失败");
    } finally {
      finishOperation(epoch, selected.id);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const indexed = readIndexedOutboundDrafts(window.sessionStorage, userId);
    pruneOutboundDraftIndex(window.sessionStorage, userId, indexed);
    setStaleDrafts(indexed);
    return () => {
      mounted.current = false;
      operationEpoch.current += 1;
      operationActive.current = false;
      activeApprovalId.current = null;
      submitLock.current = false;
    };
  }, [userId]);

  useEffect(() => {
    if (pendingState !== "loaded" || result) return;
    if (draft && approval && !pending.some((candidate) => candidate.id === draft.approvalId)) {
      if (submitLock.current) return;
      invalidateOperation();
      setStaleDrafts(readIndexedOutboundDrafts(window.sessionStorage, userId));
      setApproval(null);
      setDraft(null);
      setOptions(null);
      setErrors({});
      setConfirming(false);
      setMessage("待办状态已变化，当前办理已退出，草稿仍保留");
      return;
    }
    const indexed = readIndexedOutboundDrafts(window.sessionStorage, userId);
    setStaleDrafts(indexed);
    if (draft || operationActive.current) return;
    const restorable = indexed.find(({ entry }) => pending.some((candidate) => candidate.id === entry.approvalId));
    if (!restorable || suppressedRestoreId.current === restorable.entry.approvalId) return;
    const selected = pending.find((candidate) => candidate.id === restorable.entry.approvalId);
    if (selected) void openDraft(selected, restorable.draft);
  }, [approval, draft, pending, pendingState, result, userId]);

  const start = async (selected: PendingApproval) => {
    const stored = readSessionDraft<OutboundDraft>(window.sessionStorage, outboundDraftKey(userId, selected.id), userId, draftVersion, isOutboundDraft);
    await openDraft(selected, stored?.approvalId === selected.id && stored.step !== "complete" ? stored : createDraft(selected));
  };

  const requestReview = async () => {
    if (!approval || !draft || operationActive.current || submitLock.current) return;
    const approvalId = approval.id;
    const epoch = beginOperation(approvalId);
    setLoading(true);
    setErrors({});
    setMessage(null);
    try {
      const latest = await onReloadOptions(approvalId);
      if (!isCurrentOperation(epoch, approvalId)) return;
      const reconciled = reconcileOutboundOptions(draft, latest);
      const nextErrors = validateDecisionStep(approval, reconciled.draft.decisions, latest);
      Object.assign(nextErrors, staleErrors(reconciled));
      const nextDraft = { ...reconciled.draft, step: Object.keys(nextErrors).length ? "allocate" as const : "review" as const };
      setOptions(latest);
      setErrors(nextErrors);
      persistDraft(nextDraft, approval);
      if (Object.keys(nextErrors).length) setMessage("请修正标记项后再复核");
    } catch (error) {
      if (!isCurrentOperation(epoch, approvalId)) return;
      setMessage(error instanceof Error ? error.message : "复核前校验失败，草稿已保留");
    } finally {
      finishOperation(epoch, approvalId);
    }
  };

  const requestConfirmation = async () => {
    if (!approval || !draft || draft.step !== "review" || operationActive.current || submitLock.current) return;
    const approvalId = approval.id;
    const epoch = beginOperation(approvalId);
    setLoading(true);
    setErrors({});
    setMessage(null);
    try {
      const latest = await onReloadOptions(approvalId);
      if (!isCurrentOperation(epoch, approvalId)) return;
      const reconciled = reconcileOutboundOptions(draft, latest);
      const nextErrors = validateDecisionStep(approval, reconciled.draft.decisions, latest);
      Object.assign(nextErrors, staleErrors(reconciled));
      setOptions(latest);
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        persistDraft({ ...reconciled.draft, step: "allocate" }, approval);
        setMessage("库存选项已变化，请重新选择标记项");
        return;
      }
      persistDraft({ ...reconciled.draft, step: "review" }, approval);
      setConfirming(true);
    } catch (error) {
      if (!isCurrentOperation(epoch, approvalId)) return;
      setMessage(error instanceof Error ? error.message : "提交前校验失败，草稿已保留");
    } finally {
      finishOperation(epoch, approvalId);
    }
  };

  const confirm = async () => {
    if (!approval || !draft || draft.step !== "review" || submitLock.current || operationActive.current || completedApprovalIds.current.has(approval.id)) return;
    const approvalId = approval.id;
    submitLock.current = true;
    const epoch = beginOperation(approvalId);
    setSubmitting(true);
    setLoading(true);
    setMessage(null);
    try {
      const completed = await onConfirm({ approvalId, decisions: normalizeDecisions(draft.decisions, approval) });
      if (!isCurrentOperation(epoch, approvalId)) return;
      completedApprovalIds.current.add(approvalId);
      clearPersistedDraft(approvalId);
      setResult(completed);
      setConfirming(false);
      setDraft({ ...draft, step: "complete" });
      onCompleted(approvalId);
    } catch (error) {
      if (!isCurrentOperation(epoch, approvalId)) return;
      setConfirming(false);
      setMessage(error instanceof Error ? error.message : "出库提交失败，草稿已保留");
    } finally {
      if (isCurrentOperation(epoch, approvalId)) {
        submitLock.current = false;
        setSubmitting(false);
      }
      finishOperation(epoch, approvalId);
    }
  };

  const leave = () => {
    if (operationActive.current || submitLock.current) return;
    if (draft) suppressedRestoreId.current = draft.approvalId;
    invalidateOperation();
    setApproval(null);
    setDraft(null);
    setOptions(null);
    setErrors({});
    setMessage(null);
    setConfirming(false);
  };

  const discard = () => {
    if (operationActive.current || submitLock.current) return;
    const approvalId = draft?.approvalId;
    invalidateOperation();
    if (approvalId) clearPersistedDraft(approvalId);
    suppressedRestoreId.current = approvalId ?? null;
    setApproval(null);
    setDraft(null);
    setOptions(null);
    setErrors({});
    setMessage(null);
    setConfirming(false);
  };

  const discardStaleDraft = (approvalId: string) => {
    clearPersistedDraft(approvalId);
  };

  const cancel = async (selected: PendingApproval) => {
    if (operationActive.current || submitLock.current) return;
    const reason = window.prompt("请输入取消待办原因");
    if (!reason?.trim()) return;
    const epoch = beginOperation(selected.id);
    setLoading(true);
    setMessage(null);
    try {
      await onCancel(selected.id, reason.trim());
      if (!isCurrentOperation(epoch, selected.id)) return;
      clearPersistedDraft(selected.id);
      onCompleted(selected.id);
      setMessage("待办已取消");
    } catch (error) {
      if (!isCurrentOperation(epoch, selected.id)) return;
      setMessage(error instanceof Error ? error.message : "取消待办失败");
    } finally {
      finishOperation(epoch, selected.id);
    }
  };

  if (result && draft?.step === "complete") return <section className="outbound-flow"><h2>出库完成</h2><div className="success-notice" role="status"><CheckCircle2 size={18} />{result.id} · {inventoryStatusLabel(result.status)} · 实际数量 {result.actualQuantity} · 金额 {result.amount}</div></section>;

  const summary = approval && draft && options ? summarizeOutbound(approval, draft.decisions, options) : null;
  const visibleStaleDrafts = pendingState === "loaded"
    ? staleDrafts.filter(({ entry }) => !pending.some((candidate) => candidate.id === entry.approvalId))
    : [];
  const showSelectionHeading = !draft && (pending.length > 0 || visibleStaleDrafts.length > 0 || Boolean(message));

  return <section className="outbound-flow">
    {showSelectionHeading ? <h2>选择待办</h2> : null}
    {!draft ? <>{visibleStaleDrafts.map(({ entry }) => <div className="notice outbound-stale-draft" role="status" data-testid={`stale-draft-${entry.approvalId}`} key={entry.approvalId}><strong>待办状态已变化 · {entry.weComSpNo}</strong><p>当前办理已退出，草稿仍保留。你可以选择其他待办，或主动放弃该草稿。</p><button className="button button--secondary" type="button" onClick={() => discardStaleDraft(entry.approvalId)}>放弃该草稿</button></div>)}<div className="outbound-card-list">{pending.map((item) => {
      const requiresReapplication = item.lines.some((line) => line.legacyResolutionStatus === "REAPPLY_REQUIRED");
      return requiresReapplication
        ? <article className="outbound-card outbound-reapply-card" data-testid={`outbound-reapply-${item.id}`} key={item.id}><strong>{item.weComSpNo} · 需重新申请</strong>{item.lines.map((line) => <span key={line.id}>{line.requestedItemName} {line.requestedQuantity} {line.unit}</span>)}<span>该审批不能办理出库，请申请人使用当前模板重新提交。</span></article>
        : <article className="outbound-card" key={item.id}><strong>{item.weComSpNo}</strong><span>{item.lines.length} 个审批意向 · {inventoryStatusLabel(item.status)}</span><div className="outbound-card__actions"><button className="button button--primary" type="button" disabled={loading} onClick={() => void start(item)}>办理出库</button><button className="button button--danger" type="button" disabled={loading} onClick={() => void cancel(item)}>取消待办</button></div></article>;
    })}</div></> : null}
    {message ? <div className={message === "待办已取消" ? "success-notice" : "form-error"} role={message === "待办已取消" ? "status" : "alert"}>{message}</div> : null}
    {draft?.step === "allocate" && approval ? <><h2>分配库存</h2>{loading && !options ? <div className="notice">正在读取最新出库选项…</div> : null}{options ? <OutboundDecisionEditor approval={approval} options={options} draft={draft} errors={errors} disabled={loading} onChange={(next) => { if (operationActive.current || submitLock.current) return; persistDraft(next, approval); setErrors({}); setMessage(null); }} /> : null}<div className="outbound-flow__actions"><button className="button button--secondary" type="button" disabled={loading} onClick={leave}>返回待办</button>{options ? <button className="button button--danger" type="button" disabled={loading} onClick={discard}>放弃办理</button> : <button className="button button--primary" type="button" disabled={loading} onClick={() => void start(approval)}>重试</button>}{options ? <button className="button button--primary" type="button" disabled={loading} onClick={() => void requestReview()}>{loading ? "校验中…" : "复核出库"}</button> : null}</div></> : null}
    {draft?.step === "review" && approval && options && summary ? <MobileReview approval={approval} draft={draft} options={options} /> : null}
    {draft?.step === "review" && approval && options && summary ? <div className="outbound-flow__actions"><button className="button button--secondary" type="button" disabled={loading || submitting} onClick={() => persistDraft({ ...draft, step: "allocate" }, approval)}>返回修改</button><button className="button button--primary" type="button" disabled={loading || submitting} onClick={() => void requestConfirmation()}>{loading ? "校验中…" : "确认出库"}</button></div> : null}
    <ModalDialog open={confirming} title="确认实际出库" confirmLabel={submitting ? "提交中…" : "确认提交"} busy={submitting} onConfirm={() => void confirm()} onClose={() => { if (!submitting) setConfirming(false); }}><p>审批单 {approval?.weComSpNo}</p><p>实际数量 {summary?.actualQuantity}，预计金额 {summary?.amount}</p>{message ? <div className="form-error" role="alert">{message}</div> : null}</ModalDialog>
  </section>;
}

function MobileReview({ approval, draft, options }: { approval: PendingApproval; draft: OutboundDraft; options: OutboundOptions }) {
  const summary = summarizeOutbound(approval, draft.decisions, options);
  return <section className="outbound-mobile-review" data-testid="outbound-mobile-review"><h2>复核出库</h2>{summary.lines.map((line) => {
    const decision = draft.decisions.find((candidate) => candidate.approvalLineId === line.approvalLineId)!;
    const item = options.lines.find((candidate) => candidate.approvalLineId === line.approvalLineId)?.items.find((candidate) => candidate.id === decision.selectedItemId);
    return <article className="outbound-mobile-review__line" data-testid={`outbound-review-line-${line.approvalLineId}`} key={line.approvalLineId}>
      <strong>申请：{line.requestedItemName} {line.requestedQuantity} {line.unit}</strong>
      <span>标准物品：{decision.zeroIssue ? "本项不出库" : `${item?.code ?? decision.selectedItemId} ${item?.name ?? ""}`}</span>
      {decision.allocations.map((allocation) => <span key={allocation.id}>分配：{allocation.warehouseId} / {allocation.batchId} / {allocation.quantity} {line.unit}</span>)}
      <span>实际 {line.actualQuantity} / 审批 {line.requestedQuantity} {line.unit}</span>
      {line.difference !== "0" ? <span>差额 {line.difference}；原因：{decision.varianceReason}</span> : null}
    </article>;
  })}<p className="outbound-mobile-review__amount">预计总金额 {summary.amount}</p></section>;
}
