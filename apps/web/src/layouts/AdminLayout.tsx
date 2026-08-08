import type { ReactNode } from "react";
import { AppShell, type WarehouseOption, type WorkspaceUser } from "../components/AppShell";

export type { WarehouseOption, WorkspaceUser };

export function AdminLayout({
  children,
  user,
  warehouses,
  selectedWarehouseId,
  onSelectWarehouse,
}: {
  children: ReactNode;
  user: WorkspaceUser;
  warehouses: WarehouseOption[];
  selectedWarehouseId: string;
  onSelectWarehouse(warehouseId: string): void;
}) {
  return (
    <AppShell
      user={user}
      warehouses={warehouses}
      selectedWarehouseId={selectedWarehouseId}
      onSelectWarehouse={onSelectWarehouse}
    >
      {children}
    </AppShell>
  );
}
