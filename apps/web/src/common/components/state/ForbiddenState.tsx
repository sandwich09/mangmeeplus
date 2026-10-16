'use client';

import type { ReactNode } from 'react';
import { LockIcon } from '../../icons';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';

export interface ForbiddenStateProps {
  packageAvailable?: boolean;
  isOwner?: boolean;
  title?: string;
  description?: string;
  helpText?: string;
  /** The way out: one button or link to a place the person may use (thai-ux-standard §1.6). */
  action?: ReactNode;
  /**
   * `h1` when this state is the whole page, so the page still has its one heading (thai-ux-standard §3.1).
   * Default `p`: the state sits inside a page that has its own title.
   */
  titleAs?: 'p' | 'h1' | 'h2';
  locale?: SupportedLocale;
}

export function ForbiddenState({
  title,
  packageAvailable,
  isOwner,
  description,
  helpText,
  action,
  titleAs: Title = 'p',
  locale = 'th',
}: ForbiddenStateProps) {
  const shownDescription = packageAvailable === false ? '' : description ?? t('state.forbidden.description', locale);
  const shownHelp = packageAvailable === false ? '' : helpText ?? (isOwner ? 'เพิ่มสิทธิ์ได้ที่ พนักงานและสิทธิ์' : t('state.forbidden.help', locale));
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-gray-400">
        <LockIcon className="h-12 w-12" />
      </span>
      <div className="flex flex-col gap-1">
        <Title className={Title === 'p' ? 'text-sm font-semibold text-gray-700' : 'text-lg font-bold text-gray-900'}>
          {packageAvailable === false ? 'แพ็กเกจของร้านยังไม่มีหน้านี้' : title ?? t('state.forbidden.title', locale)}
        </Title>
        {/* A line passed as '' is left out, so it leaves no empty row (and no double gap above the action). */}
        {shownDescription && <p className="text-sm text-gray-500">{shownDescription}</p>}
      </div>
      {shownHelp && <p className="text-sm text-gray-500">{shownHelp}</p>}
      {action}
    </div>
  );
}
