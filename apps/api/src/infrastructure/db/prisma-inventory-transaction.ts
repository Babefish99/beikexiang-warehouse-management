import type { Prisma, PrismaClient } from "@prisma/client";

export type InventoryTransactionClient = Prisma.TransactionClient;

export class RetryableInventoryTransactionError extends Error {
  readonly code = "P2034";

  constructor(cause: unknown) {
    super("stock balance changed; retry transaction", { cause });
  }
}

export function accountingPeriodCode(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export async function assertPrismaPeriodOpen(transaction: InventoryTransactionClient, occurredAt: Date): Promise<void> {
  const periodCode = accountingPeriodCode(occurredAt);
  await transaction.accountingPeriod.upsert({
    where: { periodCode },
    update: {},
    create: { periodCode, status: "OPEN" },
  });
  const lockedOpenPeriod = await transaction.accountingPeriod.updateMany({
    where: { periodCode, status: "OPEN" },
    data: { status: "OPEN" },
  });
  if (lockedOpenPeriod.count !== 1) throw new Error(`closed period: ${periodCode}`);
}

export async function runInventoryTransaction<T>(prisma: PrismaClient, operation: (transaction: InventoryTransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(operation, { isolationLevel: "Serializable" });
  } catch (error) {
    if ((error as { code?: string }).code === "P2034") {
      throw new RetryableInventoryTransactionError(error);
    }
    throw error;
  }
}
