'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  DATA_RIGHTS_CASE_TYPES,
  DATA_RIGHTS_REQUEST_SOURCES,
  type DataRightsCaseType,
  type DataRightsRequestSource,
} from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { Button } from '@/common/components/button';
import { createDataRightsCase } from './data-rights.api';
import {
  CASE_TYPE_DESCRIPTION,
  CASE_TYPE_LABEL,
  SOURCE_LABEL,
  targetFieldsForCaseType,
  validateCreateCase,
  type CreateDataRightsCaseErrors,
  type CreateDataRightsCaseForm,
} from './data-rights.logic';

const inputClass = 'h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-gray-50';

function localDateTime(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export type DataRightsRemediationSeed = {
  priorCaseReference?: string;
  caseType?: DataRightsCaseType;
  targetUserId?: string;
  companyId?: string;
  membershipId?: string;
};

function initialForm(remediation?: DataRightsRemediationSeed): CreateDataRightsCaseForm {
  const now = new Date();
  const due = new Date(now.getTime() + 30 * 24 * 60 * 60_000);
  return {
    requestKey: `DR-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8)}`,
    caseType: remediation?.caseType ?? 'USER_ACCOUNT_ERASURE',
    requestSource: 'EMAIL',
    requesterContact: '',
    targetUserId: remediation?.targetUserId ?? '',
    companyId: remediation?.companyId ?? '',
    membershipId: remediation?.membershipId ?? '',
    receivedAt: localDateTime(now),
    dueAt: localDateTime(due),
    priorCaseReference: remediation?.priorCaseReference ?? '',
    targetConfirmed: false,
  };
}

function RequiredLabel({ children }: { children: ReactNode }) {
  return <>{children} <span className="text-red-600" aria-label="จำเป็น">*</span></>;
}

function ErrorText({ id, children }: { id?: string; children?: string }) {
  if (!children) return null;
  return <p id={id} role="alert" className="mt-1 text-xs text-red-600">{children}</p>;
}

export default function DataRightsNewPage({ remediation }: { remediation?: DataRightsRemediationSeed }) {
  const router = useRouter();
  const [form, setForm] = useState<CreateDataRightsCaseForm>(() => initialForm(remediation));
  const [errors, setErrors] = useState<CreateDataRightsCaseErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);
  const targetFields = useMemo(() => new Set(targetFieldsForCaseType(form.caseType)), [form.caseType]);

  const update = <K extends keyof CreateDataRightsCaseForm>(key: K, value: CreateDataRightsCaseForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const chooseCaseType = (caseType: DataRightsCaseType) => {
    const fields = new Set(targetFieldsForCaseType(caseType));
    setForm((current) => ({
      ...current,
      caseType,
      targetUserId: fields.has('targetUserId') ? current.targetUserId : '',
      companyId: fields.has('companyId') ? current.companyId : '',
      membershipId: fields.has('membershipId') ? current.membershipId : '',
      priorCaseReference: caseType === current.caseType ? current.priorCaseReference : '',
      targetConfirmed: false,
    }));
    setErrors({});
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateCreateCase(form);
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    setSubmitting(true);
    setSubmitError(null);
    setActiveConflictId(null);
    try {
      const result = await createDataRightsCase({
        commandId: crypto.randomUUID(),
        requestKey: form.requestKey.trim(),
        caseType: form.caseType,
        requestSource: form.requestSource,
        ...(form.requesterContact.trim() ? { requesterContact: form.requesterContact.trim() } : {}),
        ...(targetFields.has('targetUserId') ? { targetUserId: form.targetUserId.trim() } : {}),
        ...(targetFields.has('companyId') ? { companyId: form.companyId.trim() } : {}),
        ...(targetFields.has('membershipId') ? { membershipId: form.membershipId.trim() } : {}),
        ...(form.receivedAt ? { receivedAt: new Date(form.receivedAt).toISOString() } : {}),
        dueAt: new Date(form.dueAt).toISOString(),
        ...(form.priorCaseReference.trim() ? { priorCaseReference: form.priorCaseReference.trim() } : {}),
      });
      router.push(`/system/data-rights/${encodeURIComponent(result.caseId)}`);
    } catch (caught) {
      const apiError = caught as Error & { code?: string; details?: { activeCaseId?: unknown } };
      if (apiError.code === 'data_rights_active_target_conflict' && typeof apiError.details?.activeCaseId === 'string') {
        setActiveConflictId(apiError.details.activeCaseId);
        setSubmitError('มีเคสที่ยังไม่ปิดสำหรับประเภทและเป้าหมายเดียวกัน ระบบจึงไม่สร้างเคสซ้ำ');
      } else if (apiError.code === 'data_rights_prior_case_invalid') {
        setSubmitError('เคสต้นทางต้องเป็น BLOCKED และมีประเภทกับรหัสเป้าหมายตรงกับเคสใหม่นี้ทุกช่อง');
      } else {
        setSubmitError(apiError.message || 'สร้างเคสไม่สำเร็จ กรุณาตรวจข้อมูลแล้วลองใหม่');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f6f8f7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-5">
        <Link href="/system/data-rights" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-600 hover:text-emerald-700">← กลับไปรายการคำขอ</Link>

        <header>
          <p className="text-sm font-semibold text-emerald-700">{form.priorCaseReference ? 'เคสแก้ไขจากข้อขัดข้อง' : 'เปิดเคสควบคุมภายใน'}</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-950 sm:text-3xl">{form.priorCaseReference ? 'เปิดเคสแก้ไขและเชื่อมประวัติเดิม' : 'รับคำขอสิทธิข้อมูลใหม่'}</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">เลือกขอบเขตเพียงหนึ่งแบบ แล้วระบุรหัสเป้าหมายให้ตรงกับข้อมูลจริงในระบบ</p>
        </header>

        {form.priorCaseReference && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm leading-6 text-rose-900">
            <strong>Remediation:</strong> ระบบจะตรวจว่า reference นี้ชี้ไปยังเคส BLOCKED ที่มีประเภทและเป้าหมายตรงกันทุกช่องก่อนเปิดเคสใหม่
          </div>
        )}

        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm leading-6 text-red-900">
          <strong>คำเตือนก่อนเปิดเคส:</strong> การเลือกผิดระหว่าง “บัญชีผู้ใช้”, “สมาชิกหนึ่งกิจการ” และ “ทั้งพื้นที่ทำงาน” อาจกระทบข้อมูลคนละเจ้าของ เคสนี้ยังไม่สั่งลบ แต่จะเป็นต้นทางของการอนุมัติและหลักฐานทั้งหมด ทุกประเภทเคสต้องมี System Admin อย่างน้อย 2 บัญชีเพื่อแยกผู้เปิด ผู้อนุมัติ ผู้ดำเนินการ และผู้ตรวจอิสระ
        </div>

        <form onSubmit={submit} noValidate className="space-y-5">
          <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-950"><RequiredLabel>1. ต้องการจัดการอะไร</RequiredLabel></h2>
                <p className="mt-1 text-sm text-gray-500">เลือกหนึ่งประเภท ระบบจะแสดงเฉพาะรหัสที่จำเป็น</p>
              </div>
              <span className="text-xs text-gray-500"><span className="text-red-600">*</span> ข้อมูลจำเป็น</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {DATA_RIGHTS_CASE_TYPES.map((value, index) => {
                const selected = form.caseType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => chooseCaseType(value)}
                    aria-pressed={selected}
                    className={`rounded-2xl border p-4 text-left transition ${selected ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-100' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}
                  >
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${selected ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{index + 1}</span>
                    <span className="mt-3 block font-semibold text-gray-950">{CASE_TYPE_LABEL[value]}</span>
                    <span className="mt-1 block text-xs leading-5 text-gray-600">{CASE_TYPE_DESCRIPTION[value]}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-gray-950">2. ข้อมูลรับเรื่องและกำหนดเวลา</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-medium text-gray-700">
                <RequiredLabel>เลขอ้างอิงคำขอ</RequiredLabel>
                <input id="data-rights-request-key" className={`${inputClass} mt-1.5 font-mono`} value={form.requestKey} onChange={(event) => update('requestKey', event.target.value)} aria-invalid={Boolean(errors.requestKey)} aria-describedby={`data-rights-request-key-help${errors.requestKey ? ' data-rights-request-key-error' : ''}`} />
                <p id="data-rights-request-key-help" className="mt-1 text-xs font-normal text-gray-500">ใช้รหัสภายในที่ไม่บรรจุชื่อ อีเมล หรือข้อมูลส่วนบุคคล</p>
                <ErrorText id="data-rights-request-key-error">{errors.requestKey}</ErrorText>
              </label>
              <label className="text-sm font-medium text-gray-700">
                <RequiredLabel>ช่องทางที่รับคำขอ</RequiredLabel>
                <ThemedSelect className="mt-1.5" value={form.requestSource} onChange={(event) => update('requestSource', event.target.value as DataRightsRequestSource)}>
                  {DATA_RIGHTS_REQUEST_SOURCES.map((value) => <option key={value} value={value}>{SOURCE_LABEL[value]}</option>)}
                </ThemedSelect>
              </label>
              <label className="text-sm font-medium text-gray-700">
                วันที่และเวลารับเรื่อง
                <input id="data-rights-received-at" type="datetime-local" className={`${inputClass} mt-1.5`} value={form.receivedAt} onChange={(event) => update('receivedAt', event.target.value)} aria-invalid={Boolean(errors.receivedAt)} aria-describedby={errors.receivedAt ? 'data-rights-received-at-error' : undefined} />
                <ErrorText id="data-rights-received-at-error">{errors.receivedAt}</ErrorText>
              </label>
              <label className="text-sm font-medium text-gray-700">
                <RequiredLabel>กำหนดตอบกลับ</RequiredLabel>
                <input id="data-rights-due-at" type="datetime-local" className={`${inputClass} mt-1.5`} value={form.dueAt} onChange={(event) => update('dueAt', event.target.value)} aria-invalid={Boolean(errors.dueAt)} aria-describedby={`data-rights-due-at-help${errors.dueAt ? ' data-rights-due-at-error' : ''}`} />
                <p id="data-rights-due-at-help" className="mt-1 text-xs font-normal text-gray-500">ตรวจเส้นตายตามสิทธิและประเภทคำขอจริงก่อนบันทึก</p>
                <ErrorText id="data-rights-due-at-error">{errors.dueAt}</ErrorText>
              </label>
              <label className="text-sm font-medium text-gray-700 md:col-span-2">
                ช่องทางติดต่อผู้ขอ (ไม่บังคับ)
                <input className={`${inputClass} mt-1.5`} value={form.requesterContact} onChange={(event) => update('requesterContact', event.target.value)} placeholder="อีเมลหรือช่องทางสำหรับตอบกลับ" maxLength={320} />
                <p className="mt-1 text-xs font-normal text-gray-500">ระบบเก็บเฉพาะค่า hash เพื่อเชื่อมโยงคำขอ ไม่แสดงข้อมูลนี้ในรายละเอียดเคส</p>
              </label>
              <label className="text-sm font-medium text-gray-700 md:col-span-2">
                อ้างอิงเคส BLOCKED เดิม (เฉพาะ remediation)
                <input id="data-rights-prior-case" className={`${inputClass} mt-1.5 font-mono`} value={form.priorCaseReference} onChange={(event) => update('priorCaseReference', event.target.value)} placeholder="case://<case-id>" maxLength={135} aria-invalid={Boolean(errors.priorCaseReference)} aria-describedby={`data-rights-prior-case-help${errors.priorCaseReference ? ' data-rights-prior-case-error' : ''}`} />
                <p id="data-rights-prior-case-help" className="mt-1 text-xs font-normal text-gray-500">เว้นว่างสำหรับคำขอใหม่ ใช้ได้เฉพาะเคสเดิมที่เป็น BLOCKED และมีประเภทกับ target ตรงกัน</p>
                <ErrorText id="data-rights-prior-case-error">{errors.priorCaseReference}</ErrorText>
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-semibold text-gray-950">3. ระบุเป้าหมายให้ตรงประเภท</h2>
            <p className="mt-1 text-sm text-gray-500">คัดลอกรหัสจากหน้าจัดการระบบหรือผลค้นหาที่ได้รับอนุญาต ห้ามเดาจากชื่อบุคคล</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {targetFields.has('targetUserId') && (
                <label className="text-sm font-medium text-gray-700">
                  <RequiredLabel>User ID</RequiredLabel>
                  <input id="data-rights-target-user" className={`${inputClass} mt-1.5 font-mono`} value={form.targetUserId} onChange={(event) => update('targetUserId', event.target.value)} aria-invalid={Boolean(errors.targetUserId)} aria-describedby={errors.targetUserId ? 'data-rights-target-user-error' : undefined} />
                  <ErrorText id="data-rights-target-user-error">{errors.targetUserId}</ErrorText>
                </label>
              )}
              {targetFields.has('companyId') && (
                <label className="text-sm font-medium text-gray-700">
                  <RequiredLabel>Company ID</RequiredLabel>
                  <input id="data-rights-target-company" className={`${inputClass} mt-1.5 font-mono`} value={form.companyId} onChange={(event) => update('companyId', event.target.value)} aria-invalid={Boolean(errors.companyId)} aria-describedby={errors.companyId ? 'data-rights-target-company-error' : undefined} />
                  <ErrorText id="data-rights-target-company-error">{errors.companyId}</ErrorText>
                </label>
              )}
              {targetFields.has('membershipId') && (
                <label className="text-sm font-medium text-gray-700">
                  <RequiredLabel>Membership ID</RequiredLabel>
                  <input id="data-rights-target-membership" className={`${inputClass} mt-1.5 font-mono`} value={form.membershipId} onChange={(event) => update('membershipId', event.target.value)} aria-invalid={Boolean(errors.membershipId)} aria-describedby={errors.membershipId ? 'data-rights-target-membership-error' : undefined} />
                  <ErrorText id="data-rights-target-membership-error">{errors.membershipId}</ErrorText>
                </label>
              )}
            </div>
            <label className={`mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${errors.targetConfirmed ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
              <input type="checkbox" className="mt-0.5 h-5 w-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500" checked={form.targetConfirmed} onChange={(event) => update('targetConfirmed', event.target.checked)} aria-invalid={Boolean(errors.targetConfirmed)} aria-describedby={`data-rights-target-confirm-help${errors.targetConfirmed ? ' data-rights-target-confirm-error' : ''}`} />
              <span className="text-sm text-gray-700">
                <span className="font-semibold"><RequiredLabel>ฉันตรวจรหัสเป้าหมายและขอบเขตแล้ว</RequiredLabel></span>
                <span id="data-rights-target-confirm-help" className="mt-1 block text-xs leading-5 text-gray-500">ยืนยันว่ารหัสทั้งหมดเป็นของบุคคล/กิจการเดียวกัน และประเภทเคสไม่กระทบบัญชีหรือกิจการอื่น</span>
                <ErrorText id="data-rights-target-confirm-error">{errors.targetConfirmed}</ErrorText>
              </span>
            </label>
          </section>

          {submitError && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {submitError}
              {activeConflictId && (
                <Link href={`/system/data-rights/${encodeURIComponent(activeConflictId)}`} className="ml-2 font-semibold underline">เปิดเคสที่มีอยู่</Link>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link href="/system/data-rights" className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">ยกเลิก</Link>
            <Button type="submit" loading={submitting}>เปิดเคสและเริ่มตรวจตัวตน</Button>
          </div>
        </form>
      </div>
    </main>
  );
}
