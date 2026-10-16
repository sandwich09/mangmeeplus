'use client';
import { createContext, useContext, type ReactNode } from 'react';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { MangmeePage } from '@/common/components/mangmee';

export const BillingWorkspaceContext = createContext(false);

export default function BillingCustomerFrame({ title, description, backHref, backLabel, actions, children, showBackInWorkspace = false, eyebrow = 'ตั้งค่าร้าน', onBack }: {
  title: string; description: string; backHref: string; backLabel: string; actions?: ReactNode; children: ReactNode; showBackInWorkspace?: boolean; eyebrow?: string; onBack?: () => void;
}) {
  const inWorkspace = useContext(BillingWorkspaceContext);
  const back = onBack ? <button className="mangmee-btn mangmee-btn-secondary" onClick={onBack}>{backLabel}</button> : <a className="mangmee-btn mangmee-btn-secondary" href={backHref}>{backLabel}</a>;
  if (inWorkspace) return <MangmeePage eyebrow={eyebrow} title={title} description={description} actions={<>{showBackInWorkspace && back}{actions}</>}>{children}</MangmeePage>;
  return <div className="min-h-dvh bg-gray-50">
    <header className="border-b border-gray-200 bg-white">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <div className="flex items-center gap-3"><MangmeeLogo size={36} /><span className="text-xl font-bold text-gray-900">มั่ง<span className="text-brand-700">มี</span></span></div>
        {/* Full navigation rechecks company/session gates when leaving recovery. */}
        {back}
      </div>
    </header>
    <main className="w-full px-4 py-6 sm:px-8 sm:py-8">
      <MangmeePage eyebrow={eyebrow} title={title} description={description} actions={actions}>{children}</MangmeePage>
    </main>
  </div>;
}
