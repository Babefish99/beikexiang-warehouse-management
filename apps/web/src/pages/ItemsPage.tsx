import { type FormEvent, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { PageHeader } from "../components/PageHeader";

type ItemRow = {
  id: string;
  code: string;
  name: string;
  specification?: string;
  unit: string;
  categoryId: string;
  weComOptionKey?: string;
  minimumStock?: string;
  isActive: boolean;
};

type ItemFormState = {
  code: string;
  categoryPrefix: string;
  name: string;
  specification: string;
  unit: string;
  categoryId: string;
  weComOptionKey: string;
  minimumStock: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const emptyForm = (): ItemFormState => ({
  code: "",
  categoryPrefix: "",
  name: "",
  specification: "",
  unit: "",
  categoryId: "",
  weComOptionKey: "",
  minimumStock: "",
});

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return payload?.message ?? payload?.error ?? "请求失败";
}

function toFormState(item: ItemRow): ItemFormState {
  return {
    code: item.code,
    categoryPrefix: item.code.split("-")[0] ?? "",
    name: item.name,
    specification: item.specification ?? "",
    unit: item.unit,
    categoryId: item.categoryId,
    weComOptionKey: item.weComOptionKey ?? "",
    minimumStock: item.minimumStock ?? "",
  };
}

function toPayload(form: ItemFormState) {
  return {
    code: form.code,
    categoryPrefix: form.categoryPrefix,
    name: form.name,
    specification: form.specification || undefined,
    unit: form.unit,
    categoryId: form.categoryId,
    weComOptionKey: form.weComOptionKey || undefined,
    minimumStock: form.minimumStock || undefined,
  };
}

export function ItemsPage() {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get("search")?.trim() ?? "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<ItemFormState>(emptyForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ItemFormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/items?includeInactive=true`, { credentials: "include" });
      if (!response.ok) throw new Error(await readError(response));
      setItems(await response.json() as ItemRow[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "物品列表加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, []);

  const filteredItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return keyword ? items.filter((item) => [item.code, item.name, item.specification, item.weComOptionKey].some((value) => value?.toLowerCase().includes(keyword))) : items;
  }, [items, search]);

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/items`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(createForm)),
      });
      if (!response.ok) throw new Error(await readError(response));
      setMessage("物品已新增");
      setCreateForm(emptyForm());
      await loadItems();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "物品保存失败");
    } finally {
      setSubmitting(false);
    }
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingItemId) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/items/${editingItemId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(toPayload(editForm)),
      });
      if (!response.ok) throw new Error(await readError(response));
      setMessage("物品已更新");
      setEditingItemId(null);
      await loadItems();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "物品更新失败");
    } finally {
      setSubmitting(false);
    }
  };

  const deactivateItem = async (itemId: string) => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`${apiBaseUrl}/admin/items/${itemId}/deactivate`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readError(response));
      setMessage("物品已停用");
      if (editingItemId === itemId) setEditingItemId(null);
      await loadItems();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "物品停用失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="标准物品库"
        description="管理员维护标准物品、企业微信选项映射和启停状态。"
        actions={<button className="button button--secondary" type="button" onClick={() => void loadItems()}><RefreshCw size={15} />刷新</button>}
      />
      <section className="panel form-panel master-data-form-panel">
        <header className="panel__header">
          <div>
            <strong>新增物品</strong>
            <small>优先复用已有物品编码；失败时保留输入。</small>
          </div>
        </header>
        <form className="form-grid" onSubmit={submitCreate}>
          <label><span>编码</span><input required value={createForm.code} onChange={(event) => setCreateForm({ ...createForm, code: event.target.value })} /></label>
          <label><span>分类前缀</span><input value={createForm.categoryPrefix} onChange={(event) => setCreateForm({ ...createForm, categoryPrefix: event.target.value })} /></label>
          <label><span>名称</span><input required value={createForm.name} onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })} /></label>
          <label><span>规格</span><input value={createForm.specification} onChange={(event) => setCreateForm({ ...createForm, specification: event.target.value })} /></label>
          <label><span>单位</span><input required value={createForm.unit} onChange={(event) => setCreateForm({ ...createForm, unit: event.target.value })} /></label>
          <label><span>分类</span><input required value={createForm.categoryId} onChange={(event) => setCreateForm({ ...createForm, categoryId: event.target.value })} /></label>
          <label><span>企业微信选项 key</span><input value={createForm.weComOptionKey} onChange={(event) => setCreateForm({ ...createForm, weComOptionKey: event.target.value })} /></label>
          <label><span>最低库存</span><input value={createForm.minimumStock} onChange={(event) => setCreateForm({ ...createForm, minimumStock: event.target.value })} /></label>
          <div className="form-grid__wide form-actions">
            <button className="button button--primary" type="submit" disabled={submitting}>新增物品</button>
          </div>
        </form>
      </section>

      {editingItemId ? (
        <section className="panel form-panel master-data-form-panel">
          <header className="panel__header">
            <div>
              <strong>编辑物品</strong>
              <small>有库存流水后，物品编码不可变。</small>
            </div>
          </header>
          <form className="form-grid" onSubmit={submitEdit}>
            <label><span>编码</span><input required value={editForm.code} onChange={(event) => setEditForm({ ...editForm, code: event.target.value })} /></label>
            <label><span>分类前缀</span><input value={editForm.categoryPrefix} onChange={(event) => setEditForm({ ...editForm, categoryPrefix: event.target.value })} /></label>
            <label><span>名称</span><input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
            <label><span>规格</span><input value={editForm.specification} onChange={(event) => setEditForm({ ...editForm, specification: event.target.value })} /></label>
            <label><span>单位</span><input required value={editForm.unit} onChange={(event) => setEditForm({ ...editForm, unit: event.target.value })} /></label>
            <label><span>分类</span><input required value={editForm.categoryId} onChange={(event) => setEditForm({ ...editForm, categoryId: event.target.value })} /></label>
            <label><span>企业微信选项 key</span><input value={editForm.weComOptionKey} onChange={(event) => setEditForm({ ...editForm, weComOptionKey: event.target.value })} /></label>
            <label><span>最低库存</span><input value={editForm.minimumStock} onChange={(event) => setEditForm({ ...editForm, minimumStock: event.target.value })} /></label>
            <div className="form-grid__wide form-actions form-actions--split">
              <button className="button button--secondary" type="button" onClick={() => setEditingItemId(null)}>取消</button>
              <button className="button button--primary" type="submit" disabled={submitting}>保存修改</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel master-data-panel">
        <div className="master-data-toolbar">
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label="物品搜索"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索编码、名称或选项 key"
            />
          </label>
          <span className="toolbar-count">共 {filteredItems.length} 项</span>
        </div>
        {message ? <div className="success-notice">{message}</div> : null}
        {error ? <div className="form-error">{error}</div> : null}
        {loading ? <div className="notice">正在加载物品……</div> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编码</th>
                  <th>物品名称</th>
                  <th>规格</th>
                  <th>单位</th>
                  <th>企业微信选项 key</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td><strong>{item.name}</strong></td>
                    <td>{item.specification || "—"}</td>
                    <td>{item.unit}</td>
                    <td>{item.weComOptionKey || "—"}</td>
                    <td><span className={`status-pill ${item.isActive ? "status-pill--active" : ""}`}>{item.isActive ? "启用" : "停用"}</span></td>
                    <td>
                      <div className="table-actions">
                        <button
                          className="button button--secondary button--small"
                          type="button"
                          onClick={() => {
                            setEditingItemId(item.id);
                            setEditForm(toFormState(item));
                            setError(null);
                            setMessage(null);
                          }}
                        >
                          编辑 {item.name}
                        </button>
                        <button
                          className="button button--secondary button--small"
                          type="button"
                          disabled={!item.isActive || submitting}
                          onClick={() => void deactivateItem(item.id)}
                        >
                          停用
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
