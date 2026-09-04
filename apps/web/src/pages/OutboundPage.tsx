import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { DesktopOutboundTable, type OutboundResult } from "../features/outbound/DesktopOutboundTable";
import { MobileOutboundFlow } from "../features/outbound/MobileOutboundFlow";
import type { NormalizedDecision, OutboundOptions, PendingApproval } from "../features/outbound/outbound-workflow";
import { useMobileViewport } from "../features/mobile/use-mobile-viewport";
import { announceBusinessCompleted } from "../features/notifications/notification-tasks";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

type ApprovalSyncFailure = { weComSpNo: string; attemptedAt: string; error: string };

export function OutboundPage({ userId }: { userId: string }) {
  const isMobile = useMobileViewport();
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncFailures, setSyncFailures] = useState<ApprovalSyncFailure[]>([]);
  const [syncFailureError, setSyncFailureError] = useState(false);
  const mounted = useRef(true);
  const pendingRequestEpoch = useRef(0);
  const syncFailureRequestEpoch = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingRequestEpoch.current += 1;
      syncFailureRequestEpoch.current += 1;
    };
  }, []);

  const loadPending = useCallback(async () => {
    if (!mounted.current) return;
    pendingRequestEpoch.current += 1;
    const epoch = pendingRequestEpoch.current;
    const isCurrentRequest = () => mounted.current && pendingRequestEpoch.current === epoch;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/outbound/pending`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      const next = await response.json() as PendingApproval[];
      if (isCurrentRequest()) setPending(next);
    } catch (error) {
      if (isCurrentRequest()) setLoadError(error instanceof Error ? error.message : "读取待出库审批失败");
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, []);
  useEffect(() => { void loadPending(); }, [loadPending]);

  const loadSyncFailures = useCallback(async () => {
    if (!mounted.current) return;
    syncFailureRequestEpoch.current += 1;
    const epoch = syncFailureRequestEpoch.current;
    const isCurrentRequest = () => mounted.current && syncFailureRequestEpoch.current === epoch;
    setSyncFailureError(false);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/approvals/sync-failures?limit=20`, { credentials: "include" });
      if (!response.ok) throw new Error("sync failure request failed");
      const payload = await response.json() as unknown;
      const next = Array.isArray(payload) ? payload.filter((entry): entry is ApprovalSyncFailure => {
        if (!entry || typeof entry !== "object") return false;
        const candidate = entry as Record<string, unknown>;
        return typeof candidate.weComSpNo === "string" && typeof candidate.attemptedAt === "string" && typeof candidate.error === "string";
      }) : [];
      if (isCurrentRequest()) setSyncFailures(next);
    } catch {
      if (isCurrentRequest()) setSyncFailureError(true);
    }
  }, []);
  useEffect(() => { void loadSyncFailures(); }, [loadSyncFailures]);

  const reloadOptions = useCallback(async (approvalId: string): Promise<OutboundOptions> => {
    const response = await fetch(`${apiBaseUrl}/admin/outbound/${encodeURIComponent(approvalId)}/options`, { credentials: "include" });
    if (response.status === 401) {
      window.location.assign(`${apiBaseUrl}/auth/wecom/authorize?returnTo=${encodeURIComponent("/admin/outbound")}`);
      throw new Error("登录已失效，草稿已保留，请重新登录");
    }
    if (!response.ok) throw new Error(await readError(response));
    return await response.json() as OutboundOptions;
  }, []);

  const confirm = useCallback(async (input: { approvalId: string; decisions: NormalizedDecision[] }): Promise<OutboundResult> => {
    const response = await fetch(`${apiBaseUrl}/admin/outbound/confirm`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
    if (response.status === 401) {
      window.location.assign(`${apiBaseUrl}/auth/wecom/authorize?returnTo=${encodeURIComponent("/admin/outbound")}`);
      throw new Error("登录已失效，草稿已保留，请重新登录");
    }
    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json() as OutboundResult;
    announceBusinessCompleted();
    await loadPending();
    return result;
  }, [loadPending]);

  const cancel = useCallback(async (approvalId: string, reason: string) => {
    const response = await fetch(`${apiBaseUrl}/admin/outbound/${encodeURIComponent(approvalId)}/cancel`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    if (response.status === 401) {
      window.location.assign(`${apiBaseUrl}/auth/wecom/authorize?returnTo=${encodeURIComponent("/admin/outbound")}`);
      throw new Error("登录已失效，草稿已保留，请重新登录");
    }
    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json() as { approvalId: string; status: string };
    announceBusinessCompleted();
    await loadPending();
    return result;
  }, [loadPending]);

  return <div className="page outbound-page" data-layout={isMobile ? "mobile" : "desktop"}>
    <PageHeader title="办理出库" description="从已通过的企业微信审批中确认标准物品，再选择实际仓库、采购批次和整数数量；本次结案后不能补出。" actions={<button className="button button--secondary" type="button" onClick={() => { void loadPending(); void loadSyncFailures(); }}><RefreshCw size={18} />刷新</button>} />
    <section className="panel outbound-panel"><div className="notice outbound-status-notice"><ShieldCheck className="outbound-status-notice__icon" size={24} aria-hidden="true" /><div className="outbound-status-notice__content"><strong>{loading ? "正在读取待出库审批…" : pending.length ? `待处理 ${pending.length} 张审批单` : "当前没有待出库审批"}</strong><p>管理员确认每项实际数量后系统即时检查并扣减库存。每项少出或零出都必须单独填写原因。</p></div></div>{syncFailures.length || syncFailureError ? <details className="outbound-sync-failures" data-testid="approval-sync-failures"><summary>管理员通知：审批同步异常{syncFailures.length ? ` ${syncFailures.length} 条` : ""}</summary>{syncFailureError ? <p>暂时无法读取审批同步异常，请稍后重试。</p> : <ul>{syncFailures.map((failure) => <li key={`${failure.weComSpNo}:${failure.attemptedAt}`}><strong>{failure.weComSpNo}</strong><span>{failure.error}</span><time dateTime={failure.attemptedAt}>{new Date(failure.attemptedAt).toLocaleString("zh-CN")}</time></li>)}</ul>}</details> : null}{loadError ? <div className="form-error notice" role="alert">{loadError}</div> : null}{pending.length || isMobile ? isMobile ? <MobileOutboundFlow userId={userId} pending={pending} pendingState={loading ? "loading" : loadError ? "error" : "loaded"} onReloadOptions={reloadOptions} onConfirm={confirm} onCancel={cancel} onCompleted={(approvalId) => setPending((current) => current.filter((approval) => approval.id !== approvalId))} /> : <DesktopOutboundTable pending={pending} onReloadOptions={reloadOptions} onConfirm={confirm} /> : null}</section>
  </div>;
}
