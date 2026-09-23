'use client';
import { useState } from 'react';
import type { SalesAgentProfileDto, SalesAgentProfileInput } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { SelectField, TextField, TextareaField } from '@/common/components/field';
import { SALES_BANK_NAMES, validateSalesProfile } from './sales-console.logic';
import { SalesNotice } from './SalesConsoleParts';

export function SalesProfileEditor({ initial, admin, onSave, onCancel }: {
  initial: SalesAgentProfileDto;
  admin: boolean;
  onSave: (profile: SalesAgentProfileInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState({
    legalName: initial.legalName ?? '', nationalId: initial.nationalId ?? '', taxId: initial.taxId ?? '',
    address: initial.address ?? '', bankName: initial.bankName ?? '', bankAccount: initial.bankAccount ?? '',
    whtRatePercent: String(initial.whtRatePercent),
  });
  const [errors, setErrors] = useState<ReturnType<typeof validateSalesProfile>>({});
  const [bankSelection, setBankSelection] = useState<string>(
    SALES_BANK_NAMES.some((bank) => bank === initial.bankName) ? initial.bankName! : initial.bankName ? 'other' : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };
  const save = async () => {
    const found = validateSalesProfile(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        legalName: values.legalName.trim(), nationalId: values.nationalId,
        taxId: values.taxId || null, address: values.address.trim(), bankName: values.bankName.trim(),
        bankAccount: values.bankAccount, whtRatePercent: Number(values.whtRatePercent),
      });
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };
  return <div className="grid gap-4">
    {error && <SalesNotice tone="error">{error}</SalesNotice>}
    <TextField label="ชื่อ-นามสกุลตามบัตรประชาชน" value={values.legalName} maxLength={200} error={errors.legalName}
      onChange={(event) => set('legalName', event.target.value)} />
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField label="เลขบัตรประชาชน" value={values.nationalId} maxLength={13} inputMode="numeric" autoComplete="off" error={errors.nationalId}
        onChange={(event) => set('nationalId', event.target.value.replace(/\D/g, '').slice(0, 13))} />
      <TextField label="เลขประจำตัวผู้เสียภาษี (ถ้ามี)" value={values.taxId} maxLength={13} inputMode="numeric" autoComplete="off" error={errors.taxId}
        onChange={(event) => set('taxId', event.target.value.replace(/\D/g, '').slice(0, 13))} />
    </div>
    <TextareaField label="ที่อยู่ (ตามบัตรประชาชนหรือบริษัท)" value={values.address} maxLength={500} error={errors.address}
      onChange={(event) => set('address', event.target.value)} />
    <SelectField label="ชื่อธนาคาร" value={bankSelection} error={errors.bankName}
      onChange={(event) => { setBankSelection(event.target.value); set('bankName', event.target.value === 'other' ? '' : event.target.value); }}>
      <option value="">— เลือกธนาคาร —</option>
      {SALES_BANK_NAMES.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
      <option value="other">ธนาคารอื่น ๆ</option>
    </SelectField>
    {bankSelection === 'other' && <TextField label="ระบุชื่อธนาคาร" value={values.bankName} maxLength={120} error={errors.bankName}
      onChange={(event) => set('bankName', event.target.value)} />}
    <TextField label="เลขบัญชีธนาคาร" value={values.bankAccount} maxLength={20} inputMode="numeric" autoComplete="off" error={errors.bankAccount}
      onChange={(event) => set('bankAccount', event.target.value.replace(/\D/g, '').slice(0, 20))} />
    {admin ? <TextField label="อัตราหัก ณ ที่จ่าย (%)" value={values.whtRatePercent} inputMode="numeric" error={errors.whtRatePercent}
      onChange={(event) => set('whtRatePercent', event.target.value)} />
      : <p className="text-sm text-gray-600">อัตราหัก ณ ที่จ่าย {initial.whtRatePercent}% (ผู้ดูแลระบบเป็นผู้กำหนด)</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      {onCancel && <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={onCancel}>ยกเลิก</button>}
      <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => void save()}>{busy ? 'กำลังบันทึก…' : 'บันทึกข้อมูล'}</button>
    </div>
  </div>;
}
