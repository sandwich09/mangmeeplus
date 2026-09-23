'use client';

import Link from 'next/link';
import { billingProfileReturnHref } from '@/features/billing/billing-profile-navigation';
import { AccountEmailOtpPanel } from '@/features/auth/AccountEmailOtpPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { todayCivilDate, DBD_TSIC_ACTIVITIES, COMPANY_BUSINESS_TYPE_OTHER_MAX, type CompanyIdentityResponse, type CompanyLegalAddress, type VatRegistrationStatus } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ChevronDownIcon } from '@/common/icons';
import { TextField } from '@/common/components/field';
import { ThaiAddressFields } from '@/common/components/field/ThaiAddressFields';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import {
  getAccountProfile,
  getCompanyIdentity,
  patchCompanyIdentity,
  patchCompanyBusinessType,
  putVatRegistration,
  setMyFirstPassword,
  setMyPhoneNumber,
  type AccountProfileState,
} from './company-profile.api';
import {
  addressErrorMessages,
  buildShopSave,
  clearChecklistCache,
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
  const canManageSignature = permissions.some((permission) => ['expense.signature.self_manage', 'expense.review', 'expense.confirm', 'expense.signature.manage'].includes(permission));
  const toast = useToast();
  const [section, setSection] = useState<'shop' | 'account'>('shop');
  const [identity, setIdentity] = useState<CompanyIdentityResponse | null>(null);
  const [emailLoginEnabled, setEmailLoginEnabled] = useState(false);
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
  const [businessTypeCode, setBusinessTypeCode] = useState('');
  const [businessTypeOther, setBusinessTypeOther] = useState('');
  const [businessTypeError, setBusinessTypeError] = useState<string | null>(null);

  // บัญชีของฉัน
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [billingReturnHref, setBillingReturnHref] = useState<string | null>(null);
  useEffect(() => { setBillingReturnHref(billingProfileReturnHref(companyId, window.location.search)); }, [companyId]);

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
        setBusinessTypeCode(nextIdentity.identity.businessType?.code ?? '');
        setBusinessTypeOther(nextIdentity.identity.businessType?.other ?? '');
      }
      setVatChoice(nextIdentity.vatRegistration?.status ?? 'UNKNOWN');
      setPhone(nextAccount.phoneNumber ?? '');
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
      if (id) {
        setSection(id === 'account' ? 'account' : 'shop');
        requestAnimationFrame(() => {
          if (id === 'vat-status') document.getElementById(id)?.scrollIntoView({ block: 'start' });
          else window.scrollTo({ top: 0 });
        });
      }
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

  const saveShop = async () => {
    if (!control || !canEditShop) return;
    setShopError(null);
    setVatError(null);
    setBusinessTypeError(null);
    const plan = buildShopSave(
      control,
      full ? { registeredName: full.registeredName, taxId: full.taxId, addressJson: full.addressJson as Record<string, unknown> | null, businessType: full.businessType } : null,
      { registeredName, taxId, address, businessTypeCode, businessTypeOther },
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
      // These writes are independent: attempt each changed section and preserve typed values
      // even when another section fails.
      if (plan.businessTypePatch) {
        try { await patchCompanyBusinessType(companyId, plan.businessTypePatch); }
        catch (error) { failed = true; setBusinessTypeError(apiErrorMessage(error)); }
      }
      if (plan.vatStatus && identity?.vatRegistration) {
        try {
          await putVatRegistration(companyId, {
            // The command registry is already scoped by companyId; including a long company ID
            // can exceed the API's 64-character commandId limit.
            commandId: `profile-vat-${plan.vatStatus}-${identity.vatRegistration.version}`,
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
      if (!failed && billingReturnHref) window.location.assign(billingReturnHref);
    } finally {
      setShopSaving(false);
    }
  };


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

  if (loading && !identity) {
    return (
      <MangmeePage eyebrow="ตั้งค่า" title="ข้อมูลร้านและบัญชีของฉัน">
        <LoadingState label="กำลังโหลด..." />
      </MangmeePage>
    );
  }

  if (loadError && !identity) {
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

  return (
    <MangmeePage
      eyebrow="ตั้งค่า"
      title="ข้อมูลร้านและบัญชีของฉัน"
      description="เลือกเรื่องที่ต้องการแก้ไข ข้อมูลร้านใช้ในเอกสาร ส่วนบัญชีเป็นข้อมูลส่วนตัวของคุณ"
    >
      <nav aria-label="หมวดการตั้งค่า" className="mb-6 flex gap-1 border-b border-gray-200">
        {(['shop', 'account'] as const).map(value => <button type="button" key={value}
          aria-pressed={section === value} onClick={() => {
            setSection(value);
            window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${value}`);
          }} className={`min-h-12 border-b-2 px-5 py-3 text-base font-semibold ${section === value ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-brand-700'}`}>
          {value === 'shop' ? 'ข้อมูลร้าน' : 'บัญชีของฉัน'}
        </button>)}
      </nav>
      {loadError && <Banner tone="error">{loadError}</Banner>}
      <div className="grid gap-5">
        <div hidden={section !== 'shop'}>
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
            <div>
              <label htmlFor="business-type" className="mb-2 block text-sm font-medium text-gray-900">ประเภทธุรกิจ</label>
              <ThemedSelect
                id="business-type" aria-label="ประเภทธุรกิจ" searchable
                searchPlaceholder="ค้นหาชื่อธุรกิจหรือรหัส TSIC"
                value={businessTypeCode} disabled={!canEditShop || shopSaving}
                onChange={(event) => {
                  setBusinessTypeCode(event.target.value);
                  if (event.target.value !== 'OTHER') setBusinessTypeOther('');
                }}
              >
                <option value="">ยังไม่ระบุ</option>
                <option value="OTHER">อื่น ๆ</option>
                {DBD_TSIC_ACTIVITIES.map((row) => <option key={row.code} value={row.code}>{`${row.code} — ${row.label}`}</option>)}
              </ThemedSelect>
              <p className="mt-1 text-sm text-gray-500">เลือกกิจกรรมหลักของร้าน อ้างอิง <a href="https://tsic.dbd.go.th/index" target="_blank" rel="noreferrer" className="underline">รหัสธุรกิจ DBD (TSIC)</a></p>
            </div>
            {businessTypeCode === 'OTHER' && (
              <TextField label="ระบุประเภทธุรกิจอื่น ๆ" value={businessTypeOther}
                maxLength={COMPANY_BUSINESS_TYPE_OTHER_MAX} required
                disabled={!canEditShop || shopSaving}
                onChange={(event) => setBusinessTypeOther(event.target.value)} />
            )}
            {businessTypeError && <Banner tone="error">{businessTypeError}</Banner>}
            <TextField
              label="ชื่อจดทะเบียน"
              value={registeredName}
              disabled={!canEditShop || shopSaving}
              hint="ใช้ชื่อจดทะเบียนบนใบแจ้งหนี้และใบเสร็จ หากเว้นว่างจะใช้ชื่อร้านที่สมัครไว้"
              onChange={(event) => setRegisteredName(event.target.value)}
            />
            <TextField
              label="เลขผู้เสียภาษี"
              value={taxId}
              inputMode="numeric"
              disabled={!canEditShop || shopSaving}
              hint="ตัวเลข 13 หลัก"
              onChange={(event) => setTaxId(event.target.value.replace(/[^0-9]/g, '').slice(0, 13))}
            />
            <ThaiAddressFields companyId={companyId} required disabled={!canEditShop || shopSaving}
              value={{ postalCode: address.postalCode ?? '', province: address.province ?? '', district: address.district ?? '', subdistrict: address.subdistrict ?? '' }}
              onChange={(next) => setAddress((current) => ({ ...current, ...next }))} />
            <div className="grid gap-4 sm:grid-cols-2">
              {addressField('line1', 'ที่อยู่ (บ้านเลขที่ ถนน)')}
              {addressField('line2', 'ที่อยู่เพิ่มเติม', false)}
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
                {shopSaving ? 'กำลังบันทึก...' : billingReturnHref ? 'บันทึกและกลับไปซื้อแพ็กเกจ' : 'บันทึกข้อมูลร้าน'}
              </button>
              {billingReturnHref && <Link href={billingReturnHref} className={LINK_BUTTON}>กลับไปซื้อแพ็กเกจ</Link>}
            </div>
          )}
        </MangmeeCard>
        </div>

        <div id="account" hidden={section !== 'account'} className="scroll-mt-24">
          <h2 className="sr-only">บัญชีของฉัน</h2>

          <AccountEmailOtpPanel onState={next => {
            setEmailLoginEnabled(Boolean(next.emailLoginEnabled));
            setAccount(current => current && ({ ...current, email: next.email, emailVerified: next.emailVerified, pendingEmail: next.emailRequirement === 'CHANGE_PENDING' ? next.challenge?.email ?? null : null }));
            invalidateChecklist();
          }} />

          <details className="mangmee-card group mt-5 p-5 sm:p-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <span><span className="block text-base font-semibold text-gray-900">เบอร์มือถือ</span><span className="mt-1 block text-sm text-gray-500">{account?.phoneNumber || 'ยังไม่ได้ระบุเบอร์มือถือ'}</span></span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-brand-700"><span className="group-open:hidden">แก้ไข</span><span className="hidden group-open:inline">ปิด</span><ChevronDownIcon aria-hidden="true" className="h-5 w-5 group-open:rotate-180" /></span>
            </summary>
            <div className="mt-4 grid gap-4">
            <TextField
              label="เบอร์มือถือ"
              value={phone}
              inputMode="numeric"
              autoComplete="tel-national"
              disabled={phoneSaving}
              hint={PHONE_HINT}
              onChange={(event) => setPhone(event.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
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
          </details>

          <details className="mangmee-card group mt-5 p-5 sm:p-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <span><span className="block text-base font-semibold text-gray-900">รหัสผ่านสำรอง</span><span className="mt-1 block text-sm text-gray-500">{account?.hasPassword ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า'}</span></span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-brand-700"><span className="group-open:hidden">จัดการ</span><span className="hidden group-open:inline">ปิด</span><ChevronDownIcon aria-hidden="true" className="h-5 w-5 group-open:rotate-180" /></span>
            </summary>
            <div className="mt-4 grid gap-4">
            <h3 className="text-sm font-semibold text-gray-900">ตั้งรหัสผ่านสำรอง</h3>
            {account?.hasPassword ? (
              <p className="text-sm text-gray-600">
                บัญชีนี้มีรหัสผ่านอยู่แล้วค่ะ{' '}
                <Link className="font-semibold text-brand-700 underline underline-offset-4" href="/change-password">เปลี่ยนรหัสผ่าน</Link>
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-600">
                  ตั้งรหัสผ่านสำรองได้ตามสะดวก หากเพิ่งยืนยันตัวตนไม่เกิน 5 นาที กรอกรหัสผ่านใหม่ได้เลย
                </p>
                {emailLoginEnabled ? <Link className="mangmee-btn mangmee-btn-secondary min-h-11 text-base" href={`/email-access?next=${encodeURIComponent(`/companies/${companyId}/settings/profile#account`)}`}>รับรหัสทางอีเมลเพื่อยืนยันตัวตนอีกครั้ง</Link> : <Link className="mangmee-btn mangmee-btn-secondary min-h-11 text-base" href={`/api/auth/line-login/start?purpose=email-reauth&returnTo=${encodeURIComponent(`/companies/${companyId}/settings/profile#account`)}`}>ยืนยันตัวตนผ่าน LINE ก่อนตั้งรหัสผ่าน</Link>}
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
          </details>
          {canManageSignature && <MangmeeCard className="mt-5 p-5 sm:p-6">
            <h3 className="text-base font-semibold text-gray-900">ลายเซ็นของฉัน</h3>
            <p className="mt-1 text-sm text-gray-600">เพิ่มหรือเปลี่ยนลายเซ็นส่วนตัวเมื่อต้องใช้ลงนามเอกสาร</p>
            <Link className="mangmee-btn mangmee-btn-secondary mt-4 w-full sm:w-auto" href={`/companies/${companyId}/expenses/signatures`}>
              จัดการลายเซ็น
            </Link>
          </MangmeeCard>}
        </div>
      </div>
    </MangmeePage>
  );
}
