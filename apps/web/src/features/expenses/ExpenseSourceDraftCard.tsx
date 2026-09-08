'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { ExpenseCategorySummary, ExpenseSourceDraft } from '@watchdog-bms/contracts';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { getExpense, listExpenseCategories, updateExpenseSourceDraft } from './expenses.api';
import type { ExpenseDetail } from './expenses.model';
import {
  expenseSourceDraftChanges,
  expenseSourceDraftFormValues,
  expenseSourceDraftIssues,
  expenseSourceDraftMissingLabels,
  isExpenseSourceDraftMissing,
  type ExpenseSourceDraftFormValues,
} from './expense-source-draft.model';

const inputClass = 'mangmee-input';
const classes = (...values: Array<string | false>) => values.filter(Boolean).join(' ');

type Props = {
  companyId: string;
  expenseId: string;
  expectedUpdatedAt: string;
  sourceDraft: ExpenseSourceDraft;
  locale: SupportedLocale;
  readOnlyMessage?: string;
  onSaved: (detail: ExpenseDetail) => void;
};

export function ExpenseSourceDraftCard({ companyId, expenseId, expectedUpdatedAt, sourceDraft, locale, readOnlyMessage, onSaved }: Props) {
  const [baseline, setBaseline] = useState(() => expenseSourceDraftFormValues(sourceDraft));
  const [values, setValues] = useState(() => expenseSourceDraftFormValues(sourceDraft));
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState(false);

  useEffect(() => {
    const next = expenseSourceDraftFormValues(sourceDraft);
    setBaseline(next);
    setValues(next);
  }, [sourceDraft]);

  useEffect(() => {
    let active = true;
    setCategoryError(false);
    void listExpenseCategories(companyId)
      .then((result) => { if (active) setCategories(result.filter((category) => category.status === 'ACTIVE')); })
      .catch(() => { if (active) setCategoryError(true); });
    return () => { active = false; };
  }, [companyId]);

  const changes = useMemo(() => expenseSourceDraftChanges(baseline, values), [baseline, values]);
  const issues = useMemo(() => expenseSourceDraftIssues(values), [values]);
  const missingLabels = expenseSourceDraftMissingLabels(sourceDraft, locale);
  const hasIssue = (itemRef: string, field: 'quantity' | 'unitPrice' | 'totalAmount') => (
    issues.some((issue) => issue.itemRef === itemRef && issue.field === field)
  );
  const edit = (change: (current: ExpenseSourceDraftFormValues) => ExpenseSourceDraftFormValues) => {
    setValues(change);
    setNotice(null);
    setError(null);
  };
  const editItem = (index: number, field: keyof ExpenseSourceDraftFormValues['items'][number], value: string) => {
    edit((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? {
        ...item,
        [field]: value,
        ...(field === 'unitPrice' && value.trim() ? { totalAmount: '' } : {}),
        ...(field === 'totalAmount' && value.trim() ? { unitPrice: '' } : {}),
      } : item),
    }));
  };
  const addItem = () => edit((current) => {
    if (current.items.length >= 40) return current;
    let number = current.items.length + 1;
    while (current.items.some((item) => item.itemRef === `__web-new-${number}`)) number += 1;
    return {
      ...current,
      items: [...current.items, {
        itemRef: `__web-new-${number}`,
        description: '', quantity: '', unitPrice: '', totalAmount: '', expenseCategoryId: '',
      }],
    };
  });

  const save = async () => {
    if (!changes || issues.length > 0 || saving || !sourceDraft.canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await updateExpenseSourceDraft(companyId, expenseId, expectedUpdatedAt, changes);
      setNotice(t('expenses.source_draft_saved', locale));
      try {
        onSaved(await getExpense(companyId, expenseId));
      } catch {
        setError(t('expenses.source_draft_saved_refresh_failed', locale));
      }
    } catch (cause) {
      setError(apiErrorMessage(cause, locale));
    } finally {
      setSaving(false);
    }
  };

  const missingNote = (field: string, itemRef?: string) => isExpenseSourceDraftMissing(sourceDraft, field, itemRef)
    ? <span className="mt-1 block text-xs font-semibold text-warning-700">{t('expenses.source_draft_missing_one', locale)}</span>
    : null;

  return (
    <section aria-label={t('expenses.source_draft_region_label', locale)}>
    <div className="mangmee-card space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">{t('expenses.vendor_and_lines', locale)}</h2>
          <p className="mt-1 text-sm leading-6 text-gray-600">{t('expenses.source_draft_help', locale)}</p>
        </div>
        <span className="rounded-full bg-warning-50 px-2.5 py-1 text-xs font-bold text-warning-700">
          {t('expenses.source_draft_not_confirmed', locale)}
        </span>
      </div>

      {missingLabels.length > 0 && (
        <details className="rounded-xl border border-warning-200 bg-warning-50 p-3">
          <summary className="cursor-pointer text-sm font-bold text-warning-800">{t('expenses.source_draft_missing_title', locale)} ({missingLabels.length})</summary>
          <ul className="mt-2 grid gap-1 text-sm text-warning-800 sm:grid-cols-2">
            {missingLabels.map((label, index) => <li key={`${sourceDraft.missingFields[index]?.id ?? index}`} className="flex gap-2"><span aria-hidden>•</span><span>{label}</span></li>)}
          </ul>
        </details>
      )}

      {!sourceDraft.canEdit && (
        <p className="rounded-xl bg-gray-50 p-3 text-sm text-gray-600">{readOnlyMessage ?? t('expenses.source_draft_read_only', locale)}</p>
      )}

      <fieldset disabled={!sourceDraft.canEdit || saving} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700">
            {t('expenses.expense_date', locale)}
            <input
              type="date"
              aria-label={t('expenses.expense_date', locale)}
              value={values.expenseDate ?? ''}
              onChange={(event) => edit((current) => ({ ...current, expenseDate: event.target.value || null }))}
              className={classes(inputClass, 'mt-1')}
            />
            {missingNote('expenseDate')}
          </label>
          <label className="block text-sm font-medium text-gray-700">
            {t('expenses.vendor_name', locale)}
            <input
              aria-label={t('expenses.vendor_name', locale)}
              className={classes(inputClass, 'mt-1')}
              value={values.vendorName ?? ''}
              onChange={(event) => edit((current) => ({ ...current, vendorName: event.target.value }))}
            />
            {missingNote('vendorName')}
          </label>
          <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
            {t('expenses.source_draft_business_purpose', locale)}
            <textarea
              aria-label={t('expenses.source_draft_business_purpose', locale)}
              className={classes(inputClass, 'mt-1 min-h-20 resize-y')}
              rows={2}
              value={values.businessPurpose ?? ''}
              onChange={(event) => edit((current) => ({ ...current, businessPurpose: event.target.value }))}
            />
            {missingNote('businessPurpose')}
          </label>
        </div>

        <div>
          <div className="text-sm font-bold text-gray-800">{t('expenses.source_draft_items_title', locale)}</div>
          <div className="mt-2 space-y-3">
            {values.items.map((item, index) => (
              <section key={item.itemRef} data-source-draft-item aria-labelledby={`source-draft-item-${index}`} className="rounded-xl border border-gray-200 p-3">
                <h3 id={`source-draft-item-${index}`} className="text-sm font-bold text-gray-800">{t('expenses.source_draft_item_n', locale).replace('{n}', String(index + 1))}</h3>
                <p className="mt-1 text-xs text-gray-500">{t('expenses.source_draft_price_help', locale)}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-3">
                    {t('expenses.line_description', locale)}
                    <textarea aria-label={`${t('expenses.source_draft_item_n', locale).replace('{n}', String(index + 1))} ${t('expenses.line_description', locale)}`} className={classes(inputClass, 'mt-1 resize-y')} rows={2} value={item.description}
                      onChange={(event) => editItem(index, 'description', event.target.value)} />
                    {missingNote('description', item.itemRef)}
                  </label>
                  {(['quantity', 'unitPrice', 'totalAmount'] as const).map((field) => {
                    const labels = {
                      quantity: 'expenses.line_quantity',
                      unitPrice: 'expenses.line_unit_price',
                      totalAmount: 'expenses.source_draft_total_amount',
                    } as const;
                    const invalid = hasIssue(item.itemRef, field);
                    return (
                      <label key={field} className="block text-sm font-medium text-gray-700">
                        {t(labels[field], locale)}
                        <input
                          className={classes(inputClass, 'mt-1', invalid && 'border-error-500')}
                          inputMode="decimal"
                          aria-label={`${t('expenses.source_draft_item_n', locale).replace('{n}', String(index + 1))} ${t(labels[field], locale)}`}
                          value={item[field]}
                          aria-invalid={invalid || undefined}
                          placeholder={t('expenses.source_draft_unknown', locale)}
                          onChange={(event) => editItem(index, field, event.target.value)}
                        />
                        {invalid
                          ? <span className="mt-1 block text-xs font-semibold text-error-700">{t(field === 'quantity' ? 'expenses.source_draft_invalid_quantity' : 'expenses.source_draft_invalid_number', locale)}</span>
                          : missingNote(field, item.itemRef)}
                      </label>
                    );
                  })}
                  <label className="block text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-3">
                    {t('expenses.category', locale)}
                    <ThemedSelect value={item.expenseCategoryId} className={classes(inputClass, 'mt-1')}
                      disabled={!sourceDraft.canEdit || saving}
                      aria-label={`${t('expenses.source_draft_item_n', locale).replace('{n}', String(index + 1))} ${t('expenses.category', locale)}`}
                      onChange={(event) => editItem(index, 'expenseCategoryId', event.target.value)}>
                      <option value="">{t('expenses.category_unspecified', locale)}</option>
                      {item.expenseCategoryId && !categories.some((category) => category.id === item.expenseCategoryId) && (
                        <option value={item.expenseCategoryId}>{t('expenses.source_draft_saved_category', locale)}</option>
                      )}
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </ThemedSelect>
                    {missingNote('expenseCategoryId', item.itemRef)}
                  </label>
                </div>
              </section>
            ))}
          </div>
          {sourceDraft.canEdit && (
            <button type="button" className="mangmee-btn mangmee-btn-secondary mt-3"
              disabled={saving || values.items.length >= 40} onClick={addItem}>
              {t('expenses.add_line', locale)}
            </button>
          )}
        </div>
      </fieldset>

      {categoryError && <p className="text-xs font-semibold text-warning-700">{t('expenses.source_draft_category_error', locale)}</p>}
      {error && <div role="alert" className="rounded-xl border border-error-200 bg-error-50 p-3 text-sm font-semibold text-error-700">{error}</div>}
      {notice && <p role="status" className="rounded-xl bg-success-50 p-3 text-sm font-bold text-success-700">{notice}</p>}
      {sourceDraft.canEdit && (
        <button type="button" className="mangmee-btn mangmee-btn-primary w-full sm:w-auto"
          disabled={!changes || issues.length > 0 || saving} onClick={() => void save()}>
          {saving ? t('expenses.source_draft_saving', locale) : t('expenses.source_draft_save', locale)}
        </button>
      )}
    </div>
    </section>
  );
}
