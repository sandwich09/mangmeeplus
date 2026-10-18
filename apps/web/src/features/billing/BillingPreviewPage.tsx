'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { BillingQuote, BillingAdjustmentKind } from '@watchdog-bms/contracts';
import BillingPage from './BillingPage';
import BillingAdjustmentsPage from './BillingAdjustmentsPage';
import { BillingWorkspaceContext } from './BillingCustomerFrame';
import { createBillingPreview, previewScenarios, type PreviewScenario } from './billing-preview.fixture';

const button = 'mangmee-btn mangmee-btn-secondary';
const money = (value: number) => `${(value / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
type CheckoutPreview = Pick<BillingQuote, 'offer' | 'totalSatang' | 'purchase' | 'purchaseMode' | 'deal'>;

export default function BillingPreviewPage({ companyId }: { companyId: string }) {
  const [scenario, setScenario] = useState<PreviewScenario>('start'), [revision, setRevision] = useState(0);
  const [view, setView] = useState<'journey' | 'checkout' | 'document' | 'document-history' | 'portal'>('journey');
  const [showReturn, setShowReturn] = useState(true);
  const [returnSection, setReturnSection] = useState<'package' | 'payment' | 'history'>('package');
  const [checkout, setCheckout] = useState<CheckoutPreview | null>(null);
  const [documentKind, setDocumentKind] = useState('receipt');
  const preview = useMemo(() => ({
    returnHome: () => { setShowReturn(false); setReturnSection('package'); },
    api: createBillingPreview(companyId, scenario, checkout, quote => { setCheckout(quote); setView('checkout'); }),
    navigate: (url: string, kind: 'checkout' | 'portal' | 'document') => {
      setReturnSection(kind === 'portal' ? 'payment' : kind === 'document' ? 'history' : 'package');
      if (kind === 'document') { setDocumentKind(new URL(url).searchParams.get('kind') ?? 'receipt'); setView('document'); }
      else setView(kind);
    },
    openDocumentHistory: () => { setReturnSection('history'); setView('document-history'); },
    retrySelection: { offer: checkout?.offer.offerKey ?? 'BASIC_499', interval: checkout?.offer.interval ?? 'month' as const, purchaseMode: checkout?.purchaseMode ?? 'CARD_ONCE' as const, ...(checkout?.deal ? { dealId: checkout.deal.dealId } : {}) },
    startWithPlans: ['start', 'manual', 'deal', 'deal-auto', 'capacity', 'capacity-work', 'one-time', 'expired', 'quote-error'].includes(scenario),
    // Selecting a scenario or restarting intentionally replaces all simulated state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [companyId, scenario, revision]);
  const documentPreview = useMemo(() => ({
    read: async (kind: BillingAdjustmentKind) => ({ invoice: (await preview.api.history()).items[0], invoiceId: 'preview-invoice', invoiceNumber: 'PREVIEW-0001', kind, mode: 'TEST' as const, canOpenDocuments: true, items: [], nextCursor: null, observedAt: new Date().toISOString(),
      documentActions: { canResend: true }, recipientEmail: 'preview@example.com' }),
    open: (kind: string) => { setDocumentKind(kind); setView('document'); },
    resend: async () => ({ invoiceSent: true, receiptUpdated: true, recipientEmail: 'preview@example.com', remainingToday: 2 }),
    back: () => setView('journey'),
  }), [preview]);
  function choose(next: PreviewScenario) {
    if (['start', 'manual', 'deal', 'deal-auto', 'capacity', 'capacity-work', 'upgrade', 'one-time', 'one-time-pending', 'one-time-capacity', 'scheduled-change', 'expired', 'quote-error'].includes(next)) setCheckout(null);
    setShowReturn(true); setReturnSection('package'); setScenario(next); setRevision(value => value + 1); setView('journey');
  }
  const currentPreview = useMemo(() => ({ ...preview, initialSection: returnSection }), [preview, returnSection]);
  const returning = showReturn && ['pending', 'activating', 'success', 'failed', 'held'].includes(scenario);
  return <BillingWorkspaceContext.Provider value={true}>
    <div className="space-y-6">
      <section aria-label="ตัวควบคุมพรีวิว" className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-amber-800">พรีวิวทุกขั้นตอน · เฉพาะ local</h2><p className="mt-1 text-xs text-gray-500">จำลองตามกรณีที่เลือก ไม่ใช่แพ็กเกจจริงของบริษัท · ไม่เปลี่ยนข้อมูลหรือเรียกเก็บเงินจริง</p></div><Link href={`/companies/${encodeURIComponent(companyId)}/billing`} className="text-sm font-semibold text-brand-700 underline">ออกจากพรีวิว</Link></div>
        <div className="mt-3 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
          <label className="text-sm text-gray-600" htmlFor="billing-preview-scenario">เลือกหน้าจอที่ต้องการดู</label>
          <select id="billing-preview-scenario" className="mangmee-input min-w-0 flex-1 " value={scenario} onChange={event => choose(event.target.value as PreviewScenario)}>
            {Object.entries(previewScenarios).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" className={`${button} justify-self-start`} onClick={() => choose(scenario)}>เริ่มใหม่</button>
        </div>
      </section>
      {view === 'journey' && <BillingPage key={`${scenario}-${revision}-${showReturn}`} companyId={companyId} preview={currentPreview} returning={returning} returnAttemptId={returning ? 'preview-attempt' : null} />}
      {view === 'document-history' && <BillingAdjustmentsPage companyId={companyId} invoiceId="preview-invoice" preview={documentPreview} />}
      {view === 'checkout' && checkout && <section className="mangmee-card space-y-6 p-5 sm:p-8" aria-label="จำลองการจ่ายเงิน">
        <div><p className="text-sm font-semibold text-brand-700">ขั้นตอนจ่ายเงิน</p><h2 className="mt-2 text-2xl font-bold">จำลองหน้าจ่ายเงินภายนอก</h2><p className="mt-3 text-gray-500">ระบบจริงจะเปิด Stripe หน้านี้ใช้เลือกผลลัพธ์เพื่อดูหน้าถัดไป ไม่ใช่หน้าตาของ Stripe และไม่ต้องกรอกข้อมูลบัตร</p></div>
        <div className="rounded-xl bg-gray-50 p-5"><p className="font-semibold">{checkout.offer.label} · {checkout.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}</p><p className="mt-2 text-3xl font-bold">{money(checkout.totalSatang)}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="mangmee-btn mangmee-btn-primary" onClick={() => choose('success')}>จำลองจ่ายแล้ว</button>
          <button className={button} onClick={() => choose('pending')}>จำลองกำลังตรวจการจ่าย</button>
          <button className={button} onClick={() => choose('activating')}>จำลองจ่ายแล้ว รอเปิดสิทธิ์</button>
          <button className={button} onClick={() => choose('failed')}>จำลองจ่ายไม่สำเร็จ</button>
        </div>
        <button className="min-h-11 text-brand-700 underline" onClick={() => setView('journey')}>ยกเลิกและกลับไปเลือกแพ็กเกจ</button>
      </section>}
      {(view === 'document' || view === 'portal') && <section className="mangmee-card space-y-5 p-5 sm:p-8">
        <h2 className="text-2xl font-bold">{view === 'portal' ? 'จำลองหน้าจัดการบัตร' : documentKind === 'invoice' ? 'ใบแจ้งหนี้ตัวอย่าง' : documentKind === 'pdf' ? 'ตัวอย่างก่อนดาวน์โหลด PDF' : 'ใบเสร็จรับเงินตัวอย่าง'}</h2>
        <p className="text-gray-600">{view === 'portal' ? 'ระบบจริงจะเปิดหน้าจัดการบัตรของ Stripe พรีวิวนี้ไม่รับข้อมูลบัตรและไม่เปลี่ยนวิธีจ่ายเงิน' : 'ระบบจริงเปิดเอกสารของรายการจาก Stripe ข้อมูลด้านล่างใช้ดูทางเข้าและทางกลับเท่านั้น ไม่ใช่เอกสารทางบัญชี'}</p>
        {view === 'document' && <dl className="grid gap-4 rounded-xl bg-gray-50 p-5 sm:grid-cols-3"><div><dt className="text-sm text-gray-500">เลขตัวอย่าง</dt><dd className="mt-1 font-semibold">PREVIEW-0001</dd></div><div><dt className="text-sm text-gray-500">อีเมล</dt><dd className="mt-1 break-all">preview@example.com</dd></div><div><dt className="text-sm text-gray-500">รายการคืนเงิน</dt><dd className="mt-1">ยังไม่มีรายการ</dd></div></dl>}
        <button className={button} onClick={() => setView('journey')}>{view === 'portal' ? 'กลับไปการจ่ายเงิน' : 'กลับไปประวัติการจ่ายเงิน'}</button>
      </section>}
    </div>
  </BillingWorkspaceContext.Provider>;
}
