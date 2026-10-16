'use client';

import { AlertIcon } from '../../icons';
import { Button } from '../button/Button';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  requestId?: string;
  locale?: SupportedLocale;
}

export function ErrorState({
  title,
  description,
  onRetry,
  requestId,
  locale = 'th',
}: ErrorStateProps) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-red-400">
        <AlertIcon className="h-12 w-12" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-gray-700">{title ?? t('state.error.title', locale)}</p>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      {onRetry && (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t('state.error.retry', locale)}
        </Button>
      )}
      {requestId && (
        <p className="text-xs text-gray-500 font-mono">{t('common.request_id', locale)}: <span className="mangmee-unit">{requestId}</span></p>
      )}
    </div>
  );
}
