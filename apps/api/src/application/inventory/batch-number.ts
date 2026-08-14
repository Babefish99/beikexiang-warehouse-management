export function nextInboundBatchNo(purchasedAt: string, existingBatchNos: Iterable<string>): string {
  const date = new Date(purchasedAt);
  if (Number.isNaN(date.getTime())) throw new Error("purchasedAt is invalid");

  const prefix = date.toISOString().slice(0, 10).replaceAll("-", "");
  const highest = [...existingBatchNos]
    .map((value) => new RegExp(`^${prefix}-(\\d+)$`).exec(value)?.[1])
    .filter((value): value is string => Boolean(value))
    .reduce((max, value) => Math.max(max, Number(value)), 0);

  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}
