'use client';
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

import { reimbursementPayoutOnBehalfNotice, REIMBURSEMENT_PAYOUT_TYPING_ON_BEHALF_NOTE } from '@watchdog-bms/contracts';

// Payout account screens: the default account card (own page and employee page), the receiving
// choice on the claim form, and the masked account on the claim page with its reveal button.
// Every screen here shows the last 4 digits; the full number appears only after "แสดงเลขบัญชี",
// which the server answers for the account's own reveal group and records each time.

import { useEffect, useId, useRef, useState, type Ref } from 'react';
import Link from 'next/link';
import { payoutHolderChoiceLabel, payoutHolderLine, REIMBURSEMENT_PAYOUT_HOLDER_WORDS as HOLDER_WORDS, PAYOUT_HOLDER_NOTE_MAX_LENGTH, type PayoutHolderFacts, type SavedPayoutAccountSummary, maskedPayoutAccount, type MemberPayoutAccountSummary, type ReimbursementLegacyPayoutDefault, type ReimbursementPayoutSummary } from '@watchdog-bms/contracts';
// The pay step's line as the claim's own requester reads it (its own import, apart from the line above).
import { REIMBURSEMENT_PAYOUT_ROUND_PAY_LEAD_FOR_REQUESTER } from '@watchdog-bms/contracts';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { FieldError } from '@/common/components/field/Field';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { ErrorState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { ErrorBanner, btnClass, dangerClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { errorMessage, errorText } from './reimbursements.logic';
import {
  deleteMyPayoutAccount, getMemberPayoutAccount, getMyPayoutAccount, revealClaimPayoutAccount, revealMyPayoutAccount,
  setMemberPayoutAccount, setMyPayoutAccount,
} from './reimbursement-payout.api';
import {
  BANK_OPTIONS, LEGACY_ASK_REQUESTER_NOTE, LEGACY_DEFAULT_LABEL, OTHER_BANK, PAYER_CONFIRMATION_TEXT, PAYOUT_ATTESTATION_TEXT, PAYOUT_KIND_TEXT, PAYOUT_METHOD_TEXT,
  savedPayoutAccountTitle, setClaimPayoutHolder, setClaimPayoutSaving, chooseClaimPayoutMode, claimCashNote, claimPayoutHistory, claimPayoutView, emptyPayoutAccountForm,
  memberPayoutAccountInput, payoutAccountFormError, payoutAccountFormOf, payoutAccountLine, payoutCorrectionCardNote, payoutDefaultChangedHint, payoutRoundTexts, revealedNumberMatchesCard, setByOtherLine, shownAccountNumber,
  type ClaimPayoutForm, type PaymentFormConfirmation, type PayoutAccountForm,
} from './reimbursement-payout.logic';
// What the number of an account is called, by its kind (its own import, apart from the block above).
import { REIMBURSEMENT_SAVED_PAYOUT_WORDS as SAVED_PAYOUT_WORDS } from '@watchdog-bms/contracts';
import { isPayoutRevealDenied, payoutNumberWords } from './reimbursement-payout.logic';

/**
 * "← กลับไปการเบิกจ่าย", in the `back` slot of every page of this area: the shared back link, 44 px high on a phone and
 * 40 px from 640 px. (It was a line of text inside the eyebrow pill, 18 px high on a tablet.)
 */
export function BackToClaimsLink({ href }: { href: string }) {
  return <BackLink href={href} label="กลับไปการเบิกจ่าย" />;
}

/** The mark of a `<details>` of this area: drawn, so it is no text on the page, and it turns when the box is open (the summary's parent is `group`). */
export function DisclosureChevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-180">
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A field's label: 14 px, the same as on the claim form (it was 12 px, smaller than the text typed under it). */
export const labelClass = 'mb-1.5 block text-sm font-semibold text-gray-700';
/** A fact's name in a list of facts (a `dt`): quieter than the fact, and still 14 px. */
const factLabelClass = 'text-sm text-gray-500';
export const choiceClass = 'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700';

/** Bank, account name and number. The number stays text from the first keystroke: leading zeros are part of it. */
export function PayoutAccountFields({ value, onChange, disabled = false, invalidField, error, accountNameHint, accountNumberPlaceholder }: {
  value: PayoutAccountForm;
  onChange: (next: PayoutAccountForm) => void;
  disabled?: boolean;
  invalidField?: string;
  error?: string | null;
  accountNameHint?: string;
  /** Said inside the empty number field of a form that changes a saved account: the saved number is never put back into a field. */
  accountNumberPlaceholder?: string;
}) {
  const errorId = useId();
  // One line under a field: what is wrong with it when something is, else its hint (the two together said one rule twice).
  const wrong = (field: string) => invalidField === field && !!error;
  const fieldsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!invalidField) return;
    const field = fieldsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.scrollIntoView({ block: 'start' }); field?.focus({ preventScroll: true });
  }, [invalidField]);
  const set = (patch: Partial<PayoutAccountForm>) => onChange({ ...value, ...patch });
  const promptPay = value.payoutKind === 'PROMPTPAY_PHONE';
  return (
    <div ref={fieldsRef} className="grid gap-3 sm:grid-cols-2 [&_.mangmee-input]:min-h-11 [&_input]:scroll-mt-[calc(var(--app-header-h)+1rem)] [&_button]:scroll-mt-[calc(var(--app-header-h)+1rem)] [&_summary]:scroll-mt-[calc(var(--app-header-h)+1rem)]">
      <div>
        <label className={labelClass}>ประเภทบัญชี<span className="text-red-600"> *</span></label>
        <ThemedSelect aria-label="ประเภทบัญชี" aria-invalid={invalidField === 'payoutKind'} aria-describedby={invalidField === 'payoutKind' && error ? errorId : undefined} className={inputClass} value={value.payoutKind} disabled={disabled}
          onChange={(event) => set({ payoutKind: event.target.value === 'PROMPTPAY_PHONE' ? 'PROMPTPAY_PHONE' : 'BANK_ACCOUNT' })}>
          {Object.entries(PAYOUT_KIND_TEXT).map(([kind, text]) => <option key={kind} value={kind}>{text}</option>)}
        </ThemedSelect>
        {invalidField === 'payoutKind' && error && <FieldError id={errorId}>{error}</FieldError>}
      </div>
      {!promptPay && (
        <div>
          <label className={labelClass}>ธนาคาร<span className="text-red-600"> *</span></label>
          {/* `required`: "เลือกธนาคาร" is the prompt of an empty field, shown in the closed control and not as a row of the list. */}
          <ThemedSelect required aria-label="ธนาคาร" aria-invalid={invalidField === 'bankName' && value.bankChoice !== OTHER_BANK} aria-describedby={invalidField === 'bankName' && value.bankChoice !== OTHER_BANK && error ? errorId : undefined} className={inputClass} value={value.bankChoice} disabled={disabled}
            onChange={(event) => set({ bankChoice: event.target.value })}>
            <option value="">เลือกธนาคาร</option>
            {BANK_OPTIONS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
            <option value={OTHER_BANK}>ธนาคารอื่น</option>
          </ThemedSelect>
          {invalidField === 'bankName' && value.bankChoice !== OTHER_BANK && error && <FieldError id={errorId}>{error}</FieldError>}
        </div>
      )}
      {!promptPay && value.bankChoice === OTHER_BANK && (
        <div className="sm:col-span-2">
          <label className={labelClass}>ชื่อธนาคาร<span className="text-red-600"> *</span></label>
          <input aria-label="ชื่อธนาคาร" aria-invalid={invalidField === 'bankName'} aria-describedby={invalidField === 'bankName' && error ? errorId : undefined} className={inputClass} maxLength={80} disabled={disabled}
            value={value.bankOther} onChange={(event) => set({ bankOther: event.target.value })} />
          {invalidField === 'bankName' && error && <FieldError id={errorId}>{error}</FieldError>}
        </div>
      )}
      <div className="sm:col-span-2">
        <label className={labelClass}>ชื่อบัญชี<span className="text-red-600"> *</span></label>
        <input aria-label="ชื่อบัญชี" aria-invalid={invalidField === 'accountName'} aria-describedby={invalidField === 'accountName' && error ? errorId : undefined} className={inputClass} maxLength={140} disabled={disabled}
          autoComplete="off" value={value.accountName} onChange={(event) => set({ accountName: event.target.value })} />
        {wrong('accountName') ? <FieldError id={errorId}>{error}</FieldError>
          : <p className="mt-1 text-xs text-gray-500">{accountNameHint ?? 'ตามที่ธนาคารแสดง ผู้อนุมัติจะเทียบชื่อนี้กับชื่อผู้เบิก'}</p>}
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass}>{promptPay ? 'เบอร์พร้อมเพย์ *' : 'เลขบัญชี *'}</label>
        {/* text + numeric keypad, never type="number": that would drop a leading zero. */}
        <input aria-label={promptPay ? 'เบอร์พร้อมเพย์' : 'เลขบัญชี'} aria-invalid={invalidField === 'accountNumber'} aria-describedby={invalidField === 'accountNumber' && error ? errorId : undefined}
          className={cx(inputClass, 'tracking-[.04em]')} type="text" inputMode="numeric" autoComplete="off" maxLength={40} disabled={disabled} placeholder={accountNumberPlaceholder}
          value={value.accountNumber} onChange={(event) => set({ accountNumber: event.target.value })} />
        {wrong('accountNumber') ? <FieldError id={errorId}>{error}</FieldError>
          : <p className="mt-1 text-xs text-gray-500">{promptPay ? 'เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0' : 'ตัวเลข 6 ถึง 20 หลัก พิมพ์ขีดหรือเว้นวรรคได้'}</p>}
      </div>
    </div>
  );
}

/** Holder facts are shared by the saved-account form and a typed claim account. Defaults stay own-only. */
export function PayoutHolderFields({ value, onChange, forSelf, disabled = false, invalidField, error, allowThirdParty = true }: {
  value: PayoutHolderFacts; onChange: (next: PayoutHolderFacts) => void; forSelf: boolean; disabled?: boolean; invalidField?: string; error?: string | null; allowThirdParty?: boolean;
}) {
  const groupName = useId();
  const errorId = useId();
  const fieldsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!invalidField) return;
    const field = fieldsRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    field?.scrollIntoView({ block: 'start' }); field?.focus({ preventScroll: true });
  }, [invalidField]);
  return <div ref={fieldsRef} className="space-y-3 [overflow-wrap:anywhere] [&_input]:scroll-mt-[calc(var(--app-header-h)+1rem)] [&_textarea]:scroll-mt-[calc(var(--app-header-h)+1rem)]">
    <div role="radiogroup" aria-label={SAVED_PAYOUT_WORDS.holder} className="space-y-2">
      {(['SELF', 'THIRD_PARTY'] as const).filter(type => allowThirdParty || type === 'SELF').map(holderType => <label key={holderType} className={cx(choiceClass, value.holderType === holderType && 'border-brand-300 bg-brand-25')}>
        <input type="radio" name={groupName} className="mt-0.5 h-5 w-5 shrink-0" disabled={disabled} checked={value.holderType === holderType}
          aria-invalid={invalidField === 'holderType'} aria-describedby={invalidField === 'holderType' && error ? errorId : undefined} onChange={() => onChange({ holderType })} />
        <span>{payoutHolderChoiceLabel(holderType, forSelf)}</span>
      </label>)}
    </div>
    {invalidField === 'holderType' && error && <FieldError id={errorId}>{error}</FieldError>}
    {value.holderType === 'THIRD_PARTY' && <label className={labelClass}>{HOLDER_WORDS.noteLabel}<span className="text-red-600"> *</span>
      <textarea aria-label={HOLDER_WORDS.noteLabel} aria-invalid={invalidField === 'holderNote'} aria-describedby={invalidField === 'holderNote' && error ? errorId : undefined} className={cx(inputClass, 'mt-1.5 min-h-24 w-full')} maxLength={PAYOUT_HOLDER_NOTE_MAX_LENGTH}
        disabled={disabled} placeholder={HOLDER_WORDS.noteExample} value={value.holderNote ?? ''} onChange={event => onChange({ ...value, holderNote: event.target.value })} />
      {invalidField === 'holderNote' && error && <FieldError id={errorId}>{error}</FieldError>}
    </label>}
  </div>;
}

/** Holder facts follow the existing account-name visibility boundary. */
export function PayoutHolderNotice({ account }: { account?: Parameters<typeof payoutHolderLine>[0] & { accountName?: string | null } | null }) {
  if (!account?.accountName || account.holderType !== 'THIRD_PARTY') return null;
  return <span className="block min-w-0 space-y-1 [overflow-wrap:anywhere]"><MangmeeBadge tone="amber">{HOLDER_WORDS.thirdParty}</MangmeeBadge><span className="block text-sm">{payoutHolderLine(account)}</span></span>;
}
export function SavedPayoutAccountOption({ account, index, checked, onChange, disabled = false, name = 'claim-payout-mode' }: {
  account: SavedPayoutAccountSummary; index: number; checked: boolean; onChange: () => void; disabled?: boolean; name?: string;
}) {
  return <label className={cx(choiceClass, checked && 'border-brand-300 bg-brand-25')}><input type="radio" name={name} className="mt-0.5 h-5 w-5 shrink-0" checked={checked} disabled={disabled} onChange={onChange} /><SavedPayoutAccountDetails account={account} index={index} /></label>;
}

/** Same facts in the list and radio choice; ordinal keeps even equal masked accounts distinguishable. */
export function SavedPayoutAccountDetails({ account, index }: { account: SavedPayoutAccountSummary; index: number }) {
  return <span className="block min-w-0 space-y-1 [overflow-wrap:anywhere]">
    <span className="block font-semibold text-gray-900">{savedPayoutAccountTitle(account, index)}</span>
    <span className="block text-sm">{maskedPayoutAccount(account)}</span>
    <span className="block text-sm">{account.accountName}</span>
    {account.holderType === 'THIRD_PARTY' && <><MangmeeBadge tone="amber">{HOLDER_WORDS.thirdParty}</MangmeeBadge><span className="block text-sm">{payoutHolderLine(account)}</span></>}
  </span>;
}

/**
 * The masked account with "แสดงเลขบัญชี". The number is fetched on demand and never kept past this card. What the number
 * is called follows the kind of account: a PromptPay destination is a phone number, "เบอร์พร้อมเพย์".
 */
export function AccountNumberReveal({ masked, payoutKind, revealKey, canReveal, onReveal, last4 }: {
  masked: string;
  payoutKind?: string | null;
  /** What the number belongs to: the claim and its account version, or the default as last saved. */
  revealKey: string;
  canReveal: boolean;
  onReveal: () => Promise<string>;
  /** The last 4 digits this card shows. An answer that does not end with them is the number of another account: the page is out of date. */
  last4?: string;
}) {
  const toast = useToast();
  const words = payoutNumberWords(payoutKind);
  const [revealed, setRevealed] = useState<{ revealKey: string; accountNumber: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A number is shown only under the account it was revealed for, and only while this viewer may
  // reveal: another claim, another account version or a right that is gone shows nothing, from the
  // first render on. The effect then drops the number from memory as well.
  const shown = shownAccountNumber(revealed, revealKey, canReveal);
  useEffect(() => { setRevealed(null); setError(null); }, [revealKey, masked, canReveal]);

  const reveal = async () => {
    setBusy(true); setError(null);
    // Kept under the key it was asked for: an answer that arrives after the account changed is never shown.
    // Nor is the number of an account other than the one on this card: the API answers with the account
    // as it is now, and a page loaded before a change would put that number under the old bank and name.
    try {
      const accountNumber = await onReveal();
      if (revealedNumberMatchesCard(accountNumber, last4)) setRevealed({ revealKey, accountNumber });
      else setError(errorMessage('payout_destination_changed'));
    } catch (e) {
      // A refused reveal is said of the number it is: the sentence of that refusal's code names an account number.
      setError((isPayoutRevealDenied(e) && words.denied) || errorText(e));
    } finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown ?? '');
      toast.success(words.copied);
    } catch { setError('คัดลอกไม่สำเร็จ คัดลอกด้วยตนเอง'); }
  };

  return (
    <div className="space-y-2">
      <div className="break-words text-sm font-semibold text-gray-900">{masked}</div>
      {shown && (
        <div className="rounded-xl border border-brand-100 bg-brand-25 p-3">
          <div className={factLabelClass}>{words.full}</div>
          {/* One unit: a number is never broken over two lines (20 digits fit a 390 px phone at this size). */}
          <div className="mangmee-unit mt-1 font-mono text-lg font-bold tracking-[.06em] text-gray-900" data-testid="payout-account-number">{shown}</div>
        </div>
      )}
      {/* The hide control follows the number itself: whenever a number is on screen, so is the way to hide it. Neither
          button is the main one of the page it sits on (the pay step has "บันทึกจ่าย"); the one that backs out comes first. */}
      {shown ? (
        <ActionGroup align="start">
          <button type="button" className={ghostClass} onClick={() => setRevealed(null)}>{words.hide}</button>
          <button type="button" className={ghostClass} onClick={() => void copy()}>{words.copy}</button>
        </ActionGroup>
      ) : canReveal && (
        <ActionGroup align="start">
          {/* The name stays while it works, so the button keeps its width; the mark of `aria-busy` says it is working. */}
          <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void reveal()}>{words.show}</button>
        </ActionGroup>
      )}
      {error && <ErrorBanner message={error} />}
    </div>
  );
}

/**
 * A default payout account: the member's own ("บัญชีรับเงินคืนของฉัน") or an employee's, on the
 * employee page. The owner can reveal and remove their own; whoever edits it for someone else types
 * the number once and sees the last 4 digits afterwards, like everyone else.
 */
export function MemberPayoutAccountCard({ companyId, memberUserId, canEdit, title = 'บัญชีรับเงินคืน', description, embedded = false }: {
  companyId: string;
  /** Omitted: the signed-in member's own account. */
  memberUserId?: string;
  canEdit: boolean;
  title?: string;
  description?: string;
  /**
   * The card sits inside another page's form (the edit-employee page), which has its own main button: the card's
   * button that starts setting or editing the account is then drawn with the secondary look. Nothing else changes.
   */
  embedded?: boolean;
}) {
  const own = !memberUserId;
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [account, setAccount] = useState<MemberPayoutAccountSummary | null>(null);
  // The server's own answer to "may this viewer set this account": the button follows it, so it is
  // never offered to someone the save would refuse (a manager on a peer's or another branch's account).
  const [mayEdit, setMayEdit] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [method, setMethod] = useState<'BANK_TRANSFER' | 'CASH'>('BANK_TRANSFER');
  const [form, setForm] = useState<PayoutAccountForm>(emptyPayoutAccountForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<string | undefined>(undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && !invalidField) {
      errorRef.current?.scrollIntoView({ block: 'start' }); errorRef.current?.focus({ preventScroll: true });
    }
  }, [error, invalidField]);

  useEffect(() => {
    let active = true;
    setLoaded(false); setLoadError(null);
    (memberUserId ? getMemberPayoutAccount(companyId, memberUserId) : getMyPayoutAccount(companyId))
      .then((response) => { if (active) { setAccount(response.account); setMayEdit(response.canEdit === true); setLoaded(true); } })
      .catch((e) => { if (active) setLoadError(e); });
    return () => { active = false; };
  }, [companyId, memberUserId, reloadKey]);

  const startEdit = () => {
    // What the card already shows of the account is filled in (its kind, bank and name). The number never is: a saved
    // number cannot be shown again to be retyped over, so that one field starts empty and says so.
    setForm(payoutAccountFormOf(account)); setMethod(account?.payoutMethod ?? 'BANK_TRANSFER');
    setError(null); setInvalidField(undefined); setEditing(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = method === 'BANK_TRANSFER' ? payoutAccountFormError(form) : null;
    if (problem) {
      setError(problem.text); setInvalidField(problem.field);
      requestAnimationFrame(() => {
        const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        field?.scrollIntoView({ block: 'start' }); field?.focus({ preventScroll: true });
      });
      return;
    }
    setBusy(true); setError(null); setInvalidField(undefined);
    // What a change leaves alone is said when a change was made, not above an account nobody is changing.
    const replaced = !!account;
    try {
      const input = memberPayoutAccountInput(method, form);
      const response = memberUserId ? await setMemberPayoutAccount(companyId, memberUserId, input) : await setMyPayoutAccount(companyId, input);
      setAccount(response.account); setEditing(false); setForm(emptyPayoutAccountForm());
      toast.success(`${own ? 'บันทึกบัญชีรับเงินคืนแล้ว' : 'บันทึกบัญชีรับเงินคืนแล้ว ระบบแจ้งเจ้าของบัญชีให้ตรวจ'}${replaced ? ' ใบเบิกที่ส่งไปแล้วยังใช้บัญชีเดิม' : ''}`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm({
      title: 'ลบบัญชีรับเงินคืนประจำ',
      message: 'ใบเบิกที่ส่งไปแล้วยังใช้บัญชีเดิมของใบนั้น ร่างที่ยังไม่ส่งจะต้องเลือกวิธีรับเงินคืนใหม่ก่อนส่งอนุมัติ',
      confirmLabel: 'ลบบัญชี', cancelLabel: 'ไม่ลบ', variant: 'danger',
    }))) return;
    setBusy(true); setError(null);
    try {
      await deleteMyPayoutAccount(companyId);
      setAccount(null);
      toast.success('ลบบัญชีรับเงินคืนประจำแล้ว');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const setBy = account ? setByOtherLine(account) : null;
  return (
    <MangmeeCard className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
      <div>
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {loadError ? <ErrorState description={errorText(loadError)} onRetry={() => setReloadKey((key) => key + 1)} />
        : !loaded ? <LoadingState label="กำลังโหลดบัญชีรับเงินคืน..." />
          : editing ? (
            <form ref={formRef} className="space-y-3" onSubmit={save} noValidate>
              <div role="radiogroup" aria-label="วิธีรับเงินคืนประจำ" className="grid gap-2 sm:grid-cols-2">
                {(['BANK_TRANSFER', 'CASH'] as const).map((option) => (
                  <label key={option} className={cx(choiceClass, method === option && 'border-brand-300 bg-brand-25')}>
                    <input type="radio" name={`payout-method-${memberUserId ?? 'me'}`} className="mt-0.5 h-5 w-5 shrink-0" checked={method === option}
                      disabled={busy} onChange={() => { setMethod(option); setError(null); setInvalidField(undefined); }} />
                    <span>{PAYOUT_METHOD_TEXT[option]}</span>
                  </label>
                ))}
              </div>
              {method === 'BANK_TRANSFER' && <PayoutAccountFields value={form} onChange={(next) => { setForm(next); setError(null); setInvalidField(undefined); }} disabled={busy} invalidField={invalidField} error={error}
                accountNumberPlaceholder={account?.payoutMethod !== 'BANK_TRANSFER' ? undefined : form.payoutKind === 'PROMPTPAY_PHONE' ? 'กรอกเบอร์พร้อมเพย์ใหม่' : 'กรอกเลขบัญชีใหม่'} />}
              {/* Who will see the number, said where the number is typed (it was a paragraph above an account nobody was editing). */}
              {own && method === 'BANK_TRANSFER' && <p className="text-sm text-gray-500">{`คนอื่นเห็นแค่ 4 ตัวท้าย ${payoutNumberWords(form.payoutKind).full}เปิดดูได้เฉพาะคุณ ผู้อนุมัติของใบนั้น และผู้ที่บันทึกจ่าย`}</p>}
              {!own && <p className="text-sm text-gray-500">หลังบันทึก คุณจะเห็นเฉพาะ 4 ตัวท้าย และเจ้าของบัญชีจะได้รับแจ้งเตือนให้ตรวจ</p>}
              {/* A field's own problem is said under that field, once; this box is for what no field can be blamed for. */}
              {error && !invalidField && <div ref={errorRef} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h)+1rem)]"><ErrorBanner message={error} /></div>}
              <ActionGroup>
                <button type="button" className={ghostClass} disabled={busy} onClick={() => { setEditing(false); setError(null); setInvalidField(undefined); }}>ยกเลิก</button>
                <button type="submit" className={btnClass} disabled={busy} aria-busy={busy}>บันทึกบัญชีรับเงินคืน</button>
              </ActionGroup>
            </form>
          ) : (
            <>
              {!account ? <p className="text-sm text-gray-600">ยังไม่ได้ตั้งบัญชีรับเงินคืนประจำ</p> : account.payoutMethod === 'CASH' ? (
                <div className="text-sm font-semibold text-gray-900">{PAYOUT_METHOD_TEXT.CASH}</div>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className={factLabelClass}>ชื่อบัญชี</dt><dd className="mt-1 break-words text-sm font-semibold text-gray-900">{account.accountName}</dd></div>
                  <div>
                    <dt className={factLabelClass}>บัญชี</dt>
                    <dd className="mt-1">
                      <AccountNumberReveal masked={payoutAccountLine(account)} payoutKind={account.payoutKind} revealKey={`${companyId}:${account.userId}:${account.updatedAt}`} canReveal={own}
                        last4={account.accountLast4} onReveal={async () => (await revealMyPayoutAccount(companyId)).accountNumber} />
                    </dd>
                  </div>
                </dl>
              )}
              {setBy && <Notice tone="warning">{setBy} ตรวจว่าเป็นบัญชีของ{own ? 'คุณ' : 'พนักงาน'}</Notice>}
              {error && <div ref={errorRef} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h)+1rem)]"><ErrorBanner message={error} /></div>}
              {canEdit && mayEdit ? (
                <ActionGroup>
                  {own && account && <button type="button" className={dangerClass} disabled={busy} aria-busy={busy} onClick={() => void remove()}>ลบบัญชี</button>}
                  {/* Setting the first account is the card's main act; editing one that exists is not (the page showed two green buttons). */}
                  <button type="button" className={embedded || account ? ghostClass : btnClass} onClick={startEdit}>{account ? 'แก้ไขบัญชี' : 'ตั้งบัญชีรับเงินคืน'}</button>
                </ActionGroup>
              ) : <p className="text-sm text-gray-500">{`บัญชีนี้ตั้งหรือแก้ได้โดยเจ้าของบัญชี ${THAI_SYSTEM_ROLE_NAMES.OWNER} หรือ${THAI_SYSTEM_ROLE_NAMES.ADMIN} ส่วน${THAI_SYSTEM_ROLE_NAMES.MANAGER}และ${THAI_SYSTEM_ROLE_NAMES.HR}ตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล`}</p>}
            </>
          )}
      {confirmDialog}
    </MangmeeCard>
  );
}

/** One line for the employee list: set or not, bank and last 4 digits. Reads nothing more than that. */
export function MemberPayoutAccountLine({ companyId, memberUserId }: { companyId: string; memberUserId: string }) {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setLine(null);
    getMemberPayoutAccount(companyId, memberUserId)
      .then((response) => { if (active) setLine(payoutAccountLine(response.account)); })
      // A reader without this view simply sees no line; the employee page itself is unaffected.
      .catch(() => undefined);
    return () => { active = false; };
  }, [companyId, memberUserId]);
  return line ? <p className="mt-0.5 break-words text-sm font-semibold text-gray-500">บัญชีรับเงินคืน: {line}</p> : null;
}

/**
 * "รับเงินคืนทาง" on the claim form. A claim follows the requester's default account unless it says
 * otherwise. Holder facts say whether a selected account belongs to the requester or another person.
 */
export function ClaimPayoutFormSection({ value, onChange, forSelf, defaultAccount, noDefaultAccount = false, current, canSaveAsDefault, payoutAccountHref, invalidField, error, savedAccounts = [], savedAccountsLoading = false, savedAccountsError, onReloadSaved }: {
  value: ClaimPayoutForm;
  onChange: (next: ClaimPayoutForm) => void;
  /** The person filling the form is the requester. */
  forSelf: boolean;
  /** The requester's own default when `forSelf`: undefined while loading, null when none is set. */
  defaultAccount?: MemberPayoutAccountSummary | null;
  /**
   * The requester is known to have no default account (a new claim of their own): "follow my default" is not offered
   * as a choice that cannot be sent, and nothing is chosen for them. A draft already saved on it keeps showing it.
   */
  noDefaultAccount?: boolean;
  /** An existing draft's account for this claim, masked. */
  current?: ReimbursementPayoutSummary | null;
  /** The server's answer: this viewer may save a typed account as the requester's default. */
  canSaveAsDefault: boolean;
  payoutAccountHref: string;
  invalidField?: string;
  error?: string | null;
  savedAccounts?: SavedPayoutAccountSummary[];
  savedAccountsLoading?: boolean;
  savedAccountsError?: string | null;
  onReloadSaved?: () => void;
}) {
  const hasOwnAccount = !!current && !current.followsDefault && current.payoutMethod === 'BANK_TRANSFER';
  const choose = (mode: ClaimPayoutForm['mode']) => onChange(chooseClaimPayoutMode(value, mode, { canSaveAsDefault, forSelf, hasNoDefault: defaultAccount === null }));
  const defaultHint = !forSelf
    ? 'ระบบใช้บัญชีรับเงินคืนประจำของผู้เบิกที่เลือกไว้ และแสดงบัญชีนั้นให้ตรวจในหน้าใบเบิกก่อนกดส่งอนุมัติ'
    : defaultAccount === undefined ? 'กำลังโหลดบัญชีประจำของคุณ...'
      : defaultAccount ? `${payoutAccountLine(defaultAccount)}${defaultAccount.accountName ? ` · ${defaultAccount.accountName}` : ''}`
        : 'คุณยังไม่ได้ตั้งบัญชีประจำ บันทึกร่างได้ แต่ต้องเลือกวิธีอื่นหรือตั้งบัญชีประจำก่อนส่งอนุมัติ';
  const option = (mode: ClaimPayoutForm['mode'], label: string, hint?: string | null) => (
    <label className={cx(choiceClass, value.mode === mode && 'border-brand-300 bg-brand-25')}>
      <input type="radio" aria-label={label} name="claim-payout-mode" className="mt-0.5 h-5 w-5 shrink-0" checked={value.mode === mode} onChange={() => choose(mode)} />
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900">{label}</span>
        {hint && <span className="mt-0.5 block break-words text-sm text-gray-500">{hint}</span>}
      </span>
    </label>
  );
  const selectedHolder = value.mode === 'SPECIFIED' ? value.holder
    : value.mode === 'SAVED' && forSelf ? savedAccounts.find(account => account.id === value.savedAccountId)
      : value.mode === 'KEEP' ? current : null;
  return (
    <MangmeeCard className="p-4 [overflow-wrap:anywhere] [&_input]:scroll-mt-[calc(var(--app-header-h)+1rem)] [&_button]:scroll-mt-[calc(var(--app-header-h)+1rem)] [&_summary]:scroll-mt-[calc(var(--app-header-h)+1rem)]">
      <h3 className="text-sm font-bold text-gray-900">รับเงินคืนทาง</h3>
      <div role="radiogroup" aria-label="รับเงินคืนทาง" tabIndex={-1} aria-invalid={invalidField === 'mode' ? true : undefined} className="mt-3 space-y-2">
        {!(noDefaultAccount && value.mode !== 'DEFAULT') && option('DEFAULT', forSelf ? 'ตามบัญชีรับเงินคืนประจำของฉัน' : 'ตามบัญชีรับเงินคืนประจำของผู้เบิก', defaultHint)}
        {forSelf && defaultAccount && setByOtherLine(defaultAccount) && (
          <Notice tone="warning">{setByOtherLine(defaultAccount)} ตรวจว่าเป็นบัญชีของคุณ</Notice>
        )}
        {forSelf && savedAccounts.map((account, index) => <SavedPayoutAccountOption key={account.id} account={account} index={index} checked={value.mode === 'SAVED' && value.savedAccountId === account.id} onChange={() => onChange({ ...value, mode: 'SAVED', savedAccountId: account.id })} />)}
        {forSelf && savedAccountsLoading && <LoadingState label={SAVED_PAYOUT_WORDS.loading} />}
        {forSelf && savedAccountsError && <ErrorState description={savedAccountsError} onRetry={onReloadSaved} />}
        {option('CASH', PAYOUT_METHOD_TEXT.CASH!)}
        {hasOwnAccount && option('KEEP', 'ใช้บัญชีที่ระบุไว้ในใบนี้', `${payoutAccountLine(current)}${current?.accountName ? ` · ${current.accountName}` : ''}${current && payoutHolderLine(current) ? ` · ${payoutHolderLine(current)}` : ''}`)}
        {option('SPECIFIED', hasOwnAccount ? 'ระบุบัญชีใหม่สำหรับใบนี้' : 'ระบุบัญชีสำหรับใบนี้',
          forSelf ? null : REIMBURSEMENT_PAYOUT_TYPING_ON_BEHALF_NOTE)}
      </div>
      {/* Nothing chosen yet: said here, where the choice is made, when the form was sent without one. */}
      {invalidField === 'mode' && error && <div className="mt-2"><FieldError>{error}</FieldError></div>}
      {selectedHolder?.holderType === 'THIRD_PARTY' && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{HOLDER_WORDS.thirdPartyApprovalNotice}</p>}
      {!forSelf && <p className="mt-3 text-sm text-gray-600">{reimbursementPayoutOnBehalfNotice(true)}</p>}
      {value.mode === 'SPECIFIED' && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <PayoutAccountFields value={value.account} onChange={(account) => onChange({ ...value, account })} invalidField={invalidField} error={error} accountNameHint={SAVED_PAYOUT_WORDS.accountNameHint} />
          <PayoutHolderFields value={value.holder ?? { holderType: 'SELF' }} onChange={holder => onChange(setClaimPayoutHolder(value, holder))} forSelf={forSelf} invalidField={invalidField} error={error} />
          {canSaveAsDefault && value.holder?.holderType !== 'THIRD_PARTY' && (
            <label className="flex min-h-11 items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" aria-label={forSelf ? 'บันทึกเป็นบัญชีประจำของฉัน' : 'บันทึกเป็นบัญชีประจำของผู้เบิก'} checked={value.saveAsDefault}
                onChange={(event) => onChange(setClaimPayoutSaving(value, 'saveAsDefault', event.target.checked))} />
              <span>{forSelf ? 'บันทึกเป็นบัญชีประจำของฉัน' : 'บันทึกเป็นบัญชีประจำของผู้เบิก'}</span>
            </label>
          )}
          {forSelf && <label className="flex min-h-11 items-start gap-3 text-sm text-gray-700">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" aria-label={SAVED_PAYOUT_WORDS.saveForLater} checked={value.saveForLater === true}
              onChange={event => onChange(setClaimPayoutSaving(value, 'saveForLater', event.target.checked))} />
            <span>{SAVED_PAYOUT_WORDS.saveForLater}</span>
          </label>}
        </div>
      )}
      {forSelf && <div className="mt-3">
        <Link href={payoutAccountHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-4">จัดการบัญชีรับเงินคืนของฉัน</Link>
        <p className="mt-1 text-sm text-gray-500">เปิดแท็บใหม่ ข้อมูลใบเบิกที่กรอกยังอยู่ในแท็บนี้</p>
      </div>}
    </MangmeeCard>
  );
}

/** The content of a card where something else is already the frame (a dialog): spacing only, no border of its own. */
function PlainFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={className}>{children}</section>;
}

/**
 * The claim page's "การรับเงินคืน" card: the receiving method and the masked account, the requester's
 * name beside the account name so a person can compare them, who attested it, and the reveal button
 * for the viewers the server allows. A sent claim shows its own frozen snapshot, whatever the
 * requester's default account is today.
 *
 * At the payment step, for whoever records the payment (`payStep`), the same card is the box
 * "โอนเข้าบัญชีนี้" of spec §12.1: the account to transfer into, with show and then copy. A legacy
 * claim froze no account, so its payer is shown the requester's current default instead, labelled
 * as never approved on this claim, or is told to ask the requester (§15).
 */
export function ClaimPayoutCard({ companyId, detail, userId, editHref, payoutAccountHref, canWithdraw = false, payStep = false, sendBack, plain = false }: {
  companyId: string;
  detail: any;
  userId: string;
  editHref?: string;
  payoutAccountHref: string;
  /** Drawn inside a dialog, which is its frame already: the same content with no card around it (never a card inside a card). */
  plain?: boolean;
  /** The viewer may still take this sent claim back to a draft (the page's own withdraw action). */
  canWithdraw?: boolean;
  /** The claim waits for its payment and this viewer is offered to record it. */
  payStep?: boolean;
  /**
   * The claim waits for its payment and the server lets this viewer send it back for its account (spec §14.3). The
   * action sits here, at the foot of the box that shows the account, as a line of text: never beside "บันทึกจ่าย".
   */
  sendBack?: { onPress: () => void; disabled?: boolean };
}) {
  const payout: ReimbursementPayoutSummary | undefined = detail.payout;
  const view = claimPayoutView(detail);
  // Spec §17.2: every account this claim has been sent with. Masked like the one above, and no reveal here.
  const history = claimPayoutHistory(detail);
  const defaultChanged = payoutDefaultChangedHint(detail, canWithdraw);
  // Payout spec §14: in a payout round what is shown below is what was sent back, or what was answered and nobody approved yet.
  const correctionNote = payoutCorrectionCardNote(detail);
  // The words of the send-back at the foot of the box, by what the claim holds.
  const round = payoutRoundTexts(detail);
  // A draft whose payout block was not loaded (an action response): say nothing rather than guess.
  if (view.state === 'unknown') return null;
  const isRequester = detail.requesterUserId === userId;
  // The line above the send-back names "ผู้เบิก" on a cash claim: the claim's own requester reads it said to them ("คุณ").
  const lead = (isRequester && REIMBURSEMENT_PAYOUT_ROUND_PAY_LEAD_FOR_REQUESTER[round.held]) || round;
  // Present only for a viewer the server lets pay this legacy claim, whose requester has an account.
  const legacyDefault: ReimbursementLegacyPayoutDefault | undefined = view.state === 'legacy' ? detail.legacyPayoutDefault ?? undefined : undefined;
  // Side by side on purpose: people, not the system, judge whether the two names belong together.
  const names = (accountName?: string) => (
    <dl className="grid grid-cols-2 gap-3">
      <div className="min-w-0"><dt className={factLabelClass}>ผู้เบิก</dt><dd className="mt-1 break-words text-sm font-semibold text-gray-900">{detail.requesterDisplayNameSnapshot ?? 'ยังไม่ระบุ'}</dd></div>
      <div className="min-w-0"><dt className={factLabelClass}>ชื่อบัญชี</dt><dd className="mt-1 break-words text-sm font-semibold text-gray-900">{accountName ?? 'ยังไม่ระบุ'}</dd></div>
    </dl>
  );
  const reveal = async () => (await revealClaimPayoutAccount(companyId, detail.id)).accountNumber;
  // In a dialog (`plain`) the dialog is the frame: the same content with no card drawn around it.
  const Frame = plain ? PlainFrame : MangmeeCard;
  return (
    <Frame className={plain ? 'space-y-3 border-b border-gray-100 pb-4 [overflow-wrap:anywhere]' : 'space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Only the claim's own approved account is an instruction; a legacy claim's default is shown under its own label. */}
        <h2 className="font-bold text-gray-900">{payStep && view.state === 'transfer' ? 'โอนเข้าบัญชีนี้' : 'การรับเงินคืน'}</h2>
        {payout?.payoutMethod && <MangmeeBadge tone={payout.payoutMethod === 'CASH' ? 'slate' : 'teal'}>{PAYOUT_METHOD_TEXT[payout.payoutMethod]}</MangmeeBadge>}
      </div>
      {correctionNote && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="reimbursement-payout-correction-note">{correctionNote}</p>}
      {view.state === 'legacy' && (
        <>
          <p className="text-sm text-gray-600">{view.line}</p>
          {legacyDefault ? (
            <>
              <p className="text-sm font-semibold text-gray-900">{LEGACY_DEFAULT_LABEL}</p>
              {names(legacyDefault.accountName)}
              {/* The claim's own reveal call: it answers this payer with the requester's default, and records it. */}
              <AccountNumberReveal masked={maskedPayoutAccount(legacyDefault)} payoutKind={legacyDefault.payoutKind} revealKey={`${detail.id}:default:${legacyDefault.confirmToken}`} canReveal
                last4={legacyDefault.accountLast4} onReveal={reveal} />
            </>
          ) : payStep && <p className="text-sm text-gray-700">{LEGACY_ASK_REQUESTER_NOTE}</p>}
        </>
      )}
      {view.state === 'missing' && (
        <>
          <ErrorBanner message={view.line} />
          {(editHref || isRequester) && (
            <ActionGroup align="start">
              {isRequester && <Link href={payoutAccountHref} className={ghostClass}>ตั้งบัญชีรับเงินคืนของฉัน</Link>}
              {editHref && <Link href={editHref} className={ghostClass}>เลือกวิธีรับเงินคืนในใบนี้</Link>}
            </ActionGroup>
          )}
        </>
      )}
      {/* Who chose cash: the requester, or whoever answered a payout round with cash on their behalf. */}
      {view.state === 'cash' && <p className="text-sm text-gray-700">{claimCashNote(detail)}</p>}
      {view.state === 'transfer' && payout && (
        <>
          {names(payout.accountName)}
          <PayoutHolderNotice account={payout} />
          <dl><dt className={factLabelClass}>บัญชีรับเงินคืน</dt><dd className="mt-1">
            <AccountNumberReveal masked={view.line} payoutKind={payout.payoutKind} revealKey={`${detail.id}:${payout.version ?? ''}`} canReveal={payout.canRevealAccountNumber === true}
              last4={payout.accountLast4} onReveal={reveal} />
          </dd></dl>
        </>
      )}
      {view.notes.length > 0 && (
        <ul className="space-y-1 text-sm text-gray-500">{view.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      )}
      {defaultChanged && <Notice tone="warning">{defaultChanged}</Notice>}
      {history.length > 0 && (
        // Behind one press: the account in force is above, and a claim that went through a round has a list here long
        // enough to push the step and its button off the screen.
        <details className="group border-t border-gray-100 pt-1" data-testid="reimbursement-payout-history">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-gray-600 [&::-webkit-details-marker]:hidden">
            <span>ประวัติบัญชีรับเงินของใบนี้</span>
            <DisclosureChevron />
          </summary>
          <ol className="mt-1 divide-y divide-gray-100">
            {history.map((row) => (
              <li key={row.version} className="min-w-0 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 break-words text-sm font-semibold text-gray-900">{row.line}</span>
                  {row.current && <MangmeeBadge tone="teal">ใช้อยู่ตอนนี้</MangmeeBadge>}
                </div>
                <PayoutHolderNotice account={row.holder} />
                <ul className="mt-1 space-y-0.5 text-sm text-gray-500">{row.notes.map((note) => <li key={note}>{note}</li>)}</ul>
              </li>
            ))}
          </ol>
        </details>
      )}
      {sendBack && (
        <div className="border-t border-gray-100 pt-3" data-testid="reimbursement-payout-send-back">
          {/* By what the claim holds: an account to correct, cash to choose again, or (a claim with no account of its own,
              which is paid as it is) an account to add. "อย่าเพิ่งจ่าย" is said only to whoever is offered the payment. */}
          <p className="text-sm text-gray-500">{payStep ? lead.payLead : lead.payLeadCannotPay}</p>
          <button type="button" disabled={sendBack.disabled} onClick={sendBack.onPress}
            className="inline-flex min-h-11 items-center text-left text-sm font-semibold text-gray-700 underline underline-offset-4 hover:text-gray-900 disabled:opacity-50">
            {round.payLink}
          </button>
        </div>
      )}
    </Frame>
  );
}

/**
 * "ตรวจบัญชีแล้ว": the approver's attestation of the account shown above, required to approve a transfer claim. What they
 * are told to look at is what the card shows of that kind of account: a PromptPay number has no bank and no "เลขบัญชี".
 */
export function PayoutAttestationCheck({ checked, onChange, disabled = false, payoutKind, holderType, forSelf = false, inputRef }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  payoutKind?: string | null;
  holderType?: string | null;
  forSelf?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
      <input ref={inputRef} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block font-semibold text-gray-900">{holderType === 'THIRD_PARTY' ? HOLDER_WORDS.thirdPartyAcceptance : PAYOUT_ATTESTATION_TEXT}</span>
        {holderType === 'THIRD_PARTY' ? checked && forSelf && <span className="mt-0.5 block text-sm text-gray-500">{HOLDER_WORDS.thirdPartySelfAttestation}</span> : <span className="mt-0.5 block text-sm text-gray-500">{payoutNumberWords(payoutKind).check}</span>}
      </span>
    </label>
  );
}

/**
 * The payer's "โอนเข้าบัญชีนี้แล้ว" (spec §12.3), given for exactly one account. A transfer into the
 * claim's own account is not recorded without it; on a legacy claim it is the payer's to give, when
 * the money went into the requester's default account shown.
 */
export function PayerConfirmationCheck({ confirmation, checked, onChange, disabled = false }: {
  confirmation: PaymentFormConfirmation;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700 [overflow-wrap:anywhere]" data-testid="reimbursement-payment-confirmation">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={checked} disabled={disabled} aria-required={confirmation.required}
        onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900">{confirmation.holder?.holderType === 'THIRD_PARTY' ? HOLDER_WORDS.thirdPartyPaymentConfirmation : PAYER_CONFIRMATION_TEXT}{confirmation.required && <span className="text-red-600"> *</span>}</span>
        <span className="mt-0.5 block text-sm text-gray-600">{confirmation.accountLine}</span>
        <PayoutHolderNotice account={confirmation.holder} />
        {confirmation.note && <span className="mt-0.5 block text-sm text-gray-500">{confirmation.note}</span>}
      </span>
    </label>
  );
}
