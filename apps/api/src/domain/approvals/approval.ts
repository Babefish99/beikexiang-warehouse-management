export interface ApprovalLine {
  id: string;
  approvalId: string;
  itemId: string;
  requestedQuantity: string;
  unit: string;
}

export function assertUniqueApprovalNumber(existing: Set<string>, weComSpNo: string): void {
  if (existing.has(weComSpNo)) throw new Error(`duplicate approval number: ${weComSpNo}`);
}
