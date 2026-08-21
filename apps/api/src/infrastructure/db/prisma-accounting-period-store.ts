import type { PrismaClient } from "@prisma/client";

import type { AccountingPeriodStore } from "../../application/periods/period-close-service.js";
import type { AccountingPeriod } from "../../domain/periods/accounting-period.js";

export class PrismaAccountingPeriodStore implements AccountingPeriodStore {
  constructor(private readonly prisma: PrismaClient) {}

  async get(code: string): Promise<AccountingPeriod | undefined> {
    const period = await this.prisma.accountingPeriod.findUnique({ where: { periodCode: code } });
    return period ? toDomainPeriod(period) : undefined;
  }

  async getOrCreate(code: string): Promise<AccountingPeriod> {
    const period = await this.prisma.accountingPeriod.upsert({
      where: { periodCode: code },
      update: {},
      create: { periodCode: code, status: "OPEN" },
    });
    return toDomainPeriod(period);
  }

  async save(period: AccountingPeriod): Promise<void> {
    await this.prisma.accountingPeriod.upsert({
      where: { periodCode: period.code },
      update: { status: period.status, closedAt: period.closedAt ? new Date(period.closedAt) : null },
      create: { periodCode: period.code, status: period.status, closedAt: period.closedAt ? new Date(period.closedAt) : null },
    });
  }
}

function toDomainPeriod(period: { periodCode: string; status: string; closedAt: Date | null }): AccountingPeriod {
  return { code: period.periodCode, status: period.status as AccountingPeriod["status"], closedAt: period.closedAt?.toISOString() };
}
