import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import {
  canCommitOpeningStockImport,
  filterOpeningStockIssues,
  type OpeningStockImportPreview,
  type OpeningStockImportResult,
  type OpeningStockImportStatus,
  type OpeningStockIssueFilter,
} from "../features/opening-stock/opening-stock-import";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const MAX_TIMEOUT_MS = 2_147_483_647;

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as {
    message?: string;
    error?: string;
  } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

function issueLocation(issue: OpeningStockImportPreview["issues"][number]): string {
  return [
    issue.sheet,
    issue.row === undefined ? undefined : `第 ${issue.row} 行`,
    issue.field,
  ].filter(Boolean).join(" · ");
}

function dispositionLabel(disposition: OpeningStockImportPreview["rows"][number]["disposition"]): string {
  if (disposition === "IMPORT") return "写入";
  if (disposition === "SKIP_ZERO") return "跳过零库存";
  return "无效";
}

function CompletedImportSummary({ result }: { result: OpeningStockImportResult }) {
  return (
    <section className="panel opening-import-completed" aria-labelledby="opening-import-completed-title">
      <div className="opening-import-completed__heading">
        <CheckCircle2 size={24} aria-hidden="true" />
        <div>
          <h2 id="opening-import-completed-title">期初库存已完成导入</h2>
          <p>导入结果已锁定，后续差错请通过盘点调整处理。</p>
        </div>
      </div>
      <dl className="opening-import-completed__grid">
        <div><dt>导入标识</dt><dd>{result.id}</dd></div>
        <div><dt>源文件</dt><dd>{result.sourceFileName}</dd></div>
        <div><dt>盘点基准日期</dt><dd>{result.baselineDate}</dd></div>
        <div><dt>财务复核人</dt><dd>{result.financeReviewer}</dd></div>
        <div><dt>物品数</dt><dd>{result.itemCount}</dd></div>
        <div><dt>新建物品</dt><dd>{result.createdItemCount}</dd></div>
        <div><dt>盘点行</dt><dd>{result.inventoryRowCount}</dd></div>
        <div><dt>库存写入行</dt><dd>{result.positiveRowCount}</dd></div>
        <div><dt>零库存行</dt><dd>{result.zeroRowCount}</dd></div>
        <div><dt>总数量</dt><dd>{result.totalQuantity}</dd></div>
        <div><dt>总金额</dt><dd>{result.totalAmount}</dd></div>
        <div><dt>导入时间</dt><dd>{new Date(result.importedAt).toLocaleString("zh-CN")}</dd></div>
      </dl>
      <p className="opening-import-hash">文件 SHA-256：{result.fileSha256}</p>
    </section>
  );
}

export function OpeningStockPage() {
  const [status, setStatus] = useState<OpeningStockImportStatus | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OpeningStockImportPreview | null>(null);
  const [financeReviewer, setFinanceReviewer] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [issueFilter, setIssueFilter] = useState<OpeningStockIssueFilter>("ALL");
  const [busy, setBusy] = useState<"status" | "preview" | "commit" | null>("status");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [, setExpiryVersion] = useState(0);

  const loadStatus = async () => {
    setBusy("status");
    setError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/opening-stock/import/status`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readError(response));
      setStatus(await response.json() as OpeningStockImportStatus);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "期初库存状态加载失败");
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  useEffect(() => {
    if (!preview?.previewExpiresAt) return;
    const expiresAt = new Date(preview.previewExpiresAt).getTime();
    if (!Number.isFinite(expiresAt)) return;
    const delay = Math.max(0, Math.min(expiresAt - Date.now(), MAX_TIMEOUT_MS));
    const timeout = window.setTimeout(() => setExpiryVersion((version) => version + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [preview?.previewExpiresAt]);

  const filteredIssues = useMemo(
    () => filterOpeningStockIssues(preview?.issues ?? [], issueFilter),
    [issueFilter, preview?.issues],
  );
  const fileMatchesPreview = Boolean(file && file === previewFile);
  const canCommit = canCommitOpeningStockImport({
    preview,
    fileMatchesPreview,
    financeReviewer,
    confirmed,
    now: new Date(),
  });

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setPreviewFile(null);
    setConfirmed(false);
    setIssueFilter("ALL");
    setError(null);
    setMessage(null);
  };

  const submitPreview = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError("请选择固定格式的 .xlsx 文件");
      return;
    }

    setBusy("preview");
    setError(null);
    setMessage(null);
    setPreview(null);
    setPreviewFile(null);
    setConfirmed(false);
    try {
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await fetch(`${apiBaseUrl}/admin/opening-stock/import/preview`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!response.ok) throw new Error(await readError(response));
      setPreview(await response.json() as OpeningStockImportPreview);
      setPreviewFile(file);
      setMessage("预览校验已完成，请核对汇总、问题清单和明细行。");
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "期初库存预览失败");
    } finally {
      setBusy(null);
    }
  };

  const submitCommit = async () => {
    if (!file || !preview?.previewToken || !canCommitOpeningStockImport({
      preview,
      fileMatchesPreview: file === previewFile,
      financeReviewer,
      confirmed,
      now: new Date(),
    })) {
      setError("当前预览已不可导入，请检查文件、财务复核信息或重新预览");
      return;
    }

    setBusy("commit");
    setError(null);
    setMessage(null);
    try {
      const body = new FormData();
      body.append("previewToken", preview.previewToken);
      body.append("financeReviewer", financeReviewer.trim());
      body.append("confirmed", "true");
      body.append("file", file, file.name);
      const response = await fetch(`${apiBaseUrl}/admin/opening-stock/import/commit`, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json() as OpeningStockImportResult;
      setStatus({ availability: "COMPLETED", completedImport: result });
      setMessage("期初库存正式导入成功。");
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : "期初库存正式导入失败");
    } finally {
      setBusy(null);
    }
  };

  const commitDisabledReason = (() => {
    if (!preview) return "请先上传文件并完成预览校验";
    if (!preview.canCommit) return "预览存在错误，修正工作簿后请重新上传预览";
    if (!preview.previewToken || !preview.previewExpiresAt) return "预览凭证不可用，请重新预览";
    if (new Date(preview.previewExpiresAt).getTime() <= Date.now()) return "预览已过期，请重新预览";
    if (!fileMatchesPreview) return "当前文件与预览文件不一致，请重新预览";
    if (financeReviewer.trim() === "") return "请填写财务复核人";
    if (!confirmed) return "请确认已与财务共同核对";
    return busy === "commit" ? "正在正式导入" : null;
  })();

  return (
    <div className="page opening-import-page">
      <PageHeader
        title="期初库存导入"
        description="使用固定格式 Excel 完成一次性初始化；系统预览校验通过并经财务共同复核后方可正式导入。"
      />

      {message ? <div className="success-notice" role="status"><CheckCircle2 size={18} aria-hidden="true" />{message}</div> : null}
      {error ? <div className="form-error opening-import-feedback" role="alert">{error}</div> : null}
      {busy === "status" ? <section className="panel opening-import-state" role="status">正在读取期初库存状态……</section> : null}

      {!status && busy !== "status" ? (
        <section className="panel opening-import-state">
          <strong>暂时无法读取期初库存状态</strong>
          <button className="button" type="button" onClick={() => void loadStatus()}>重新加载</button>
        </section>
      ) : null}

      {status?.availability === "BLOCKED_BY_ACTIVITY" ? (
        <section className="panel opening-import-state opening-import-state--blocked">
          <AlertTriangle size={24} aria-hidden="true" />
          <div>
            <h2>已有库存业务，不能再初始化期初库存</h2>
            <p>系统检测到入库、出库、调拨或盘点等库存活动。请勿通过期初导入覆盖现有库存。</p>
          </div>
        </section>
      ) : null}

      {status?.availability === "COMPLETED" && status.completedImport ? (
        <CompletedImportSummary result={status.completedImport} />
      ) : null}

      {status?.availability === "AVAILABLE" ? (
        <>
          <section className="panel opening-import-upload" aria-labelledby="opening-import-upload-title">
            <div className="opening-import-upload__intro">
              <span className="opening-import-upload__icon"><UploadCloud size={24} aria-hidden="true" /></span>
              <div>
                <h2 id="opening-import-upload-title">上传固定格式工作簿</h2>
                <p>仅支持一个 .xlsx 文件，最大 5 MB。请勿修改工作表名称、列名和物料编码。</p>
              </div>
            </div>
            <form className="opening-import-upload__form" onSubmit={submitPreview}>
              <label htmlFor="opening-stock-file">期初库存 Excel</label>
              <input
                id="opening-stock-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                disabled={busy !== null}
              />
              <button className="button button--primary" type="submit" disabled={!file || busy !== null}>
                {busy === "preview" ? "正在预览……" : "预览校验"}
              </button>
            </form>
            <ul className="opening-import-constraints">
              <li>盘点基准日期和三个仓库资料必须符合模板约束。</li>
              <li>零库存行会保留在预览中但不会写入库存流水。</li>
              <li>正式导入只允许成功一次，提交前请与财务核对汇总金额。</li>
            </ul>
          </section>

          {preview ? (
            <>
              <section className="opening-import-summary" aria-label="导入预览汇总">
                {[
                  ["物品", preview.summary.itemCount],
                  ["新建", preview.summary.newItemCount],
                  ["已有", preview.summary.existingItemCount],
                  ["盘点", preview.summary.inventoryRowCount],
                  ["写入", preview.summary.positiveRowCount],
                  ["零库存", preview.summary.zeroRowCount],
                  ["总数量", preview.summary.totalQuantity],
                  ["总金额", preview.summary.totalAmount],
                ].map(([label, value]) => (
                  <div className="panel opening-import-summary__card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </section>

              <section className="panel opening-import-issues" aria-labelledby="opening-import-issues-title">
                <div className="opening-import-section-heading">
                  <div>
                    <h2 id="opening-import-issues-title">校验问题</h2>
                    <p>错误必须修正；警告请在正式导入前逐项确认。</p>
                  </div>
                  <div className="opening-import-filter" aria-label="问题严重程度筛选">
                    {(["ALL", "ERROR", "WARNING"] as const).map((filter) => (
                      <button
                        className={issueFilter === filter ? "is-active" : ""}
                        type="button"
                        key={filter}
                        aria-pressed={issueFilter === filter}
                        onClick={() => setIssueFilter(filter)}
                      >
                        {filter === "ALL" ? "全部" : filter === "ERROR" ? "错误" : "警告"}
                      </button>
                    ))}
                  </div>
                </div>
                {filteredIssues.length === 0 ? (
                  <p className="opening-import-empty"><CheckCircle2 size={17} aria-hidden="true" />当前筛选下没有问题</p>
                ) : (
                  <ul className="opening-import-issue-list">
                    {filteredIssues.map((issue, index) => (
                      <li key={`${issue.code}-${issue.sheet ?? "global"}-${issue.row ?? "global"}-${issue.field ?? "global"}-${index}`}>
                        <span className={`opening-import-pill opening-import-pill--${issue.severity.toLowerCase()}`}>
                          {issue.severity === "ERROR" ? "错误" : "警告"}
                        </span>
                        <div>
                          {issueLocation(issue) ? <span>{issueLocation(issue)}</span> : null}
                          <strong>{issue.message}</strong>
                          <small>{issue.code}</small>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="panel opening-import-preview" aria-labelledby="opening-import-preview-title">
                <div className="opening-import-section-heading">
                  <div>
                    <h2 id="opening-import-preview-title">期初库存明细预览</h2>
                    <p>基准日期：{preview.baselineDate ?? "未识别"} · 共 {preview.rows.length} 行</p>
                  </div>
                  <FileSpreadsheet size={22} aria-hidden="true" />
                </div>
                <div className="opening-import-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Excel 行</th><th>仓库</th><th>物料</th><th>物品名称</th><th>批次号</th>
                        <th>实盘数量</th><th>确认单价</th><th>金额</th><th>说明</th><th>处理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row) => (
                        <tr key={row.sheetRow}>
                          <td>{row.sheetRow}</td><td>{row.warehouseCode}</td><td>{row.itemCode}</td>
                          <td>{row.itemName}</td><td>{row.batchNo}</td><td>{row.quantity}</td>
                          <td>{row.unitCost}</td><td>{row.amount}</td><td>{row.remark ?? "—"}</td>
                          <td><span className={`opening-import-pill opening-import-pill--${row.disposition.toLowerCase()}`}>{dispositionLabel(row.disposition)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel opening-import-confirmation" aria-labelledby="opening-import-confirmation-title">
                <div>
                  <h2 id="opening-import-confirmation-title">财务共同复核</h2>
                  <p>请依据预览汇总和源工作簿确认金额后，再执行不可重复的正式导入。</p>
                </div>
                <label>
                  <span>财务复核人</span>
                  <input
                    value={financeReviewer}
                    maxLength={100}
                    onChange={(event) => setFinanceReviewer(event.target.value)}
                    disabled={busy === "commit"}
                  />
                </label>
                <label className="opening-import-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={busy === "commit"}
                  />
                  <span>已与财务共同核对盘点数量、单价和总金额</span>
                </label>
                <div className="opening-import-confirmation__actions">
                  <button
                    className="button button--primary"
                    type="button"
                    disabled={!canCommit || busy !== null}
                    onClick={() => void submitCommit()}
                  >
                    {busy === "commit" ? "正在正式导入……" : "正式导入"}
                  </button>
                  {commitDisabledReason ? <p>{commitDisabledReason}</p> : <p>所有条件已满足，可以正式导入。</p>}
                </div>
              </section>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
