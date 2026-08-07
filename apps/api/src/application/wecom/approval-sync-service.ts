import type { ApprovalGateway } from "../../infrastructure/wecom/approval-gateway.js";
import { ApprovalParser, type ParsedApproval, type WeComApprovalPayload } from "../../infrastructure/wecom/approval-parser.js";
import { createInventoryMemoryState, type InventoryApprovalOutboundStatus, type InventoryApprovalState, type InventoryMemoryState } from "../inventory/inventory-memory-state.js";

export type ApprovalOutboundStatus = InventoryApprovalOutboundStatus;

const CLOSED_OUTBOUND_STATUSES = new Set<ApprovalOutboundStatus>([
  "COMPLETED",
  "PARTIALLY_ISSUED",
  "UNAVAILABLE",
  "VOIDED",
]);

export interface ApprovalSyncRecord extends ParsedApproval {
  id: string;
  outboundStatus: ApprovalOutboundStatus;
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
      this.state.approvalsBySpNo.set(record.weComSpNo, approvalId);
      this.state.approvals.set(approvalId, {
        id: approvalId,
        weComSpNo: record.weComSpNo,
        syncStatus: record.status,
        outboundStatus: record.outboundStatus,
        applicantUserId: record.applicantUserId,
        applicantName: record.applicantName,
        department: record.department,
        purpose: record.purpose,
        submittedAt: record.submittedAt,
        lines: record.lines.map((line, index) => ({
          id: existing?.lines[index]?.id ?? `${approvalId}-line-${index + 1}`,
          itemId: line.itemId,
          requestedQuantity: line.requestedQuantity,
          unit: line.unit,
          itemOptionKey: line.itemOptionKey,
          itemName: line.itemName,
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
    status: record.syncStatus,
    applicantUserId: record.applicantUserId,
    applicantName: record.applicantName,
    department: record.department,
    purpose: record.purpose,
    submittedAt: record.submittedAt,
    lines: record.lines.map((line) => ({
      itemId: line.itemId,
      itemOptionKey: line.itemOptionKey ?? "",
      itemName: line.itemName ?? "",
      requestedQuantity: line.requestedQuantity,
      unit: line.unit,
    })),
    outboundStatus: record.outboundStatus as ApprovalOutboundStatus,
  };
}

export class ApprovalSyncService {
  constructor(private readonly dependencies: { gateway: ApprovalGateway; parser: ApprovalParser; store: ApprovalSyncStore }) {}

  async sync(spNo: string, options: { callbackPayload?: unknown } = {}): Promise<{ approvalId: string; created: boolean; status: string }> {
    if (!/^\d{8,32}$/.test(spNo)) throw new Error("enterprise WeChat approval number is invalid");
    const attemptNo = await this.dependencies.store.nextAttemptNo(spNo);
    let detail: WeComApprovalPayload | undefined;
    try {
      detail = await this.dependencies.gateway.fetchDetail(spNo);
      const parsed = this.dependencies.parser.parse(detail);
      const existing = await this.dependencies.store.findBySpNo(spNo);
      const record: ApprovalSyncRecord = {
        id: existing?.id ?? `approval-${spNo}`,
        ...parsed,
        outboundStatus: parsed.status === "APPROVED"
          ? existing && CLOSED_OUTBOUND_STATUSES.has(existing.outboundStatus) ? existing.outboundStatus : "PENDING_OUTBOUND"
          : existing?.outboundStatus ?? "NONE",
      };
      await this.dependencies.store.save(record);
      const payload = options.callbackPayload === undefined ? detail : { callback: options.callbackPayload, detail };
      await this.dependencies.store.recordSyncAttempt({ weComSpNo: spNo, status: "SUCCEEDED", attemptNo, payload });
      return { approvalId: record.id, created: !existing, status: parsed.status === "APPROVED" ? record.outboundStatus : parsed.status };
    } catch (error) {
      const payload = options.callbackPayload === undefined ? detail : { callback: options.callbackPayload, detail };
      await this.dependencies.store.recordSyncAttempt({ weComSpNo: spNo, status: "FAILED", attemptNo, payload, error: error instanceof Error ? error.message : "approval synchronization failed" });
      throw error;
    }
  }

  async handleCallback(event: { spNo: string; rawPayload?: unknown }): Promise<void> {
    await this.sync(event.spNo, { callbackPayload: event.rawPayload });
  }
}

export type { WeComApprovalPayload };
