import type { ApprovalGateway } from "../../infrastructure/wecom/approval-gateway.js";
import { ApprovalParser, type ParsedApproval, type WeComApprovalPayload } from "../../infrastructure/wecom/approval-parser.js";

export type ApprovalOutboundStatus = "NONE" | "PENDING_OUTBOUND" | "COMPLETED";

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

  async findBySpNo(weComSpNo: string): Promise<ApprovalSyncRecord | undefined> {
    const record = this.approvalRecords.get(weComSpNo);
    return record ? structuredClone(record) : undefined;
  }

  async save(record: ApprovalSyncRecord): Promise<void> {
    this.approvalRecords.set(record.weComSpNo, structuredClone(record));
  }

  async nextAttemptNo(weComSpNo: string): Promise<number> {
    return this.syncAttempts.filter((attempt) => attempt.weComSpNo === weComSpNo).length + 1;
  }

  async recordSyncAttempt(attempt: ApprovalSyncAttempt): Promise<void> {
    this.syncAttempts.push(structuredClone(attempt));
  }

  records(): ApprovalSyncRecord[] {
    return [...this.approvalRecords.values()].map((record) => structuredClone(record));
  }

  attempts(): ApprovalSyncAttempt[] {
    return this.syncAttempts.map((attempt) => structuredClone(attempt));
  }
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
        outboundStatus: parsed.status === "APPROVED" ? existing?.outboundStatus === "COMPLETED" ? "COMPLETED" : "PENDING_OUTBOUND" : existing?.outboundStatus ?? "NONE",
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
