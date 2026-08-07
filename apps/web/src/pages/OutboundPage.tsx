import { Fragment, FormEvent, useEffect, useState } from "react";
import { CheckCircle2, Plus, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type ApprovalLine = { id: string; itemId: string; requestedQuantity: string };
type PendingApproval = { id: string; weComSpNo: string; status: string; lines: ApprovalLine[] };
type BatchOption = { batchId: string; warehouseId: string; itemId: string; remainingQuantity: string; unitCost: string };
type AllocationRow = { id: string; approvalLineId: string; warehouseId: string; batchId: string; quantity: string };
type EditorState = {
  expanded: boolean;
  loading: boolean;
  submitting: boolean;
  options: BatchOption[];
  allocations: AllocationRow[];
  reason: string;
  error: string | null;
  result: string | null;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

function newAllocation(lineId = ""): AllocationRow {
  return { id: crypto.randomUUID(), approvalLineId: lineId, warehouseId: "", batchId: "", quantity: "" };
}

function initialEditor(approval: PendingApproval): EditorState {
  return {
    expanded: true,
    loading: true,
    submitting: false,
    options: [],
    allocations: approval.lines.map((line) => newAllocation(line.id)),
    reason: "",
    error: null,
    result: null,
  };
}

export function OutboundPage() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [editors, setEditors] = useState<Record<string, EditorState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPending = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/outbound/pending`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      setPending(await response.json() as PendingApproval[]);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "读取待出库审批失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadPending(); }, []);

  const openEditor = async (approval: PendingApproval) => {
    const current = editors[approval.id];
    if (current?.expanded && !current.loading) {
      setEditors((previous) => ({ ...previous, [approval.id]: { ...current, expanded: false } }));
      return;
    }
    const editor = current ?? initialEditor(approval);
    setEditors((previous) => ({ ...previous, [approval.id]: { ...editor, expanded: true, loading: true, error: null } }));
    try {
      const response = await fetch(`${apiBaseUrl}/admin/outbound/${approval.id}/options`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { batches: BatchOption[] };
      setEditors((previous) => ({ ...previous, [approval.id]: { ...editor, expanded: true, loading: false, options: payload.batches, error: null } }));
    } catch (error) {
      setEditors((previous) => ({ ...previous, [approval.id]: { ...editor, expanded: true, loading: false, error: error instanceof Error ? error.message : "读取可出库批次失败" } }));
    }
  };

  const updateEditor = (approvalId: string, update: (editor: EditorState) => EditorState) => {
    setEditors((previous) => {
      const editor = previous[approvalId];
      return editor ? { ...previous, [approvalId]: update(editor) } : previous;
    });
  };

  const updateAllocation = (approvalId: string, rowId: string, patch: Partial<AllocationRow>) => {
    updateEditor(approvalId, (editor) => ({
      ...editor,
      allocations: editor.allocations.map((row) => row.id === rowId ? { ...row, ...patch } : row),
      error: null,
      result: null,
    }));
  };

  const submit = async (event: FormEvent, approval: PendingApproval) => {
    event.preventDefault();
    const editor = editors[approval.id];
    if (!editor) return;
    const hasIncompleteRow = editor.allocations.some((row) => (row.warehouseId || row.batchId || row.quantity) && (!row.warehouseId || !row.batchId || !row.quantity));
    if (hasIncompleteRow) {
      updateEditor(approval.id, (current) => ({ ...current, error: "请完整填写每一行的仓库、批次和实际数量" }));
      return;
    }
    const allocations = editor.allocations
      .filter((row) => row.warehouseId && row.batchId && row.quantity)
      .map(({ approvalLineId, warehouseId, batchId, quantity }) => ({ approvalLineId, warehouseId, batchId, quantity }));
    updateEditor(approval.id, (current) => ({ ...current, submitting: true, error: null, result: null }));
    try {
      const response = await fetch(`${apiBaseUrl}/admin/outbound/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: approval.id, allocations, reason: editor.reason }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json() as { id: string; status: string; actualQuantity: string; amount: string };
      setEditors((previous) => ({ ...previous, [approval.id]: { ...editor, submitting: false, result: `出库已完成：${payload.id}，${payload.status}，实际数量 ${payload.actualQuantity}，金额 ${payload.amount}` } }));
      await loadPending();
    } catch (error) {
      updateEditor(approval.id, (current) => ({ ...current, submitting: false, error: error instanceof Error ? error.message : "出库提交失败" }));
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="办理出库"
        description="从已通过的企业微信审批中选择实际仓库、采购批次和数量；可以少出，但不能超过审批数量。"
        actions={<button className="button button--secondary" type="button" onClick={() => void loadPending()}><RefreshCw size={15} />刷新</button>}
      />
      <section className="panel">
        <div className="notice">
          <ShieldCheck size={24} color="var(--orange)" />
          <strong>{loading ? "正在读取待出库审批…" : pending.length ? `待处理 ${pending.length} 张审批单` : "当前没有待出库审批"}</strong>
          <p>管理员确认实际数量后系统即时检查并扣减库存。少出或零出必须填写原因，本次结案后不能补出。</p>
        </div>
        {loadError ? <div className="form-error notice">{loadError}</div> : null}
        {pending.length ? <div className="table-wrap"><table><thead><tr><th>审批编号</th><th>申请行数</th><th>状态</th><th>操作</th></tr></thead><tbody>{pending.map((approval) => {
          const editor = editors[approval.id];
          return <Fragment key={approval.id}>
            <tr>
              <td><strong>{approval.weComSpNo}</strong></td>
              <td>{approval.lines.length} 行</td>
              <td><span className="status-pill status-pill--active">{approval.status}</span></td>
              <td><button className="button button--primary button--small" type="button" onClick={() => void openEditor(approval)}>{editor?.expanded ? "收起" : "办理出库"}</button></td>
            </tr>
            {editor?.expanded ? <tr key={`${approval.id}-editor`}><td colSpan={4}><form className="form-grid" onSubmit={(event) => void submit(event, approval)}>
              {editor.loading ? <div className="form-grid__wide notice">正在读取可用批次…</div> : null}
              {editor.error ? <div className="form-grid__wide form-error">{editor.error}</div> : null}
              {!editor.loading ? editor.allocations.map((row, index) => {
                const line = approval.lines.find((candidate) => candidate.id === row.approvalLineId) ?? approval.lines[0];
                const lineOptions = editor.options.filter((option) => option.itemId === line?.itemId);
                const warehouseIds = [...new Set(lineOptions.map((option) => option.warehouseId))];
                const batchOptions = lineOptions.filter((option) => !row.warehouseId || option.warehouseId === row.warehouseId);
                return <div className="form-grid__wide" key={row.id} style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr 1fr 1fr auto", gap: "10px", alignItems: "end" }}>
                  <label><span>申请物品 / 数量</span><select required value={row.approvalLineId} onChange={(event) => updateAllocation(approval.id, row.id, { approvalLineId: event.target.value, warehouseId: "", batchId: "" })}>{approval.lines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.itemId} / 审批 {candidate.requestedQuantity}</option>)}</select></label>
                  <label><span>实际仓库</span><select value={row.warehouseId} onChange={(event) => updateAllocation(approval.id, row.id, { warehouseId: event.target.value, batchId: "" })}><option value="">选择仓库</option>{warehouseIds.map((warehouseId) => <option key={warehouseId} value={warehouseId}>{warehouseId}</option>)}</select></label>
                  <label><span>采购批次</span><select value={row.batchId} onChange={(event) => updateAllocation(approval.id, row.id, { batchId: event.target.value })}><option value="">选择批次</option>{batchOptions.map((option) => <option key={`${option.warehouseId}:${option.batchId}`} value={option.batchId}>{option.batchId} / 可用 {option.remainingQuantity} / 单价 {option.unitCost}</option>)}</select></label>
                  <label><span>实际数量</span><input type="number" min="0.001" step="0.001" value={row.quantity} onChange={(event) => updateAllocation(approval.id, row.id, { quantity: event.target.value })} /></label>
                  <button className="button button--secondary button--small" type="button" aria-label={`删除第 ${index + 1} 行`} onClick={() => updateEditor(approval.id, (current) => ({ ...current, allocations: current.allocations.filter((candidate) => candidate.id !== row.id) }))}><Trash2 size={15} /></button>
                </div>;
              }) : null}
              {!editor.loading ? <>
                <div className="form-grid__wide form-actions form-actions--split"><button className="button button--secondary" type="button" onClick={() => updateEditor(approval.id, (current) => ({ ...current, allocations: [...current.allocations, newAllocation(approval.lines[0]?.id)] }))}><Plus size={15} />增加分配行</button><button className="button button--secondary" type="button" onClick={() => updateEditor(approval.id, (current) => ({ ...current, allocations: [], reason: "" }))}>清空分配（零出库）</button></div>
                <label className="form-grid__wide"><span>少出 / 零出原因（少出或零出时必填）</span><textarea value={editor.reason} onChange={(event) => updateEditor(approval.id, (current) => ({ ...current, reason: event.target.value, error: null }))} /></label>
                <div className="form-grid__wide form-actions"><button className="button button--primary" type="submit" disabled={editor.submitting}>{editor.submitting ? "提交中…" : "确认实际出库"}</button></div>
              </> : null}
              {editor.result ? <div className="form-grid__wide success-notice"><CheckCircle2 size={18} />{editor.result}</div> : null}
            </form></td></tr> : null}
          </Fragment>;
        })}</tbody></table></div> : null}
      </section>
    </div>
  );
}
