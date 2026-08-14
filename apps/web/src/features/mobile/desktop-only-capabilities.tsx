import { Monitor } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";

type DesktopOnlyCapability = {
  label: string;
  description: string;
};

const desktopOnlyCapabilities: Record<string, DesktopOnlyCapability> = {
  "/admin/items": { label: "标准物品库", description: "物品主数据维护需要在电脑端完成。" },
  "/admin/warehouses": { label: "仓库设置", description: "仓库主数据维护需要在电脑端完成。" },
  "/admin/opening-stock": { label: "期初库存", description: "期初库存初始化需要在电脑端完成。" },
  "/admin/transfers": { label: "仓库调拨", description: "跨仓调拨需要在电脑端完成。" },
  "/admin/returns": { label: "办理退库", description: "关联原出库记录的退库操作需要在电脑端完成。" },
  "/admin/stocktake": { label: "月度盘点", description: "盘点与差异调整需要在电脑端完成。" },
  "/admin/period-close": { label: "月度结账", description: "月末核对与结账需要在电脑端完成。" },
};

export function getDesktopOnlyCapability(pathname: string): DesktopOnlyCapability | null {
  return desktopOnlyCapabilities[pathname] ?? null;
}

export function DesktopOnlyCapabilityNotice({ capability }: { capability: DesktopOnlyCapability }) {
  return <div className="page">
    <PageHeader title="请在电脑端处理" description={`${capability.label}暂不提供手机操作表单。`} />
    <section className="panel">
      <div className="notice">
        <Monitor size={24} color="var(--orange)" />
        <strong>{capability.label}</strong>
        <p>{capability.description}手机端不会加载对应业务数据或提交控件。</p>
      </div>
    </section>
  </div>;
}
