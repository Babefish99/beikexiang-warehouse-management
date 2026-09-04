import {
  approvalUnitsMatch,
  normalizeApprovalUnit,
  parsePositiveIntegerQuantity,
  type LegacyResolutionStatus,
} from "../../domain/approvals/approval-intent.js";

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
  requestedItemName: string;
  requestedQuantity: string;
  unit: string;
  note?: string;
  itemId?: string;
  itemOptionKey?: string;
  legacyResolutionStatus: LegacyResolutionStatus;
}

export interface ParsedApproval {
  weComSpNo: string;
  status: ParsedApprovalStatus;
  applicantUserId: string;
  applicantName: string;
  department?: string;
  purpose: string;
  submittedAt: string;
  sourceTemplateId?: string;
  lines: ParsedApprovalLine[];
}

export interface ResolvedApprovalItem {
  id: string;
  code?: string;
  name?: string;
  unit?: string;
  isActive: boolean;
}

export type ApprovalItemResolver = (reference: string) => ResolvedApprovalItem | undefined;

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
  constructor(
    private readonly resolveItem: ApprovalItemResolver,
    private readonly intentTemplateId?: string,
  ) {}

  parse(detail: WeComApprovalPayload): ParsedApproval {
    const table = detail.contents.find((content): content is WeComApprovalTable => content.control === "Table");
    const rows = table?.value.children ?? [];
    if (rows.length > 5) throw new Error("approval cannot contain more than five item rows");

    const sourceTemplateId = detail.template_id?.trim() || undefined;
    const isIntentTable = this.intentTemplateId
      ? sourceTemplateId === this.intentTemplateId
      : rows.some((row) => (
        !row.list.some((field) => field.control === "Selector")
        && row.list.some((field) => isIntentFieldTitle(field.title))
      ));
    const purposeField = detail.contents.find((content): content is WeComApprovalField => content.control !== "Table" && content.title === "用途");
    const purpose = purposeField?.value?.text?.trim() ?? "";
    if (isIntentTable && !purpose) throw new Error("approval purpose is required");
    const lines = isIntentTable
      ? rows.map((row) => this.parseIntentLine(row))
      : rows.length > 0
        ? rows.map((row) => this.parseLegacySelectorLine(row))
        : this.parseFixedTextLines(detail.contents);
    if (lines.length === 0 || lines.some((line) => !line.requestedItemName)) {
      throw new Error("approval must contain between one and five substantive item rows");
    }
    return {
      weComSpNo: detail.sp_no,
      status: parseStatus(detail.sp_status),
      applicantUserId: detail.applyer.userid,
      applicantName: detail.applyer.name,
      department: detail.department ?? detail.applyer.department,
      purpose,
      submittedAt: toSubmittedAt(detail.apply_time),
      sourceTemplateId,
      lines,
    };
  }

  private parseIntentLine(row: WeComApprovalRow): ParsedApprovalLine {
    const requestedItemName = textValue(row.list.find((field) => field.title === "意向物品名称"));
    const requestedQuantity = parsePositiveIntegerQuantity(numberOrTextValue(row.list.find((field) => field.title === "审批数量")));
    const unit = normalizeApprovalUnit(textValue(row.list.find((field) => field.title === "单位")));
    const note = textValue(row.list.find((field) => field.title === "补充要求"));
    if (!requestedItemName) throw new Error("approval requested item name is required");
    if (!unit) throw new Error("approval unit is required");
    return {
      requestedItemName,
      requestedQuantity,
      unit,
      ...(note ? { note } : {}),
      legacyResolutionStatus: "NOT_APPLICABLE",
    };
  }

  private parseLegacySelectorLine(row: WeComApprovalRow): ParsedApprovalLine {
    const selectorOptions = row.list.find((field) => field.control === "Selector")?.value?.selector?.options ?? [];
    const selector = selectorOptions.length === 1 ? selectorOptions[0] : undefined;
    const numberField = row.list.find((field) => field.control === "Number" || field.control === "Decimal");
    const itemOptionKey = selector?.key?.trim();
    const requestedQuantity = numberOrTextValue(numberField);
    const unit = normalizeApprovalUnit(numberField?.value?.new_number?.unit ?? numberField?.value?.number?.unit ?? "");
    const requestedItemName = selector
      ? selector.value?.trim() ?? ""
      : selectorOptions.map((option) => option.value?.trim()).filter((value): value is string => Boolean(value)).join("、");
    const parsedQuantity = tryParsePositiveIntegerQuantity(requestedQuantity);
    const item = itemOptionKey && parsedQuantity && unit ? this.resolveItem(itemOptionKey) : undefined;
    if (item && parsedQuantity && item.isActive && item.unit && itemOptionKey && approvalUnitsMatch(unit, item.unit)) {
      return {
        requestedItemName,
        requestedQuantity: parsedQuantity,
        unit,
        itemId: item.id,
        itemOptionKey,
        legacyResolutionStatus: "EXACT_LOCKED",
      };
    }
    return { requestedItemName, requestedQuantity, unit, legacyResolutionStatus: "REAPPLY_REQUIRED" };
  }

  private parseFixedTextLines(contents: Array<WeComApprovalField | WeComApprovalTable>): ParsedApprovalLine[] {
    const fields = contents.filter((content): content is WeComApprovalField => content.control !== "Table");
    const names = fields.flatMap((field) => {
      const match = field.title?.match(/^物品(\d+)\s*名称/);
      return match ? [{ index: Number(match[1]), value: field.value?.text?.trim() ?? "" }] : [];
    });
    if (names.length > 5) throw new Error("approval cannot contain more than five item rows");

    return names
      .filter(({ value }) => value !== "" && value !== "无")
      .map(({ index, value: requestedItemName }) => {
        const quantityField = fields.find((field) => field.title?.match(new RegExp(`^物品${index}\\s*数量及单位`)));
        const rawQuantity = quantityField?.value?.text?.trim() ?? "";
        const quantityMatch = rawQuantity.match(/^([0-9]+(?:\.[0-9]+)?)\s*(.*)$/);
        return {
          requestedItemName,
          requestedQuantity: quantityMatch?.[1] ?? rawQuantity,
          unit: normalizeApprovalUnit(quantityMatch?.[2] ?? ""),
          legacyResolutionStatus: "REAPPLY_REQUIRED",
        };
      });
  }
}

function textValue(field: WeComApprovalField | undefined): string {
  return field?.value?.text?.trim() ?? "";
}

function numberOrTextValue(field: WeComApprovalField | undefined): string {
  const number = field?.value?.new_number ?? field?.value?.number;
  return number?.value === undefined ? textValue(field) : String(number.value).trim();
}

function tryParsePositiveIntegerQuantity(value: string): string | undefined {
  try {
    return parsePositiveIntegerQuantity(value);
  } catch {
    return undefined;
  }
}

function isIntentFieldTitle(title: string | undefined): boolean {
  return title === "意向物品名称" || title === "审批数量" || title === "单位" || title === "补充要求";
}
