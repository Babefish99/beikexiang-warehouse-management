import type { ReactNode } from "react";
import { AppShell } from "../components/AppShell";

export interface AdminLayoutUser {
  name: string;
  roleLabel: string;
}

export function AdminLayout({ children, user }: { children: ReactNode; user: AdminLayoutUser }) {
  return <AppShell>{children}<span className="sr-only">当前登录：{user.name}（{user.roleLabel}）</span></AppShell>;
}
