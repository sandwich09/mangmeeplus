import type { ReactNode } from 'react';
import { cx, mangmeeToneClass, type MangmeeTone } from './mangmee-design';

type PageProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function MangmeePage({ eyebrow, title, description, actions, meta, children, className }: PageProps) {
  return (
    <div className={cx('mangmee-page', className)}>
      <div className="mangmee-page-header">
        <div className="min-w-0">
          {eyebrow && <div className="mangmee-eyebrow">{eyebrow}</div>}
          <h1 className="mangmee-page-title">{title}</h1>
          {description && <p className="mangmee-page-description">{description}</p>}
        </div>
        {(actions || meta) && (
          <div className="mangmee-page-actions">
            {meta}
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export function MangmeeCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('mangmee-card', className)}>{children}</section>;
}

// Required by design (spec R2): a shared chip that silently defaults would caption a company-wide
// page with a branch scope it does not have. Every call site declares its own intent.
export function MangmeeBranchChip({ label }: { label: ReactNode }) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full border border-brand-100 bg-brand-25 px-3 text-sm font-bold text-brand-700">
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4.75 10.25h14.5M6.25 10.25v8h11.5v-8M7.25 10.25V6.75h9.5v3.5"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </span>
  );
}

export function MangmeeMutedCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cx('mangmee-card mangmee-card-muted', className)}>{children}</section>;
}

export function MangmeeIconFrame({
  tone = 'brand',
  children,
  className,
}: {
  tone?: MangmeeTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx('mangmee-icon-frame', mangmeeToneClass[tone].icon, className)}>{children}</span>;
}

export function MangmeeBadge({
  tone = 'brand',
  children,
  className,
}: {
  tone?: MangmeeTone;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx('mangmee-badge', mangmeeToneClass[tone].badge, className)}>{children}</span>;
}

export function MangmeeStatCard({
  icon,
  label,
  value,
  tone = 'brand',
  sub,
}: {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  tone?: MangmeeTone;
  sub?: ReactNode;
}) {
  return (
    <MangmeeCard className="mangmee-stat-card">
      {icon && <MangmeeIconFrame tone={tone}>{icon}</MangmeeIconFrame>}
      <div className="min-w-0">
        <div className="mangmee-stat-label">{label}</div>
        <div className="mangmee-stat-value">{value}</div>
        {sub && <div className="mangmee-stat-sub">{sub}</div>}
      </div>
    </MangmeeCard>
  );
}
