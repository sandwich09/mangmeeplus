'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayCivilDate, type CompanyIdentityResponse, type CompanyLegalAddress, type VatRegistrationStatus } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { TextField } from '@/common/components/field';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import {
  getAccountProfile,
  getCompanyIdentity,
  patchCompanyIdentity,
  putVatRegistration,
  requestMyEmailVerification,
  resendMyEmailVerification,
  setMyFirstPassword,
  setMyPhoneNumber,
  setMyUnverifiedEmail,
  type AccountProfileState,
} from './company-profile.api';
import {
  addressErrorMessages,
  buildShopSave,
  clearChecklistCache,
  emailSectionMode,
  isThaiMobileInput,
  passwordFormError,
  sectionIdFromHash,
  usernameFieldRequired,
  PHONE_ERROR_MESSAGE,
  PHONE_HINT,
} from './company-profile.logic';

const EMPTY_ADDRESS: CompanyLegalAddress = {
  line1: '', line2: '', subdistrict: '', district: '', province: '', postalCode: '',
};

const SUPPORT_CONTACT = 'ติดต่อทีมงานได้ที่ โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com นะคะ';
/** The id `TextField` derives, so the "เปลี่ยนอีเมล" button can move focus into the box it opens. */
const EMAIL_FIELD_ID = 'account-email';

function Banner({ tone, children }: { tone: 'error' | 'ok' | 'note'; children: React.ReactNode }) {
  const className = tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';
  return <p className={`rounded-lg border px-3 py-2 text-sm ${className}`}>{children}</p>;
}

function SectionHeading({ id, title, hint }: { id: string; title: string; hint: string }) {
  return (
    <div className="mb-4">
      <h2 id={id} className="scroll-mt-24 text-base font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-600">{hint}</p>
    </div>
  );
}

/** Full width on a phone, content width from `sm` up — the product is used on phones first. */
const ACTION_BUTTON = 'mangmee-btn w-full sm:w-auto sm:justify-self-start';
const LINK_BUTTON = 'justify-self-start text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800 disabled:no-underline disabled:opacity-50';

export function CompanyProfilePage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  // The API gates on these same keys; disabling here is so a member is not invited to type into a
  // box whose every save comes back 403 (FINANCE holds vat_registration.read but not .manage).
  const canManageShop = permissions.includes('company.legal_identity.manage');
  const canManageVat = permissions.includes('company.vat_registration.manage');
  const toast = useToast();
  const [identity, setIdentity] = useState<CompanyIdentityResponse | null>(null);
  const [account, setAccount] = useState<AccountProfileState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ข้อมูลร้าน
  const [registeredName, setRegisteredName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [address, setAddress] = useState<CompanyLegalAddress>(EMPTY_ADDRESS);
  const [vatChoice, setVatChoice] = useState<VatRegistrationStatus>('UNKNOWN');
  const [shopError, setShopError] = useState<string | null>(null);
  const [vatError, setVatError] = useState<string | null>(null);
  const [shopSaving, setShopSaving] = useState(false);

  // บัญชีของฉัน
  const [email, setEmail] = useState('');
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailPassword, setEmailPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailErrorCode, setEmailErrorCode] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // L1: the dashboard card caches its answer for 10 minutes, so without this the item the owner
  // just completed keeps reading as missing on the next dashboard visit.
  const invalidateChecklist = useCallback(() => {
    clearChecklistCache(typeof window === 'undefined' ? undefined : window.sessionStorage, companyId);
  }, [companyId]);

  /**
   * UAT 2026-09-06: every save used to end in a full re-read that copied the server's values back
   * into the form. Choosing the VAT status therefore wiped the ชื่อจดทะเบียน / เลขภาษี / ที่อยู่ the
   * owner had typed but not yet saved. The re-read stays — it is what refreshes
   * `legalIdentityVersion`, the VAT version and `readiness` — but it seeds the boxes once only;
   * each save writes back the one value it owns.
   */
  const seeded = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextIdentity, nextAccount] = await Promise.all([getCompanyIdentity(companyId), getAccountProfile()]);
      setIdentity(nextIdentity);
      setAccount(nextAccount);
      if (seeded.current) return;
      seeded.current = true;
      if (nextIdentity.identity && !nextIdentity.identity.masked) {
        setRegisteredName(nextIdentity.identity.registeredName ?? '');
        setTaxId(nextIdentity.identity.taxId ?? '');
        setAddress({ ...EMPTY_ADDRESS, ...(nextIdentity.identity.addressJson ?? {}) });
      }
      setVatChoice(nextIdentity.vatRegistration?.status ?? 'UNKNOWN');
      setPhone(nextAccount.phoneNumber ?? '');
      setEmail(nextAccount.lineLinked && !nextAccount.emailVerified
        ? nextAccount.email ?? ''
        : nextAccount.pendingEmail ?? nextAccount.email ?? '');
    } catch (error) {
      setLoadError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  // Both sections mount only after the two reads land, so by the time they exist the browser has
  // already performed its native fragment jump — against an empty page. `#account` from the day-7
  // กันหลุด nudge therefore left the owner at the top of the page, looking at the shop form.
  //
  // No `behavior: 'smooth'`: an unrequested animation is exactly what `prefers-reduced-motion`
  // asks us not to do, and the default instant jump is what a fragment would have done anyway.
  const jumpedToHash = useRef(false);
  useEffect(() => {
    if (loading || loadError) return undefined;
    const jump = () => {
      const id = sectionIdFromHash(window.location.hash);
      if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
    };
    if (!jumpedToHash.current) {
      jumpedToHash.current = true;
      jump();
    }
    // A hash change while mounted is a same-page navigation React does not re-render for.
    window.addEventListener('hashchange', jump);
    return () => window.removeEventListener('hashchange', jump);
  }, [loading, loadError]);

  const control = identity?.control;
  const full = identity?.identity && !identity.identity.masked ? identity.identity : null;
  // Two separate facts: `legal_identity.read` un-masks the values, `legal_identity.manage` allows
  // the write. Editing needs both — typing over values you cannot see is destructive, and typing
  // values you may not save is a 403 dressed up as a form.
  const canEditShop = full !== null && canManageShop;
  const masked = identity?.identity && identity.identity.masked ? identity.identity : null;
  const serverVatStatus = identity?.vatRegistration?.status ?? 'UNKNOWN';
  // `PasswordLoginUseCase` looks accounts up by username OR the stored account email. With neither, a
  // password would be unusable, so the username stops being optional.
  const usernameRequired = usernameFieldRequired(account);
  const emailMode = emailSectionMode(account, emailEditing);
  const directEmailEdit = Boolean(account?.lineLinked && !account.emailVerified);

  const saveShop = async () => {
    if (!control || !canEditShop) return;
    setShopError(null);
    setVatError(null);
    const plan = buildShopSave(
      control,
      full ? { registeredName: full.registeredName, taxId: full.taxId, addressJson: full.addressJson as Record<string, unknown> | null } : null,
      { registeredName, taxId, address },
      { current: serverVatStatus, chosen: vatChoice },
    );
    if ('error' in plan) {
      setShopError(plan.error);
      return;
    }
    setShopSaving(true);
    let failed = false;
    try {
      if (plan.identityPatch) {
        try {
          await patchCompanyIdentity(companyId, plan.identityPatch as never);
        } catch (error) {
          failed = true;
          // `invalid addressJson` arrives with per-field details and no code, so the generic
          // sentence would tell the owner to reload when the real answer is "จังหวัด is empty".
          const fields = addressErrorMessages(error);
          setShopError(fields.length > 0 ? fields.join(' · ') : apiErrorMessage(error));
        }
      }
      // Attempted even when the identity half failed: the two are independent writes behind one
      // press, and nothing typed is lost either way.
      if (plan.vatStatus && identity?.vatRegistration) {
        try {
          await putVatRegistration(companyId, {
            commandId: `profile-vat-${companyId}-${plan.vatStatus}-${identity.vatRegistration.version}`,
            expectedVersion: identity.vatRegistration.version,
            command: { kind: 'UPSERT_FACT', status: plan.vatStatus, effectiveFrom: todayCivilDate('Asia/Bangkok') },
          });
        } catch (error) {
          failed = true;
          setVatError(apiErrorMessage(error));
        }
      }
      invalidateChecklist();
      if (!failed) toast.success('บันทึกข้อมูลร้านแล้วค่ะ');
      await load();
    } finally {
      setShopSaving(false);
    }
  };

  const startEmailEdit = () => {
    setEmailError(null);
    setEmailErrorCode(null);
    setEmailSent(false);
    setEmail(directEmailEdit ? account?.email ?? '' : account?.pendingEmail ?? account?.email ?? '');
    setEmailEditing(true);
  };

  // The button that reveals the box is not the box: without this the owner has to hunt for it.
  useEffect(() => {
    if (emailEditing) document.getElementById(EMAIL_FIELD_ID)?.focus();
  }, [emailEditing]);

  const saveEmail = async () => {
    setEmailError(null);
    setEmailErrorCode(null);
    setEmailSent(false);
    if (!email.trim()) {
      setEmailError('กรอกอีเมลก่อนนะคะ');
      return;
    }
    setEmailSaving(true);
    try {
      if (directEmailEdit) {
        const saved = await setMyUnverifiedEmail(
          email.trim(),
          account?.email ?? null,
          account?.hasPassword ? emailPassword : undefined,
        );
        setEmail(saved.email);
        toast.success('บันทึกอีเมลบัญชีแล้วค่ะ');
      } else {
        await requestMyEmailVerification(email.trim(), account?.hasPassword ? emailPassword : undefined);
        setEmailSent(true);
      }
      invalidateChecklist();
      setEmailEditing(false);
      setEmailPassword('');
      await load();
    } catch (error) {
      setEmailError(apiErrorMessage(error));
      setEmailErrorCode(apiErrorCode(error));
    } finally {
      setEmailSaving(false);
    }
  };

  const verifyAccountEmail = async () => {
    if (!account?.email) return;
    setEmailError(null);
    setEmailErrorCode(null);
    setEmailSaving(true);
    try {
      await requestMyEmailVerification(account.email, account.hasPassword ? emailPassword : undefined);
      setEmailSent(true);
      setEmailPassword('');
      await load();
    } catch (error) {
      setEmailError(apiErrorMessage(error));
      setEmailErrorCode(apiErrorCode(error));
    } finally {
      setEmailSaving(false);
    }
  };

  const resendEmail = async () => {
    setEmailError(null);
    setEmailErrorCode(null);
    setEmailSaving(true);
    try {
      await resendMyEmailVerification();
      setEmailSent(true);
      await load();
    } catch (error) {
      setEmailError(apiErrorMessage(error));
      setEmailErrorCode(apiErrorCode(error));
    } finally {
      setEmailSaving(false);
    }
  };

  /** Blank clears the stored number; the button that sends blank says so in words. */
  const savePhoneValue = async (next: string) => {
    setPhoneError(null);
    if (next && !isThaiMobileInput(next)) {
      setPhoneError(PHONE_ERROR_MESSAGE);
      return;
    }
    setPhoneSaving(true);
    try {
      const saved = await setMyPhoneNumber(next);
      // The stored form is normalised; showing it back is what the re-read used to do.
      setPhone(saved.phoneNumber ?? '');
      toast.success(saved.phoneNumber ? 'บันทึกเบอร์มือถือแล้วค่ะ' : 'ลบเบอร์มือถือแล้วค่ะ');
      await load();
    } catch (error) {
      setPhoneError(apiErrorMessage(error));
    } finally {
      setPhoneSaving(false);
    }
  };

  const savePassword = async () => {
    const invalid = passwordFormError(account, { password, confirmPassword, username: newUsername });
    setPasswordError(invalid);
    if (invalid) return;
    setPasswordSaving(true);
    try {
      const saved = await setMyFirstPassword(password, newUsername.trim() || undefined);
      setPassword('');
      setConfirmPassword('');
      setNewUsername('');
      // The stored form is lower-cased and the login box matches it case-sensitively, so telling
      // them what to type is the difference between a backup password and a locked door.
      invalidateChecklist();
      toast.success(saved.username
        ? `ตั้งรหัสผ่านสำรองแล้วค่ะ ชื่อผู้ใช้ของคุณคือ ${saved.username}`
        : 'ตั้งรหัสผ่านสำรองแล้วค่ะ');
      await load();
    } catch (error) {
      setPasswordError(apiErrorMessage(error));
    } finally {
      setPasswordSaving(false);
    }
  };

  if (loading) {
    return (
      <MangmeePage eyebrow="ตั้งค่า" title="ข้อมูลร้านและบัญชีของฉัน">
        <LoadingState label="กำลังโหลด..." />
      </MangmeePage>
    );
  }

  if (loadError) {
    return (
      <MangmeePage eyebrow="ตั้งค่า" title="ข้อมูลร้านและบัญชีของฉัน">
        <MangmeeCard className="p-5 sm:p-6">
          <div className="grid gap-3">
            <Banner tone="error">{loadError}</Banner>
            <button type="button" className={`${ACTION_BUTTON} mangmee-btn-primary`} onClick={() => void load()}>
              ลองใหม่
            </button>
          </div>
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const addressField = (key: keyof CompanyLegalAddress, label: string, required = true) => (
    <TextField
      label={label}
      value={address[key] ?? ''}
      disabled={!canEditShop || shopSaving}
      required={required}
      onChange={(event) => setAddress((current) => ({ ...current, [key]: event.target.value }))}
    />
  );

  const emailErrorBanner = emailError && (
    <Banner tone="error">
      {emailErrorCode === 'email_belongs_to_other_account' ? (
        <>
          อีเมลนี้มีบัญชีอื่นใช้อยู่แล้วค่ะ ถ้าเป็นบัญชีของคุณเอง เข้าสู่ระบบด้วยบัญชีเดิมแล้วผูก LINE
          เข้ากับบัญชีนั้น ระบบจะเสนอให้รวมบัญชีให้เอง{' '}
          <Link className="underline" href="/login">ไปหน้าเข้าสู่ระบบ</Link>
        </>
      ) : emailErrorCode === 'account_email_conflict' ? (
        <>อีเมลนี้มีบัญชีอื่นใช้อยู่แล้วค่ะ กรุณาใช้อีเมลอื่น อีเมลบัญชีของคุณยังไม่เปลี่ยน</>
      ) : emailErrorCode === 'account_email_changed' ? (
        <>อีเมลบัญชีถูกเปลี่ยนจากอีกหน้าหรืออุปกรณ์แล้วค่ะ โหลดหน้านี้ใหม่ก่อนแก้อีกครั้ง</>
      ) : emailErrorCode === 'account_email_verified' ? (
        <>อีเมลบัญชีนี้ยืนยันแล้วค่ะ โหลดหน้านี้ใหม่เพื่อใช้ขั้นตอนเปลี่ยนอีเมลที่ยืนยันแล้ว</>
      ) : emailErrorCode === 'invalid_email' ? (
        <>รูปแบบอีเมลไม่ถูกต้องค่ะ เช่น somchai@gmail.com</>
      ) : emailError}
    </Banner>
  );

  return (
    <MangmeePage
      eyebrow="ตั้งค่า"
      title="ข้อมูลร้านและบัญชีของฉัน"
      description="กรอกทีหลังได้ ไม่ต้องกรอกครบก็ใช้งานได้ตามปกติค่ะ"
    >
      <div className="grid gap-5">
        <MangmeeCard className="p-5 sm:p-6">
          <SectionHeading
            id="shop"
            title="ข้อมูลร้าน"
            hint="ใช้ตอนออกใบกำกับภาษีและเอกสารทางการ ถ้ายังไม่มีก็เว้นไว้ก่อนได้ค่ะ"
          />
          {!canEditShop && (
            <div className="mb-4">
              <Banner tone="note">
                {full
                  ? 'บัญชีของคุณดูข้อมูลนี้ได้อย่างเดียว ถ้าต้องการแก้ไข ให้เจ้าของร้านเป็นคนแก้นะคะ'
                  : 'บัญชีของคุณเห็นข้อมูลนี้ได้บางส่วน ถ้าต้องการดูหรือแก้ไขทั้งหมด ให้เจ้าของร้านเป็นคนทำนะคะ'}
              </Banner>
            </div>
          )}
          {/* A caller with only `company.setup.read` gets the masked block the API actually sent —
              last four of the tax id and the province — instead of an editable form full of blanks
              that would have overwritten real values with empty ones. */}
          {masked ? (
            <dl className="grid gap-3 text-sm" data-testid="masked-identity">
              <div><dt className="text-gray-600">ชื่อร้าน</dt><dd className="font-medium text-gray-900">{masked.displayName}</dd></div>
              <div><dt className="text-gray-600">ชื่อจดทะเบียน</dt><dd className="font-medium text-gray-900">{masked.registeredName ?? 'ยังไม่ได้กรอก'}</dd></div>
              <div>
                <dt className="text-gray-600">เลขผู้เสียภาษี</dt>
                <dd className="font-medium text-gray-900">{masked.taxIdLast4 ? `ลงท้าย ${masked.taxIdLast4}` : 'ยังไม่ได้กรอก'}</dd>
              </div>
              <div><dt className="text-gray-600">จังหวัด</dt><dd className="font-medium text-gray-900">{masked.addressProvince ?? 'ยังไม่ได้กรอก'}</dd></div>
            </dl>
          ) : (
          <div className="grid gap-4">
            <TextField
              label="ชื่อจดทะเบียน"
              value={registeredName}
              disabled={!canEditShop || shopSaving}
              hint="ชื่อตามหนังสือรับรอง ไม่ใช่ชื่อร้านที่ใช้เรียกกัน"
              onChange={(event) => setRegisteredName(event.target.value)}
            />
            <TextField
              label="เลขผู้เสียภาษี"
              value={taxId}
              inputMode="numeric"
              disabled={!canEditShop || shopSaving}
              hint="ตัวเลข 13 หลัก"
              onChange={(event) => setTaxId(event.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {addressField('line1', 'ที่อยู่ (บ้านเลขที่ ถนน)')}
              {addressField('line2', 'ที่อยู่เพิ่มเติม', false)}
              {addressField('subdistrict', 'ตำบล / แขวง')}
              {addressField('district', 'อำเภอ / เขต')}
              {addressField('province', 'จังหวัด')}
              {addressField('postalCode', 'รหัสไปรษณีย์')}
            </div>
          </div>
          )}

          {identity?.vatRegistration && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <label className="text-sm font-medium text-gray-900" htmlFor="vat-status">ร้านจดทะเบียน VAT หรือยัง</label>
              <p className="mt-1 mb-3 text-sm text-gray-600">
                {canManageVat
                  ? 'ตอบไว้เพื่อให้ระบบออกเอกสารภาษีได้ถูกต้องค่ะ แล้วกดปุ่มบันทึกด้านล่างครั้งเดียว'
                  : 'บัญชีของคุณดูได้อย่างเดียว ให้เจ้าของร้านหรือผู้ทำบัญชีเป็นคนตอบนะคะ'}
              </p>
              {/* The answer is form state, nothing more. It used to save on change and reload the
                  page's data, which re-seeded — and so erased — everything typed above (UAT
                  2026-09-06). `UNKNOWN` stays disabled: a shop cannot un-answer the question. */}
              <ThemedSelect
                id="vat-status"
                className="mangmee-input"
                value={vatChoice}
                disabled={shopSaving || !canManageVat}
                onChange={(event) => setVatChoice(event.target.value as VatRegistrationStatus)}
              >
                <option value="UNKNOWN" disabled>ยังไม่ได้ตอบ</option>
                <option value="REGISTERED">จดทะเบียน VAT แล้ว</option>
                <option value="NOT_REGISTERED">ยังไม่ได้จดทะเบียน VAT</option>
              </ThemedSelect>
              {vatError && <div className="mt-3"><Banner tone="error">{vatError}</Banner></div>}
            </div>
          )}

          {canEditShop && (
            <div className="mt-6 grid gap-4 border-t border-gray-200 pt-5">
              {shopError && <Banner tone="error">{shopError}</Banner>}
              <button
                type="button"
                className={`${ACTION_BUTTON} mangmee-btn-primary`}
                disabled={shopSaving} aria-busy={Boolean(shopSaving)}
                onClick={() => void saveShop()}
              >
                {shopSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลร้าน'}
              </button>
            </div>
          )}
        </MangmeeCard>

        <MangmeeCard className="p-5 sm:p-6">
          <SectionHeading
            id="account"
            title="บัญชีของฉัน"
            hint="เผื่อวันหนึ่งเปลี่ยนมือถือแล้ว LINE หลุด จะได้กลับเข้าร้านได้ค่ะ"
          />

          <div className="grid gap-4">
            {/* The read-only blocks need a caption; the two form modes get theirs from the box. */}
            {emailMode !== 'edit' && emailMode !== 'none' && (
              <div className="text-sm font-medium text-gray-700">
                {emailMode === 'unverified' ? 'อีเมลบัญชี' : 'อีเมล'}
              </div>
            )}

            {/* §15.4.1 C: with no mailer there is nothing to offer, so nothing is offered. */}
            {emailMode === 'unavailable' && (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
                  <span className="font-medium">{account?.email ?? 'ยังไม่ได้กรอกอีเมล'}</span>
                  {account?.emailVerified && <MangmeeBadge tone="lime">ยืนยันแล้ว</MangmeeBadge>}
                </p>
                <Banner tone="note">
                  ระบบนี้ยังเปิดส่งอีเมลยืนยันไม่ได้ {SUPPORT_CONTACT}
                </Banner>
              </>
            )}

            {/* §15.4.1 B: a verified address is a fact, not an open box under a button whose only
                possible answer is the API's 409 "already verified for your account". */}
            {emailMode === 'verified' && (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
                  <span className="font-medium">{account?.email}</span>
                  <MangmeeBadge tone="lime">ยืนยันแล้ว</MangmeeBadge>
                </p>
                <button type="button" className={LINK_BUTTON} onClick={startEmailEdit}>เปลี่ยนอีเมล</button>
              </>
            )}

            {emailMode === 'unverified' && (
              <>
                <p className="flex flex-wrap items-center gap-2 text-sm text-gray-900">
                  <span className="font-medium">{account?.email}</span>
                  <MangmeeBadge tone="amber">ยังไม่ยืนยัน</MangmeeBadge>
                </p>
                <p className="text-sm text-gray-600">
                  {account?.hasPassword
                    ? 'ใช้อีเมลนี้คู่กับรหัสผ่านเพื่อเข้าเว็บได้ แต่อีเมลยังใช้กู้บัญชีไม่ได้จนกว่าจะยืนยัน'
                    : 'อีเมลนี้ใช้เข้าเว็บได้หลังจากตั้งรหัสผ่านสำรองด้านล่าง'}
                </p>
                <button type="button" className={LINK_BUTTON} onClick={startEmailEdit}>แก้ไขอีเมลบัญชี</button>
                {account && account.emailDeliveryEnabled !== false && (
                  <div className="mt-1 grid gap-3 rounded-lg border border-gray-200 p-3">
                    <p className="text-sm font-semibold text-gray-900">ยืนยันอีเมลเพื่อกู้บัญชี</p>
                    {account.pendingEmail ? (
                      <>
                        <Banner tone={emailSent ? 'ok' : 'note'}>
                          ส่งลิงก์ยืนยันไปที่ {account.pendingEmail} แล้ว รอการยืนยัน (ลิงก์มีอายุ 15 นาที)
                          {' '}ถ้าไม่ได้รับอีเมล {SUPPORT_CONTACT}
                        </Banner>
                        {emailErrorBanner}
                        <button
                          type="button"
                          className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto sm:justify-self-start"
                          disabled={emailSaving} aria-busy={Boolean(emailSaving)}
                          onClick={() => void resendEmail()}
                        >
                          {emailSaving ? 'กำลังส่ง...' : 'ส่งลิงก์อีกครั้ง'}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-sm text-gray-600">ระบบจะส่งลิงก์ยืนยันไปที่อีเมลบัญชีนี้</p>
                        {account?.hasPassword && (
                          <TextField
                            label="รหัสผ่านปัจจุบันสำหรับยืนยันอีเมล"
                            type="password"
                            value={emailPassword}
                            autoComplete="current-password"
                            disabled={emailSaving}
                            onChange={(event) => setEmailPassword(event.target.value)}
                          />
                        )}
                        {emailErrorBanner}
                        <button
                          type="button"
                          className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto sm:justify-self-start"
                          disabled={emailSaving} aria-busy={Boolean(emailSaving)}
                          onClick={() => void verifyAccountEmail()}
                        >
                          {emailSaving ? 'กำลังส่ง...' : 'ส่งลิงก์ยืนยัน'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {emailMode === 'pending' && (
              <>
                <Banner tone={emailSent ? 'ok' : 'note'}>
                  ส่งลิงก์ยืนยันไปที่ {account?.pendingEmail} แล้ว รอการยืนยัน (ลิงก์มีอายุ 15 นาที)
                  {' '}ถ้าไม่ได้รับอีเมล {SUPPORT_CONTACT}
                </Banner>
                {emailErrorBanner}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto"
                    disabled={emailSaving} aria-busy={Boolean(emailSaving)}
                    onClick={() => void resendEmail()}
                  >
                    {emailSaving ? 'กำลังส่ง...' : 'ส่งลิงก์อีกครั้ง'}
                  </button>
                  <button type="button" className={LINK_BUTTON} disabled={emailSaving} aria-busy={Boolean(emailSaving)} onClick={startEmailEdit}>เปลี่ยนอีเมล</button>
                </div>
              </>
            )}

            {(emailMode === 'edit' || emailMode === 'none') && (
              <>
                <TextField
                  id={EMAIL_FIELD_ID}
                  label={directEmailEdit ? 'อีเมลบัญชี' : 'อีเมล'}
                  aria-label={directEmailEdit ? 'อีเมลบัญชี' : 'อีเมล'}
                  type="email"
                  maxLength={254}
                  value={email}
                  disabled={emailSaving}
                  hint={directEmailEdit
                    ? 'ใช้คู่กับรหัสผ่านสำรองเพื่อเข้าเว็บได้ การบันทึกนี้ยังไม่ใช่การยืนยันอีเมล'
                    : 'เราจะส่งลิงก์ยืนยันไปที่อีเมลนี้'}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {account?.hasPassword && (
                  <TextField
                    label="รหัสผ่านปัจจุบัน"
                    type="password"
                    value={emailPassword}
                    autoComplete="current-password"
                    disabled={emailSaving}
                    hint="ยืนยันว่าเป็นคุณจริง ก่อนเปลี่ยนอีเมล"
                    onChange={(event) => setEmailPassword(event.target.value)}
                  />
                )}
                {emailErrorBanner}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    className="mangmee-btn mangmee-btn-primary w-full sm:w-auto"
                    disabled={emailSaving} aria-busy={Boolean(emailSaving)}
                    onClick={() => void saveEmail()}
                  >
                    {emailSaving
                      ? directEmailEdit ? 'กำลังบันทึก...' : 'กำลังส่ง...'
                      : directEmailEdit ? 'บันทึกอีเมลบัญชี' : 'ส่งลิงก์ยืนยันอีเมล'}
                  </button>
                  {emailEditing && account?.email && (
                    <button type="button" className={LINK_BUTTON} disabled={emailSaving} onClick={() => setEmailEditing(false)}>
                      ยกเลิก
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="mt-6 grid gap-4 border-t border-gray-200 pt-5">
            <TextField
              label="เบอร์มือถือ"
              value={phone}
              inputMode="tel"
              disabled={phoneSaving}
              hint={PHONE_HINT}
              onChange={(event) => setPhone(event.target.value)}
            />
            {phoneError && <Banner tone="error">{phoneError}</Banner>}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                className="mangmee-btn mangmee-btn-secondary w-full sm:w-auto"
                disabled={phoneSaving} aria-busy={Boolean(phoneSaving)}
                onClick={() => void savePhoneValue(phone.trim())}
              >
                {phoneSaving ? 'กำลังบันทึก...' : 'บันทึกเบอร์มือถือ'}
              </button>
              {/* Clearing is still "save a blank", but the hint no longer has to explain that. */}
              {account?.phoneNumber && (
                <button type="button" className={LINK_BUTTON} disabled={phoneSaving} aria-busy={Boolean(phoneSaving)} onClick={() => void savePhoneValue('')}>
                  ลบเบอร์ออก
                </button>
              )}
            </div>
          </div>

          <div className="mt-6 grid gap-4 border-t border-gray-200 pt-5">
            <h3 className="text-sm font-semibold text-gray-900">ตั้งรหัสผ่านสำรอง</h3>
            {account?.hasPassword ? (
              <p className="text-sm text-gray-600">
                บัญชีนี้มีรหัสผ่านอยู่แล้วค่ะ{' '}
                <Link className="underline" href="/change-password">เปลี่ยนรหัสผ่าน</Link>
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  ตั้งไว้เพื่อเข้าใช้งานบนคอมพิวเตอร์โดยไม่ต้องใช้ LINE ไม่บังคับค่ะ
                </p>
                {usernameRequired ? (
                  <TextField
                    label="ชื่อผู้ใช้"
                    value={newUsername}
                    autoComplete="username"
                    disabled={passwordSaving}
                    required
                    hint="ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์ ตัวอักษร a-z ตัวเลข จุด ขีด อย่างน้อย 4 ตัว"
                    onChange={(event) => setNewUsername(event.target.value)}
                  />
                ) : account?.username ? (
                  // It used to offer an "optional" username box whose hint promised a login by
                  // verified email — in the one state where there is none — and whose real effect
                  // was to rename the login the account already has.
                  <p className="text-sm text-gray-600">
                    ชื่อผู้ใช้สำหรับเข้าจากคอมพิวเตอร์คือ <strong className="text-gray-900">{account.username}</strong>
                  </p>
                ) : account?.email ? (
                  <p className="text-sm text-gray-600">
                    หลังตั้งรหัสผ่านแล้ว ใช้อีเมล <strong className="text-gray-900">{account.email}</strong> เข้าเว็บได้
                  </p>
                ) : null}
                <TextField
                  label="รหัสผ่านใหม่"
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  disabled={passwordSaving}
                  hint="อย่างน้อย 8 ตัว"
                  onChange={(event) => setPassword(event.target.value)}
                />
                <TextField
                  label="พิมพ์รหัสผ่านอีกครั้ง"
                  type="password"
                  value={confirmPassword}
                  autoComplete="new-password"
                  disabled={passwordSaving}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
                {passwordError && <Banner tone="error">{passwordError}</Banner>}
                <button
                  type="button"
                  className={`${ACTION_BUTTON} mangmee-btn-primary`}
                  disabled={passwordSaving} aria-busy={Boolean(passwordSaving)}
                  onClick={() => void savePassword()}
                >
                  {passwordSaving ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านสำรอง'}
                </button>
              </>
            )}
          </div>
        </MangmeeCard>
      </div>
    </MangmeePage>
  );
}
