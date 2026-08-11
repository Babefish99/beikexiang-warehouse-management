import type { ReactNode } from "react";

export type DashboardIconProps = {
  size?: number;
  className?: string;
};

function DashboardIcon({ size = 22, className, children }: DashboardIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {children}
    </svg>
  );
}

export function InventoryMark(props: DashboardIconProps) {
  return (
    <DashboardIcon {...props}>
      <path d="M4 3.5h2v16H4zM18 3.5h2v16h-2zM3 19.5h18v2H3zM5 10h14v1.7H5z" fill="currentColor" />
      <rect fill="currentColor" height="4.8" rx=".8" width="4.4" x="7" y="5" />
      <path d="M8.3 5v1h1.8V5M13 13h4.4v4.8H13zM14.2 13v1h1.8v-1" fill="currentColor" />
    </DashboardIcon>
  );
}

export function ApprovalMark(props: DashboardIconProps) {
  return (
    <DashboardIcon {...props}>
      <path d="M8 3.5h8a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2h1v-1a2 2 0 0 1 2-2Z" fill="currentColor" />
      <path d="M8 5.5h8v3H8z" fill="#fff" />
      <circle cx="16.8" cy="16.5" fill="currentColor" r="4.5" />
      <path d="m14.7 16.5 1.4 1.4 2.9-3" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </DashboardIcon>
  );
}

export function InboundMark(props: DashboardIconProps) {
  return (
    <DashboardIcon {...props}>
      <path d="M4 9.7 12 6l8 3.7v8.1a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 17.8z" fill="currentColor" />
      <path d="m4.5 9.8 7.5 3.3 7.5-3.3M12 13.1v6.1" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M12 2.5v6M9.5 6l2.5 2.5L14.5 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </DashboardIcon>
  );
}

export function OutboundMark(props: DashboardIconProps) {
  return (
    <DashboardIcon {...props}>
      <path d="M4 9.7 12 6l8 3.7v8.1a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 17.8z" fill="currentColor" />
      <path d="m4.5 9.8 7.5 3.3 7.5-3.3M12 13.1v6.1" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M12 8.5v-6M9.5 5l2.5-2.5L14.5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </DashboardIcon>
  );
}
