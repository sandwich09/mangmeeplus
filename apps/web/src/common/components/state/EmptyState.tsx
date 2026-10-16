'use client';

import React from 'react';
import { FolderIcon } from '../../icons';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';

export interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  locale?: SupportedLocale;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  locale = 'th',
}: EmptyStateProps) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-gray-300">
        {icon ?? <FolderIcon className="h-12 w-12" />}
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-gray-700">{title ?? t('state.empty.title', locale)}</p>
        <p className="text-sm text-gray-500">{description ?? t('state.empty.description', locale)}</p>
      </div>
      {action}
    </div>
  );
}
