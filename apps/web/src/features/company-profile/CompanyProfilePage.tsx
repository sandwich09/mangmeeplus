'use client';
import { useLockedShell } from '@/features/plan-term/LockedShellScope';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { notifyCompanyProfileChanged } from '../web-core-workspace/workspace-scope.api';

import Link from 'next/link';
import { AccountDisplayName } from './AccountDisplayName';
import { billingProfileReturnHref } from '@/features/billing/billing-profile-navigation';
import { billingApi } from '@/features/billing/billing.api';
import { AccountEmailOtpPanel } from '@/features/auth/AccountEmailOtpPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { THAI_SYSTEM_ROLE_NAMES, todayCivilDate, DBD_TSIC_ACTIVITIES, COMPANY_BUSINESS_TYPE_OTHER_MAX, type CompanyIdentityResponse, type CompanyLegalAddress, type VatRegistrationStatus } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { secondaryButtonClass } from '@/common/components/button/button-classes';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
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
  checkoutAddressDiffers,
  checkoutAddressText,
  checkoutAddressToForm,
  clearChecklistCache,
  isThaiMobileInput,
  passwordFormError,
  sectionIdFromHash,
  usernameFieldRequired,
  NO_CHANGES_MESSAGE,
  OWN_SIGNATURE_PERMISSIONS,
  TAX_ID_ERROR_MESSAGE,
  companyProfileReturnPath,
  companyProfileReturnLabel,
  withholdingProfileReturnPath,
  PHONE_ERROR_MESSAGE,
  PHONE_HINT,
} from './company-profile.logic';

const EMPTY_ADDRESS: CompanyLegalAddress = {
  line1: '', line2: '', subdistrict: '', district: '', province: '', postalCode: '',
};

/** The page's notices in the shared look; `note` is a plain remark (read-only, nothing wrong). */
function Banner({ tone, children }: { tone: 'error' | 'ok' | 'note'; children: React.ReactNode }) {
  return <Notice tone={tone === 'ok' ? 'success' : tone === 'note' ? 'info' : 'error'}>{children}</Notice>;
}

/** Who may open the settings hub: the way back is offered only to them (others came from a document page). */
const SETTINGS_HUB_PERMISSIONS = ['company.settings.view', 'company.setup.manage'];

/** Full width on a phone; from `sm` up its own width at the right end, under the last field (thai-ux-standard §3.2). */
const ACTION_BUTTON = 'mangmee-btn w-full sm:w-auto sm:justify-self-end';
const LINK_BUTTON = 'justify-self-start text-sm font-medium text-brand-700 underline underline-offset-4 hover:text-brand-800 disabled:no-underline disabled:opacity-50';

export function CompanyProfilePage({ companyId, permissions, accountOnly = false }: { companyId: string; permissions: readonly string[]; accountOnly?: boolean }) {
  // The API gates on these same keys; disabling here is so a member is not invited to type into a
  // box whose every save comes back 403 (FINANCE holds vat_registration.read but not .manage).
  const canManageShop = permissions.includes('company.legal_identity.manage');
  const canManageVat = permissions.includes('company.vat_registration.manage');
  const lockedShell = useLockedShell();
  const canManageSignature = !lockedShell && permissions.some((permission) => OWN_SIGNATURE_PERMISSIONS.includes(permission));
  const toast = useToast();
  const [section, setSection] = useState<'shop' | 'account'>(accountOnly ? 'account' : 'shop');
  const [identity, setIdentity] = useState<CompanyIdentityResponse | null>(null);
  const [emailLoginEnabled, setEmailLoginEnabled] = useState(false);
  const [account, setAccount] = useState<AccountProfileState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ข้อมูลร้าน
  const [displayName, setDisplayName] = useState('');
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
  const [checkoutAddress, setCheckoutAddress] = useState<CompanyLegalAddress | null>(null);
  const [checkoutFilled, setCheckoutFilled] = useState(false);
  const [certificateReturnHref, setCertificateReturnHref] = useState<string | null>(null);
  const [shopSaved, setShopSaved] = useState(false);
  const [withholdingReturnHref, setWithholdingReturnHref] = useState<string | null>(null);
  useEffect(() => { setWithholdingReturnHref(withholdingProfileReturnPath(companyId, window.location.search)); }, [companyId]);
  useEffect(() => { setCertificateReturnHref(companyProfileReturnPath(companyId, window.location.search)); }, [companyId]);

  // L1: the dashboard card caches its answer for 10 minutes, so without this the item the owner
  // just completed keeps reading as missing on the next dashboard visit.
  const invalidateChecklist = useCallback(() => {
    clearChecklistCache(typeof window === 'undefined' ? undefined : window.sessionStorage, companyId);
    if (typeof window !== 'undefined') notifyCompanyProfileChanged();
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
      const [nextIdentity, nextAccount] = await Promise.all([accountOnly ? Promise.resolve(null) : getCompanyIdentity(companyId), getAccountProfile()]);
      setIdentity(nextIdentity);
      setAccount(nextAccount);
      if (seeded.current) return;
      seeded.current = true;
      if (nextIdentity?.identity && !nextIdentity.identity.masked) {
        setDisplayName(nextIdentity.identity.displayName);
        setRegisteredName(nextIdentity.identity.registeredName ?? '');
        setTaxId(nextIdentity.identity.taxId ?? '');
        setAddress({ ...EMPTY_ADDRESS, ...(nextIdentity.identity.addressJson ?? {}) });
        setBusinessTypeCode(nextIdentity.identity.businessType?.code ?? '');
        setBusinessTypeOther(nextIdentity.identity.businessType?.other ?? '');
      }
      setVatChoice(nextIdentity?.vatRegistration?.status ?? 'UNKNOWN');
      setPhone(nextAccount.phoneNumber ?? '');
    } catch (error) {
      setLoadError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [companyId, accountOnly]);

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
        if (id === 'account' && !accountOnly) { window.location.replace(`/companies/${companyId}/account`); return; }
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
  // DQ5: the address typed at Stripe Checkout, offered — never written — to this form. The billing
  // status needs company.plan.manage; without it (or on any failure) the offer simply does not show.
  const canManagePlan = permissions.includes('company.plan.manage');
  // Offered only while the SAVED address is incomplete (the server's own readiness reason): a shop with
  // a full address has nothing to fill, and one click would swap its sub-district for a blank.
  const checkoutFill = checkoutAddress && identity?.readiness.identity?.reasons.includes('company_address_incomplete')
    ? checkoutAddressToForm(checkoutAddress) : null;
  useEffect(() => {
    if (!canEditShop || !canManagePlan) return;
    let active = true;
    void billingApi(companyId).status().then((status) => { if (active) setCheckoutAddress(status.checkoutAddress ?? null); }).catch(() => {});
    return () => { active = false; };
  }, [canEditShop, canManagePlan, companyId]);
  const masked = identity?.identity && identity.identity.masked ? identity.identity : null;
  const shopMissing = [
    ['ชื่อจดทะเบียน', ['registered_name_missing']],
    ['เลขผู้เสียภาษี', ['tax_id_missing', 'tax_id_invalid']],
    ['ที่อยู่', ['company_address_incomplete']],
  ] as const;
  const missingShopLabels = shopMissing.filter(([, reasons]) => reasons.some(reason => identity?.readiness.identity?.reasons.includes(reason))).map(([label]) => label);
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
      full ? { displayName: full.displayName, registeredName: full.registeredName, taxId: full.taxId, addressJson: full.addressJson as Record<string, unknown> | null, businessType: full.businessType } : null,
      { displayName, registeredName, taxId, address, businessTypeCode, businessTypeOther },
      { current: serverVatStatus, chosen: vatChoice },
    );
    if ('error' in plan) {
      // F29: nothing to save on the way back to a purchase is not an error — just go back.
      if (plan.error === NO_CHANGES_MESSAGE && billingReturnHref) { window.location.assign(billingReturnHref); return; }
      setShopError(plan.error);
      return;
    }
    setShopSaving(true);
    setShopSaved(false);
    let failed = false;
    try {
      if (plan.identityPatch) {
        try {
          await patchCompanyIdentity(companyId, plan.identityPatch as never);
          if (plan.identityPatch.displayName !== undefined) {
            setDisplayName(displayName.trim());
            notifyCompanyProfileChanged();
          }
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
      if (!failed && !withholdingReturnHref) toast.success('บันทึกข้อมูลร้านแล้ว');
      if (!failed) setShopSaved(true);
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
      toast.success(saved.phoneNumber ? 'บันทึกเบอร์มือถือแล้ว' : 'ลบเบอร์มือถือแล้ว');
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
        ? `ตั้งรหัสผ่านสำรองแล้ว ชื่อผู้ใช้ของคุณคือ ${saved.username}`
        : 'ตั้งรหัสผ่านสำรองแล้ว');
      await load();
    } catch (error) {
      setPasswordError(apiErrorMessage(error));
    } finally {
      setPasswordSaving(false);
    }
  };

  const certificateReturnLabel = companyProfileReturnLabel(certificateReturnHref);
  const pageTitle = accountOnly ? 'บัญชีของฉัน' : 'ข้อมูลร้าน';
  const back = permissions.some((permission) => SETTINGS_HUB_PERMISSIONS.includes(permission))
    ? <BackLink href={`/companies/${companyId}/settings`} label="กลับไปตั้งค่า" />
    : undefined;

  if (loading && !(accountOnly ? account : identity)) {
    return (
      <MangmeePage back={back} title={pageTitle}>
        <LoadingState label="กำลังโหลด…" />
      </MangmeePage>
    );
  }

  if (loadError && !(accountOnly ? account : identity)) {
    return (
      <MangmeePage back={back} title={pageTitle}>
        <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => void load()} aria-busy={Boolean(loading)}>ลองอีกครั้ง</button>}>
          {loadError}
        </Notice>
      </MangmeePage>
    );
  }

  // No stars: the whole address may wait; when one box is filled the save asks for the rest by name.
  const addressField = (key: keyof CompanyLegalAddress, label: string) => (
    <TextField
      label={label}
      value={address[key] ?? ''}
      disabled={!canEditShop || shopSaving}
      onChange={(event) => setAddress((current) => ({ ...current, [key]: event.target.value }))}
    />
  );

  return (
    <MangmeePage back={back} title={pageTitle}>
      {!accountOnly && <nav aria-label="หมวดการตั้งค่า" className="flex gap-1 border-b border-gray-200">
        <span className="min-h-12 border-b-2 border-brand-600 px-5 py-3 font-semibold">ข้อมูลร้าน</span>
        <Link className="min-h-12 px-5 py-3 font-semibold text-brand-700" href={`/companies/${companyId}/account`}>บัญชีของฉัน</Link>
      </nav>}
      {loadError && <Banner tone="error">{loadError}</Banner>}
      <div className="grid gap-5">
        {!accountOnly && <div id="shop" hidden={section !== 'shop'} className="scroll-mt-24 flex min-h-full flex-col gap-5">
        <MangmeeCard className="p-5 sm:p-6">
          <p className="mb-4 text-sm text-gray-600">ใช้พิมพ์บนใบเสร็จและเอกสารของร้าน กรอกภายหลังได้</p>
          {missingShopLabels.length > 0 && <Notice tone="warning">ข้อมูลร้านยังขาด: {missingShopLabels.join(' · ')} · {canEditShop ? 'กรอกช่องที่แจ้งไว้แล้วบันทึก' : 'ให้เจ้าของกิจการหรือผู้มีสิทธิ์แก้ข้อมูลร้านกรอกช่องที่แจ้งไว้'}</Notice>}
          {certificateReturnHref && <Link href={certificateReturnHref} className={`${LINK_BUTTON} mb-4 inline-block`}>{certificateReturnLabel}</Link>}
          {!canEditShop && (
            <div className="mb-4">
              <Banner tone="note">
                {full
                  ? `ข้อมูลนี้คุณดูได้อย่างเดียว ${THAI_SYSTEM_ROLE_NAMES.OWNER}เป็นคนแก้`
                  : `คุณเห็นข้อมูลร้านได้บางส่วน ${THAI_SYSTEM_ROLE_NAMES.OWNER}เห็นและแก้ได้ทั้งหมด`}
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
            <TextField label="ชื่อร้าน" value={displayName} required maxLength={200}
              disabled={!canEditShop || shopSaving}
              error={shopError?.startsWith('ชื่อร้าน') ? shopError : undefined}
              onChange={(event) => setDisplayName(event.target.value)} />
            <div>
              <label htmlFor="business-type" className="mb-2 block text-sm font-medium text-gray-900">ประเภทธุรกิจ</label>
              <ThemedSelect
                id="business-type" aria-label="ประเภทธุรกิจ" searchable
                searchPlaceholder="ค้นหาชื่อธุรกิจหรือรหัสประเภทธุรกิจ"
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
              <p className="mt-1 text-sm text-gray-500">เลือกงานหลักของร้าน พิมพ์ค้นหาได้</p>
            </div>
            {businessTypeCode === 'OTHER' && (
              <TextField label="ระบุประเภทธุรกิจอื่น ๆ" value={businessTypeOther}
                maxLength={COMPANY_BUSINESS_TYPE_OTHER_MAX} required
                disabled={!canEditShop || shopSaving}
                onChange={(event) => setBusinessTypeOther(event.target.value)} />
            )}
            {businessTypeError && <Banner tone="error">{businessTypeError}</Banner>}
            <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="ชื่อจดทะเบียน"
              value={registeredName}
              showRequiredMark={!full?.displayName?.trim()}
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
              error={shopError === TAX_ID_ERROR_MESSAGE ? shopError : undefined}
              onChange={(event) => setTaxId(event.target.value.replace(/[^0-9]/g, '').slice(0, 13))}
            />
            </div>
            <p className="text-sm font-medium text-gray-900">ที่อยู่ร้าน <span className="font-normal text-gray-500">(ถ้ากรอก ให้กรอกครบทุกช่อง)</span></p>
            <ThaiAddressFields companyId={companyId} disabled={!canEditShop || shopSaving}
              value={{ postalCode: address.postalCode ?? '', province: address.province ?? '', district: address.district ?? '', subdistrict: address.subdistrict ?? '' }}
              onChange={(next) => setAddress((current) => ({ ...current, ...next }))} />
            <div className="grid gap-4 sm:grid-cols-2">
              {addressField('line1', 'ที่อยู่ (บ้านเลขที่ ถนน)')}
              {addressField('line2', 'ที่อยู่เพิ่มเติม')}
              {canEditShop && checkoutAddress && checkoutFill && checkoutAddressDiffers(checkoutAddress, address) && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm sm:col-span-2">
                  <p>มีที่อยู่ที่กรอกไว้ตอนชำระเงิน: <span className="break-words">{checkoutAddressText(checkoutAddress)}</span></p>
                  <button type="button" className={`${ACTION_BUTTON} mangmee-btn-secondary mt-2`} disabled={shopSaving}
                    onClick={() => { setAddress((current) => ({ ...current, ...checkoutFill })); setCheckoutFilled(true); }}>ใช้ที่อยู่จากการชำระเงิน</button>
                  <p className="mt-1 text-gray-600">เติมลงฟอร์มให้ตรวจก่อน ยังไม่บันทึกจนกว่าจะกดบันทึกข้อมูลร้าน</p>
                </div>
              )}
              {checkoutFilled && !address.subdistrict?.trim() && (
                <p role="status" className="text-sm text-amber-800 sm:col-span-2">หน้าชำระเงินไม่มีช่องตำบล/แขวง เลือกตำบล/แขวงอีกครั้งก่อนบันทึก</p>
              )}
            </div>
          </div>
          )}

          {identity?.vatRegistration && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <label className="text-sm font-medium text-gray-900" htmlFor="vat-status">ร้านจดทะเบียน VAT หรือยัง</label>
              <p className="mt-1 mb-3 text-sm text-gray-600">
                {canManageVat
                  ? 'ระบบใช้คำตอบนี้ออกเอกสารภาษีของร้าน'
                  : `คำตอบนี้คุณดูได้อย่างเดียว ${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้ทำบัญชีเป็นคนตอบ`}
              </p>
              {/* The answer is form state, nothing more. It used to save on change and reload the
                  page's data, which re-seeded — and so erased — everything typed above (UAT
                  2026-09-06). `UNKNOWN` stays disabled: a shop cannot un-answer the question. */}
              <ThemedSelect
                id="vat-status"
                aria-label="ร้านจดทะเบียน VAT หรือยัง"
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
        </MangmeeCard>
          {canEditShop && (
            <>
              {shopError === NO_CHANGES_MESSAGE
                ? <p role="status" className="text-sm text-gray-500 sm:justify-self-end">{shopError}</p>
                : shopError && shopError !== TAX_ID_ERROR_MESSAGE && !shopError.startsWith('ชื่อร้าน') && <Banner tone="error">{shopError}</Banner>}
              {withholdingReturnHref && shopSaved && <Notice tone="success" action={<Link className="underline" href={withholdingReturnHref}>กลับไปภาษีหัก ณ ที่จ่าย</Link>}>บันทึกข้อมูลร้านแล้ว</Notice>}
              <FormActionBar><ActionGroup>
              {billingReturnHref && <Link href={billingReturnHref} className={`${ACTION_BUTTON} mangmee-btn-secondary`}>กลับไปซื้อแพ็กเกจ</Link>}
              <button
                type="button"
                className={`${ACTION_BUTTON} ${certificateReturnHref && shopSaved ? 'mangmee-btn-secondary' : 'mangmee-btn-primary'}`}
                disabled={shopSaving} aria-busy={Boolean(shopSaving)}
                onClick={() => void saveShop()}
              >
                {shopSaving ? 'กำลังบันทึก...' : billingReturnHref ? 'บันทึกและกลับไปซื้อแพ็กเกจ' : 'บันทึกข้อมูลร้าน'}
              </button>
              {certificateReturnHref && shopSaved && <Link href={certificateReturnHref} className={`${ACTION_BUTTON} mangmee-btn-primary`}>{certificateReturnLabel}</Link>}
              </ActionGroup></FormActionBar>
            </>
          )}
        </div>}

        {accountOnly && <div id="account" hidden={section !== 'account'} className="scroll-mt-24">

          <AccountDisplayName companyId={companyId} />
          <AccountEmailOtpPanel onState={next => {
            setEmailLoginEnabled(Boolean(next.emailLoginEnabled));
            setAccount(current => current && ({ ...current, email: next.email, emailVerified: next.emailVerified, pendingEmail: next.emailRequirement === 'CHANGE_PENDING' ? next.challenge?.email ?? null : null }));
            invalidateChecklist();
          }} refreshKey={account} />

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
            <FormActionBar><ActionGroup>
              {account?.phoneNumber && (
                <button type="button" className={`${ACTION_BUTTON} mangmee-btn-danger`} disabled={phoneSaving} aria-busy={Boolean(phoneSaving)} onClick={() => void savePhoneValue('')}>
                  ลบเบอร์ออก
                </button>
              )}
              <button
                type="button"
                className={`${ACTION_BUTTON} mangmee-btn-primary`}
                disabled={phoneSaving} aria-busy={Boolean(phoneSaving)}
                onClick={() => void savePhoneValue(phone.trim())}
              >
                {phoneSaving ? 'กำลังบันทึก...' : 'บันทึกเบอร์มือถือ'}
              </button>
            </ActionGroup></FormActionBar>
            </div>
          </details>

          {account?.hasPassword ? (
            <MangmeeCard className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 p-5 sm:p-6">
              <span><span className="block text-base font-semibold text-gray-900">รหัสผ่านสำรอง</span><span className="mt-1 block text-sm text-gray-500">ตั้งค่าแล้ว</span></span>
              <Link className={`${secondaryButtonClass} w-full sm:w-auto`} href="/change-password">เปลี่ยนรหัสผ่าน</Link>
            </MangmeeCard>
          ) : (
          <details className="mangmee-card group mt-5 p-5 sm:p-6">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
              <span><span className="block text-base font-semibold text-gray-900">รหัสผ่านสำรอง</span><span className="mt-1 block text-sm text-gray-500">ยังไม่ได้ตั้งค่า</span></span>
              <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-brand-700"><span className="group-open:hidden">จัดการ</span><span className="hidden group-open:inline">ปิด</span><ChevronDownIcon aria-hidden="true" className="h-5 w-5 group-open:rotate-180" /></span>
            </summary>
            <div className="mt-4 grid gap-4">
            <h3 className="text-sm font-semibold text-gray-900">จัดการรหัสผ่านสำรอง</h3>
              <>
                <p className="text-sm text-gray-600">
                  ตั้งรหัสผ่านสำรองได้ตามสะดวก หากเพิ่งยืนยันตัวตนไม่เกิน 5 นาที กรอกรหัสผ่านใหม่ได้เลย
                </p>
                {emailLoginEnabled && account?.email?.trim() ? <Link className="mangmee-btn mangmee-btn-secondary min-h-11 text-base" href={`/email-access?next=${encodeURIComponent(`/companies/${companyId}/account`)}`}>รับรหัสทางอีเมลเพื่อยืนยันตัวตนอีกครั้ง</Link> : account?.lineLinked ? <Link className="mangmee-btn mangmee-btn-secondary min-h-11 text-base" href={`/api/auth/line-login/start?purpose=email-reauth&returnTo=${encodeURIComponent(`/companies/${companyId}/account`)}`}>ยืนยันตัวตนผ่าน LINE ก่อนตั้งรหัสผ่าน</Link> : null}
                {usernameRequired ? (
                  <TextField
                    label="ชื่อผู้ใช้"
                    value={newUsername}
                    autoComplete="username"
                    disabled={passwordSaving}
                    required
                    hint="ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์ ตัวอักษรอังกฤษพิมพ์เล็ก ตัวเลข จุด ขีดกลาง หรือขีดล่าง ตั้งแต่ 4 ถึง 64 ตัว"
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
                    หลังตั้งรหัสผ่านแล้ว ใช้อีเมล <strong className="text-gray-900">{account.email}</strong> คู่กับรหัสผ่านเข้าเว็บได้
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
                <FormActionBar><ActionGroup><button
                  type="button"
                  className={`${ACTION_BUTTON} mangmee-btn-primary`}
                  disabled={passwordSaving} aria-busy={Boolean(passwordSaving)}
                  onClick={() => void savePassword()}
                >
                  {passwordSaving ? 'กำลังบันทึก...' : 'ตั้งรหัสผ่านสำรอง'}
                </button></ActionGroup></FormActionBar>
              </>
            </div>
          </details>
          )}
          {canManageSignature && <MangmeeCard className="mt-5 p-5 sm:p-6">
            <h3 className="text-base font-semibold text-gray-900">ลายเซ็นของฉัน</h3>
            <p className="mt-1 text-sm text-gray-600">เพิ่มหรือเปลี่ยนลายเซ็นส่วนตัวเมื่อต้องใช้เซ็นเอกสาร</p>
            <Link className="mangmee-btn mangmee-btn-secondary mt-4 w-full sm:w-auto" href={`/companies/${companyId}/expenses/signatures`}>
              จัดการลายเซ็น
            </Link>
          </MangmeeCard>}
        </div>}
      </div>
    </MangmeePage>
  );
}
