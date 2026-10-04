import type { ComponentProps, ReactNode } from 'react';
import { MangmeeCard, MangmeeStatCard } from '@/common/components/mangmee';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';

// Scoped to report/account pages; the app's other dashboards keep their own density.
export const EXECUTIVE_PAGE_CLASS = 'min-w-0 [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:min-w-11 [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-offset-2 [&_button]:focus-visible:outline-brand-700 [&_.mangmee-page-header]:relative [&_.mangmee-page-header]:pb-5 [&_.mangmee-page-header]:after:absolute [&_.mangmee-page-header]:after:inset-x-0 [&_.mangmee-page-header]:after:bottom-0 [&_.mangmee-page-header]:after:h-px [&_.mangmee-page-header]:after:bg-linear-to-r [&_.mangmee-page-header]:after:from-gold-500 [&_.mangmee-page-header]:after:to-transparent [&_.mangmee-page-title]:text-brand-800 [&_.mangmee-page-description]:text-base [&_.mangmee-stat-card]:h-full [&_.mangmee-stat-card]:flex-col [&_.mangmee-stat-card]:items-start [&_.mangmee-stat-card]:gap-3 [&_.mangmee-stat-card]:p-4 md:[&_.mangmee-stat-card]:p-5 [&_.mangmee-icon-frame]:shrink-0 [&_.mangmee-icon-frame]:rounded-full [&_.mangmee-stat-label]:text-sm [&_.mangmee-stat-label]:text-gray-700 [&_.mangmee-stat-value]:text-3xl md:[&_.mangmee-stat-value]:text-4xl [&_.mangmee-stat-value]:tabular-nums [&_.mangmee-stat-sub]:text-sm [&_.mangmee-stat-sub]:text-gray-600';

export function ExecutiveSectionCard({ title, children, actions, className = '' }: { title: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <MangmeeCard className={`min-w-0 space-y-4 p-4 sm:p-5 ${className}`}>
    <header className="flex min-w-0 flex-wrap items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-3 text-lg font-semibold text-brand-800"><span aria-hidden="true" className="h-6 w-1 shrink-0 rounded-full bg-brand-600" />{title}</h2>{actions}
    </header>{children}
  </MangmeeCard>;
}

export function ExecutiveKpi({ iconName = 'chart', ...props }: Omit<ComponentProps<typeof MangmeeStatCard>, 'icon'> & { iconName?: string }) {
  const Icon = DesignIcons[iconName];
  return <MangmeeStatCard {...props} icon={<Icon className="size-5" />} />;
}
