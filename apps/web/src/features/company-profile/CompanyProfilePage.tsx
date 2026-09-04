'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CompanyIdentityResponse, CompanyLegalAddress, VatFactStatus } from '@watchdog-bms/contracts';
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
import { identityChangeKind, isThaiMobileInput, isThaiTaxIdInput, type IdentityField } from './company-profile.logic';

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

export function CompanyProfilePage({ companyId }: { companyId: string }) {
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
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

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
  // `company.legal_identity.read` is what un-masks the section; without it the owner would be
  // typing over values they cannot see, so the form is read-only instead of silently destructive.
  const canEditShop = full !== null;
  const vatStatus = identity?.vatRegistration?.status ?? 'UNKNOWN';

  const changedFields = (): IdentityField[] => {
    const fields: IdentityField[] = [];
    if (taxId.replace(/[^0-9]/g, '') !== (full?.taxId ?? '')) fields.push('taxId');
    if (registeredName.trim() !== (full?.registeredName ?? '')) fields.push('registeredName');
    const current = full?.addressJson ?? null;
    const sameAddress = current !== null && (Object.keys(EMPTY_ADDRESS) as Array<keyof CompanyLegalAddress>)
      .every((key) => (address[key] ?? '') === (current[key] ?? ''));
    if (!sameAddress) fields.push('addressJson');
    return fields;
  };

  const saveShop = async () => {
    if (!control || !canEditShop) return;
    const fields = changedFields();
    setShopError(null);
    if (fields.length === 0) {
      setShopError('ยังไม่มีอะไรเปลี่ยนค่ะ');
      return;
    }
    if (taxId.trim() && !isThaiTaxIdInput(taxId)) {
      setShopError('เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลักค่ะ');
      return;
    }
    const changeKind = identityChangeKind(control, fields);
    setShopSaving(true);
    try {
      await patchCompanyIdentity(companyId, {
        expectedLegalIdentityVersion: control.legalIdentityVersion,
        changeKind,
        ...(fields.includes('taxId') ? { taxId: taxId.replace(/[^0-9]/g, '') } : {}),
        ...(fields.includes('registeredName') ? { registeredName: registeredName.trim() } : {}),
        ...(fields.includes('addressJson')
          ? { addressJson: { ...address, line2: address.line2?.trim() ? address.line2.trim() : null } }
          : {}),
        // The server requires these two for the heavier kinds; a shop owner filling in a blank
        // field should not have to learn the vocabulary, so the page answers for them.
        ...(changeKind === 'CORRECTION' ? { correctionReason: 'TYPO' as const, note: 'แก้ไขจากหน้าข้อมูลร้าน' } : {}),
        ...(changeKind === 'LEGAL_CHANGE' ? { effectiveFrom: new Date().toISOString().slice(0, 10) } : {}),
      });
      toast.success('บันทึกข้อมูลร้านแล้วค่ะ');
      await load();
    } catch (error) {
      setShopError(apiErrorMessage(error));
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
        command: { kind: 'UPSERT_FACT', status, effectiveFrom: new Date().toISOString().slice(0, 10) },
      });
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
    setPasswordError(null);
    if (password.length < 8) {
      setPasswordError('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวค่ะ');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('รหัสผ่านสองช่องยังไม่ตรงกันค่ะ');
      return;
    }
    setPasswordSaving(true);
    try {
      await setMyFirstPassword(password);
      setPassword('');
      setConfirmPassword('');
      toast.success('ตั้งรหัสผ่านสำรองแล้วค่ะ');
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
                บัญชีของคุณดูข้อมูลนี้ได้บางส่วน ถ้าต้องการแก้ไข ให้เจ้าของร้านเป็นคนแก้นะคะ
              </Banner>
            </div>
          )}
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

          {identity?.vatRegistration && (
            <div className="mt-6 border-t border-gray-200 pt-5">
              <label className="text-sm font-medium text-gray-900" htmlFor="vat-status">ร้านจดทะเบียน VAT หรือยัง</label>
              <p className="mt-1 mb-3 text-sm text-gray-600">ตอบไว้เพื่อให้ระบบออกเอกสารภาษีได้ถูกต้องค่ะ</p>
              <ThemedSelect
                id="vat-status"
                className="mangmee-input"
                value={vatStatus}
                disabled={vatSaving}
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
