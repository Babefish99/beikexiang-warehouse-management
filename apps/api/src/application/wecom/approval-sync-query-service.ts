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

const PUBLIC_BUSINESS_ERRORS = new Map<string, string>([
  ["approval submitted time is invalid", "审批提交时间无效"],
  ["approval cannot contain more than five item rows", "审批物品不能超过五项"],
  ["approval must contain between one and five substantive item rows", "审批必须包含一至五项有效物品"],
  ["approval requested item name is required", "审批意向物品名称不能为空"],
  ["approval unit is required", "审批单位不能为空"],
  ["approval quantity must be a positive integer", "审批数量必须为正整数"],
  ["approval source template does not match the existing record", "审批模板与已有记录不一致"],
  ["enterprise WeChat approval template is not allowed", "审批模板不在允许范围内"],
  ["enterprise WeChat approval detail request failed", "企业微信审批详情获取失败，请重试"],
  ["enterprise WeChat token request failed", "企业微信认证失败，请检查连接配置后重试"],
]);
const FALLBACK_ERROR = "审批同步失败，请检查审批内容或同步配置后重试";

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_APPROVAL_SYNC_FAILURE_LIMIT;
  return Math.min(MAX_APPROVAL_SYNC_FAILURE_LIMIT, Math.max(1, Math.trunc(limit)));
}

function sanitizeBusinessError(error?: string): string {
  const normalized = error?.trim();
  return normalized ? PUBLIC_BUSINESS_ERRORS.get(normalized) ?? FALLBACK_ERROR : FALLBACK_ERROR;
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
