import { Fragment, type FormEvent, useState } from "react";
import { CheckCircle2, Plus, Trash2 } from "lucide-react";
import type { AllocationRow, BatchOption, PendingApproval } from "./outbound-workflow";

type EditorState = { expanded: boolean; loading: boolean; submitting: boolean; options: BatchOption[]; allocations: AllocationRow[]; reason: string; error: string | null; result: string | null };
export type OutboundResult = { id: string; status: string; actualQuantity: string; amount: string };

function newAllocation(lineId = ""): AllocationRow {
  return { id: crypto.randomUUID(), approvalLineId: lineId, warehouseId: "", batchId: "", quantity: "" };
}

function initialEditor(approval: PendingApproval): EditorState {
  return { expanded: true, loading: true, submitting: false, options: [], allocations: approval.lines.map((line) => newAllocation(line.id)), reason: "", error: null, result: null };
}

export function DesktopOutboundTable({ pending, onReloadOptions, onConfirm }: {
  pending: PendingApproval[];
  onReloadOptions(approvalId: string): Promise<BatchOption[]>;
  onConfirm(input: { approvalId: string; allocations: Array<Omit<AllocationRow, "id">>; reason: string }): Promise<OutboundResult>;
}) {
  const [editors, setEditors] = useState<Record<string, EditorState>>({});
  const updateEditor = (approvalId: string, update: (editor: EditorState) => EditorState) => setEditors((previous) => {
    const editor = previous[approvalId];
    return editor ? { ...previous, [approvalId]: update(editor) } : previous;
  });
  const openEditor = async (approval: PendingApproval) => {
    const current = editors[approval.id];
    if (current?.expanded && !current.loading) {
      updateEditor(approval.id, (editor) => ({ ...editor, expanded: false }));
      return;
    }
    const editor = current ?? initialEditor(approval);
    setEditors((previous) => ({ ...previous, [approval.id]: { ...editor, expanded: true, loading: true, error: null } }));
    try {
      const options = await onReloadOptions(approval.id);
      setEditors((previous) => ({ ...previous, [approval.id]: { ...(previous[approval.id] ?? editor), expanded: true, loading: false, options, error: null } }));
    } catch (error) {
      updateEditor(approval.id, (value) => ({ ...value, loading: false, error: error instanceof Error ? error.message : "读取可出库批次失败" }));
    }
  };
  const submit = async (event: FormEvent, approval: PendingApproval) => {
    event.preventDefault();
    const editor = editors[approval.id];
    if (!editor || editor.submitting) return;
    const incomplete = editor.allocations.some((row) => (row.warehouseId || row.batchId || row.quantity) && (!row.warehouseId || !row.batchId || !row.quantity));
    if (incomplete) {
      updateEditor(approval.id, (value) => ({ ...value, error: "请完整填写每一行的仓库、批次和实际数量" }));
      return;
    }
    const allocations = editor.allocations.filter((row) => row.warehouseId && row.batchId && row.quantity).map(({ id: _id, ...row }) => row);
    updateEditor(approval.id, (value) => ({ ...value, submitting: true, error: null, result: null }));
    try {
      const payload = await onConfirm({ approvalId: approval.id, allocations, reason: editor.reason });
      updateEditor(approval.id, (value) => ({ ...value, submitting: false, result: `出库已完成：${payload.id}，${payload.status}，实际数量 ${payload.actualQuantity}，金额 ${payload.amount}` }));
    } catch (error) {
      updateEditor(approval.id, (value) => ({ ...value, submitting: false, error: error instanceof Error ? error.message : "出库提交失败" }));
    }
  };
  const updateAllocation = (approvalId: string, rowId: string, patch: Partial<AllocationRow>) => updateEditor(approvalId, (editor) => ({ ...editor, allocations: editor.allocations.map((row) => row.id === rowId ? { ...row, ...patch } : row), error: null, result: null }));

  return <div className="table-wrap"><table><thead><tr><th>审批编号</th><th>申请行数</th><th>状态</th><th>操作</th></tr></thead><tbody>{pending.map((approval) => {
    const editor = editors[approval.id];
    return <Fragment key={approval.id}><tr><td><strong>{approval.weComSpNo}</strong></td><td>{approval.lines.length} 行</td><td><span className="status-pill status-pill--active">{approval.status}</span></td><td><button className="button button--primary button--small" type="button" onClick={() => void openEditor(approval)}>{editor?.expanded ? "收起" : "办理出库"}</button></td></tr>
      {editor?.expanded ? <tr><td colSpan={4}><form className="form-grid" onSubmit={(event) => void submit(event, approval)}>
        {editor.loading ? <div className="form-grid__wide notice">正在读取可用批次…</div> : null}
        {editor.error ? <div className="form-grid__wide form-error">{editor.error}</div> : null}
        {!editor.loading ? editor.allocations.map((row, index) => {
          const line = approval.lines.find((candidate) => candidate.id === row.approvalLineId) ?? approval.lines[0];
          const lineOptions = editor.options.filter((option) => option.itemId === line?.itemId);
          const warehouseIds = [...new Set(lineOptions.map((option) => option.warehouseId))];
          const batchOptions = lineOptions.filter((option) => !row.warehouseId || option.warehouseId === row.warehouseId);
          return <div className="form-grid__wide outbound-desktop-row" key={row.id}><label><span>申请物品 / 数量</span><select required value={row.approvalLineId} onChange={(event) => updateAllocation(approval.id, row.id, { approvalLineId: event.target.value, warehouseId: "", batchId: "" })}>{approval.lines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.itemId} / 审批 {candidate.requestedQuantity}</option>)}</select></label><label><span>实际仓库</span><select value={row.warehouseId} onChange={(event) => updateAllocation(approval.id, row.id, { warehouseId: event.target.value, batchId: "" })}><option value="">选择仓库</option>{warehouseIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label><label><span>采购批次</span><select value={row.batchId} onChange={(event) => updateAllocation(approval.id, row.id, { batchId: event.target.value })}><option value="">选择批次</option>{batchOptions.map((option) => <option key={`${option.warehouseId}:${option.batchId}`} value={option.batchId}>{option.batchId} / 可用 {option.remainingQuantity} / 单价 {option.unitCost}</option>)}</select></label><label><span>实际数量</span><input type="number" min="0.001" step="0.001" value={row.quantity} onChange={(event) => updateAllocation(approval.id, row.id, { quantity: event.target.value })} /></label><button className="button button--secondary button--small" type="button" aria-label={`删除第 ${index + 1} 行`} onClick={() => updateEditor(approval.id, (value) => ({ ...value, allocations: value.allocations.filter((candidate) => candidate.id !== row.id) }))}><Trash2 size={15} /></button></div>;
        }) : null}
        {!editor.loading ? <><div className="form-grid__wide notice"><strong>出库汇总：审批数量 {approval.lines.reduce((total, line) => total + Number(line.requestedQuantity), 0).toFixed(3)}，实际出库 {editor.allocations.reduce((total, row) => total + Number(row.quantity || 0), 0).toFixed(3)}，预计金额 {editor.allocations.reduce((total, row) => { const batch = editor.options.find((option) => option.warehouseId === row.warehouseId && option.batchId === row.batchId); return total + Number(row.quantity || 0) * Number(batch?.unitCost || 0); }, 0).toFixed(2)}</strong><p>预计金额按管理员选择的入库批次采购单价计算，提交后由服务端再次校验并写入出库流水。</p></div><div className="form-grid__wide form-actions form-actions--split"><button className="button button--secondary" type="button" onClick={() => updateEditor(approval.id, (value) => ({ ...value, allocations: [...value.allocations, newAllocation(approval.lines[0]?.id)] }))}><Plus size={15} />增加分配行</button><button className="button button--secondary" type="button" onClick={() => updateEditor(approval.id, (value) => ({ ...value, allocations: [], reason: "" }))}>清空分配（零出库）</button></div><label className="form-grid__wide"><span>少出 / 零出原因（少出或零出时必填）</span><textarea value={editor.reason} onChange={(event) => updateEditor(approval.id, (value) => ({ ...value, reason: event.target.value, error: null }))} /></label><div className="form-grid__wide form-actions"><button className="button button--primary" type="submit" disabled={editor.submitting}>{editor.submitting ? "提交中…" : "确认实际出库"}</button></div></> : null}
        {editor.result ? <div className="form-grid__wide success-notice"><CheckCircle2 size={18} />{editor.result}</div> : null}
      </form></td></tr> : null}</Fragment>;
  })}</tbody></table></div>;
}
