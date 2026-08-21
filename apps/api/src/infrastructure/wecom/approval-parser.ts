export type ParsedApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" | "CANCELED" | "DELETED" | "UNKNOWN";

export interface WeComApprovalField {
  control: string;
  title?: string;
  value?: {
    text?: string;
    new_number?: { value?: string | number; unit?: string };
    number?: { value?: string | number; unit?: string };
    selector?: { options?: Array<{ key?: string; value?: string }> };
  };
}

export interface WeComApprovalRow {
  list: WeComApprovalField[];
}

export interface WeComApprovalTable {
  control: "Table";
  title?: string;
  value: { children: WeComApprovalRow[] };
}

export interface WeComApprovalPayload {
  sp_no: string;
  template_id?: string;
  sp_status: number | string;
  apply_time: number | string;
  applyer: { userid: string; name: string; department?: string };
  department?: string;
  contents: Array<WeComApprovalField | WeComApprovalTable>;
}

export interface ParsedApprovalLine {
  itemId: string;
  itemOptionKey: string;
  itemName: string;
  requestedQuantity: string;
  unit: string;
}

export interface ParsedApproval {
  weComSpNo: string;
  status: ParsedApprovalStatus;
  applicantUserId: string;
  applicantName: string;
  department?: string;
  purpose: string;
  submittedAt: string;
  lines: ParsedApprovalLine[];
}

function parseStatus(value: number | string): ParsedApprovalStatus {
  switch (String(value).toLowerCase()) {
    case "1":
    case "pending":
    case "processing":
      return "PENDING";
    case "2":
    case "approved":
      return "APPROVED";
    case "3":
    case "rejected":
      return "REJECTED";
    case "4":
    case "revoked":
      return "REVOKED";
    case "6":
    case "canceled":
    case "cancelled":
      return "CANCELED";
    case "5":
    case "7":
    case "deleted":
      return "DELETED";
    default:
      return "UNKNOWN";
  }
}

function toSubmittedAt(value: number | string): string {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("approval submitted time is invalid");
  return date.toISOString();
}

export class ApprovalParser {
  constructor(private readonly resolveItemByOptionKey: (optionKey: string) => { id: string } | undefined) {}

  parse(detail: WeComApprovalPayload): ParsedApproval {
    const table = detail.contents.find((content): content is WeComApprovalTable => content.control === "Table");
    const rows = table?.value.children ?? [];
    if (rows.length > 5) throw new Error("approval cannot contain more than five item rows");

    const purposeField = detail.contents.find((content): content is WeComApprovalField => content.control !== "Table" && content.title === "用途");
    const purpose = purposeField?.value?.text?.trim() ?? "";
    const lines = rows.map((row) => this.parseLine(row));
    return {
      weComSpNo: detail.sp_no,
      status: parseStatus(detail.sp_status),
      applicantUserId: detail.applyer.userid,
      applicantName: detail.applyer.name,
      department: detail.department ?? detail.applyer.department,
      purpose,
      submittedAt: toSubmittedAt(detail.apply_time),
      lines,
    };
  }

  private parseLine(row: WeComApprovalRow): ParsedApprovalLine {
    const selector = row.list.find((field) => field.control === "Selector")?.value?.selector?.options?.[0];
    const numberField = row.list.find((field) => field.control === "Number" || field.control === "Decimal");
    const number = numberField?.value?.new_number ?? numberField?.value?.number;
    const itemOptionKey = selector?.key?.trim();
    const requestedQuantity = number?.value === undefined ? "" : String(number.value).trim();
    const unit = number?.unit?.trim() ?? "";
    if (!itemOptionKey) throw new Error("approval item option key is required");
    if (!requestedQuantity || !Number.isFinite(Number(requestedQuantity)) || Number(requestedQuantity) <= 0) {
      throw new Error(`approval quantity is invalid for item option key: ${itemOptionKey}`);
    }
    if (!unit) throw new Error(`approval unit is required for item option key: ${itemOptionKey}`);
    const item = this.resolveItemByOptionKey(itemOptionKey);
    if (!item) throw new Error(`unknown item option key: ${itemOptionKey}`);
    return { itemId: item.id, itemOptionKey, itemName: selector?.value?.trim() ?? "", requestedQuantity, unit };
  }
}
