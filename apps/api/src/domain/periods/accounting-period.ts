export type AccountingPeriodStatus = "OPEN" | "CLOSED";

export interface AccountingPeriod {
  code: string;
  status: AccountingPeriodStatus;
  closedAt?: string;
}

export interface AccountingPeriodService {
  isOpen(period: AccountingPeriod): boolean;
  close(period: AccountingPeriod): AccountingPeriod;
  assertOpen(period: AccountingPeriod): void;
}

export function createAccountingPeriod(input: { code: string; status?: AccountingPeriodStatus }): AccountingPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.code)) throw new Error("period code must be YYYY-MM");
  return { code: input.code, status: input.status ?? "OPEN" };
}

export function createAccountingPeriodService(): AccountingPeriodService {
  return {
    isOpen: (period) => period.status === "OPEN",
    close: (period) => ({ ...period, status: "CLOSED", closedAt: new Date().toISOString() }),
    assertOpen: (period) => {
      if (period.status !== "OPEN") throw new Error(`closed period: ${period.code}`);
    },
  };
}
