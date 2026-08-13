import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import { ModalDialog } from "../../components/ModalDialog";
import { clearSessionDraft, readSessionDraft, writeSessionDraft } from "../drafts/session-draft";
import {
  addOutboundDraftIndexEntry,
  isOutboundDraft,
  normalizeAllocations,
  outboundDraftKey,
  readIndexedOutboundDrafts,
  reconcileBatchOptions,
  removeOutboundDraftIndexEntry,
  summarizeOutbound,
  validateAllocationStep,
  validateReviewStep,
  type AllocationRow,
  type BatchOption,
  type IndexedOutboundDraft,
  type OutboundDraft,
  type PendingApproval,
} from "./outbound-workflow";
import type { OutboundResult } from "./DesktopOutboundTable";

const draftVersion = 1;

function createAllocation(approvalLineId: string): AllocationRow {
  return { id: crypto.randomUUID(), approvalLineId, warehouseId: "", batchId: "", quantity: "" };
}

function createDraft(approval: PendingApproval): OutboundDraft {
  return { approvalId: approval.id, step: "allocate", allocations: approval.lines.map((line) => createAllocation(line.id)), reason: "" };
}

export function MobileOutboundFlow({ userId, pending, onReloadOptions, onConfirm, onCancel, onCompleted }: {
  userId: string;
  pending: PendingApproval[];
  onReloadOptions(approvalId: string): Promise<BatchOption[]>;
  onConfirm(input: { approvalId: string; allocations: Array<Omit<AllocationRow, "id">>; reason: string }): Promise<OutboundResult>;
  onCancel(approvalId: string, reason: string): Promise<{ approvalId: string; status: string }>;
  onCompleted(approvalId: string): void;
}) {
  const [draft, setDraft] = useState<OutboundDraft | null>(null);
  const [options, setOptions] = useState<BatchOption[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [allocationErrors, setAllocationErrors] = useState<Record<string, string>>({});
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [invalidAllocationIds, setInvalidAllocationIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OutboundResult | null>(null);
  const [cancelApproval, setCancelApproval] = useState<PendingApproval | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelStage, setCancelStage] = useState<"reason" | "confirm">("reason");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [staleDrafts, setStaleDrafts] = useState<IndexedOutboundDraft[]>(() => readIndexedOutboundDrafts(window.sessionStorage, userId));
  const submitLock = useRef(false);
  const cancelLock = useRef(false);
  const mounted = useRef(true);
  const optionsRequestEpoch = useRef(0);
  const activeApprovalId = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      optionsRequestEpoch.current += 1;
      activeApprovalId.current = null;
    };
  }, []);

  const beginOptionsRequest = (approvalId: string) => {
    activeApprovalId.current = approvalId;
    optionsRequestEpoch.current += 1;
    return optionsRequestEpoch.current;
  };
  const isCurrentOptionsRequest = (epoch: number, approvalId: string) => mounted.current
    && optionsRequestEpoch.current === epoch
    && activeApprovalId.current === approvalId;

  useEffect(() => {
    if (draft || result || !pending.length) return;
    for (const approval of pending) {
      const stored = readSessionDraft<OutboundDraft>(window.sessionStorage, outboundDraftKey(userId, approval.id), userId, draftVersion, isOutboundDraft);
      if (stored?.approvalId === approval.id && stored.step !== "complete") {
        activeApprovalId.current = stored.approvalId;
        setDraft(stored);
        setLoadingOptions(true);
        const epoch = beginOptionsRequest(approval.id);
        void onReloadOptions(approval.id).then((next) => {
          if (!isCurrentOptionsRequest(epoch, approval.id)) return;
          const reconciled = reconcileBatchOptions(stored, next);
          setOptions(next);
          setInvalidAllocationIds(reconciled.invalidAllocationIds);
          setDraft(reconciled.draft);
        }).catch((error: unknown) => {
          if (isCurrentOptionsRequest(epoch, approval.id)) setReviewError(error instanceof Error ? error.message : "读取可用批次失败");
        }).finally(() => { if (isCurrentOptionsRequest(epoch, approval.id)) setLoadingOptions(false); });
        break;
      }
    }
  }, [draft, onReloadOptions, pending, result, userId]);

  useEffect(() => {
    if (!draft || result || pending.some((candidate) => candidate.id === draft.approvalId)) return;
    optionsRequestEpoch.current += 1;
    activeApprovalId.current = null;
    setStaleDrafts(readIndexedOutboundDrafts(window.sessionStorage, userId));
    setDraft(null);
    setOptions([]);
    setLoadingOptions(false);
    setReviewError(null);
  }, [draft, pending, result]);

  const saveDraft = (next: OutboundDraft) => {
    activeApprovalId.current = next.approvalId;
    writeSessionDraft(window.sessionStorage, outboundDraftKey(userId, next.approvalId), { version: draftVersion, userId, value: next });
    const selected = pending.find((candidate) => candidate.id === next.approvalId);
    addOutboundDraftIndexEntry(window.sessionStorage, userId, { approvalId: next.approvalId, weComSpNo: selected?.weComSpNo ?? next.approvalId });
    setDraft(next);
  };
  const approval = draft ? pending.find((candidate) => candidate.id === draft.approvalId) : undefined;
  const summary = approval && draft ? summarizeOutbound(approval, draft.allocations, options) : null;
  const visibleStaleDrafts = staleDrafts.filter(({ entry }) => !pending.some((candidate) => candidate.id === entry.approvalId));

  const start = async (selected: PendingApproval) => {
    const next = readSessionDraft<OutboundDraft>(window.sessionStorage, outboundDraftKey(userId, selected.id), userId, draftVersion, isOutboundDraft) ?? createDraft(selected);
    saveDraft(next);
    setLoadingOptions(true);
    setReviewError(null);
    const epoch = beginOptionsRequest(selected.id);
    try {
      const loaded = await onReloadOptions(selected.id);
      if (!isCurrentOptionsRequest(epoch, selected.id)) return;
      setOptions(loaded);
      const reconciled = reconcileBatchOptions(next, loaded);
      setInvalidAllocationIds(reconciled.invalidAllocationIds);
      saveDraft({ ...reconciled.draft, step: next.step === "select" ? "allocate" : next.step });
    } catch (error) {
      if (isCurrentOptionsRequest(epoch, selected.id)) setReviewError(error instanceof Error ? error.message : "读取可用批次失败");
    } finally {
      if (isCurrentOptionsRequest(epoch, selected.id)) setLoadingOptions(false);
    }
  };
  const updateAllocation = (rowId: string, patch: Partial<AllocationRow>) => {
    if (!draft) return;
    saveDraft({ ...draft, allocations: draft.allocations.map((row) => row.id === rowId ? { ...row, ...patch } : row) });
    setAllocationErrors((current) => ({ ...current, [rowId]: "" }));
    setInvalidAllocationIds((current) => current.filter((id) => id !== rowId));
  };
  const requestReview = () => {
    if (!approval || !draft) return;
    const errors = validateAllocationStep(approval, draft.allocations, options);
    setAllocationErrors(errors);
    if (Object.keys(errors).length) return;
    setReviewError(null);
    saveDraft({ ...draft, step: "review" });
  };
  const requestConfirmation = async () => {
    if (!approval || !draft || !summary || submitLock.current) return;
    const reviewErrors = validateReviewStep(summary, draft.reason);
    setReviewError(reviewErrors.reason ?? null);
    if (reviewErrors.reason) return;
    submitLock.current = true;
    setSubmitting(true);
    const epoch = beginOptionsRequest(approval.id);
    try {
      const latest = await onReloadOptions(approval.id);
      if (!isCurrentOptionsRequest(epoch, approval.id)) return;
      setOptions(latest);
      const reconciled = reconcileBatchOptions(draft, latest);
      setInvalidAllocationIds(reconciled.invalidAllocationIds);
      saveDraft(reconciled.draft);
      if (reconciled.invalidAllocationIds.length) {
        setReviewError("库存已变化，请返回分配步骤重新选择标记项");
        return;
      }
      setConfirming(true);
    } catch (error) {
      if (isCurrentOptionsRequest(epoch, approval.id)) setReviewError(error instanceof Error ? error.message : "提交前校验失败，草稿已保留");
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const confirm = async () => {
    if (!draft || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setReviewError(null);
    try {
      const completed = await onConfirm({ approvalId: draft.approvalId, allocations: normalizeAllocations(draft.allocations), reason: draft.reason.trim() });
      if (!mounted.current) return;
      clearSessionDraft(window.sessionStorage, outboundDraftKey(userId, draft.approvalId));
      removeOutboundDraftIndexEntry(window.sessionStorage, userId, draft.approvalId);
      setResult(completed);
      setConfirming(false);
      setDraft({ ...draft, step: "complete" });
      onCompleted(draft.approvalId);
    } catch (error) {
      if (mounted.current) setReviewError(error instanceof Error ? error.message : "出库提交失败，草稿已保留");
    } finally {
      submitLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const discard = () => {
    optionsRequestEpoch.current += 1;
    activeApprovalId.current = null;
    if (draft) clearSessionDraft(window.sessionStorage, outboundDraftKey(userId, draft.approvalId));
    if (draft) removeOutboundDraftIndexEntry(window.sessionStorage, userId, draft.approvalId);
    setDraft(null);
    setOptions([]);
    setResult(null);
    setReviewError(null);
    setAllocationErrors({});
    setInvalidAllocationIds([]);
  };
  const discardStaleDraft = (approvalId: string) => {
    clearSessionDraft(window.sessionStorage, outboundDraftKey(userId, approvalId));
    removeOutboundDraftIndexEntry(window.sessionStorage, userId, approvalId);
    setStaleDrafts((current) => current.filter(({ entry }) => entry.approvalId !== approvalId));
  };
  const advanceCancel = () => {
    if (!cancelReason.trim()) {
      setCancelError("必须填写取消原因");
      return;
    }
    setCancelError(null);
    setCancelStage("confirm");
  };
  const confirmCancel = async () => {
    if (!cancelApproval || cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(true);
    setCancelError(null);
    try {
      await onCancel(cancelApproval.id, cancelReason.trim());
      if (!mounted.current) return;
      clearSessionDraft(window.sessionStorage, outboundDraftKey(userId, cancelApproval.id));
      removeOutboundDraftIndexEntry(window.sessionStorage, userId, cancelApproval.id);
      onCompleted(cancelApproval.id);
      setCancelApproval(null);
      setCancelStage("reason");
      setCancelReason("");
      setReviewError("待办已取消");
      if (draft?.approvalId === cancelApproval.id) setDraft(null);
    } catch (error) {
      if (mounted.current) setCancelError(error instanceof Error ? error.message : "取消失败，草稿已保留");
    } finally {
      cancelLock.current = false;
      if (mounted.current) setCancelling(false);
    }
  };

  if (result && draft?.step === "complete") return <section className="outbound-flow"><h2>出库完成</h2><div className="success-notice" role="status"><CheckCircle2 size={18} />出库已完成</div><dl className="outbound-review"><div><dt>服务端 ID</dt><dd>{result.id}</dd></div><div><dt>状态</dt><dd>{result.status}</dd></div><div><dt>实际数量</dt><dd>{result.actualQuantity}</dd></div><div><dt>金额</dt><dd>{result.amount}</dd></div></dl><button className="button button--primary" type="button" onClick={discard}>返回待办</button></section>;

  return <section className="outbound-flow">
    {!draft ? <><h2>选择待办</h2>{visibleStaleDrafts.map(({ entry }) => <div className="notice outbound-stale-draft" role="status" data-testid={`stale-draft-${entry.approvalId}`} key={entry.approvalId}><strong>待办状态已变化 · {entry.weComSpNo}</strong><p>当前办理已退出，草稿仍保留。你可以选择其他待办，或主动放弃该草稿。</p><button className="button button--secondary" type="button" onClick={() => discardStaleDraft(entry.approvalId)}>放弃该草稿</button></div>)}{reviewError ? <div className="success-notice" role="status">{reviewError}</div> : null}<div className="outbound-card-list">{pending.map((item) => <article className="outbound-card" key={item.id}><strong>{item.weComSpNo}</strong><span>{item.lines.length} 个物品 · {item.status}</span><div className="outbound-card__actions"><button className="button button--primary" type="button" onClick={() => void start(item)}>办理出库</button><button className="button button--danger" type="button" onClick={() => { setCancelApproval(item); setCancelReason(""); setCancelStage("reason"); setCancelError(null); }}>取消待办</button></div></article>)}</div></> : null}
    {draft?.step === "allocate" && approval ? <><h2>分配库存</h2>{loadingOptions ? <div className="notice">正在读取可用批次…</div> : null}{reviewError ? <div className="form-error" role="alert">{reviewError}</div> : null}{approval.lines.map((line) => {
      const rows = draft.allocations.filter((row) => row.approvalLineId === line.id);
      const lineOptions = options.filter((option) => option.itemId === line.itemId);
      const warehouses = [...new Set(lineOptions.map((option) => option.warehouseId))];
      return <fieldset className="outbound-allocation-line" data-testid={`allocation-line-${line.id}`} key={line.id}><legend>{line.itemId} · 审批 {line.requestedQuantity}</legend>{rows.map((row, index) => {
        const batches = lineOptions.filter((option) => option.warehouseId === row.warehouseId);
        return <div className="outbound-allocation-row" data-testid="allocation-row" key={row.id}><label><span>实际仓库</span><select aria-invalid={Boolean(allocationErrors[row.id] || invalidAllocationIds.includes(row.id))} value={row.warehouseId} onChange={(event) => updateAllocation(row.id, { warehouseId: event.target.value, batchId: "" })}><option value="">选择仓库</option>{warehouses.map((warehouse) => <option value={warehouse} key={warehouse}>{warehouse}</option>)}</select></label><label><span>采购批次</span><select aria-invalid={Boolean(allocationErrors[row.id] || invalidAllocationIds.includes(row.id))} value={row.batchId} onChange={(event) => updateAllocation(row.id, { batchId: event.target.value })}><option value="">选择批次</option>{batches.map((batch) => <option value={batch.batchId} key={batch.batchId}>{batch.batchId} · 可用 {batch.remainingQuantity}</option>)}</select></label><label><span>实际数量</span><input aria-invalid={Boolean(allocationErrors[row.id] || invalidAllocationIds.includes(row.id))} inputMode="decimal" value={row.quantity} onChange={(event) => updateAllocation(row.id, { quantity: event.target.value })} /></label>{allocationErrors[row.id] ? <small className="field-error">{allocationErrors[row.id]}</small> : null}{invalidAllocationIds.includes(row.id) ? <small className="field-error">库存已变化，请重新选择</small> : null}{rows.length > 1 ? <button className="button button--secondary" type="button" aria-label={`删除${line.itemId}第 ${index + 1} 条分配`} onClick={() => saveDraft({ ...draft, allocations: draft.allocations.filter((candidate) => candidate.id !== row.id) })}><Trash2 size={18} />删除</button> : null}</div>;
      })}<button className="button button--secondary" type="button" onClick={() => saveDraft({ ...draft, allocations: [...draft.allocations, createAllocation(line.id)] })}><Plus size={18} />增加分配行</button>{allocationErrors[`line:${line.id}`] ? <small className="field-error">{allocationErrors[`line:${line.id}`]}</small> : null}</fieldset>;
    })}<div className="outbound-flow__actions"><button className="button button--secondary" type="button" onClick={discard}>放弃办理</button><button className="button button--primary" type="button" disabled={loadingOptions} onClick={requestReview}>下一步：复核</button></div></> : null}
    {draft?.step === "review" && approval && summary ? <><h2>复核出库</h2><dl className="outbound-review">{summary.lines.map((line) => <div key={line.approvalLineId}><dt>{line.itemId}</dt><dd>审批 {line.requestedQuantity} / 实际 {line.actualQuantity} / 差额 {line.difference}</dd></div>)}<div><dt>预计总金额</dt><dd>{summary.amount}</dd></div></dl>{draft.allocations.map((row) => <div className={invalidAllocationIds.includes(row.id) ? "outbound-review-row outbound-review-row--invalid" : "outbound-review-row"} data-testid={invalidAllocationIds.includes(row.id) ? "review-allocation-invalid" : "review-allocation"} key={row.id}>{row.warehouseId} / {row.batchId} / {row.quantity}</div>)}<label><span>少出 / 零出原因</span><textarea aria-invalid={Boolean(reviewError?.includes("原因"))} value={draft.reason} onChange={(event) => { saveDraft({ ...draft, reason: event.target.value }); setReviewError(null); }} /></label>{reviewError ? <div className="form-error" role="alert">{reviewError}</div> : null}<div className="outbound-flow__actions"><button className="button button--secondary" type="button" onClick={() => saveDraft({ ...draft, step: "allocate" })}>上一步</button><button className="button button--primary" type="button" disabled={submitting} onClick={() => void requestConfirmation()}>{submitting ? "校验中…" : "确认出库"}</button></div></> : null}
    <ModalDialog open={confirming} title="确认实际出库" confirmLabel={submitting ? "提交中…" : "确认提交"} busy={submitting} onConfirm={() => void confirm()} onClose={() => { if (!submitting) setConfirming(false); }}><p>审批单 {approval?.weComSpNo}</p><p>实际数量 {summary?.actualQuantity}，预计金额 {summary?.amount}</p>{reviewError ? <div className="form-error" role="alert">{reviewError}</div> : null}</ModalDialog>
    <ModalDialog open={Boolean(cancelApproval) && cancelStage === "reason"} title="取消待办" confirmLabel="下一步" dangerous onConfirm={advanceCancel} onClose={() => { if (!cancelling) setCancelApproval(null); }}><label><span>取消原因</span><textarea value={cancelReason} onChange={(event) => { setCancelReason(event.target.value); setCancelError(null); }} /></label>{cancelError ? <div className="form-error" role="alert">{cancelError}</div> : null}</ModalDialog>
    <ModalDialog open={Boolean(cancelApproval) && cancelStage === "confirm"} title="确认取消待办" confirmLabel={cancelling ? "取消中…" : "确认取消"} dangerous busy={cancelling} onConfirm={() => void confirmCancel()} onClose={() => { if (!cancelling) setCancelStage("reason"); }}><p>审批号：{cancelApproval?.weComSpNo}</p><p>原因：{cancelReason.trim()}</p>{cancelError ? <div className="form-error" role="alert">{cancelError}</div> : null}</ModalDialog>
  </section>;
}
