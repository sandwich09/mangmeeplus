'use client';

import type { BuyerEntityKind } from '@watchdog-bms/contracts';
import { SelectField, TextField, TextareaField } from '@/common/components/field';
import { cx } from '@/common/components/mangmee';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { inputClass } from '@/features/expenses/ExpensesUi';
import { counterpartyBranchCodeDigits } from './counterparties.logic';
import type { CounterpartyFormIssue, CounterpartyFormValues } from './counterparties.model';

type GroupProps = {
  values: CounterpartyFormValues;
  onChange: (next: Partial<CounterpartyFormValues>) => void;
  disabled: boolean;
  issue: CounterpartyFormIssue | null;
};

function issueFor(issue: CounterpartyFormIssue | null, field: keyof CounterpartyFormValues, locale: SupportedLocale): string | undefined {
  return issue?.field === field ? t(issue.messageKey, locale) : undefined;
}

/**
 * §11.1 identity block. There is deliberately no customer/vendor/both control: `type` is server
 * owned (A5) and the screen shows usage badges counted from real documents instead.
 */
export function CounterpartyIdentityFields({ values, onChange, disabled, issue, allowUnspecifiedEntityKind }: GroupProps & {
  /** Mirrors the review page's payee-kind control: the blank option exists only while nothing is stored. */
  allowUnspecifiedEntityKind: boolean;
}) {
  const locale = useWorkspaceLocale();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField
        label={t('counterparties.display_name', locale)}
        name="counterparty-display-name"
        value={values.displayName}
        error={issueFor(issue, 'displayName', locale)}
        disabled={disabled}
        onChange={(event) => onChange({ displayName: event.target.value })}
      />
      <TextField
        label={t('counterparties.legal_name', locale)}
        name="counterparty-legal-name"
        value={values.legalName}
        disabled={disabled}
        onChange={(event) => onChange({ legalName: event.target.value })}
      />
      <TextField
        label={t('counterparties.tax_id', locale)}
        name="counterparty-tax-id"
        inputMode="numeric"
        value={values.taxId}
        disabled={disabled}
        onChange={(event) => onChange({ taxId: event.target.value })}
      />
      <SelectField
        label={t('counterparties.entity_kind', locale)}
        name="counterparty-entity-kind"
        hint={t('counterparties.entity_kind_hint', locale)}
        value={values.entityKind}
        disabled={disabled}
        onChange={(event) => onChange({ entityKind: event.target.value as BuyerEntityKind | '' })}
      >
        {allowUnspecifiedEntityKind && <option value="">{t('counterparties.entity_kind_unspecified', locale)}</option>}
        <option value="JURISTIC">{t('counterparties.entity_kind_juristic', locale)}</option>
        <option value="INDIVIDUAL">{t('counterparties.entity_kind_individual', locale)}</option>
      </SelectField>
      <CounterpartyBranchField values={values} onChange={onChange} disabled={disabled} issue={issue} />
    </div>
  );
}

/**
 * A6/CON-8: สำนักงานใหญ่ / สาขา plus the code the document prints, never a dropdown of registry
 * branches. `isBranch` is local state because a blank code means both "head office" and "branch,
 * nothing typed yet", so the choice cannot be read back off the stored value.
 */
function CounterpartyBranchField({ values, onChange, disabled, issue }: GroupProps) {
  const locale = useWorkspaceLocale();
  const branchIssue = issueFor(issue, 'branchCode', locale);
  return (
    <div className="flex flex-col gap-1.5 text-sm font-medium text-gray-700 sm:col-span-2">
      {t('counterparties.branch', locale)}
      <div className="flex flex-wrap items-start gap-2">
        <div className="mangmee-segmented shrink-0" role="group" aria-label={t('counterparties.branch', locale)}>
          {([false, true] as const).map((isBranch) => (
            <button
              key={String(isBranch)}
              type="button"
              aria-pressed={values.isBranch === isBranch}
              disabled={disabled}
              className={cx('mangmee-tab', values.isBranch === isBranch && 'mangmee-tab-active', disabled && 'cursor-not-allowed opacity-50')}
              onClick={() => onChange({ isBranch, ...(isBranch ? {} : { branchCode: '' }) })}
            >
              {t(isBranch ? 'counterparties.branch' : 'counterparties.head_office', locale)}
            </button>
          ))}
        </div>
        {values.isBranch && (
          <label className="min-w-0 flex-1 basis-40">
            <span className="sr-only">{t('counterparties.branch_code', locale)}</span>
            <input
              className={inputClass}
              inputMode="numeric"
              placeholder="00001"
              aria-label={t('counterparties.branch_code', locale)}
              aria-invalid={branchIssue ? true : undefined}
              value={values.branchCode}
              disabled={disabled}
              onChange={(event) => onChange({ branchCode: counterpartyBranchCodeDigits(event.target.value) })}
            />
          </label>
        )}
      </div>
      {branchIssue
        ? <span role="alert" className="text-xs font-normal text-red-600">{branchIssue}</span>
        : <span className="text-xs font-normal text-gray-400">{t('counterparties.branch_code_hint', locale)}</span>}
    </div>
  );
}

/** §11.1 address block. The RD lookup button is absent until `RdVatDetailAdapter` exists (§7). */
export function CounterpartyAddressFields({ values, onChange, disabled, issue }: GroupProps) {
  const locale = useWorkspaceLocale();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <TextareaField
          label={t('counterparties.address_text', locale)}
          name="counterparty-address-text"
          rows={3}
          hint={t('counterparties.address_hint', locale)}
          error={issueFor(issue, 'addressText', locale)}
          value={values.addressText}
          disabled={disabled}
          onChange={(event) => onChange({ addressText: event.target.value })}
        />
      </div>
      <TextField
        label={t('counterparties.postal_code', locale)}
        name="counterparty-postal-code"
        inputMode="numeric"
        value={values.postalCode}
        disabled={disabled}
        onChange={(event) => onChange({ postalCode: event.target.value })}
      />
    </div>
  );
}

export function CounterpartyContactFields({ values, onChange, disabled }: Omit<GroupProps, 'issue'>) {
  const locale = useWorkspaceLocale();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <TextField
        label={t('counterparties.email', locale)}
        name="counterparty-email"
        type="email"
        value={values.email}
        disabled={disabled}
        onChange={(event) => onChange({ email: event.target.value })}
      />
      <TextField
        label={t('counterparties.phone', locale)}
        name="counterparty-phone"
        inputMode="tel"
        value={values.phone}
        disabled={disabled}
        onChange={(event) => onChange({ phone: event.target.value })}
      />
    </div>
  );
}
