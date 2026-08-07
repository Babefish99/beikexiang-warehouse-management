import type { AccountingPeriod } from "../../domain/periods/accounting-period.js";
import { createAccountingPeriod, createAccountingPeriodService } from "../../domain/periods/accounting-period.js";

export interface AccountingPeriodStore {
  get(code: string): AccountingPeriod | undefined;
  getOrCreate(code: string): AccountingPeriod;
  save(period: AccountingPeriod): void;
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

  constructor(private readonly periodStore: AccountingPeriodStore = new InMemoryAccountingPeriodStore()) {}

  async close(input: { period: AccountingPeriod; pendingOutboundCount: number; unpostedAdjustmentCount: number }): Promise<AccountingPeriod> {
    if (input.pendingOutboundCount > 0) throw new Error("pending outbound items must be resolved");
    if (input.unpostedAdjustmentCount > 0) throw new Error("unposted adjustments must be resolved");
    const current = this.periodStore.getOrCreate(input.period.code);
    this.periods.assertOpen(current);
    const closed = this.periods.close(current);
    this.periodStore.save(closed);
    return closed;
  }
}
