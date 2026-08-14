import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ModalDialog } from "../components/ModalDialog";
import { PageHeader } from "../components/PageHeader";
import {
  clearSessionDraft,
  readSessionDraft,
  writeSessionDraft,
} from "../features/drafts/session-draft";
import {
  calculateInboundAmount,
  createInboundPayload,
  createInboundDraft,
  isInboundDraft,
  mapInboundServerError,
  reconcileInboundDraft,
  resetInboundAfterSuccess,
  validateInboundDraft,
  type InboundDraft,
  type InboundFieldErrors,
} from "../features/inbound/inbound-form";
import { announceBusinessCompleted } from "../features/notifications/notification-tasks";
import { useMobileViewport } from "../features/mobile/use-mobile-viewport";

type SelectorWarehouse = { id: string; code: string; name: string };
type SelectorItem = { id: string; code: string; name: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const draftVersion = 2;

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InboundPage({ userId }: { userId: string }) {
  const isMobile = useMobileViewport();
  const draftKey = `warehouse.inbound.v1.${userId}`;
  const [warehouses, setWarehouses] = useState<SelectorWarehouse[]>([]);
  const [items, setItems] = useState<SelectorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<InboundDraft>(() => (
    readSessionDraft<InboundDraft>(window.sessionStorage, draftKey, userId, draftVersion, isInboundDraft) ?? createInboundDraft(today())
  ));
  const [errors, setErrors] = useState<InboundFieldErrors>({});
  const [staleFields, setStaleFields] = useState<Array<"warehouseId" | "itemId">>([]);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadOptions = async () => {
      setLoading(true);
      setError(null);
      try {
        const [warehouseResponse, itemResponse] = await Promise.all([
          fetch(`${apiBaseUrl}/admin/warehouses`, { credentials: "include" }),
          fetch(`${apiBaseUrl}/admin/items`, { credentials: "include" }),
        ]);
        if (!warehouseResponse.ok) throw new Error(await readError(warehouseResponse));
        if (!itemResponse.ok) throw new Error(await readError(itemResponse));
        const nextWarehouses = await warehouseResponse.json() as SelectorWarehouse[];
        const nextItems = await itemResponse.json() as SelectorItem[];
        if (!active) return;
        setWarehouses(nextWarehouses);
        setItems(nextItems);
        setForm((current) => {
          const reconciled = reconcileInboundDraft(current, {
            warehouseIds: nextWarehouses.map((warehouse) => warehouse.id),
            itemIds: nextItems.map((item) => item.id),
          });
          setStaleFields(reconciled.staleFields);
          if (reconciled.staleFields.length) {
            writeSessionDraft(window.sessionStorage, draftKey, { version: draftVersion, userId, value: reconciled.draft });
          }
          return reconciled.draft;
        });
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "标准数据加载失败");
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadOptions();
    return () => { active = false; };
  }, [draftKey, userId]);

  const updateField = useCallback((field: keyof InboundDraft, value: string) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      writeSessionDraft(window.sessionStorage, draftKey, { version: draftVersion, userId, value: next });
      return next;
    });
    setErrors((current) => ({ ...current, [field]: undefined }));
    if (field === "warehouseId" || field === "itemId") {
      setStaleFields((current) => current.filter((staleField) => staleField !== field));
    }
    setResult(null);
  }, [draftKey, userId]);

  const expectedAmount = calculateInboundAmount(form.quantity, form.unitCost);
  const selectedWarehouse = useMemo(
    () => warehouses.find((warehouse) => warehouse.id === form.warehouseId),
    [form.warehouseId, warehouses],
  );
  const selectedItem = useMemo(
    () => items.find((item) => item.id === form.itemId),
    [form.itemId, items],
  );

  const requestConfirmation = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const nextErrors = validateInboundDraft(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setConfirming(true);
  };

  const confirmInbound = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/inbound`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(createInboundPayload(form)),
      });
      if (!response.ok) {
        if (response.status === 401) {
          setError("登录已失效，请重新登录后重试");
        } else {
          const mappedError = mapInboundServerError(await readError(response));
          setError(mappedError.message);
          setErrors((current) => ({ ...current, ...mappedError.fieldErrors }));
        }
        setResult(null);
        return;
      }
      const data = await response.json() as { inboundId: string; batchIds: string[]; batchNo: string };
      clearSessionDraft(window.sessionStorage, draftKey);
      setForm((current) => resetInboundAfterSuccess(current));
      setErrors({});
      setStaleFields([]);
      setResult(`入库已登记：${data.inboundId}，批次 ${data.batchNo}`);
      setConfirming(false);
      announceBusinessCompleted();
    } catch {
      setError("网络异常，草稿已保留，请稍后重试");
      setResult(null);
    } finally {
      setSubmitting(false);
    }
  };

  const discardDraft = () => {
    clearSessionDraft(window.sessionStorage, draftKey);
    setForm(createInboundDraft(today()));
    setErrors({});
    setStaleFields([]);
    setError(null);
    setResult(null);
  };

  return (
    <div className="page inbound-page" data-layout={isMobile ? "mobile" : "desktop"}>
      <PageHeader title="登记入库" description="按实际采购和收货情况登记批次，复杂主数据维护请在电脑端完成。" />
      <section className="panel form-panel inbound-panel">
        <form className="form-grid inbound-form" onSubmit={requestConfirmation} noValidate>
          <fieldset className="inbound-form__group inbound-form__group--master">
            <legend>仓库与物品</legend>
            <label>
              <span>仓库 *</span>
              <select aria-invalid={Boolean(errors.warehouseId)} value={form.warehouseId} onChange={(event) => updateField("warehouseId", event.target.value)}>
                <option value="">请选择仓库</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}
              </select>
              {errors.warehouseId ? <small className="field-error">{errors.warehouseId}</small> : null}
            </label>
            <label>
              <span>物品 *</span>
              <select aria-invalid={Boolean(errors.itemId)} value={form.itemId} onChange={(event) => updateField("itemId", event.target.value)}>
                <option value="">请选择标准物品</option>
                {items.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
              </select>
              {errors.itemId ? <small className="field-error">{errors.itemId}</small> : null}
            </label>
          </fieldset>

          <fieldset className="inbound-form__group inbound-form__group--purchase">
            <legend>批次与采购信息</legend>
            <p>按采购日期自动生成，例如 20260814-001</p>
            <label><span>采购日期 *</span><input aria-invalid={Boolean(errors.purchasedAt)} type="date" value={form.purchasedAt} onChange={(event) => updateField("purchasedAt", event.target.value)} />{errors.purchasedAt ? <small className="field-error">{errors.purchasedAt}</small> : null}</label>
            <label><span>采购人</span><input value={form.purchaser} onChange={(event) => updateField("purchaser", event.target.value)} /></label>
            <label className="inbound-form__wide"><span>备注（单价为 0 时必填）</span><textarea aria-invalid={Boolean(errors.remark)} value={form.remark} onChange={(event) => updateField("remark", event.target.value)} />{errors.remark ? <small className="field-error">{errors.remark}</small> : null}</label>
          </fieldset>

          <fieldset className="inbound-form__group inbound-form__group--amount">
            <legend>数量与预计金额</legend>
            <label><span>入库数量 *</span><input aria-invalid={Boolean(errors.quantity)} inputMode="decimal" value={form.quantity} onChange={(event) => updateField("quantity", event.target.value)} />{errors.quantity ? <small className="field-error">{errors.quantity}</small> : null}</label>
            <label><span>采购单价 *</span><input aria-invalid={Boolean(errors.unitCost)} inputMode="decimal" value={form.unitCost} onChange={(event) => updateField("unitCost", event.target.value)} />{errors.unitCost ? <small className="field-error">{errors.unitCost}</small> : null}</label>
            <output className="inbound-amount" aria-live="polite">预计金额 {expectedAmount === null ? "—" : `¥${expectedAmount}`}</output>
          </fieldset>

          {staleFields.length ? <div className="form-grid__wide notice inbound-stale"><strong>标准数据已变化，请重新选择</strong><p>其他草稿字段已为你保留。</p></div> : null}
          <div className="form-grid__wide notice inbound-hint"><strong>{loading ? "正在加载标准数据……" : "请核对后保存"}</strong><p>提交失败或刷新页面时会保留当前非敏感字段。</p></div>
          <div className="form-grid__wide form-actions form-actions--split inbound-actions">
            <button className="button button--secondary" type="button" onClick={discardDraft} disabled={submitting}>放弃草稿</button>
            <button className="button button--primary" type="submit" disabled={loading || submitting || !warehouses.length || !items.length}>{submitting ? "提交中…" : "保存入库"}</button>
          </div>
        </form>
        {result ? <div className="success-notice" role="status"><CheckCircle2 size={18} />{result}</div> : null}
        {error && !confirming ? <div className="form-error" role="alert">{error}</div> : null}
      </section>

      <ModalDialog
        open={confirming}
        title="确认入库"
        confirmLabel={submitting ? "提交中…" : "确认入库"}
        busy={submitting}
        onConfirm={() => { void confirmInbound(); }}
        onClose={() => { if (!submitting) setConfirming(false); }}
      >
        <dl className="inbound-summary">
          <div><dt>仓库</dt><dd>{selectedWarehouse?.name}</dd></div>
          <div><dt>物品</dt><dd>{selectedItem?.name}</dd></div>
          <div><dt>批次</dt><dd>按采购日期自动生成</dd></div>
          <div><dt>数量</dt><dd>{form.quantity}</dd></div>
          <div><dt>预计金额</dt><dd>{expectedAmount === null ? "—" : `¥${expectedAmount}`}</dd></div>
        </dl>
        {error ? <div className="form-error modal-dialog__error" role="alert">{error}</div> : null}
      </ModalDialog>
    </div>
  );
}
