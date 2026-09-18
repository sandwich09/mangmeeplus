'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ExpenseCaptureGroupListItemDto, ExpenseCaptureGroupStatus } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx, type MangmeeTone } from '@/common/components/mangmee';
import { ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { listExpenseCaptureGroups } from '../expenses.api';
import { ghostClass } from '../ExpensesUi';
import { captureText } from './expense-capture-review.logic';

/**
 * "งานรับหลักฐาน" — the capture jobs, which are deliberately NOT in the expense list (appendix §5):
 * a group is evidence being sorted out, not money that happened. It gets its own list so nothing
 * that has not been reviewed can be mistaken for a record in the books.
 */

const STATUS_LABELS: Record<ExpenseCaptureGroupStatus, DictionaryKey> = {
  OPEN: 'expenses.capture.status_open',
  HANDED_OFF: 'expenses.capture.status_handed_off',
  CLOSED_NO_HANDOFF: 'expenses.capture.status_closed_no_handoff',
  CANCELLED: 'expenses.capture.status_cancelled',
};

const STATUS_TONES: Record<ExpenseCaptureGroupStatus, MangmeeTone> = {
  OPEN: 'brand', HANDED_OFF: 'teal', CLOSED_NO_HANDOFF: 'slate', CANCELLED: 'amber',
};

export function ExpenseCaptureListPage({ companyId }: { companyId: string }) {
  const locale = useWorkspaceLocale();
  const [groups, setGroups] = useState<ExpenseCaptureGroupListItemDto[]>([]);
  const [status, setStatus] = useState<ExpenseCaptureGroupStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listExpenseCaptureGroups(companyId, status ? { status } : undefined);
      setGroups(result.items);
      setError(null);
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }, [companyId, status]);

  useEffect(() => { void load(); }, [load]);

  const backLink = (
    <Link href={`/companies/${companyId}/expenses`}>← {t('expenses.capture.back_to_expenses', locale)}</Link>
  );
  const chips: Array<{ key: ExpenseCaptureGroupStatus | ''; label: string }> = [
    { key: '', label: t('expenses.capture.list_filter_all', locale) },
    { key: 'OPEN', label: t('expenses.capture.status_open', locale) },
    { key: 'HANDED_OFF', label: t('expenses.capture.status_handed_off', locale) },
    { key: 'CLOSED_NO_HANDOFF', label: t('expenses.capture.status_closed_no_handoff', locale) },
  ];

  return (
    <MangmeePage
      eyebrow={backLink}
      title={t('expenses.capture.list_title', locale)}
      description={t('expenses.capture.list_description', locale)}
    >
      <div className="flex flex-col gap-4 text-lg leading-8 text-gray-800">
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button key={chip.key || 'all'} type="button" aria-pressed={status === chip.key}
              className={cx(ghostClass, 'min-h-11', status === chip.key && 'border-brand-500 text-brand-800')}
              onClick={() => setStatus(chip.key)}>
              {chip.label}
            </button>
          ))}
        </div>
        {loading && <LoadingState label={t('expenses.loading', locale)} />}
        {!loading && error !== null
          ? ((error as { status?: number }).status === 403 || apiErrorCode(error) === 'FORBIDDEN'
            ? <ForbiddenState locale={locale} />
            : <ErrorState locale={locale} description={apiErrorMessage(error)} onRetry={() => void load()} />)
          : null}
        {!loading && !error && groups.length === 0 && (
          <p className="text-base leading-7 text-gray-500">{t('expenses.capture.list_empty', locale)}</p>
        )}
        {!loading && !error && groups.map((group) => (
          <MangmeeCard key={group.groupId} className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <MangmeeBadge tone={STATUS_TONES[group.status]}>{t(STATUS_LABELS[group.status], locale)}</MangmeeBadge>
              <span className="text-sm text-gray-500">{formatThaiDateTime(group.updatedAt)}</span>
            </div>
            <p className="mt-2 text-base leading-7 text-gray-800">
              {captureText(t('expenses.capture.list_files', locale), {
                files: String(group.fileCount), read: String(group.filesRead),
              })}
            </p>
            <Link className={cx(ghostClass, 'mt-3 inline-flex min-h-11 items-center justify-center')}
              href={group.webPath || `/companies/${companyId}/expenses/capture/${group.groupId}`}>
              {t('expenses.capture.list_open', locale)}
            </Link>
          </MangmeeCard>
        ))}
      </div>
    </MangmeePage>
  );
}
