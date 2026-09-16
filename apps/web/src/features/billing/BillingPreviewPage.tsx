'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { BillingQuote, BillingAdjustmentKind } from '@watchdog-bms/contracts';
import BillingPage from './BillingPage';
import BillingAdjustmentsPage from './BillingAdjustmentsPage';
import { BillingWorkspaceContext } from './BillingCustomerFrame';
import { createBillingPreview, previewScenarios, type PreviewScenario } from './billing-preview.fixture';

const button = 'mangmee-btn mangmee-btn-secondary';
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value / 100);
type CheckoutPreview = Pick<BillingQuote, 'offer' | 'totalSatang'>;

export default function BillingPreviewPage({ companyId }: { companyId: string }) {
  const [scenario, setScenario] = useState<PreviewScenario>('start'), [revision, setRevision] = useState(0);
  const [view, setView] = useState<'journey' | 'checkout' | 'document' | 'document-history' | 'portal'>('journey');
  const [returnSection, setReturnSection] = useState<'package' | 'payment' | 'history'>('package');
  const [checkout, setCheckout] = useState<CheckoutPreview | null>(null);
  const [documentKind, setDocumentKind] = useState('receipt');
  const preview = useMemo(() => ({
    api: createBillingPreview(companyId, scenario, checkout?.offer ?? null, quote => { setCheckout(quote); setView('checkout'); }),
    readAccountEmail: async () => ({ email: 'preview@example.com', emailVerified: true, emailRevision: 0, emailRequirement: 'READY' as const,
      hasPassword: true, lineLinked: false, serverNow: new Date().toISOString(), challenge: null }),
    navigate: (url: string, kind: 'checkout' | 'portal' | 'document') => {
      setReturnSection(kind === 'portal' ? 'payment' : kind === 'document' ? 'history' : 'package');
      if (kind === 'document') { setDocumentKind(new URL(url).searchParams.get('kind') ?? 'receipt'); setView('document'); }
      else setView(kind);
    },
    openDocumentHistory: () => { setReturnSection('history'); setView('document-history'); },
    startWithPlans: ['start', 'capacity', 'expired', 'quote-error'].includes(scenario),
    // Selecting a scenario or restarting intentionally replaces all simulated state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [companyId, scenario, revision]);
  const documentPreview = useMemo(() => ({
    read: async (kind: BillingAdjustmentKind) => ({ invoiceId: 'preview-invoice', invoiceNumber: 'PREVIEW-0001', kind, mode: 'TEST' as const, canOpenDocuments: true, items: [], nextCursor: null, observedAt: new Date().toISOString() }),
    open: (kind: string) => { setDocumentKind(kind); setView('document'); },
    back: () => setView('journey'),
  }), []);
  function choose(next: PreviewScenario) {
    if (['start', 'capacity', 'upgrade', 'expired', 'quote-error'].includes(next)) setCheckout(null);
    setReturnSection('package'); setScenario(next); setRevision(value => value + 1); setView('journey');
  }
  const currentPreview = useMemo(() => ({ ...preview, initialSection: returnSection }), [preview, returnSection]);
  const returning = ['pending', 'activating', 'success', 'failed', 'held'].includes(scenario);
  return <BillingWorkspaceContext.Provider value={true}>
    <div className="space-y-6">
      <section aria-label="ตัวควบคุมพรีวิว" className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-bold text-amber-800">พรีวิวทุกขั้นตอน · เฉพาะ local</h2><p className="mt-1 text-xs text-gray-500">ข้อมูลตัวอย่าง · ไม่เปลี่ยนบริษัทหรือเรียกเก็บเงินจริง</p></div><Link href={`/companies/${encodeURIComponent(companyId)}/billing`} className="text-sm font-semibold text-brand-700 underline">ออกจากพรีวิว</Link></div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600" htmlFor="billing-preview-scenario">เลือกหน้าจอที่ต้องการดู</label>
          <select id="billing-preview-scenario" className="mangmee-input min-w-0 flex-1 sm:max-w-xs" value={scenario} onChange={event => choose(event.target.value as PreviewScenario)}>
            {Object.entries(previewScenarios).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" className={button} onClick={() => choose(scenario)}>เริ่มใหม่</button>
        </div>
      </section>
      {view === 'journey' && <BillingPage key={`${scenario}-${revision}`} companyId={companyId} preview={currentPreview} returning={returning} returnAttemptId={returning ? 'preview-attempt' : null} />}
      {view === 'document-history' && <BillingAdjustmentsPage companyId={companyId} invoiceId="preview-invoice" preview={documentPreview} />}
      {view === 'checkout' && checkout && <section className="mangmee-card mx-auto max-w-2xl space-y-6 p-5 sm:p-8" aria-label="จำลองการชำระเงิน">
        <div><p className="text-sm font-semibold text-brand-700">ขั้นตอนชำระเงิน</p><h2 className="mt-2 text-2xl font-bold">จำลองหน้าชำระเงินภายนอก</h2><p className="mt-3 text-gray-500">ระบบจริงจะเปิด Stripe หน้านี้ใช้เลือกผลลัพธ์เพื่อดูหน้าถัดไป ไม่ใช่หน้าตาของ Stripe และไม่ต้องกรอกข้อมูลบัตร</p></div>
        <div className="rounded-xl bg-gray-50 p-5"><p className="font-semibold">{checkout.offer.label} · {checkout.offer.interval === 'year' ? 'รายปี' : 'รายเดือน'}</p><p className="mt-2 text-3xl font-bold">{money(checkout.totalSatang)}</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button className="mangmee-btn mangmee-btn-primary" onClick={() => choose('success')}>จำลองชำระสำเร็จ</button>
          <button className={button} onClick={() => choose('pending')}>จำลองกำลังตรวจการชำระ</button>
          <button className={button} onClick={() => choose('activating')}>จำลองจ่ายแล้ว รอเปิดสิทธิ์</button>
          <button className={button} onClick={() => choose('failed')}>จำลองชำระไม่สำเร็จ</button>
        </div>
        <button className="min-h-11 text-brand-700 underline" onClick={() => setView('journey')}>ยกเลิกและกลับไปเลือกแพ็กเกจ</button>
      </section>}
      {(view === 'document' || view === 'portal') && <section className="mangmee-card space-y-5 p-5 sm:p-8">
        <h2 className="text-2xl font-bold">{view === 'portal' ? 'จำลองหน้าจัดการบัตร' : documentKind === 'invoice' ? 'ใบแจ้งหนี้ตัวอย่าง' : documentKind === 'pdf' ? 'ตัวอย่างก่อนดาวน์โหลด PDF' : 'ใบเสร็จรับเงินตัวอย่าง'}</h2>
        <p className="text-gray-600">{view === 'portal' ? 'ระบบจริงจะเปิดหน้าจัดการบัตรของ Stripe พรีวิวนี้ไม่รับข้อมูลบัตรและไม่เปลี่ยนวิธีชำระเงิน' : 'ระบบจริงเปิดเอกสารของรายการจาก Stripe ข้อมูลด้านล่างใช้ดูทางเข้าและทางกลับเท่านั้น ไม่ใช่เอกสารทางบัญชี'}</p>
        {view === 'document' && <dl className="grid gap-4 rounded-xl bg-gray-50 p-5 sm:grid-cols-3"><div><dt className="text-sm text-gray-500">เลขตัวอย่าง</dt><dd className="mt-1 font-semibold">PREVIEW-0001</dd></div><div><dt className="text-sm text-gray-500">อีเมล</dt><dd className="mt-1 break-all">preview@example.com</dd></div><div><dt className="text-sm text-gray-500">รายการคืนเงิน</dt><dd className="mt-1">ยังไม่มีรายการ</dd></div></dl>}
        <button className={button} onClick={() => setView('journey')}>{view === 'portal' ? 'กลับไปการชำระเงิน' : 'กลับไปประวัติการชำระเงิน'}</button>
      </section>}
    </div>
  </BillingWorkspaceContext.Provider>;
}
