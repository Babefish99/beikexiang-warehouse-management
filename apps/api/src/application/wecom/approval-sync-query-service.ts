export interface ApprovalSyncFailureRecord {
  weComSpNo: string;
  attemptedAt: string;
  error?: string;
}

export interface ApprovalSyncFailure {
  weComSpNo: string;
  attemptedAt: string;
  error: string;
}

export interface ApprovalSyncFailureSource {
  listRecentFailures(limit: number): Promise<ApprovalSyncFailureRecord[]>;
}

export const DEFAULT_APPROVAL_SYNC_FAILURE_LIMIT = 20;
export const MAX_APPROVAL_SYNC_FAILURE_LIMIT = 100;

const SENSITIVE_ERROR_PATTERN = /callback|headers?|access[_\s-]*token|secret|token|encoding[_\s-]*aes[_\s-]*key|aes[_\s-]*key|cookie/i;
const FALLBACK_ERROR = "approval synchronization failed";

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_APPROVAL_SYNC_FAILURE_LIMIT;
  return Math.min(MAX_APPROVAL_SYNC_FAILURE_LIMIT, Math.max(1, Math.trunc(limit)));
}

function sanitizeBusinessError(error?: string): string {
  const normalized = error?.trim();
  if (!normalized || SENSITIVE_ERROR_PATTERN.test(normalized)) return FALLBACK_ERROR;
  return normalized.slice(0, 500);
}

export class ApprovalSyncQueryService {
  constructor(private readonly source: ApprovalSyncFailureSource) {}

  async listRecentFailures(limit = DEFAULT_APPROVAL_SYNC_FAILURE_LIMIT): Promise<ApprovalSyncFailure[]> {
    const failures = await this.source.listRecentFailures(boundedLimit(limit));
    return failures.map((failure) => ({
      weComSpNo: failure.weComSpNo,
      attemptedAt: failure.attemptedAt,
      error: sanitizeBusinessError(failure.error),
    }));
  }
}
