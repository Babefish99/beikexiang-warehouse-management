import { ModalDialog } from "../../components/ModalDialog";
import type { WorkspaceUser } from "../../components/AppShell";
import { Bell } from "lucide-react";
import { OPEN_NOTIFICATION_CENTER_EVENT } from "../notifications/notification-tasks";
import { useNotificationTaskSnapshot } from "../notifications/use-notification-tasks";

export function MobileMoreSheet({
  open,
  user,
  loginChannel,
  onClose,
}: {
  open: boolean;
  user: WorkspaceUser;
  loginChannel: string;
  onClose(): void;
}) {
  const notificationSnapshot = useNotificationTaskSnapshot();
  return (
    <ModalDialog open={open} title="更多功能" onClose={onClose}>
      <div className="mobile-more-sheet">
        {user.role === "ADMIN" ? <button className="mobile-notification-trigger" type="button" aria-label={`通知中心，${notificationSnapshot.tasks.length} 项任务`} onClick={() => {
          onClose();
          window.dispatchEvent(new Event(OPEN_NOTIFICATION_CENTER_EVENT));
        }}><Bell size={18} /><span>通知中心</span><strong>{notificationSnapshot.tasks.length}</strong></button> : null}
        <dl className="mobile-more-sheet__account">
          <div><dt>用户</dt><dd>{user.name}</dd></div>
          <div><dt>角色</dt><dd>{user.roleLabel}</dd></div>
          <div><dt>登录渠道</dt><dd>{loginChannel}</dd></div>
        </dl>
        <p>调拨、盘点、月结、主数据维护请在电脑端处理。</p>
      </div>
    </ModalDialog>
  );
}
