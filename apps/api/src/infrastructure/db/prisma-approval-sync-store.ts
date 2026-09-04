import { Prisma, type PrismaClient } from "@prisma/client";

import type { ApprovalSyncAttempt, ApprovalSyncRecord, ApprovalSyncStore } from "../../application/wecom/approval-sync-service.js";
import { runInventoryTransaction, type InventoryTransactionClient } from "./prisma-inventory-transaction.js";

const closedOutboundStatuses = new Set(["COMPLETED", "PARTIALLY_ISSUED", "UNAVAILABLE", "VOIDED", "REVOCATION_EXCEPTION"]);

export class PrismaApprovalSyncStore implements ApprovalSyncStore {
  constructor(private readonly prisma: PrismaClient) {}

  async findBySpNo(weComSpNo: string): Promise<ApprovalSyncRecord | undefined> {
    const approval = await this.prisma.approvalRequest.findUnique({
      where: { weComSpNo },
      include: {
        lines: { include: { item: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        outboundOrder: { include: { decisions: { select: { id: true } } } },
      },
    });
    if (!approval) return undefined;
    return {
      id: approval.id,
      weComSpNo: approval.weComSpNo,
      sourceTemplateId: approval.sourceTemplateId ?? undefined,
      status: approval.status as ApprovalSyncRecord["status"],
      outboundStatus: approval.outboundStatus as ApprovalSyncRecord["outboundStatus"],
      applicantUserId: approval.applicantUserId,
      applicantName: approval.applicantName,
      department: approval.department ?? undefined,
      purpose: approval.purpose,
      submittedAt: approval.submittedAt.toISOString(),
      lines: approval.lines.map((line) => ({
        requestedItemName: line.requestedItemName,
        requestedQuantity: line.requestedQuantity.toString(),
        unit: line.unit,
        note: line.note ?? undefined,
        itemId: line.itemId ?? undefined,
        itemOptionKey: line.item?.weComOptionKey ?? undefined,
        legacyResolutionStatus: line.legacyResolutionStatus as ApprovalSyncRecord["lines"][number]["legacyResolutionStatus"],
      })),
      hasOutboundDecision: Boolean(approval.outboundOrder?.decisions.length),
    };
  }

  async save(record: ApprovalSyncRecord): Promise<void> {
    await runInventoryTransaction(this.prisma, (transaction) => this.upsertApproval(transaction, record));
  }

  async saveWithAttempt(record: ApprovalSyncRecord, attempt: ApprovalSyncAttempt): Promise<void> {
    await runInventoryTransaction(this.prisma, async (transaction) => {
      await this.upsertApproval(transaction, record);
      await upsertAttempt(transaction, attempt);
    });
  }

  async nextAttemptNo(weComSpNo: string): Promise<number> {
    const latest = await this.prisma.syncAttempt.findFirst({ where: { weComSpNo }, orderBy: { attemptNo: "desc" } });
    return (latest?.attemptNo ?? 0) + 1;
  }

  async recordSyncAttempt(attempt: ApprovalSyncAttempt): Promise<void> {
    await runInventoryTransaction(this.prisma, (transaction) => upsertAttempt(transaction, attempt));
  }

  private async upsertApproval(transaction: InventoryTransactionClient, record: ApprovalSyncRecord): Promise<void> {
    await transaction.role.upsert({
      where: { id: "role-applicant" },
      update: { code: "APPLICANT", name: "领用人" },
      create: { id: "role-applicant", code: "APPLICANT", name: "领用人" },
    });
    await transaction.user.upsert({
      where: { id: record.applicantUserId },
      update: { name: record.applicantName, roleId: "role-applicant", isActive: true },
      create: { id: record.applicantUserId, weComUserId: record.applicantUserId, name: record.applicantName, roleId: "role-applicant", isActive: true },
    });
    const existing = await transaction.approvalRequest.findUnique({
      where: { weComSpNo: record.weComSpNo },
      include: {
        lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        outboundOrder: { include: { decisions: { select: { id: true } } } },
      },
    });
    const preserveClosed = existing ? closedOutboundStatuses.has(existing.outboundStatus) : false;
    const preserveLines = Boolean(existing)
      && (preserveClosed || closedOutboundStatuses.has(record.outboundStatus) || Boolean(existing?.outboundOrder?.decisions.length));
    const approvalId = existing?.id ?? record.id;
    await transaction.approvalRequest.upsert({
      where: { weComSpNo: record.weComSpNo },
      update: {
        applicantUserId: record.applicantUserId,
        applicantName: record.applicantName,
        department: record.department,
        purpose: record.purpose,
        status: record.status,
        outboundStatus: preserveClosed && record.outboundStatus !== "REVOCATION_EXCEPTION"
          ? existing!.outboundStatus
          : record.outboundStatus,
        sourceTemplateId: existing?.sourceTemplateId ?? record.sourceTemplateId,
        submittedAt: new Date(record.submittedAt),
      },
      create: {
        id: approvalId,
        weComSpNo: record.weComSpNo,
        applicantUserId: record.applicantUserId,
        applicantName: record.applicantName,
        department: record.department,
        purpose: record.purpose,
        status: record.status,
        outboundStatus: record.outboundStatus,
        sourceTemplateId: record.sourceTemplateId,
        submittedAt: new Date(record.submittedAt),
      },
    });
    if (preserveLines) return;

    const retainedIds: string[] = [];
    for (const [index, line] of record.lines.entries()) {
      const lineId = existing?.lines[index]?.id ?? `${approvalId}-line-${index + 1}`;
      retainedIds.push(lineId);
      await transaction.approvalLine.upsert({
        where: { id: lineId },
        update: {
          requestedItemName: line.requestedItemName,
          requestedQuantity: line.requestedQuantity,
          unit: line.unit,
          note: line.note ?? null,
          itemId: line.itemId ?? null,
          legacyResolutionStatus: line.legacyResolutionStatus,
        },
        create: {
          id: lineId,
          approvalRequestId: approvalId,
          requestedItemName: line.requestedItemName,
          requestedQuantity: line.requestedQuantity,
          unit: line.unit,
          note: line.note ?? null,
          itemId: line.itemId ?? null,
          legacyResolutionStatus: line.legacyResolutionStatus,
        },
      });
    }
    await transaction.approvalLine.deleteMany({ where: { approvalRequestId: approvalId, id: { notIn: retainedIds } } });
  }
}

async function upsertAttempt(transaction: InventoryTransactionClient, attempt: ApprovalSyncAttempt): Promise<void> {
  const id = `sync-${attempt.weComSpNo}-${attempt.attemptNo}`;
  const payload = attempt.payload === undefined ? undefined : attempt.payload as Prisma.InputJsonValue;
  await transaction.syncAttempt.upsert({
    where: { id },
    update: { status: attempt.status, payload, error: attempt.error },
    create: { id, weComSpNo: attempt.weComSpNo, status: attempt.status, attemptNo: attempt.attemptNo, payload, error: attempt.error },
  });
}
