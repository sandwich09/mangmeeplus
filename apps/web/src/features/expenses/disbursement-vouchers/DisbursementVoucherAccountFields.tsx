'use client';

import { useState } from 'react';
import { SelectField, TextField } from '@/common/components/field';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { BANK_OPTIONS, OTHER_BANK } from '@/features/reimbursements/reimbursement-payout.logic';
import { ghostClass } from '../ExpensesUi';
import { disbursementAccountError, emptyDisbursementAccount, type DisbursementPayeeAccountFields } from './disbursement-voucher-account.logic';

export function DisbursementVoucherAccountFields({ value, onChange }: {
  value: DisbursementPayeeAccountFields; onChange: (patch: Partial<DisbursementPayeeAccountFields>) => void;
}) {
  const [bankChoice, setBankChoice] = useState(() => BANK_OPTIONS.includes(value.payeeBankName) ? value.payeeBankName : value.payeeBankName ? OTHER_BANK : '');
  const error = disbursementAccountError(value);
  return <fieldset className="min-w-0 space-y-3 md:grid md:grid-cols-3 md:items-start md:gap-x-4 md:gap-y-3 md:space-y-0">
    <legend className="mb-3 text-sm font-semibold">{t('expenses.disbursement.account_optional', 'th')}</legend>
    <SelectField label={t('expenses.disbursement.account_bank', 'th')} value={bankChoice} onChange={event => {
      setBankChoice(event.target.value); onChange({ payeeBankName: event.target.value === OTHER_BANK ? '' : event.target.value });
    }}>
      <option value="">{t('expenses.disbursement.account_bank_unspecified', 'th')}</option>{BANK_OPTIONS.map(bank => <option key={bank} value={bank}>{bank}</option>)}
      <option value={OTHER_BANK}>{t('expenses.disbursement.account_bank_other', 'th')}</option>
    </SelectField>
    {bankChoice === OTHER_BANK && <TextField label={t('expenses.disbursement.account_bank', 'th')} value={value.payeeBankName} maxLength={80}
      onChange={event => onChange({ payeeBankName: event.target.value })} />}
    <TextField label={t('expenses.disbursement.account_name', 'th')} value={value.payeeAccountName} maxLength={140} autoComplete="off"
      onChange={event => onChange({ payeeAccountName: event.target.value })} />
    {value.payeeAccountLast4 && <p className="font-mono text-sm">{value.payeeBankName} {value.payeeAccountName} <span className="whitespace-nowrap">xxx-{value.payeeAccountLast4}</span></p>}
    <TextField label={t('expenses.disbursement.account_number', 'th')} type="text" inputMode="numeric" autoComplete="off" maxLength={40}
      value={value.payeeAccountNumber} placeholder={value.payeeAccountLast4 ? t('expenses.disbursement.account_replace', 'th') : undefined}
      hint={t('expenses.disbursement.account_hint', 'th')} error={error ?? undefined}
      onChange={event => onChange({ payeeAccountNumber: event.target.value })} />
    {(value.payeeAccountLast4 || value.payeeBankName || value.payeeAccountName || value.payeeAccountNumber) && <button type="button" className={ghostClass}
      onClick={() => { setBankChoice(''); onChange({ ...emptyDisbursementAccount, payeeAccountCleared: true }); }}>{t('expenses.disbursement.account_remove', 'th')}</button>}
  </fieldset>;
}
