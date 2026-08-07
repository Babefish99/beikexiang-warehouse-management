const NOT_FOUND_PATTERNS = [
  /^item not found:/i,
  /^warehouse not found:/i,
  /^approval not found:/i,
  /^outbound allocation not found:/i,
  /^approval line not found:/i,
  /^batch not found:/i,
  /^source stock balance not found$/i,
  /^return stock balance not found$/i,
  /^stocktake balance not found$/i,
  /^stock balance batch not found$/i,
];

const BAD_REQUEST_PATTERNS = [
  /inactive or not found$/i,
  /is invalid$/i,
  /\b(?:is|are) required\b/i,
  /already exists/i,
  /already closed/i,
  /cannot /i,
  /does not belong to/i,
  /unknown item option key/i,
  /must /i,
  /mismatch/i,
  /exceeds/i,
  /substitution/i,
  /closed period:/i,
  /changed;/i,
  /duplicate approval number:/i,
  /cannot become negative/i,
  /quantity must be positive/i,
  /quantity must be finite/i,
  /cannot be negative/i,
  /nothing is issued/i,
];

export class BusinessRuleError extends Error {
  constructor(message: string, readonly statusCode: 400 | 404 = 400) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

export function classifyAdminBusinessError(error: unknown): BusinessRuleError | undefined {
  if (error instanceof BusinessRuleError) return error;
  if (!(error instanceof Error)) return undefined;
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(error.message))) {
    return new BusinessRuleError(error.message, 404);
  }
  if (BAD_REQUEST_PATTERNS.some((pattern) => pattern.test(error.message))) {
    return new BusinessRuleError(error.message, 400);
  }
  return undefined;
}
