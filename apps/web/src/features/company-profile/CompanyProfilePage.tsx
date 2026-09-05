'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { todayCivilDate, type CompanyIdentityResponse, type CompanyLegalAddress, type VatFactStatus } from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
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
  setMyFirstPassword,
  setMyPhoneNumber,
  type AccountProfileState,
} from './company-profile.api';
import {
  addressErrorMessages,
  buildIdentityPatch,
  clearChecklistCache,
  isThaiMobileInput,
  passwordFormError,
  usernameFieldRequired,
} from './company-profile.logic';

const EMPTY_ADDRESS: CompanyLegalAddress = {
  line1: '', line2: '', subdistrict: '', district: '', province: '', postalCode: '',
};

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
  const [shopError, setShopError] = useState<string | null>(null);
  const [shopSaving, setShopSaving] = useState(false);
  const [vatSaving, setVatSaving] = useState(false);

  // บัญชีของฉัน
  const [email, setEmail] = useState('');
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

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextIdentity, nextAccount] = await Promise.all([getCompanyIdentity(companyId), getAccountProfile()]);
      setIdentity(nextIdentity);
      setAccount(nextAccount);
      if (nextIdentity.identity && !nextIdentity.identity.masked) {
        setRegisteredName(nextIdentity.identity.registeredName ?? '');
        setTaxId(nextIdentity.identity.taxId ?? '');
        setAddress({ ...EMPTY_ADDRESS, ...(nextIdentity.identity.addressJson ?? {}) });
      }
      setPhone(nextAccount.phoneNumber ?? '');
      setEmail(nextAccount.pendingEmail ?? nextAccount.email ?? '');
    } catch (error) {
      setLoadError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const control = identity?.control;
  const full = identity?.identity && !identity.identity.masked ? identity.identity : null;
  // Two separate facts: `legal_identity.read` un-masks the values, `legal_identity.manage` allows
  // the write. Editing needs both — typing over values you cannot see is destructive, and typing
  // values you may not save is a 403 dressed up as a form.
  const canEditShop = full !== null && canManageShop;
  const masked = identity?.identity && identity.identity.masked ? identity.identity : null;
  const vatStatus = identity?.vatRegistration?.status ?? 'UNKNOWN';
  // `PasswordLoginUseCase` looks accounts up by username OR verified email. With neither, a
  // password would be unusable, so the username stops being optional.
  const usernameRequired = usernameFieldRequired(account);

  const saveShop = async () => {
    if (!control || !canEditShop) return;
    setShopError(null);
    const patch = buildIdentityPatch(
      control,
      full ? { registeredName: full.registeredName, taxId: full.taxId, addressJson: full.addressJson as Record<string, unknown> | null } : null,
      { registeredName, taxId, address },
    );
    if ('error' in patch) {
      setShopError(patch.error);
      return;
    }
    setShopSaving(true);
    try {
      await patchCompanyIdentity(companyId, patch.body as never);
      invalidateChecklist();
      toast.success('บันทึกข้อมูลร้านแล้วค่ะ');
      await load();
    } catch (error) {
      // `invalid addressJson` arrives with per-field details and no code, so the generic sentence
      // would tell the owner to reload when the real answer is "จังหวัด is empty".
      const fields = addressErrorMessages(error);
      setShopError(fields.length > 0 ? fields.join(' · ') : apiErrorMessage(error));
    } finally {
      setShopSaving(false);
    }
  };

  const saveVat = async (status: VatFactStatus) => {
    if (!identity?.vatRegistration) return;
    setShopError(null);
    setVatSaving(true);
    try {
      await putVatRegistration(companyId, {
        commandId: `profile-vat-${companyId}-${status}-${identity.vatRegistration.version}`,
        expectedVersion: identity.vatRegistration.version,
        command: { kind: 'UPSERT_FACT', status, effectiveFrom: todayCivilDate('Asia/Bangkok') },
      });
      invalidateChecklist();
      toast.success('บันทึกสถานะ VAT แล้วค่ะ');
      await load();
    } catch (error) {
      setShopError(apiErrorMessage(error));
    } finally {
      setVatSaving(false);
    }
  };

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
      await requestMyEmailVerification(email.trim(), account?.hasPassword ? emailPassword : undefined);
      invalidateChecklist();
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

  const savePhone = async () => {
    setPhoneError(null);
    if (phone.trim() && !isThaiMobileInput(phone)) {
      setPhoneError('เบอร์มือถือต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0 ค่ะ');
      return;
    }
    setPhoneSaving(true);
    try {
      await setMyPhoneNumber(phone.trim());
      toast.success('บันทึกเบอร์มือถือแล้วค่ะ');
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
            <button type="button" className="mangmee-btn mangmee-btn-primary justify-self-start" onClick={() => void load()}>
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
            {shopError && <Banner tone="error">{shopError}</Banner>}
            {canEditShop && (
              <button
                type="button"
                className="mangmee-btn mangmee-btn-primary justify-self-start"
                disabled={shopSaving}
                onClick={() => void saveShop()}
              >
                {shopSaving ? 'กำลังบันทึก...' : 'บันทึกข้อมูลร้าน'}
              </button>
            )}
          </div>
          )}

          {identity?.vatRegistration && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <label className="text-sm font-medium text-gray-900" htmlFor="vat-status">ร้านจดทะเบียน VAT หรือยัง</label>
              <p className="mt-1 mb-3 text-sm text-gray-600">
                {canManageVat
                  ? 'ตอบไว้เพื่อให้ระบบออกเอกสารภาษีได้ถูกต้องค่ะ'
                  : 'บัญชีของคุณดูได้อย่างเดียว ให้เจ้าของร้านหรือผู้ทำบัญชีเป็นคนตอบนะคะ'}
              </p>
              <ThemedSelect
                id="vat-status"
                className="mangmee-input"
                value={vatStatus}
                disabled={vatSaving || !canManageVat}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === 'REGISTERED' || next === 'NOT_REGISTERED') void saveVat(next);
                }}
              >
                <option value="UNKNOWN" disabled>ยังไม่ได้ตอบ</option>
                <option value="REGISTERED">จดทะเบียน VAT แล้ว</option>
                <option value="NOT_REGISTERED">ยังไม่ได้จดทะเบียน VAT</option>
              </ThemedSelect>
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
            <TextField
              label="อีเมล"
              type="email"
              value={email}
              disabled={emailSaving}
              hint={
                account?.emailVerified
                  ? 'ยืนยันอีเมลแล้ว'
                  : account?.pendingEmail
                    ? `ส่งลิงก์ยืนยันไปที่ ${account.pendingEmail} แล้ว รอการยืนยัน`
                    : 'เราจะส่งลิงก์ยืนยันไปที่อีเมลนี้'
              }
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
            {emailSent && (
              <Banner tone="ok">
                ส่งลิงก์ยืนยันไปที่อีเมลแล้วค่ะ กดลิงก์ในอีเมลเพื่อยืนยัน ลิงก์มีอายุ 15 นาที
                ถ้าไม่ได้รับอีเมล ติดต่อทีมงานได้ที่ โทร 098-256-5628 หรืออีเมล contact@mangmeeplus.com นะคะ
              </Banner>
            )}
            {emailError && (
              <Banner tone="error">
                {emailErrorCode === 'email_belongs_to_other_account' ? (
                  <>
                    อีเมลนี้มีบัญชีอื่นใช้อยู่แล้วค่ะ ถ้าเป็นบัญชีของคุณเอง เข้าสู่ระบบด้วยบัญชีเดิมแล้วผูก LINE
                    เข้ากับบัญชีนั้น ระบบจะเสนอให้รวมบัญชีให้เอง{' '}
                    <Link className="underline" href="/login">ไปหน้าเข้าสู่ระบบ</Link>
                  </>
                ) : emailError}
              </Banner>
            )}
            <button
              type="button"
              className="mangmee-btn mangmee-btn-primary justify-self-start"
              disabled={emailSaving}
              onClick={() => void saveEmail()}
            >
              {emailSaving ? 'กำลังส่ง...' : 'ส่งลิงก์ยืนยันอีเมล'}
            </button>
          </div>

          <div className="mt-6 grid gap-4 border-t border-gray-200 pt-5">
            <TextField
              label="เบอร์มือถือ"
              value={phone}
              inputMode="tel"
              disabled={phoneSaving}
              hint="ตัวเลข 10 หลัก ขึ้นต้นด้วย 0 เว้นว่างไว้ก็ได้ถ้าไม่อยากให้เก็บ"
              onChange={(event) => setPhone(event.target.value)}
            />
            {phoneError && <Banner tone="error">{phoneError}</Banner>}
            <button
              type="button"
              className="mangmee-btn mangmee-btn-secondary justify-self-start"
              disabled={phoneSaving}
              onClick={() => void savePhone()}
            >
              {phoneSaving ? 'กำลังบันทึก...' : 'บันทึกเบอร์มือถือ'}
            </button>
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
                {(usernameRequired || !account?.emailVerified) && (
                  <TextField
                    label={usernameRequired ? 'ชื่อผู้ใช้' : 'ชื่อผู้ใช้ (ถ้าต้องการ)'}
                    value={newUsername}
                    autoComplete="username"
                    disabled={passwordSaving}
                    required={usernameRequired}
                    hint={
                      usernameRequired
                        ? 'ใช้คู่กับรหัสผ่านตอนเข้าจากคอมพิวเตอร์ ตัวอักษร a-z ตัวเลข จุด ขีด อย่างน้อย 4 ตัว'
                        : 'ถ้าไม่ตั้ง จะเข้าด้วยอีเมลที่ยืนยันแล้วก็ได้ค่ะ'
                    }
                    onChange={(event) => setNewUsername(event.target.value)}
                  />
                )}
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
                  className="mangmee-btn mangmee-btn-primary justify-self-start"
                  disabled={passwordSaving}
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
