import { Bell, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { ModalDialog } from "../../components/ModalDialog";
import { OPEN_NOTIFICATION_CENTER_EVENT, type NotificationTask } from "./notification-tasks";
import { useNotificationTasks } from "./use-notification-tasks";

const actionableKinds = new Set<NotificationTask["kind"]>(["PENDING_OUTBOUND", "LOW_STOCK"]);

function TaskList({ tasks }: { tasks: NotificationTask[] }) {
  return <div className="workspace-notification-list">
    {tasks.map((task) => actionableKinds.has(task.kind) ? (
      <a className="workspace-notification" key={task.id} href={task.href}>
        <strong>{task.title}</strong><p>{task.description}</p>
      </a>
    ) : (
      <article className="workspace-notification workspace-notification--desktop-only" key={task.id}>
        <strong>{task.title}</strong><p>{task.description}</p><small><Monitor size={14} />请在电脑端处理</small>
      </article>
    ))}
  </div>;
}

function Contents({ tasks, loading, error, refresh }: ReturnType<typeof useNotificationTasks>) {
  if (loading && !tasks.length) return <p className="workspace-popover__empty">正在加载任务…</p>;
  if (error) return <div className="workspace-notification-state" role="alert"><p>{error}</p><button type="button" onClick={() => void refresh()}>重新加载</button></div>;
  if (!tasks.length) return <p className="workspace-popover__empty">暂无待处理任务</p>;
  return <TaskList tasks={tasks} />;
}

export function NotificationCenter({ identityKey, role, mobile, open: controlledOpen, onOpenChange, renderTrigger = true }: { identityKey: string; role: "ADMIN" | "FINANCE"; mobile: boolean; open?: boolean; onOpenChange?(open: boolean): void; renderTrigger?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const open = mobile ? mobileOpen : (controlledOpen ?? false);
  const setOpen = (next: boolean) => mobile ? setMobileOpen(next) : onOpenChange?.(next);
  const state = useNotificationTasks({ identityKey, enabled: role === "ADMIN", open });

  useEffect(() => {
    if (!open || mobile) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobile, open]);

  useEffect(() => {
    if (!mobile || role !== "ADMIN") return;
    const handleOpen = () => setOpen(true);
    window.addEventListener(OPEN_NOTIFICATION_CENTER_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATION_CENTER_EVENT, handleOpen);
  }, [mobile, role]);

  if (role !== "ADMIN") return null;
  const label = `通知中心，${state.tasks.length} 项任务`;
  const trigger = <button
    className={mobile ? "mobile-notification-trigger" : "topbar-icon-button"}
    type="button"
    aria-label={label}
    aria-expanded={open}
    onClick={() => {
      setOpen(!open);
    }}
  ><Bell size={18} /><span>{mobile ? "通知中心" : ""}</span><strong>{state.tasks.length}</strong></button>;

  if (mobile) return <>
    {renderTrigger ? trigger : null}
    <ModalDialog open={open} title="通知与待办" onClose={() => setOpen(false)}>
      <div className="mobile-notification-center"><Contents {...state} /></div>
    </ModalDialog>
  </>;

  return <div className="topbar-panel">
    {trigger}
    {open ? <section className="workspace-popover workspace-popover--notifications" role="region" aria-label="通知与待办">
      <div className="workspace-popover__header"><strong>通知与待办</strong></div>
      <Contents {...state} />
    </section> : null}
  </div>;
}
