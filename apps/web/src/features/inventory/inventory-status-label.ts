const inventoryStatusLabels: Record<string, string> = {
  PENDING_OUTBOUND: "待出库",
  COMPLETED: "已完成",
  PARTIALLY_ISSUED: "部分出库",
  UNAVAILABLE: "无法出库",
  VOIDED: "已取消",
  PENDING: "待处理",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  REVOKED: "已撤回",
  CANCELED: "已取消",
  DELETED: "已删除",
  UNKNOWN: "状态未知",
};

export function inventoryStatusLabel(status: string): string {
  return inventoryStatusLabels[status] ?? "状态待确认";
}
