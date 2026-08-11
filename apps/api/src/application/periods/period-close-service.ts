import type { AccountingPeriod } from "../../domain/periods/accounting-period.js";
import { createAccountingPeriod, createAccountingPeriodService } from "../../domain/periods/accounting-period.js";

export interface AccountingPeriodStore {
  get(code: string): AccountingPeriod | undefined | Promise<AccountingPeriod | undefined>;
  getOrCreate(code: string): AccountingPeriod | Promise<AccountingPeriod>;
  save(period: AccountingPeriod): void | Promise<void>;
}

export interface PeriodCloseChecks {
  getPendingOutboundCount?: () => number | Promise<number>;
  getUnpostedAdjustmentCount?: () => number | Promise<number>;
}

export class InMemoryAccountingPeriodStore implements AccountingPeriodStore {
  private readonly periods = new Map<string, AccountingPeriod>();

  get(code: string): AccountingPeriod | undefined {
    const period = this.periods.get(code);
    return period ? structuredClone(period) : undefined;
  }

  getOrCreate(code: string): AccountingPeriod {
    const existing = this.get(code);
    if (existing) return existing;
    const period = createAccountingPeriod({ code });
    this.save(period);
    return structuredClone(period);
  }

  save(period: AccountingPeriod): void {
    this.periods.set(period.code, structuredClone(period));
  }
}

export class PeriodCloseService {
  private readonly periods = createAccountingPeriodService();

  constructor(private readonly periodStore: AccountingPeriodStore = new InMemoryAccountingPeriodStore(), private readonly checks: PeriodCloseChecks = {}) {}

  async close(input: { period: AccountingPeriod; pendingOutboundCount?: number; unpostedAdjustmentCount?: number }): Promise<AccountingPeriod> {
    const pendingOutboundCount = this.checks.getPendingOutboundCount
      ? await this.checks.getPendingOutboundCount()
      : input.pendingOutboundCount ?? 0;
    const unpostedAdjustmentCount = this.checks.getUnpostedAdjustmentCount
      ? await this.checks.getUnpostedAdjustmentCount()
      : input.unpostedAdjustmentCount ?? 0;
    if (pendingOutboundCount > 0) throw new Error("pending outbound items must be resolved");
    if (unpostedAdjustmentCount > 0) throw new Error("unposted adjustments must be resolved");
    const current = await this.periodStore.getOrCreate(input.period.code);
    this.periods.assertOpen(current);
    const closed = this.periods.close(current);
    await this.periodStore.save(closed);
    return closed;
  }
}
