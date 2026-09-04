import { Plus, Trash2 } from "lucide-react";

import type {
  AllocationRow,
  DecisionDraft,
  OutboundDraft,
  OutboundOptions,
  PendingApproval,
} from "./outbound-workflow";

export interface OutboundDecisionEditorProps {
  approval: PendingApproval;
  options: OutboundOptions;
  draft: OutboundDraft;
  errors: Readonly<Record<string, string>>;
  onChange(draft: OutboundDraft): void;
  disabled?: boolean;
}

function newAllocation(): AllocationRow {
  return { id: crypto.randomUUID(), warehouseId: "", batchId: "", quantity: "" };
}

function actualQuantity(decision: DecisionDraft): number {
  return decision.zeroIssue
    ? 0
    : decision.allocations.reduce((total, allocation) => total + (/^[1-9]\d*$/.test(allocation.quantity) ? Number(allocation.quantity) : 0), 0);
}

export function OutboundDecisionEditor({ approval, options, draft, errors, onChange, disabled = false }: OutboundDecisionEditorProps) {
  const updateDecision = (lineId: string, update: (decision: DecisionDraft) => DecisionDraft) => {
    if (disabled) return;
    onChange({ ...draft, decisions: draft.decisions.map((decision) => decision.approvalLineId === lineId ? update(decision) : decision) });
  };

  return <div className="outbound-decision-editor">{approval.lines.map((line) => {
    const decision = draft.decisions.find((candidate) => candidate.approvalLineId === line.id);
    if (!decision) return null;
    const candidateItems = options.lines.find((candidate) => candidate.approvalLineId === line.id)?.items ?? [];
    const selectedItem = candidateItems.find((candidate) => candidate.id === decision.selectedItemId);
    const isLocked = line.legacyResolutionStatus === "EXACT_LOCKED";
    const actual = actualQuantity(decision);
    const isShort = actual < Number(line.requestedQuantity);
    const lineError = errors[`line:${line.id}`];
    const reasonError = errors[`reason:${line.id}`];

    const changeItem = (selectedItemId: string) => {
      if (selectedItemId === decision.selectedItemId) return;
      const hasAllocationInput = decision.allocations.some((allocation) => allocation.warehouseId || allocation.batchId || allocation.quantity);
      if (hasAllocationInput && !window.confirm("更换标准物品会清空本项已有分配，是否继续？")) return;
      updateDecision(line.id, (current) => ({
        ...current,
        selectedItemId,
        zeroIssue: false,
        allocations: hasAllocationInput || current.selectedItemId ? [] : current.allocations,
      }));
    };

    return <fieldset className="outbound-decision-line" data-testid={`outbound-decision-line-${line.id}`} key={line.id}>
      <legend>审批意向</legend>
      <div className="outbound-intent">
        <strong>{line.requestedItemName}</strong>
        <span>审批数量：{line.requestedQuantity} {line.unit}</span>
        {line.note ? <span>备注：{line.note}</span> : null}
      </div>
      {!decision.zeroIssue ? <>
        {isLocked ? <div className="outbound-locked-item"><span>标准物品（旧审批锁定）</span><strong>{selectedItem ? `${selectedItem.code} ${selectedItem.name} / ${selectedItem.unit}` : line.itemId}</strong></div> : <label>
          <span>标准物品</span>
          <select disabled={disabled} aria-invalid={Boolean(lineError)} value={decision.selectedItemId} onChange={(event) => changeItem(event.target.value)}>
            <option value="">选择标准物品</option>
            {decision.selectedItemId && !selectedItem ? <option value={decision.selectedItemId}>已失效：{decision.selectedItemId}</option> : null}
            {candidateItems.map((item) => <option value={item.id} key={item.id}>{item.code} {item.name} / {item.unit} / 可用 {item.availableQuantity}</option>)}
          </select>
        </label>}
        {decision.allocations.map((allocation, index) => {
          const selectedBatches = options.batches.filter((batch) => batch.itemId === decision.selectedItemId);
          const warehouses = [...new Set(selectedBatches.map((batch) => batch.warehouseId))];
          const batches = selectedBatches.filter((batch) => !allocation.warehouseId || batch.warehouseId === allocation.warehouseId);
          const allocationError = errors[allocation.id];
          const updateAllocation = (patch: Partial<AllocationRow>) => updateDecision(line.id, (current) => ({
            ...current,
            allocations: current.allocations.map((candidate) => candidate.id === allocation.id ? { ...candidate, ...patch } : candidate),
          }));
          return <div className="outbound-decision-allocation" data-testid="outbound-allocation-row" key={allocation.id}>
            <label><span>实际仓库</span><select disabled={disabled || !decision.selectedItemId} aria-invalid={Boolean(allocationError)} value={allocation.warehouseId} onChange={(event) => updateAllocation({ warehouseId: event.target.value, batchId: "" })}><option value="">选择仓库</option>{allocation.warehouseId && !warehouses.includes(allocation.warehouseId) ? <option value={allocation.warehouseId}>已失效：{allocation.warehouseId}</option> : null}{warehouses.map((warehouse) => <option value={warehouse} key={warehouse}>{warehouse}</option>)}</select></label>
            <label><span>采购批次</span><select disabled={disabled || !decision.selectedItemId || !allocation.warehouseId} aria-invalid={Boolean(allocationError)} value={allocation.batchId} onChange={(event) => updateAllocation({ batchId: event.target.value })}><option value="">选择批次</option>{allocation.batchId && !batches.some((batch) => batch.batchId === allocation.batchId) ? <option value={allocation.batchId}>已失效：{allocation.batchId}</option> : null}{batches.map((batch) => <option value={batch.batchId} key={`${batch.warehouseId}:${batch.batchId}`}>{batch.batchId} / 可用 {batch.remainingQuantity} / 单价 {batch.unitCost}</option>)}</select></label>
            <label><span>实际数量</span><input disabled={disabled} type="number" inputMode="numeric" min="1" step="1" aria-invalid={Boolean(allocationError)} value={allocation.quantity} onChange={(event) => updateAllocation({ quantity: event.target.value })} /></label>
            <button disabled={disabled} className="button button--secondary button--small" type="button" aria-label={`删除第 ${index + 1} 条分配`} onClick={() => updateDecision(line.id, (current) => ({ ...current, allocations: current.allocations.filter((candidate) => candidate.id !== allocation.id) }))}><Trash2 size={15} /></button>
            {allocationError ? <small className="field-error">{allocationError}</small> : null}
          </div>;
        })}
        <button className="button button--secondary button--small outbound-add-allocation" type="button" disabled={disabled || !decision.selectedItemId} onClick={() => updateDecision(line.id, (current) => ({ ...current, allocations: [...current.allocations, newAllocation()] }))}><Plus size={15} />增加分配</button>
      </> : null}
      <div className="outbound-decision-line__totals"><span>审批 {line.requestedQuantity} {line.unit}</span><span>实际 {actual} {line.unit}</span><span>差额 {Number(line.requestedQuantity) - actual} {line.unit}</span></div>
      {isShort || decision.zeroIssue ? <label><span>少出 / 零出原因</span><textarea disabled={disabled} required aria-invalid={Boolean(reasonError)} value={decision.varianceReason} onChange={(event) => updateDecision(line.id, (current) => ({ ...current, varianceReason: event.target.value }))} />{reasonError ? <small className="field-error">{reasonError}</small> : null}</label> : null}
      {lineError ? <div className="field-error" role="alert">{lineError}</div> : null}
      <button disabled={disabled} className={decision.zeroIssue ? "button button--secondary button--small" : "button button--danger button--small"} type="button" onClick={() => updateDecision(line.id, (current) => decision.zeroIssue
        ? { ...current, selectedItemId: isLocked ? line.itemId ?? "" : current.selectedItemId, zeroIssue: false, allocations: [newAllocation()] }
        : { ...current, zeroIssue: true, selectedItemId: "", allocations: [] })}>{decision.zeroIssue ? "恢复本项出库" : "本项不出库"}</button>
    </fieldset>;
  })}</div>;
}
