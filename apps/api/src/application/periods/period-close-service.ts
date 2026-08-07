import type { AccountingPeriod } from "../../domain/periods/accounting-period.js";
import { createAccountingPeriodService } from "../../domain/periods/accounting-period.js";

export class PeriodCloseService {
  private readonly periods = createAccountingPeriodService();

  async close(input: { period: AccountingPeriod; pendingOutboundCount: number; unpostedAdjustmentCount: number }): Promise<AccountingPeriod> {
    if (input.pendingOutboundCount > 0) throw new Error("pending outbound items must be resolved");
    if (input.unpostedAdjustmentCount > 0) throw new Error("unposted adjustments must be resolved");
    return this.periods.close(input.period);
  }
}
