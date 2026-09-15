'use client';

// Source-first credit/debit note form (income-expense-ledger spec F-LED-6, F-LED-7 S5):
// opened only from an eligible issued document, prefilled from it, with a mandatory legal
// reason and the FlowAccount-style "original → corrected → difference" model. Creates a DRAFT;
// the existing Issue button finalises it; the detail API supplies the remaining cumulative cap.

import { useState } from 'react';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { baht } from '@/features/expenses/ExpensesUi';
import type { DocumentDetail } from './accounting-documents.model';
import {
  buildCorrectionInput,
  correctionEligibility,
  correctionLineBasis,
  correctionReasonOptions,
  hadPriorCorrections,
  round2,
  type CorrectionCreateBody,
  type CorrectionMode,
  type CorrectionSourceDocument,
} from './income-record.logic';

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const ghostClass = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';

export function CorrectionNoteSection({ detail, permissions, busy, onCreate }: {
  detail: DocumentDetail;
  permissions: string[];
  busy: boolean;
  onCreate: (body: CorrectionCreateBody, successMessage: string, attachment?: File) => Promise<void>;
}) {
  const [mode, setMode] = useState<CorrectionMode | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [corrected, setCorrected] = useState<Record<number, string>>({});
  const [attachment, setAttachment] = useState<File | null>(null);

  const source: CorrectionSourceDocument = {
    id: detail.id,
    documentType: detail.documentType,
    status: detail.status,
    vatMode: detail.vatMode,
    vatAmount: detail.vatAmount,
    outputTaxCode: detail.outputTaxCode,
    counterpartyId: detail.counterpartyId,
    lines: detail.lines.map((line) => ({
      lineNumber: line.lineNumber,
      description: line.description,
      lineTotalAmount: line.lineTotalAmount,
      vatAmount: line.vatAmount ?? '0',
      vatRate: line.vatRate,
      whtRate: line.whtRate,
      correctionBasisAmount: line.correctionBasisAmount,
      taxSnapshot: line.taxSnapshot
        ? { externalTaxCode: line.taxSnapshot.externalTaxCode ?? undefined, taxCodeDefinitionId: line.taxSnapshot.taxCodeDefinitionId ?? undefined }
        : undefined,
    })),
  };

  const eligibility = correctionEligibility(source);
  const canCredit = permissions.includes('accounting.document.create') || permissions.includes('accounting.credit_note.create');
  const canDebit = permissions.includes('accounting.document.create') || permissions.includes('accounting.debit_note.create');
  if (!eligibility.visible || (!canCredit && !canDebit)) return null;

  const open = (nextMode: CorrectionMode) => {
    setMode(nextMode);
    setReasonCode('');
    setReasonText('');
    setCorrected({});
    setAttachment(null);
  };

  const build = mode
    ? buildCorrectionInput({ mode, source, corrected, reasonCode, reasonText, documentDate: todayCivilDate() })
    : null;
  const buildError = build && 'error' in build ? build.error : null;
  const diffTotal = build && 'body' in build ? build.diffTotal : 0;
  const originalTotal = round2(source.lines.reduce((sum, line) => sum + Number(correctionLineBasis(line, source.vatMode)), 0));
  const exVatSuffix = source.vatMode === 'VAT_EXCLUDED' ? ' (ก่อน VAT)' : '';

  return (
    <section className="space-y-3 border-t border-gray-200 pt-4">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {canCredit && (
          <button type="button" className={ghostClass} disabled={busy || !eligibility.enabled} aria-busy={Boolean(busy)} onClick={() => open('CREDIT_NOTE')}>
            ใบลดหนี้ (ลดยอด)
          </button>
        )}
        {canDebit && (
          <button type="button" className={ghostClass} disabled={busy || !eligibility.enabled} aria-busy={Boolean(busy)} onClick={() => open('DEBIT_NOTE')}>
            ใบเพิ่มหนี้ (เพิ่มยอด)
          </button>
        )}
      </div>
      {!eligibility.enabled && eligibility.reason && <p className="text-base text-gray-600">{eligibility.reason}</p>}

      {mode && eligibility.enabled && (
        <div className="space-y-3 rounded-lg border border-brand-200 bg-brand-25 p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-gray-900">{mode === 'CREDIT_NOTE' ? 'ออกใบลดหนี้จากเอกสารนี้' : 'ออกใบเพิ่มหนี้จากเอกสารนี้'}</h3>
              <p className="text-base text-gray-600">อ้างอิง {detail.documentNumber ?? 'เอกสารที่เลือก'} · กรอก "มูลค่าที่ถูกต้อง" แล้วระบบคำนวณผลต่างให้</p>
            </div>
            <button type="button" className={ghostClass} onClick={() => setMode(null)}>ยกเลิก</button>
          </div>

          {hadPriorCorrections(detail.status) && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-base text-amber-800">
              เอกสารนี้เคยมีใบลดหนี้/ใบเพิ่มหนี้แล้ว — ยอดด้านล่างคือยอดคงเหลือจริงหลังหัก/บวกเอกสารที่ออกแล้ว
            </p>
          )}

          <label className="block text-base font-bold text-gray-700">
            สาเหตุ (ตามที่กฎหมายกำหนด)
            <ThemedSelect className={`${inputClass} mt-1`} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} aria-label="สาเหตุ">
              <option value="">เลือกสาเหตุ...</option>
              {correctionReasonOptions(mode).map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}
            </ThemedSelect>
          </label>
          {reasonCode === 'OTHER_PRESCRIBED' && (
            <label className="block text-base font-bold text-gray-700">
              ระบุรายละเอียดเหตุ *
              <input className={`${inputClass} mt-1`} maxLength={500} value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder="อธิบายเหตุตามที่กฎหมายกำหนด" aria-label="รายละเอียดเหตุ" />
            </label>
          )}

          <div className="space-y-2">
            {source.lines.map((line) => {
              const basis = correctionLineBasis(line, source.vatMode);
              return (
                <div key={line.lineNumber} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="text-base font-medium text-gray-800">{line.lineNumber}. {line.description}</div>
                  <div className="mt-2 grid grid-cols-2 items-end gap-2 text-base">
                    <div>
                      <div className="text-base text-gray-500">{hadPriorCorrections(detail.status) ? 'มูลค่าคงเหลือปัจจุบัน' : 'มูลค่าตามเอกสารเดิม'}{exVatSuffix}</div>
                      <div className="tabular-nums font-semibold text-gray-900">{baht(basis)}</div>
                    </div>
                    <label className="block text-base text-gray-500">
                      มูลค่าที่ถูกต้อง
                      <input
                        className={`${inputClass} mt-1 text-right`}
                        inputMode="decimal"
                        placeholder={basis}
                        value={corrected[line.lineNumber] ?? ''}
                        onChange={(e) => setCorrected((current) => ({ ...current, [line.lineNumber]: e.target.value }))}
                        aria-label={`มูลค่าที่ถูกต้องของรายการที่ ${line.lineNumber}`}
                      />
                    </label>
                  </div>
                  {mode === 'CREDIT_NOTE' && <p className="mt-1 text-base text-gray-500">ลดได้ไม่เกิน {baht(basis)}</p>}
                </div>
              );
            })}
          </div>

          <dl className="space-y-1 text-base">
            <div className="flex justify-between"><dt className="text-gray-500">{hadPriorCorrections(detail.status) ? 'มูลค่าคงเหลือปัจจุบัน' : 'มูลค่าตามเอกสารเดิม'}{exVatSuffix}</dt><dd className="tabular-nums text-gray-800">{baht(originalTotal)}</dd></div>
            <div className="flex justify-between font-bold text-gray-900">
              <dt>ผลต่างที่จะ{mode === 'CREDIT_NOTE' ? 'ลด' : 'เพิ่ม'}{exVatSuffix}</dt>
              <dd className="tabular-nums">{baht(diffTotal)}</dd>
            </div>
          </dl>

          {permissions.includes('attachment.create') && (
            <label className="block text-base font-bold text-gray-700">
              แนบหลักฐาน (ถ้ามี)
              <input
                className={`${inputClass} mt-1 min-h-12 py-2`}
                type="file"
                accept={ATTACHMENT_UPLOAD_ACCEPT}
                onChange={(event) => setAttachment(event.target.files?.[0] ?? null)}
              />
              <span className="mt-1 block font-normal text-gray-500">รองรับรูปภาพหรือ PDF เพื่อเก็บกับใบลดหนี้/ใบเพิ่มหนี้ฉบับนี้</span>
            </label>
          )}

          <button
            type="button"
            className={`${btnClass} h-14 w-full text-base`}
            disabled={busy || !!buildError} aria-busy={Boolean(busy)}
            onClick={() => {
              if (!build || 'error' in build) return;
              void onCreate(
                build.body,
                mode === 'CREDIT_NOTE'
                  ? 'สร้างร่างใบลดหนี้แล้ว — ตรวจสอบแล้วกดออกเอกสารเพื่อยืนยัน'
                  : 'สร้างร่างใบเพิ่มหนี้แล้ว — ตรวจสอบแล้วกดออกเอกสารเพื่อยืนยัน',
                attachment ?? undefined,
              );
            }}
          >
            {busy ? 'กำลังสร้าง...' : mode === 'CREDIT_NOTE' ? 'สร้างร่างใบลดหนี้' : 'สร้างร่างใบเพิ่มหนี้'}
          </button>
          {buildError && !busy && <p role="status" className="text-center text-base font-medium text-gray-600">{buildError}</p>}
        </div>
      )}
    </section>
  );
}
