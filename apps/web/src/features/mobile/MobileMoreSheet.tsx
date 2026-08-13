import { ModalDialog } from "../../components/ModalDialog";
import type { WorkspaceUser } from "../../components/AppShell";

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
  return (
    <ModalDialog open={open} title="更多功能" onClose={onClose}>
      <div className="mobile-more-sheet">
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
