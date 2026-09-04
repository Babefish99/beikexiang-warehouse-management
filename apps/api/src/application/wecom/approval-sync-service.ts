import type { ApprovalGateway } from "../../infrastructure/wecom/approval-gateway.js";
import type { ParsedApproval, WeComApprovalPayload } from "../../infrastructure/wecom/approval-parser.js";
import { createInventoryMemoryState, type InventoryApprovalOutboundStatus, type InventoryApprovalState, type InventoryMemoryState } from "../inventory/inventory-memory-state.js";

export type ApprovalOutboundStatus = InventoryApprovalOutboundStatus;

const CLOSED_OUTBOUND_STATUSES = new Set<ApprovalOutboundStatus>([
  "COMPLETED",
  "PARTIALLY_ISSUED",
  "UNAVAILABLE",
  "VOIDED",
  "REVOCATION_EXCEPTION",
]);

const ISSUED_OUTBOUND_STATUSES = new Set<ApprovalOutboundStatus>([
  "COMPLETED",
  "PARTIALLY_ISSUED",
  "UNAVAILABLE",
]);

export interface ApprovalSyncRecord extends ParsedApproval {
  id: string;
  outboundStatus: ApprovalOutboundStatus;
  hasOutboundDecision?: boolean;
}

export interface ApprovalSyncAttempt {
  weComSpNo: string;
  status: "SUCCEEDED" | "FAILED";
  attemptNo: number;
  payload?: unknown;
  error?: string;
}

export interface ApprovalSyncStore {
  findBySpNo(weComSpNo: string): Promise<ApprovalSyncRecord | undefined>;
  save(record: ApprovalSyncRecord): Promise<void>;
  nextAttemptNo(weComSpNo: string): Promise<number>;
  recordSyncAttempt(attempt: ApprovalSyncAttempt): Promise<void>;
  saveWithAttempt?(record: ApprovalSyncRecord, attempt: ApprovalSyncAttempt): Promise<void>;
}

export interface ApprovalDetailParser {
  parse(detail: WeComApprovalPayload): ParsedApproval | Promise<ParsedApproval>;
}

export class InMemoryApprovalSyncStore implements ApprovalSyncStore {
  private readonly approvalRecords = new Map<string, ApprovalSyncRecord>();
  private readonly syncAttempts: ApprovalSyncAttempt[] = [];
  private readonly state?: InventoryMemoryState;

  constructor(state?: InventoryMemoryState) {
    this.state = state;
  }

  async findBySpNo(weComSpNo: string): Promise<ApprovalSyncRecord | undefined> {
    if (this.state) {
      const approvalId = this.state.approvalsBySpNo.get(weComSpNo);
      const record = approvalId ? this.state.approvals.get(approvalId) : undefined;
      return record ? toApprovalSyncRecord(record) : undefined;
    }
    const record = this.approvalRecords.get(weComSpNo);
    return record ? structuredClone(record) : undefined;
  }

  async save(record: ApprovalSyncRecord): Promise<void> {
    if (this.state) {
      const existingId = this.state.approvalsBySpNo.get(record.weComSpNo);
      const existing = existingId ? this.state.approvals.get(existingId) : undefined;
      const approvalId = existing?.id ?? record.id;
      const preserveLines = existing !== undefined
        && (CLOSED_OUTBOUND_STATUSES.has(existing.outboundStatus)
          || CLOSED_OUTBOUND_STATUSES.has(record.outboundStatus)
          || existing.hasOutboundDecision === true);
      this.state.approvalsBySpNo.set(record.weComSpNo, approvalId);
      this.state.approvals.set(approvalId, {
        id: approvalId,
        weComSpNo: record.weComSpNo,
        sourceTemplateId: existing?.sourceTemplateId ?? record.sourceTemplateId,
        syncStatus: record.status,
        outboundStatus: record.outboundStatus,
        applicantUserId: record.applicantUserId,
        applicantName: record.applicantName,
        department: record.department,
        purpose: record.purpose,
        submittedAt: record.submittedAt,
        hasOutboundDecision: existing?.hasOutboundDecision ?? record.hasOutboundDecision,
        lines: preserveLines ? existing.lines : record.lines.map((line, index) => ({
          id: existing?.lines[index]?.id ?? `${approvalId}-line-${index + 1}`,
          requestedItemName: line.requestedItemName,
          itemId: line.itemId,
          requestedQuantity: line.requestedQuantity,
          unit: line.unit,
          note: line.note,
          itemOptionKey: line.itemOptionKey,
          legacyResolutionStatus: line.legacyResolutionStatus,
        })),
      });
      return;
    }
    this.approvalRecords.set(record.weComSpNo, structuredClone(record));
  }

  async nextAttemptNo(weComSpNo: string): Promise<number> {
    return this.syncAttempts.filter((attempt) => attempt.weComSpNo === weComSpNo).length + 1;
  }

  async recordSyncAttempt(attempt: ApprovalSyncAttempt): Promise<void> {
    this.syncAttempts.push(structuredClone(attempt));
  }

  async saveWithAttempt(record: ApprovalSyncRecord, attempt: ApprovalSyncAttempt): Promise<void> {
    await this.save(record);
    await this.recordSyncAttempt(attempt);
  }

  records(): ApprovalSyncRecord[] {
    if (this.state) {
      return [...this.state.approvals.values()].map((record) => toApprovalSyncRecord(record));
    }
    return [...this.approvalRecords.values()].map((record) => structuredClone(record));
  }

  attempts(): ApprovalSyncAttempt[] {
    return this.syncAttempts.map((attempt) => structuredClone(attempt));
  }
}

function toApprovalSyncRecord(record: InventoryApprovalState): ApprovalSyncRecord {
  return {
    id: record.id,
    weComSpNo: record.weComSpNo,
    sourceTemplateId: record.sourceTemplateId,
    status: record.syncStatus,
    applicantUserId: record.applicantUserId,
    applicantName: record.applicantName,
    department: record.department,
    purpose: record.purpose,
    submittedAt: record.submittedAt,
    lines: record.lines.map((line) => ({
      itemId: line.itemId,
      itemOptionKey: line.itemOptionKey,
      requestedItemName: line.requestedItemName,
      requestedQuantity: line.requestedQuantity,
      unit: line.unit,
      note: line.note,
      legacyResolutionStatus: line.legacyResolutionStatus,
    })),
    outboundStatus: record.outboundStatus as ApprovalOutboundStatus,
    hasOutboundDecision: record.hasOutboundDecision,
  };
}

function hasCompleteExactEvidence(line: ParsedApproval["lines"][number], sourceTemplateId: string | undefined): boolean {
  return Boolean(
    sourceTemplateId
    && line.itemId?.trim()
    && line.itemOptionKey?.trim()
    && line.requestedItemName.trim()
    && /^[1-9]\d*$/.test(line.requestedQuantity)
    && line.unit.trim(),
  );
}

function normalizeResolutionEvidence(parsed: ParsedApproval): ParsedApproval {
  return {
    ...parsed,
    lines: parsed.lines.map((line) => line.legacyResolutionStatus !== "EXACT_LOCKED" || hasCompleteExactEvidence(line, parsed.sourceTemplateId)
      ? line
      : {
          requestedItemName: line.requestedItemName,
          requestedQuantity: line.requestedQuantity,
          unit: line.unit,
          ...(line.note ? { note: line.note } : {}),
          legacyResolutionStatus: "REAPPLY_REQUIRED",
        }),
  };
}

export function deriveOutboundStatus(input: {
  approvalStatus: ParsedApproval["status"];
  existingOutboundStatus?: ApprovalOutboundStatus;
  lines: ParsedApproval["lines"];
}): ApprovalOutboundStatus {
  const existing = input.existingOutboundStatus ?? "NONE";
  if (input.approvalStatus === "REVOKED") {
    if (ISSUED_OUTBOUND_STATUSES.has(existing)) return "REVOCATION_EXCEPTION";
    if (existing === "VOIDED" || existing === "REVOCATION_EXCEPTION") return existing;
    return "VOIDED";
  }
  if (CLOSED_OUTBOUND_STATUSES.has(existing)) return existing;
  if (input.approvalStatus !== "APPROVED") return existing;
  return input.lines.some((line) => line.legacyResolutionStatus === "REAPPLY_REQUIRED")
    ? "REAPPLY_REQUIRED"
    : "PENDING_OUTBOUND";
}

export class ApprovalSyncService {
  constructor(private readonly dependencies: { gateway: ApprovalGateway; parser: ApprovalDetailParser; store: ApprovalSyncStore; approvalTemplateIds?: string[] }) {}

  async sync(spNo: string, options: { callbackPayload?: unknown } = {}): Promise<{ approvalId: string; created: boolean; status: string }> {
    if (!/^\d{8,32}$/.test(spNo)) throw new Error("enterprise WeChat approval number is invalid");
    const attemptNo = await this.dependencies.store.nextAttemptNo(spNo);
    let detail: WeComApprovalPayload | undefined;
    let retainFailurePayload = true;
    try {
      detail = await this.dependencies.gateway.fetchDetail(spNo);
      const detailTemplateId = detail.template_id?.trim();
      if (this.dependencies.approvalTemplateIds?.length && (!detailTemplateId || !this.dependencies.approvalTemplateIds.includes(detailTemplateId))) {
        retainFailurePayload = false;
        throw new Error("enterprise WeChat approval template is not allowed");
      }
      const parsed = normalizeResolutionEvidence(await this.dependencies.parser.parse(detail));
      const existing = await this.dependencies.store.findBySpNo(spNo);
      if (existing?.sourceTemplateId && parsed.sourceTemplateId && existing.sourceTemplateId !== parsed.sourceTemplateId) {
        throw new Error("approval source template does not match the existing record");
      }
      const record: ApprovalSyncRecord = {
        id: existing?.id ?? `approval-${spNo}`,
        ...parsed,
        outboundStatus: deriveOutboundStatus({
          approvalStatus: parsed.status,
          existingOutboundStatus: existing?.outboundStatus,
          lines: parsed.lines,
        }),
        hasOutboundDecision: existing?.hasOutboundDecision,
      };
      const payload = options.callbackPayload === undefined ? detail : { callback: options.callbackPayload, detail };
      const attempt: ApprovalSyncAttempt = { weComSpNo: spNo, status: "SUCCEEDED", attemptNo, payload };
      if (this.dependencies.store.saveWithAttempt) await this.dependencies.store.saveWithAttempt(record, attempt);
      else {
        await this.dependencies.store.save(record);
        await this.dependencies.store.recordSyncAttempt(attempt);
      }
      return {
        approvalId: record.id,
        created: !existing,
        status: record.outboundStatus === "NONE" ? parsed.status : record.outboundStatus,
      };
    } catch (error) {
      const payload = retainFailurePayload
        ? options.callbackPayload === undefined ? detail : { callback: options.callbackPayload, detail }
        : undefined;
      await this.dependencies.store.recordSyncAttempt({ weComSpNo: spNo, status: "FAILED", attemptNo, payload, error: error instanceof Error ? error.message : "approval synchronization failed" });
      throw error;
    }
  }

  async handleCallback(event: { spNo: string; rawPayload?: unknown }): Promise<void> {
    await this.sync(event.spNo, { callbackPayload: event.rawPayload });
  }
}

export type { WeComApprovalPayload };
