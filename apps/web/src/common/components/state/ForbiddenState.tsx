'use client';

import { LockIcon } from '../../icons';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';

export interface ForbiddenStateProps {
  title?: string;
  description?: string;
  helpText?: string;
  readonly?: boolean;
  locale?: SupportedLocale;
}

export function ForbiddenState({
  title,
  description,
  helpText,
  readonly = false,
  locale = 'th',
}: ForbiddenStateProps) {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-gray-400">
        <LockIcon className="h-12 w-12" />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-gray-700">
          {readonly ? t('state.readonly.title', locale) : (title ?? t('state.forbidden.title', locale))}
        </p>
        <p className="text-sm text-gray-400">
          {readonly ? t('state.readonly.description', locale) : (description ?? t('state.forbidden.description', locale))}
        </p>
      </div>
      {!readonly && (
        <p className="text-xs text-gray-400">{helpText ?? t('state.forbidden.help', locale)}</p>
      )}
    </div>
  );
}
