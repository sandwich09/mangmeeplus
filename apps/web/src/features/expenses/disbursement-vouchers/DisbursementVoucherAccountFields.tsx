'use client';

import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { EyeIcon, EyeCloseIcon } from '@/common/icons';
import { revealDisbursementVoucherAccount } from './disbursement-vouchers.api';
import { SelectField, TextField } from '@/common/components/field';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { BANK_OPTIONS, OTHER_BANK } from '@/features/reimbursements/reimbursement-payout.logic';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { canRevealDisbursementAccount, disbursementAccountError, emptyDisbursementAccount, type DisbursementPayeeAccountFields } from './disbursement-voucher-account.logic';

export function DisbursementVoucherAccountFields({ value, onChange, companyId, voucherId, permissions = [] }: {
  companyId?: string; voucherId?: string; permissions?: readonly string[];
  value: DisbursementPayeeAccountFields; onChange: (patch: Partial<DisbursementPayeeAccountFields>) => void;
}) {
  const [bankChoice, setBankChoice] = useState(() => BANK_OPTIONS.includes(value.payeeBankName) ? value.payeeBankName : value.payeeBankName ? OTHER_BANK : '');
  useEffect(() => { setBankChoice(BANK_OPTIONS.includes(value.payeeBankName) ? value.payeeBankName : value.payeeBankName ? OTHER_BANK : ''); }, [value.payeeAccountFromVoucherId]);
  // A kept account is stored encrypted: its field shows the last four digits; pressing it empties the field for a new number.
  const [typing, setTyping] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const accountId = value.payeeAccountFromVoucherId || voucherId;
  useEffect(() => {
    setRevealed(null); setRevealError(undefined); setBusy(false); setTyping(false);
    request.current?.abort(); request.current = null;
    return () => { request.current?.abort(); request.current = null; };
  }, [accountId, value.payeeAccountLast4]);
  const canReveal = Boolean(companyId && accountId && value.payeeAccountLast4 && !value.payeeAccountNumber
    && canRevealDisbursementAccount(permissions, 'DRAFT', Boolean(value.payeeAccountFromVoucherId)));
  const toggleReveal = async () => {
    if (!canReveal || request.current) return;
    setRevealError(undefined);
    if (revealed) { setRevealed(null); setTyping(false); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const result = await revealDisbursementVoucherAccount(companyId!, accountId!, controller.signal, value.payeeAccountFromVoucherId ? 'prefill' : undefined);
      if (!controller.signal.aborted) { setRevealed(result.accountNumber); setTyping(false); }
    } catch (error) { if (!controller.signal.aborted) setRevealError(apiErrorMessage(error)); }
    finally { if (!controller.signal.aborted) { setBusy(false); request.current = null; } }
  };
  const eye = canReveal ? <button type="button" aria-label={revealed ? 'ซ่อนเลข' : 'ดูเลขเต็ม'} aria-pressed={Boolean(revealed)}
    disabled={busy} aria-busy={busy} onClick={toggleReveal}
    className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:text-gray-700">
    {revealed ? <EyeCloseIcon aria-hidden="true" className="h-5 w-5" /> : <EyeIcon aria-hidden="true" className="h-5 w-5" />}
  </button> : undefined;
  const masked = value.payeeAccountLast4 ? `xxx-${value.payeeAccountLast4}` : '';
  const error = disbursementAccountError(value);
  const bankError = error === DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_bank_required ? error : undefined;
  return <fieldset className="min-w-0 space-y-3">
    <legend className="float-left flex w-full items-center justify-between gap-3 text-sm font-semibold">
      บัญชีผู้รับเงิน (ถ้ามี)
      {(value.payeeAccountLast4 || value.payeeBankName || value.payeeAccountName || value.payeeAccountNumber) && <button type="button" className="min-h-11 text-sm font-normal text-gray-500 underline"
        onClick={() => { setBankChoice(''); onChange({ ...emptyDisbursementAccount, payeeAccountFromVoucherId: undefined, payeeAccountCleared: true }); }}>{value.payeeAccountFromVoucherId ? 'ใช้บัญชีอื่น' : 'ล้างบัญชี'}</button>}
    </legend>
    <div className="clear-both grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
    <div className="space-y-3">
    {value.payeeAccountFromVoucherId ? <TextField label="ธนาคาร" value={value.payeeBankName} readOnly /> : <SelectField id="disbursement-account-bank" error={bankChoice !== OTHER_BANK ? bankError : undefined} label={t('expenses.disbursement.account_bank', 'th')} value={bankChoice} onChange={event => {
      setBankChoice(event.target.value); onChange({ payeeBankName: event.target.value === OTHER_BANK ? '' : event.target.value });
    }}>
      <option value="">{t('expenses.disbursement.account_bank_unspecified', 'th')}</option>{BANK_OPTIONS.map(bank => <option key={bank} value={bank}>{bank}</option>)}
      <option value={OTHER_BANK}>{t('expenses.disbursement.account_bank_other', 'th')}</option>
    </SelectField>}
    {!value.payeeAccountFromVoucherId && bankChoice === OTHER_BANK && <TextField label="ชื่อธนาคาร" error={bankError} value={value.payeeBankName} maxLength={80}
      onChange={event => onChange({ payeeBankName: event.target.value })} />}
    </div>
    <TextField label={t('expenses.disbursement.account_name', 'th')} value={value.payeeAccountName} readOnly={Boolean(value.payeeAccountFromVoucherId)} maxLength={140} autoComplete="off"
      onChange={event => onChange({ payeeAccountName: event.target.value })} />
    <div className="space-y-2">
    {/* The label wraps the eye button and the hint; the field's own name stays the label alone. */}
    <TextField id="disbursement-account-number" label={t('expenses.disbursement.account_number', 'th')} aria-label={t('expenses.disbursement.account_number', 'th')} type="text"
      readOnly={Boolean(value.payeeAccountFromVoucherId)} inputMode={value.payeeAccountFromVoucherId ? undefined : 'numeric'} autoComplete="off" maxLength={40}
      value={value.payeeAccountNumber || (canReveal ? revealed : null) || (typing && !value.payeeAccountFromVoucherId ? '' : masked)}
      placeholder={masked && !value.payeeAccountFromVoucherId ? t('expenses.disbursement.account_replace', 'th') : undefined}
      hint="เก็บแบบเข้ารหัส แสดง 4 ตัวท้าย" error={revealError || (bankError ? undefined : error ?? undefined)} endAdornment={eye}
      onFocus={() => setTyping(true)} onBlur={() => setTyping(false)}
      onChange={event => { setRevealed(null); setRevealError(undefined); onChange({ payeeAccountNumber: event.target.value }); }} />
    </div>
    </div>
  </fieldset>;
}
