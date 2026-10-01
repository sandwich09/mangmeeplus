'use client';

// Payout account screens: the default account card (own page and employee page), the receiving
// choice on the claim form, and the masked account on the claim page with its reveal button.
// Every screen here shows the last 4 digits; the full number appears only after "แสดงเลขบัญชี",
// which the server answers for the account's own reveal group and records each time.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { maskedPayoutAccount, type MemberPayoutAccountSummary, type ReimbursementLegacyPayoutDefault, type ReimbursementPayoutSummary } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { ErrorState, LoadingState } from '@/common/components/state';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { ErrorBanner, btnClass, ghostClass, inputClass } from '../expenses/ExpensesUi';
import { errorMessage, errorText } from './reimbursements.logic';
import {
  deleteMyPayoutAccount, getMemberPayoutAccount, getMyPayoutAccount, revealClaimPayoutAccount, revealMyPayoutAccount,
  setMemberPayoutAccount, setMyPayoutAccount,
} from './reimbursement-payout.api';
import {
  BANK_OPTIONS, LEGACY_ASK_REQUESTER_NOTE, LEGACY_DEFAULT_LABEL, OTHER_BANK, PAYER_CONFIRMATION_TEXT, PAYOUT_ATTESTATION_TEXT, PAYOUT_KIND_TEXT, PAYOUT_METHOD_TEXT,
  chooseClaimPayoutMode, claimPayoutView, emptyPayoutAccountForm,
  memberPayoutAccountInput, payoutAccountFormError, payoutAccountLine, payoutDefaultChangedHint, revealedNumberMatchesCard, setByOtherLine, shownAccountNumber,
  type ClaimPayoutForm, type PaymentFormConfirmation, type PayoutAccountForm,
} from './reimbursement-payout.logic';

const labelClass = 'mb-1.5 block text-xs font-semibold text-gray-600';
const choiceClass = 'flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700';

/** Bank, account name and number. The number stays text from the first keystroke: leading zeros are part of it. */
export function PayoutAccountFields({ value, onChange, disabled = false, invalidField }: {
  value: PayoutAccountForm;
  onChange: (next: PayoutAccountForm) => void;
  disabled?: boolean;
  invalidField?: string;
}) {
  const set = (patch: Partial<PayoutAccountForm>) => onChange({ ...value, ...patch });
  const promptPay = value.payoutKind === 'PROMPTPAY_PHONE';
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass}>ประเภทบัญชี *</label>
        <ThemedSelect aria-label="ประเภทบัญชี" className={inputClass} value={value.payoutKind} disabled={disabled}
          onChange={(event) => set({ payoutKind: event.target.value === 'PROMPTPAY_PHONE' ? 'PROMPTPAY_PHONE' : 'BANK_ACCOUNT' })}>
          {Object.entries(PAYOUT_KIND_TEXT).map(([kind, text]) => <option key={kind} value={kind}>{text}</option>)}
        </ThemedSelect>
      </div>
      {!promptPay && (
        <div>
          <label className={labelClass}>ธนาคาร *</label>
          <ThemedSelect aria-label="ธนาคาร" aria-invalid={invalidField === 'bankName'} className={inputClass} value={value.bankChoice} disabled={disabled}
            onChange={(event) => set({ bankChoice: event.target.value })}>
            <option value="">เลือกธนาคาร</option>
            {BANK_OPTIONS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
            <option value={OTHER_BANK}>ธนาคารอื่น</option>
          </ThemedSelect>
        </div>
      )}
      {!promptPay && value.bankChoice === OTHER_BANK && (
        <div className="sm:col-span-2">
          <label className={labelClass}>ชื่อธนาคาร *</label>
          <input aria-label="ชื่อธนาคาร" aria-invalid={invalidField === 'bankName'} className={inputClass} maxLength={80} disabled={disabled}
            value={value.bankOther} onChange={(event) => set({ bankOther: event.target.value })} />
        </div>
      )}
      <div className="sm:col-span-2">
        <label className={labelClass}>ชื่อบัญชี *</label>
        <input aria-label="ชื่อบัญชี" aria-invalid={invalidField === 'accountName'} className={inputClass} maxLength={140} disabled={disabled}
          autoComplete="off" value={value.accountName} onChange={(event) => set({ accountName: event.target.value })} />
        <p className="mt-1 text-xs text-gray-500">ตามที่ธนาคารแสดง ผู้อนุมัติจะเทียบชื่อนี้กับชื่อผู้เบิก</p>
      </div>
      <div className="sm:col-span-2">
        <label className={labelClass}>{promptPay ? 'เบอร์พร้อมเพย์ *' : 'เลขบัญชี *'}</label>
        {/* text + numeric keypad, never type="number": that would drop a leading zero. */}
        <input aria-label={promptPay ? 'เบอร์พร้อมเพย์' : 'เลขบัญชี'} aria-invalid={invalidField === 'accountNumber'}
          className={cx(inputClass, 'tracking-[.04em]')} type="text" inputMode="numeric" autoComplete="off" maxLength={40} disabled={disabled}
          value={value.accountNumber} onChange={(event) => set({ accountNumber: event.target.value })} />
        <p className="mt-1 text-xs text-gray-500">
          {promptPay ? 'เบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0' : 'ตัวเลข 6 ถึง 20 หลัก พิมพ์ขีดหรือเว้นวรรคได้ ระบบเก็บเฉพาะตัวเลข'}
        </p>
      </div>
    </div>
  );
}

/** The masked account with "แสดงเลขบัญชี". The number is fetched on demand and never kept past this card. */
function AccountNumberReveal({ masked, revealKey, canReveal, onReveal, last4 }: {
  masked: string;
  /** What the number belongs to: the claim and its account version, or the default as last saved. */
  revealKey: string;
  canReveal: boolean;
  onReveal: () => Promise<string>;
  /** The last 4 digits this card shows. An answer that does not end with them is the number of another account: the page is out of date. */
  last4?: string;
}) {
  const toast = useToast();
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
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown ?? '');
      toast.success('คัดลอกเลขบัญชีแล้ว');
    } catch { setError('คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง'); }
  };

  return (
    <div className="space-y-2">
      <div className="break-words text-sm font-semibold text-gray-900">{masked}</div>
      {shown && (
        <div className="rounded-xl border border-brand-100 bg-brand-25 p-3">
          <div className="text-xs font-semibold text-gray-500">เลขบัญชีเต็ม</div>
          <div className="mt-1 break-all font-mono text-lg font-bold tracking-[.06em] text-gray-900" data-testid="payout-account-number">{shown}</div>
        </div>
      )}
      {/* The hide control follows the number itself: whenever a number is on screen, so is the way to hide it. */}
      {shown ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} onClick={() => void copy()}>คัดลอกเลขบัญชี</button>
          <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} onClick={() => setRevealed(null)}>ซ่อนเลขบัญชี</button>
        </div>
      ) : canReveal && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={busy} onClick={() => void reveal()}>
            {busy ? 'กำลังเปิด...' : 'แสดงเลขบัญชี'}
          </button>
        </div>
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
export function MemberPayoutAccountCard({ companyId, memberUserId, canEdit, title = 'บัญชีรับเงินคืน', description }: {
  companyId: string;
  /** Omitted: the signed-in member's own account. */
  memberUserId?: string;
  canEdit: boolean;
  title?: string;
  description?: string;
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

  useEffect(() => {
    let active = true;
    setLoaded(false); setLoadError(null);
    (memberUserId ? getMemberPayoutAccount(companyId, memberUserId) : getMyPayoutAccount(companyId))
      .then((response) => { if (active) { setAccount(response.account); setMayEdit(response.canEdit === true); setLoaded(true); } })
      .catch((e) => { if (active) setLoadError(e); });
    return () => { active = false; };
  }, [companyId, memberUserId, reloadKey]);

  const startEdit = () => {
    // The form always starts empty: the saved number cannot be shown again to be retyped over.
    setForm(emptyPayoutAccountForm()); setMethod(account?.payoutMethod ?? 'BANK_TRANSFER');
    setError(null); setInvalidField(undefined); setEditing(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = method === 'BANK_TRANSFER' ? payoutAccountFormError(form) : null;
    if (problem) { setError(problem.text); setInvalidField(problem.field); return; }
    setBusy(true); setError(null); setInvalidField(undefined);
    try {
      const input = memberPayoutAccountInput(method, form);
      const response = memberUserId ? await setMemberPayoutAccount(companyId, memberUserId, input) : await setMyPayoutAccount(companyId, input);
      setAccount(response.account); setEditing(false); setForm(emptyPayoutAccountForm());
      toast.success(own ? 'บันทึกบัญชีรับเงินคืนแล้ว' : 'บันทึกบัญชีรับเงินคืนแล้ว ระบบแจ้งเจ้าของบัญชีให้ตรวจ');
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!(await confirm({
      title: 'ลบบัญชีรับเงินคืนประจำ',
      message: 'ใบเบิกที่ส่งไปแล้วยังใช้บัญชีเดิมของใบนั้น ร่างที่ยังไม่ส่งจะต้องเลือกวิธีรับเงินคืนใหม่ก่อนส่งอนุมัติ',
      confirmLabel: 'ลบบัญชี', cancelLabel: 'กลับ', variant: 'danger',
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
            <form className="space-y-3" onSubmit={save} noValidate>
              <div role="radiogroup" aria-label="วิธีรับเงินคืนประจำ" className="grid gap-2 sm:grid-cols-2">
                {(['BANK_TRANSFER', 'CASH'] as const).map((option) => (
                  <label key={option} className={cx(choiceClass, method === option && 'border-brand-300 bg-brand-25')}>
                    <input type="radio" name={`payout-method-${memberUserId ?? 'me'}`} className="mt-0.5 h-5 w-5 shrink-0" checked={method === option}
                      disabled={busy} onChange={() => { setMethod(option); setError(null); }} />
                    <span>{PAYOUT_METHOD_TEXT[option]}</span>
                  </label>
                ))}
              </div>
              {method === 'BANK_TRANSFER' && <PayoutAccountFields value={form} onChange={(next) => { setForm(next); setError(null); setInvalidField(undefined); }} disabled={busy} invalidField={invalidField} />}
              {!own && <p className="text-xs text-gray-500">หลังบันทึก คุณจะเห็นเฉพาะ 4 ตัวท้าย และเจ้าของบัญชีจะได้รับแจ้งเตือนให้ตรวจ</p>}
              {error && <ErrorBanner message={error} />}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} onClick={() => { setEditing(false); setError(null); }}>ยกเลิก</button>
                <button type="submit" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึกบัญชี'}</button>
              </div>
            </form>
          ) : (
            <>
              {!account ? <p className="text-sm text-gray-600">ยังไม่ได้ตั้งบัญชีรับเงินคืนประจำ</p> : account.payoutMethod === 'CASH' ? (
                <div className="text-sm font-semibold text-gray-900">{PAYOUT_METHOD_TEXT.CASH}</div>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-xs font-semibold text-gray-500">ชื่อบัญชี</dt><dd className="mt-1 break-words text-sm text-gray-900">{account.accountName}</dd></div>
                  <div>
                    <dt className="text-xs font-semibold text-gray-500">บัญชี</dt>
                    <dd className="mt-1">
                      <AccountNumberReveal masked={payoutAccountLine(account)} revealKey={`${companyId}:${account.userId}:${account.updatedAt}`} canReveal={own}
                        last4={account.accountLast4} onReveal={async () => (await revealMyPayoutAccount(companyId)).accountNumber} />
                    </dd>
                  </div>
                </dl>
              )}
              {setBy && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{setBy} ตรวจว่าเป็นบัญชีของ{own ? 'คุณ' : 'พนักงาน'}</p>}
              {error && <ErrorBanner message={error} />}
              {canEdit && mayEdit ? (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} onClick={startEdit}>{account ? 'แก้ไขบัญชี' : 'ตั้งบัญชีรับเงินคืน'}</button>
                  {own && account && <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={busy} onClick={() => void remove()}>ลบบัญชี</button>}
                </div>
              ) : <p className="text-xs text-gray-500">บัญชีนี้ตั้งหรือแก้ได้โดยเจ้าของบัญชี เจ้าของกิจการ หรือผู้ดูแลบริษัท ส่วนผู้จัดการและฝ่ายบุคคลตั้งให้ได้เฉพาะพนักงานในสาขาที่ตนดูแล</p>}
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
  return line ? <p className="mt-0.5 break-words text-xs font-semibold text-gray-500">บัญชีรับเงินคืน: {line}</p> : null;
}

/**
 * "รับเงินคืนทาง" on the claim form. A claim follows the requester's default account unless it says
 * otherwise; the account is always the requester's, also when someone else prepares the claim.
 */
export function ClaimPayoutFormSection({ value, onChange, forSelf, defaultAccount, current, canSaveAsDefault, payoutAccountHref, invalidField }: {
  value: ClaimPayoutForm;
  onChange: (next: ClaimPayoutForm) => void;
  /** The person filling the form is the requester. */
  forSelf: boolean;
  /** The requester's own default when `forSelf`: undefined while loading, null when none is set. */
  defaultAccount?: MemberPayoutAccountSummary | null;
  /** An existing draft's account for this claim, masked. */
  current?: ReimbursementPayoutSummary | null;
  /** The server's answer: this viewer may save a typed account as the requester's default. */
  canSaveAsDefault: boolean;
  payoutAccountHref: string;
  invalidField?: string;
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
      <input type="radio" name="claim-payout-mode" className="mt-0.5 h-5 w-5 shrink-0" checked={value.mode === mode} onChange={() => choose(mode)} />
      <span className="min-w-0">
        <span className="block font-semibold text-gray-900">{label}</span>
        {hint && <span className="mt-0.5 block break-words text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
  return (
    <MangmeeCard className="p-4 [overflow-wrap:anywhere]">
      <h3 className="text-sm font-bold text-gray-900">รับเงินคืนทาง</h3>
      <div role="radiogroup" aria-label="รับเงินคืนทาง" className="mt-3 space-y-2">
        {option('DEFAULT', forSelf ? 'ตามบัญชีรับเงินคืนประจำของฉัน' : 'ตามบัญชีรับเงินคืนประจำของผู้เบิก', defaultHint)}
        {forSelf && defaultAccount && setByOtherLine(defaultAccount) && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{setByOtherLine(defaultAccount)} ตรวจว่าเป็นบัญชีของคุณ</p>
        )}
        {option('CASH', PAYOUT_METHOD_TEXT.CASH!)}
        {hasOwnAccount && option('KEEP', 'ใช้บัญชีที่ระบุไว้ในใบนี้', `${payoutAccountLine(current)}${current?.accountName ? ` · ${current.accountName}` : ''}`)}
        {option('SPECIFIED', hasOwnAccount ? 'ระบุบัญชีใหม่สำหรับใบนี้' : 'ระบุบัญชีสำหรับใบนี้',
          forSelf ? null : 'กรอกบัญชีของผู้เบิก หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย')}
      </div>
      {value.mode === 'SPECIFIED' && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <PayoutAccountFields value={value.account} onChange={(account) => onChange({ ...value, account })} invalidField={invalidField} />
          {canSaveAsDefault && (
            <label className="flex min-h-11 items-start gap-3 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={value.saveAsDefault}
                onChange={(event) => onChange({ ...value, saveAsDefault: event.target.checked })} />
              <span>{forSelf ? 'บันทึกเป็นบัญชีประจำของฉัน' : 'บันทึกเป็นบัญชีประจำของผู้เบิก'}</span>
            </label>
          )}
        </div>
      )}
      {forSelf && <Link href={payoutAccountHref} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-700 underline underline-offset-4">จัดการบัญชีรับเงินคืนของฉัน</Link>}
    </MangmeeCard>
  );
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
export function ClaimPayoutCard({ companyId, detail, userId, editHref, payoutAccountHref, canWithdraw = false, payStep = false }: {
  companyId: string;
  detail: any;
  userId: string;
  editHref?: string;
  payoutAccountHref: string;
  /** The viewer may still take this sent claim back to a draft (the page's own withdraw action). */
  canWithdraw?: boolean;
  /** The claim waits for its payment and this viewer is offered to record it. */
  payStep?: boolean;
}) {
  const payout: ReimbursementPayoutSummary | undefined = detail.payout;
  const view = claimPayoutView(detail);
  const defaultChanged = payoutDefaultChangedHint(detail, canWithdraw);
  // A draft whose payout block was not loaded (an action response): say nothing rather than guess.
  if (view.state === 'unknown') return null;
  const isRequester = detail.requesterUserId === userId;
  // Present only for a viewer the server lets pay this legacy claim, whose requester has an account.
  const legacyDefault: ReimbursementLegacyPayoutDefault | undefined = view.state === 'legacy' ? detail.legacyPayoutDefault ?? undefined : undefined;
  // Side by side on purpose: people, not the system, judge whether the two names belong together.
  const names = (accountName?: string) => (
    <dl className="grid grid-cols-2 gap-3">
      <div className="min-w-0"><dt className="text-xs font-semibold text-gray-500">ผู้เบิก</dt><dd className="mt-1 break-words text-sm font-semibold text-gray-900">{detail.requesterDisplayNameSnapshot ?? '—'}</dd></div>
      <div className="min-w-0"><dt className="text-xs font-semibold text-gray-500">ชื่อบัญชี</dt><dd className="mt-1 break-words text-sm font-semibold text-gray-900">{accountName ?? '—'}</dd></div>
    </dl>
  );
  const reveal = async () => (await revealClaimPayoutAccount(companyId, detail.id)).accountNumber;
  return (
    <MangmeeCard className="space-y-3 p-4 [overflow-wrap:anywhere] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Only the claim's own approved account is an instruction; a legacy claim's default is shown under its own label. */}
        <h2 className="font-bold text-gray-900">{payStep && view.state === 'transfer' ? 'โอนเข้าบัญชีนี้' : 'การรับเงินคืน'}</h2>
        {payout?.payoutMethod && <MangmeeBadge tone={payout.payoutMethod === 'CASH' ? 'slate' : 'teal'}>{PAYOUT_METHOD_TEXT[payout.payoutMethod]}</MangmeeBadge>}
      </div>
      {view.state === 'legacy' && (
        <>
          <p className="text-sm text-gray-600">{view.line}</p>
          {legacyDefault ? (
            <>
              <p className="text-sm font-semibold text-gray-900">{LEGACY_DEFAULT_LABEL}</p>
              {names(legacyDefault.accountName)}
              {/* The claim's own reveal call: it answers this payer with the requester's default, and records it. */}
              <AccountNumberReveal masked={maskedPayoutAccount(legacyDefault)} revealKey={`${detail.id}:default:${legacyDefault.confirmToken}`} canReveal
                last4={legacyDefault.accountLast4} onReveal={reveal} />
            </>
          ) : payStep && <p className="text-sm text-gray-700">{LEGACY_ASK_REQUESTER_NOTE}</p>}
        </>
      )}
      {view.state === 'missing' && (
        <>
          <ErrorBanner message={view.line} />
          <div className="flex flex-col gap-2 sm:flex-row">
            {editHref && <Link href={editHref} className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')}>เลือกวิธีรับเงินคืนในใบนี้</Link>}
            {isRequester && <Link href={payoutAccountHref} className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')}>ตั้งบัญชีรับเงินคืนของฉัน</Link>}
          </div>
        </>
      )}
      {view.state === 'cash' && <p className="text-sm text-gray-700">ผู้เบิกขอรับเป็นเงินสด ไม่ต้องมีบัญชี</p>}
      {view.state === 'transfer' && payout && (
        <>
          {names(payout.accountName)}
          <AccountNumberReveal masked={view.line} revealKey={`${detail.id}:${payout.version ?? ''}`} canReveal={payout.canRevealAccountNumber === true}
            last4={payout.accountLast4} onReveal={reveal} />
        </>
      )}
      {view.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-gray-500">{view.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      )}
      {defaultChanged && <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{defaultChanged}</p>}
    </MangmeeCard>
  );
}

/** "ตรวจบัญชีแล้ว": the approver's attestation of the account shown above, required to approve a transfer claim. */
export function PayoutAttestationCheck({ checked, onChange, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-start gap-3 rounded-xl border border-gray-200 p-3 text-sm text-gray-700">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="block font-semibold text-gray-900">{PAYOUT_ATTESTATION_TEXT}</span>
        <span className="mt-0.5 block text-xs text-gray-500">ดูชื่อบัญชี เลขบัญชี และธนาคารในการ์ดการรับเงินคืนด้านบน ระบบบันทึกชื่อคุณและเวลาที่ตรวจ</span>
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
        <span className="block font-semibold text-gray-900">{PAYER_CONFIRMATION_TEXT}{confirmation.required && ' *'}</span>
        <span className="mt-0.5 block text-xs text-gray-600">{confirmation.accountLine}</span>
        {confirmation.note && <span className="mt-0.5 block text-xs text-gray-500">{confirmation.note}</span>}
      </span>
    </label>
  );
}
