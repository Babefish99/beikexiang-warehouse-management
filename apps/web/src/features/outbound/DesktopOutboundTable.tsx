import { Fragment, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { inventoryStatusLabel } from "../inventory/inventory-status-label";
import { OutboundDecisionEditor } from "./OutboundDecisionEditor";
import {
  normalizeDecisions,
  reconcileOutboundOptions,
  summarizeOutbound,
  validateDecisionStep,
  type DecisionDraft,
  type NormalizedDecision,
  type OutboundDraft,
  type OutboundOptions,
  type PendingApproval,
} from "./outbound-workflow";

type EditorState = {
  expanded: boolean;
  loading: boolean;
  submitting: boolean;
  completed: boolean;
  reviewing: boolean;
  options: OutboundOptions | null;
  draft: OutboundDraft;
  errors: Record<string, string>;
  error: string | null;
  result: string | null;
};

export type OutboundResult = { id: string; status: string; actualQuantity: string; amount: string };

function initialDecision(line: PendingApproval["lines"][number]): DecisionDraft {
  return {
    approvalLineId: line.id,
    selectedItemId: line.legacyResolutionStatus === "EXACT_LOCKED" ? line.itemId ?? "" : "",
    zeroIssue: false,
    varianceReason: "",
    allocations: [{ id: crypto.randomUUID(), warehouseId: "", batchId: "", quantity: "" }],
  };
}

function initialEditor(approval: PendingApproval): EditorState {
  return {
    expanded: true,
    loading: true,
    submitting: false,
    completed: false,
    reviewing: false,
    options: null,
    draft: { approvalId: approval.id, step: "allocate", decisions: approval.lines.map(initialDecision) },
    errors: {},
    error: null,
    result: null,
  };
}

export function DesktopOutboundTable({ pending, onReloadOptions, onConfirm }: {
  pending: PendingApproval[];
  onReloadOptions(approvalId: string): Promise<OutboundOptions>;
  onConfirm(input: { approvalId: string; decisions: NormalizedDecision[] }): Promise<OutboundResult>;
}) {
  const [editors, setEditors] = useState<Record<string, EditorState>>({});
  const mounted = useRef(true);
  const optionRequestEpochs = useRef<Record<string, number>>({});
  const submitLocks = useRef(new Set<string>());
  const completedApprovals = useRef(new Set<string>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      optionRequestEpochs.current = {};
    };
  }, []);
  const beginOptionsRequest = (approvalId: string) => {
    const epoch = (optionRequestEpochs.current[approvalId] ?? 0) + 1;
    optionRequestEpochs.current[approvalId] = epoch;
    return epoch;
  };
  const isCurrentOptionsRequest = (approvalId: string, epoch: number) => mounted.current && optionRequestEpochs.current[approvalId] === epoch;
  const updateEditor = (approvalId: string, update: (editor: EditorState) => EditorState) => setEditors((previous) => {
    const editor = previous[approvalId];
    return editor ? { ...previous, [approvalId]: update(editor) } : previous;
  });

  const openEditor = async (approval: PendingApproval) => {
    const current = editors[approval.id];
    if (current?.loading || current?.submitting || current?.completed || completedApprovals.current.has(approval.id)) return;
    if (current?.expanded && !current.loading) {
      updateEditor(approval.id, (editor) => ({ ...editor, expanded: false, reviewing: false }));
      return;
    }
    const editor = current ?? initialEditor(approval);
    const epoch = beginOptionsRequest(approval.id);
    setEditors((previous) => ({ ...previous, [approval.id]: { ...editor, expanded: true, loading: true, reviewing: false, error: null } }));
    try {
      const options = await onReloadOptions(approval.id);
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      setEditors((previous) => {
        const previousEditor = previous[approval.id] ?? editor;
        const reconciled = reconcileOutboundOptions(previousEditor.draft, options);
        const errors: Record<string, string> = {};
        for (const lineId of reconciled.staleSelectedItemLineIds) errors[`line:${lineId}`] = "所选标准物品已失效，请重新选择";
        for (const allocationId of reconciled.staleAllocationIds) errors[allocationId] = "库存已变化，请重新选择";
        return {
          ...previous,
          [approval.id]: { ...previousEditor, expanded: true, loading: false, reviewing: false, options, draft: reconciled.draft, errors, error: null },
        };
      });
    } catch (error) {
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      updateEditor(approval.id, (value) => ({ ...value, loading: false, error: error instanceof Error ? error.message : "读取出库选项失败" }));
    }
  };

  const requestReview = async (approval: PendingApproval) => {
    const editor = editors[approval.id];
    if (!editor || editor.loading || editor.submitting || editor.completed) return;
    const epoch = beginOptionsRequest(approval.id);
    updateEditor(approval.id, (value) => ({ ...value, loading: true, errors: {}, error: null }));
    try {
      const latest = await onReloadOptions(approval.id);
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      const reconciled = reconcileOutboundOptions(editor.draft, latest);
      const errors = validateDecisionStep(approval, reconciled.draft.decisions, latest);
      for (const lineId of reconciled.staleSelectedItemLineIds) errors[`line:${lineId}`] = "所选标准物品已失效，请重新选择";
      for (const allocationId of reconciled.staleAllocationIds) errors[allocationId] = "库存已变化，请重新选择";
      updateEditor(approval.id, (value) => ({
        ...value,
        loading: false,
        options: latest,
        draft: reconciled.draft,
        errors,
        reviewing: Object.keys(errors).length === 0,
        error: null,
      }));
    } catch (error) {
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      updateEditor(approval.id, (value) => ({ ...value, loading: false, error: error instanceof Error ? error.message : "提交前校验失败，草稿已保留" }));
    }
  };

  const submit = async (approval: PendingApproval) => {
    const editor = editors[approval.id];
    if (!editor || editor.submitting || !editor.reviewing || editor.completed || submitLocks.current.has(approval.id) || completedApprovals.current.has(approval.id)) return;
    submitLocks.current.add(approval.id);
    const epoch = beginOptionsRequest(approval.id);
    let confirmationStarted = false;
    updateEditor(approval.id, (value) => ({ ...value, submitting: true, error: null, result: null }));
    try {
      const latest = await onReloadOptions(approval.id);
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      const reconciled = reconcileOutboundOptions(editor.draft, latest);
      const errors = validateDecisionStep(approval, reconciled.draft.decisions, latest);
      for (const lineId of reconciled.staleSelectedItemLineIds) errors[`line:${lineId}`] = "所选标准物品已失效，请重新选择";
      for (const allocationId of reconciled.staleAllocationIds) errors[allocationId] = "库存已变化，请重新选择";
      if (Object.keys(errors).length > 0) {
        updateEditor(approval.id, (value) => ({
          ...value,
          submitting: false,
          reviewing: false,
          options: latest,
          draft: reconciled.draft,
          errors,
          error: null,
        }));
        return;
      }
      updateEditor(approval.id, (value) => ({ ...value, options: latest, draft: reconciled.draft, errors: {} }));
      confirmationStarted = true;
      const payload = await onConfirm({ approvalId: approval.id, decisions: normalizeDecisions(reconciled.draft.decisions, approval) });
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      completedApprovals.current.add(approval.id);
      updateEditor(approval.id, (value) => ({
        ...value,
        submitting: false,
        completed: true,
        reviewing: false,
        errors: {},
        error: null,
        result: `出库已完成：${payload.id}，${inventoryStatusLabel(payload.status)}，实际数量 ${payload.actualQuantity}，金额 ${payload.amount}`,
      }));
    } catch (error) {
      if (!isCurrentOptionsRequest(approval.id, epoch)) return;
      updateEditor(approval.id, (value) => ({
        ...value,
        submitting: false,
        reviewing: confirmationStarted ? value.reviewing : false,
        error: error instanceof Error ? error.message : "出库提交失败，草稿已保留",
      }));
    } finally {
      submitLocks.current.delete(approval.id);
    }
  };

  return <div className="table-wrap"><table><thead><tr><th>审批编号</th><th>申请行数</th><th>状态</th><th>操作</th></tr></thead><tbody>{pending.map((approval) => {
    const editor = editors[approval.id];
    const requiresReapplication = approval.lines.some((line) => line.legacyResolutionStatus === "REAPPLY_REQUIRED");
    return <Fragment key={approval.id}><tr><td><strong>{approval.weComSpNo}</strong></td><td>{approval.lines.length} 行</td><td><span className="status-pill status-pill--active">{editor?.completed ? "已完成" : inventoryStatusLabel(approval.status)}</span></td><td>{!requiresReapplication ? <button className="button button--primary button--small" type="button" disabled={Boolean(editor?.loading || editor?.submitting || editor?.completed)} onClick={() => void openEditor(approval)}>{editor?.completed ? "已完成" : editor?.expanded ? "收起" : "办理出库"}</button> : <span className="status-pill">需重新申请</span>}</td></tr>
      {requiresReapplication ? <tr><td colSpan={4}><article className="outbound-reapply-card" data-testid={`outbound-reapply-${approval.id}`}><strong>旧审批信息不完整，需重新申请</strong>{approval.lines.map((line) => <p key={line.id}>{line.requestedItemName} {line.requestedQuantity} {line.unit}</p>)}<p>该审批不能办理出库，请申请人使用当前模板重新提交。</p></article></td></tr> : null}
      {editor?.expanded ? <tr><td colSpan={4}><div className="form-grid outbound-desktop-editor">
        {editor.loading ? <div className="form-grid__wide notice">正在读取最新出库选项…</div> : null}
        {editor.error ? <div className="form-grid__wide form-error" role="alert">{editor.error}</div> : null}
        {!editor.loading && !editor.completed && editor.options && !editor.reviewing ? <>
          <div className="form-grid__wide"><OutboundDecisionEditor approval={approval} options={editor.options} draft={editor.draft} errors={editor.errors} onChange={(draft) => updateEditor(approval.id, (value) => ({ ...value, draft, errors: {}, error: null, result: null }))} /></div>
          <div className="form-grid__wide form-actions"><button className="button button--primary" type="button" onClick={() => void requestReview(approval)}>复核出库</button></div>
        </> : null}
        {!editor.loading && !editor.completed && editor.options && editor.reviewing ? <DesktopReview approval={approval} draft={editor.draft} options={editor.options} /> : null}
        {!editor.loading && !editor.completed && editor.reviewing ? <div className="form-grid__wide form-actions form-actions--split"><button className="button button--secondary" type="button" disabled={editor.submitting} onClick={() => updateEditor(approval.id, (value) => ({ ...value, reviewing: false, error: null }))}>返回修改</button><button className="button button--primary" type="button" disabled={editor.submitting} onClick={() => void submit(approval)}>{editor.submitting ? "提交中…" : "确认并提交"}</button></div> : null}
        {editor.result ? <div className="form-grid__wide success-notice" role="status"><CheckCircle2 size={18} />{editor.result}</div> : null}
      </div></td></tr> : null}</Fragment>;
  })}</tbody></table></div>;
}

function DesktopReview({ approval, draft, options }: { approval: PendingApproval; draft: OutboundDraft; options: OutboundOptions }) {
  const summary = summarizeOutbound(approval, draft.decisions, options);
  return <section className="form-grid__wide outbound-desktop-review"><h3>复核出库</h3>{summary.lines.map((line) => {
    const decision = draft.decisions.find((candidate) => candidate.approvalLineId === line.approvalLineId)!;
    const item = options.lines.find((candidate) => candidate.approvalLineId === line.approvalLineId)?.items.find((candidate) => candidate.id === decision.selectedItemId);
    return <article data-testid={`outbound-review-line-${line.approvalLineId}`} key={line.approvalLineId}>
      <p>申请：{line.requestedItemName} {line.requestedQuantity} {line.unit}</p>
      <p>实际：{decision.zeroIssue ? `本项不出库 0 ${line.unit}` : `${item?.code ?? decision.selectedItemId} ${item?.name ?? ""} ${line.actualQuantity} ${line.unit}`}</p>
      {decision.allocations.map((allocation) => <p key={allocation.id}>分配：{allocation.warehouseId} / {allocation.batchId} / {allocation.quantity}</p>)}
      <p>差额：{line.difference}{line.difference !== "0" ? `；原因：${decision.varianceReason}` : ""}</p>
    </article>;
  })}<p className="outbound-desktop-review__amount">预计金额：{summary.amount}</p></section>;
}
