'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TradeTaxEvidenceDto, TransactionTaxContext } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
import { createTradeTaxEvidence, getTradeTaxEvidenceAttachmentDownloadUrl, listTradeTaxEvidence, uploadTradeTaxEvidenceAttachment, verifyTradeTaxEvidence } from './transaction-tax.api';
import { TAX_CONTEXT_LABELS, transactionTaxCapabilities, transactionTaxErrorMessage } from './transaction-tax.model';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import { useToast } from '@/common/components/toast';

const evidenceContexts = ['IMPORT_GOODS', 'IMPORT_SERVICE', 'EXPORT_GOODS', 'EXPORT_SERVICE'] as const satisfies readonly TransactionTaxContext[];
type EvidenceContext = (typeof evidenceContexts)[number];
const field = 'mangmee-input w-full';
const sourceDefaults: Record<EvidenceContext, string> = {
  IMPORT_GOODS: 'procurement.vendor_bill', IMPORT_SERVICE: 'procurement.vendor_bill',
  EXPORT_GOODS: 'accounting.document', EXPORT_SERVICE: 'accounting.document',
};

export function TradeTaxEvidencePage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const toast = useToast();
  const capability = transactionTaxCapabilities(permissions);
  const canInspectEvidence = permissions.includes('attachment.read');
  const branch = useBranchFilter();
  const [items, setItems] = useState<TradeTaxEvidenceDto[]>([]);
  const [context, setContext] = useState<EvidenceContext>('IMPORT_GOODS');
  const [sourceType, setSourceType] = useState(sourceDefaults.IMPORT_GOODS);
  const [sourceId, setSourceId] = useState('');
  const [sourceLineId, setSourceLineId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedContext = query.get('context');
    if (requestedContext && evidenceContexts.includes(requestedContext as EvidenceContext)) {
      const next = requestedContext as EvidenceContext;
      setContext(next);
      setSourceType(query.get('sourceType') || sourceDefaults[next]);
    } else if (query.get('sourceType')) setSourceType(query.get('sourceType')!);
    setSourceId(query.get('sourceId') || '');
    setSourceLineId(query.get('sourceLineId') || '');
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await listTradeTaxEvidence(companyId, { branchId: branch?.branchId || undefined })); }
    catch (cause) { setError(transactionTaxErrorMessage(cause)); }
    finally { setLoading(false); }
  }, [branch?.branchId, companyId]);
  useEffect(() => { void load(); }, [load]);

  async function submit(form: FormData) {
    const file = form.get('attachment');
    if (!(file instanceof File) || !file.size) { setError('กรุณาแนบหลักฐานอย่างน้อย 1 ไฟล์'); return; }
    setBusy(true); setError('');
    try {
      const attachmentId = await uploadTradeTaxEvidenceAttachment(companyId, branch?.branchId || undefined, file);
      await createTradeTaxEvidence(companyId, {
        branchId: branch?.branchId || null,
        transactionContext: context,
        sourceType,
        sourceId,
        sourceLineId: sourceLineId || null,
        evidenceType: String(form.get('evidenceType')),
        referenceNumber: String(form.get('referenceNumber')),
        evidenceDate: String(form.get('evidenceDate')),
        countryCode: String(form.get('countryCode') || '') || null,
        currency: String(form.get('currency') || 'THB'),
        exchangeRate: String(form.get('exchangeRate') || '') || null,
        exchangeRateSource: String(form.get('exchangeRateSource') || '') || null,
        customsValue: String(form.get('customsValue') || '0'),
        dutyAmount: String(form.get('dutyAmount') || '0'),
        exciseAmount: String(form.get('exciseAmount') || '0'),
        otherTaxAmount: String(form.get('otherTaxAmount') || '0'),
        importVatAmount: String(form.get('importVatAmount') || '0'),
        attachmentIds: [attachmentId],
      });
      await load();
      toast.success('บันทึกหลักฐานเรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function openAttachment(attachmentId: string) {
    const preview = window.open('about:blank', '_blank');
    if (preview) preview.opener = null;
    try {
      const { downloadUrl } = await getTradeTaxEvidenceAttachmentDownloadUrl(companyId, attachmentId);
      if (preview) preview.location.replace(downloadUrl);
      else window.location.assign(downloadUrl);
    } catch (cause) { preview?.close(); setError(transactionTaxErrorMessage(cause)); }
  }

  async function verify(id: string, status: 'VERIFIED' | 'REJECTED') {
    setError('');
    try {
      await verifyTradeTaxEvidence(companyId, id, status);
      await load();
      toast.success(status === 'VERIFIED' ? 'ยืนยันหลักฐานเรียบร้อยแล้ว' : 'ปฏิเสธหลักฐานเรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); }
  }

  return (
    <MangmeePage title="หลักฐานภาษีการค้าระหว่างประเทศ" description="เก็บหลักฐานนำเข้าสินค้า บริการต่างประเทศ/ภ.พ.36 และส่งออก โดยผูกกับ source document และสาขา">
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <MangmeeCard className="p-4">
          <h2 className="mb-3 font-bold">เพิ่มหลักฐาน</h2>
          <form action={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <ThemedSelect value={context} onChange={(event) => { const next = event.target.value as EvidenceContext; setContext(next); setSourceType(sourceDefaults[next]); }}>{evidenceContexts.map((item) => <option key={item} value={item}>{TAX_CONTEXT_LABELS[item]}</option>)}</ThemedSelect>
            <input required value={sourceType} onChange={(event) => setSourceType(event.target.value)} name="sourceType" placeholder="Source type" className={field} />
            <input required name="sourceId" value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="Source document ID" className={field} />
            <input name="sourceLineId" required={context === 'IMPORT_GOODS'} value={sourceLineId} onChange={(event) => setSourceLineId(event.target.value)} placeholder="Source line ID" className={field} />
            <ThemedSelect name="evidenceType" defaultValue="CUSTOMS_ENTRY"><option value="CUSTOMS_ENTRY">ใบขนสินค้า</option><option value="PP36_RECEIPT">ใบเสร็จ ภ.พ.36 จากสรรพากร</option><option value="EXPORT_DECLARATION">ใบขนส่งออก</option><option value="FOREIGN_USE_EVIDENCE">หลักฐานใช้บริการในต่างประเทศ</option><option value="SHIPPING_EVIDENCE">หลักฐานขนส่ง</option><option value="PAYMENT_EVIDENCE">หลักฐานชำระเงิน</option><option value="OTHER">อื่น ๆ</option></ThemedSelect>
            {context === 'IMPORT_GOODS' && <p className="text-xs text-amber-700 sm:col-span-2 xl:col-span-1">หลักฐานนำเข้าสินค้าต้องผูกกับบรรทัดเดียว เพื่อไม่ให้ยอดศุลกากรหรือ VAT นำเข้าถูกนับซ้ำ</p>}
            <input required name="referenceNumber" placeholder="เลขที่อ้างอิง" className={field} />
            <input required name="evidenceDate" type="date" className={field} />
            <input name="countryCode" placeholder="ประเทศ เช่น US" maxLength={2} className={field} />
            <input required name="currency" defaultValue="THB" className={field} />
            <input name="exchangeRate" type="number" step="0.000001" placeholder="อัตราแลกเปลี่ยน" className={field} />
            <input name="exchangeRateSource" placeholder="แหล่งอัตราแลกเปลี่ยน" className={field} />
            <input name="customsValue" type="number" step="0.01" defaultValue="0" placeholder="มูลค่าศุลกากร" className={field} />
            <input name="dutyAmount" type="number" step="0.01" defaultValue="0" placeholder="อากรขาเข้า" className={field} />
            <input name="exciseAmount" type="number" step="0.01" defaultValue="0" placeholder="ภาษีสรรพสามิต" className={field} />
            <input name="otherTaxAmount" type="number" step="0.01" defaultValue="0" placeholder="ภาษีอื่น" className={field} />
            <input name="importVatAmount" type="number" step="0.01" defaultValue="0" placeholder="VAT นำเข้า/ภ.พ.36" className={field} />
            <label className="text-xs font-bold text-gray-600">ไฟล์หลักฐาน<input required name="attachment" type="file" accept={ATTACHMENT_UPLOAD_ACCEPT} className="mt-1 block w-full text-sm" /></label>
            <button disabled={!capability.canPrepareEvidence || busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังบันทึก...' : 'บันทึกหลักฐาน'}</button>
          </form>
          {!capability.canPrepareEvidence && <p className="mt-3 text-xs text-amber-700">อ่านอย่างเดียว: ต้องมีสิทธิ์เตรียมหลักฐานภาษีและสิทธิ์แก้เอกสารต้นทาง</p>}
        </MangmeeCard>
        <MangmeeCard className="overflow-hidden">
          <div className="border-b border-gray-100 p-4"><h2 className="font-bold">หลักฐานในขอบเขต ({items.length})</h2></div>
          {loading ? <div className="p-8 text-center text-sm text-gray-500">กำลังโหลด...</div> : !items.length ? <div className="p-8 text-center text-sm text-gray-500">ยังไม่มีหลักฐานการค้าระหว่างประเทศ</div> : (
            <div className="divide-y divide-gray-100">{items.map((item) => <article key={item.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{TAX_CONTEXT_LABELS[item.transactionContext]} · {item.referenceNumber}</strong><div className="mt-1 text-xs text-gray-500">{item.sourceType} / {item.sourceId} · {item.evidenceDate} · {item.currency}</div><div className="mt-1 text-xs text-gray-500">Customs {item.customsValue} · Duty {item.dutyAmount} · Excise {item.exciseAmount} · Import VAT {item.importVatAmount}</div><div className="mt-2 flex flex-wrap gap-2">{item.attachmentIds.map((attachmentId, index) => <button key={attachmentId} type="button" disabled={!canInspectEvidence} className="rounded border border-brand-200 px-2 py-1 text-xs font-bold text-brand-700 disabled:opacity-50" onClick={() => void openAttachment(attachmentId)}>เปิดหลักฐาน {index + 1}</button>)}</div></div><div className="flex items-center gap-2"><span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold">{item.status}</span>{capability.canVerifyEvidence && item.status !== 'VERIFIED' && <><button disabled={!canInspectEvidence} title={!canInspectEvidence ? 'ต้องมีสิทธิ์อ่านไฟล์แนบก่อนยืนยัน' : undefined} className="text-xs font-bold text-emerald-700 disabled:opacity-50" onClick={() => void verify(item.id, 'VERIFIED')}>ยืนยัน</button><button className="text-xs font-bold text-red-700" onClick={() => void verify(item.id, 'REJECTED')}>ปฏิเสธ</button></>}</div></div></article>)}</div>
          )}
          {capability.canVerifyEvidence && !canInspectEvidence && <p className="border-t border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">ต้องมีสิทธิ์ attachment.read เพื่อเปิดไฟล์ก่อนยืนยันหลักฐาน</p>}
        </MangmeeCard>
      </div>
    </MangmeePage>
  );
}
