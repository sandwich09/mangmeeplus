'use client';

import Link from 'next/link';
import { useState, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import type { BillingOperatorCompanyDetail, BillingOperatorOverview } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingControl, billingPrimaryControl, billingLabel, billingPlanLabel, billingIssueLabel, billingMonthlyAllowanceText } from '../billing/billing-display';
import BillingOperationPanel from './BillingOperationPanel';
import BillingTimelinePanel from './BillingTimelinePanel';

const sections = { overview: 'ภาพรวม', payments: 'รายการชำระเงิน', history: 'ประวัติ', manage: 'ปรับแพ็กเกจและตรวจสอบ' };
const money = (amount: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(amount / 100);

export default function BillingCompanyOverview({ company: c, overview, loading, cursor, onPage, onRefresh, leaving }: {
  company: BillingOperatorCompanyDetail; overview: BillingOperatorOverview | null; loading: boolean; cursor: string | null;
  onPage: (cursor: string | null) => void; onRefresh: () => void; leaving: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const params = useSearchParams(), rawView = params.get('view') ?? 'overview';
  const view = Object.hasOwn(sections, rawView) ? rawView : 'overview';
  const [historyOpened, setHistoryOpened] = useState(view === 'history');
  const base = `/system/billing/companies/${encodeURIComponent(c.companyId)}`;
  const openIssues = c.issues.filter(issue => issue.state !== 'RESOLVED');
  const viewHref = (key: string) => { const query = new URLSearchParams(params); if (key === 'overview') query.delete('view'); else query.set('view', key); return `${base}${query.size ? `?${query}` : ''}`; };
  const changeView = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); if (key === 'history') setHistoryOpened(true);
    window.history.replaceState(null, '', viewHref(key));
  };
  // S43/D-P3-6: a deal is read from the contract attempt's snapshot, and sits next to วิธีต่ออายุ.
  const sources = { TRIAL: 'ทดลองใช้ฟรี', MANUAL: 'ผู้ดูแลกำหนดให้', STRIPE: 'ซื้อผ่าน Stripe', DEAL: 'ดีลพิเศษจากทีมขาย', OTHER_BILLING: 'บัญชีชำระเงินอื่น', NONE: 'ยังไม่มีข้อมูลแพ็กเกจ' };
  return <div className="space-y-6">
    <section aria-label="ข้อมูลการชำระเงินบริษัท" className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><Link onClick={leaving} href="/system/billing" className="inline-flex min-h-11 items-center text-sm text-gray-600 underline">กลับรายชื่อบริษัท</Link><h2 className="text-xl font-semibold text-gray-900">{c.companyName}</h2><p className="mt-2 text-sm text-gray-600">{billingLabel('company', c.companyStatus)}</p></div>
        <button type="button" onClick={onRefresh} disabled={loading} aria-busy={Boolean(loading)} className="min-h-11 rounded-lg px-3 text-sm text-gray-600 underline disabled:opacity-50">{loading ? 'กำลังอัปเดต…' : 'อัปเดตข้อมูลบริษัท'}</button></div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg bg-gray-50 p-4"><dt className="text-sm text-gray-600">แพ็กเกจปัจจุบัน</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{c.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingPlanLabel(c.tierKey)}</dd><dd className="mt-2 text-sm text-gray-600">{c.planState === 'NO_PACKAGE' ? 'ยังไม่ได้เลือกแพ็กเกจ ลูกค้าซื้อเองได้จากหน้าแพ็กเกจ' : c.termEndsAt ? `ใช้ได้ถึง ${formatThaiDateTime(c.termEndsAt)}` : 'ยังไม่มีวันสิ้นสุดในข้อมูล'}</dd></div>
        <div className="rounded-lg bg-gray-50 p-4"><dt className="text-sm text-gray-600">การใช้งานของลูกค้า</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{c.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingLabel('access', c.accessState)}</dd><dd className="mt-2 text-sm text-gray-600">{['HELD', 'FAILED'].includes(c.applyState) ? 'ยังมีรายการซื้อที่เปิดแพ็กเกจไม่ได้ ให้ตรวจปัญหาในหมวดภาพรวม' : `ผลเปิดแพ็กเกจ: ${billingLabel('apply', c.applyState)}`}</dd></div>
        <div className="rounded-lg bg-gray-50 p-4"><dt className="text-sm text-gray-600">ใบเสร็จที่อ่านได้อีก</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{c.source === 'NONE' && c.tierKey === null ? 'ยังไม่มีข้อมูลโควตา' : c.usage.remaining === null ? 'ไม่จำกัด' : `${c.usage.remaining.toLocaleString('th-TH')} ใบ`}</dd><dd className="mt-2 text-sm text-gray-600">{c.usage.cadence === 'PAID_GRANTS' ? 'คงเหลือจากแพ็กเกจและสิทธิ์ที่ได้รับ' : 'คงเหลือตามโควตาที่กำหนด'}</dd></div>
      </dl>
      <nav aria-label="ข้อมูลบริษัทด้านการชำระเงิน" className="flex flex-wrap gap-x-5 border-b border-gray-200">{Object.entries(sections).map(([key, title]) => <Link key={key} href={viewHref(key)} onClick={event => changeView(event, key)} aria-current={view === key ? 'page' : undefined} className={`inline-flex min-h-12 items-center border-b-2 text-base font-semibold ${view === key ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>{title}</Link>)}</nav>
    </section>
    <div hidden={view !== 'overview'} className="space-y-6">
      <section aria-label="สิ่งที่ต้องดูแลของบริษัท" className="rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-900">{openIssues.length ? 'ปัญหาที่ต้องดูแลก่อน' : 'ปัญหาที่ระบบบันทึกไว้'}</h2>
        <p className="mt-2 text-gray-600">{openIssues.length ? 'เปิดปัญหาที่ต้องการแก้ ระบบจะแสดงหลักฐานและขั้นตอนของรายการนั้น' : 'ไม่พบปัญหาที่ยังค้างในข้อมูลชุดนี้ หากลูกค้าแจ้งปัญหา ให้ตรวจรายการชำระเงินประกอบ'}</p>
        <div className="mt-4 divide-y divide-gray-100">{openIssues.map(issue => <article key={issue.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div className="min-w-0"><h3 className="font-semibold text-gray-900">{billingIssueLabel(issue.kind)}</h3><p className="mt-1 text-sm text-gray-600">{billingLabel('issue', issue.state)} · {issue.assigneeName ?? 'ยังไม่มีคนรับเรื่อง'}</p>{issue.overdue && <p className="mt-1 text-sm text-amber-800">เกินกำหนดติดตาม</p>}</div><Link onClick={leaving} href={`/system/billing/issues/${encodeURIComponent(issue.id)}`} className={openIssues.length === 1 ? billingPrimaryControl : billingControl}>ดูวิธีแก้ปัญหา</Link></article>)}</div>
        {c.issues.length >= 25 && <p className="text-sm text-gray-600">แสดงปัญหาล่าสุดไม่เกิน 25 รายการ <Link onClick={leaving} href="/system/billing/issues" className="text-brand-800 underline">ดูปัญหาทั้งระบบ</Link></p>}
      </section>
      <section aria-label="รายละเอียดแพ็กเกจปัจจุบัน" className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6"><h2 className="text-lg font-semibold text-gray-900">แพ็กเกจและการต่ออายุ</h2>
        <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">{[
          ['ได้รับแพ็กเกจจาก', c.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : sources[c.source]], ['สถานะชำระเงิน', billingLabel('payment', c.paymentState)],
          ['วิธีต่ออายุ', c.renewalMode === 'CARD_ONCE' ? 'บัตรจ่ายครั้งเดียว · ซื้อใหม่เอง' : c.renewalMode === 'PROMPTPAY_ONCE' ? 'PromptPay QR จ่ายครั้งเดียว · ซื้อใหม่เอง' : c.renewalMode === 'PROMPTPAY_RENEW' ? 'PromptPay QR · จ่ายบิลใหม่ทุกงวด' : c.renewalMode === 'CARD_AUTO' ? 'บัตร · ต่ออายุอัตโนมัติ' : 'ยังไม่มี'],
          ['จำนวนสาขาที่ใช้ได้', c.branchLimit === null ? 'ยังไม่มีข้อมูล' : `${c.branchLimit} สาขา`], ['จำนวนผู้ใช้ที่ใช้ได้', c.employeeLimit === null ? 'ยังไม่มีข้อมูล' : `${c.employeeLimit} คน`],
          ['ชำระไว้ถึง', formatThaiDateTime(c.paidThrough, 'ยังไม่มีข้อมูล')], ['เก็บเงินครั้งถัดไป', formatThaiDateTime(c.nextChargeAt, 'ยังไม่มีกำหนด')],
          ...(c.graceEndsAt ? [['ผ่อนผันให้ใช้ได้ถึง', formatThaiDateTime(c.graceEndsAt)]] : []), ...(c.cancelEffectiveAt ? [['ยกเลิกมีผลเมื่อ', formatThaiDateTime(c.cancelEffectiveAt)]] : []),
          ...(c.usage.expiresAt ? [['ใบเสร็จส่วนที่หมดอายุใกล้ที่สุด', formatThaiDateTime(c.usage.expiresAt)]] : []),
        ].map(([title, value]) => <div key={title}><dt className="text-sm text-gray-500">{title}</dt><dd className="mt-1 text-gray-900">{value}</dd></div>)}</dl>
        {c.usage.monthlyAllowance && <p className="text-sm text-gray-600">{billingMonthlyAllowanceText(c.usage)}</p>}
        {c.effectiveCapacity?.temporary && <p className="rounded-lg bg-brand-50 p-4 text-brand-900">สิทธิ์ชั่วคราว: {billingPlanLabel(c.effectiveCapacity.tierKey)} · {c.effectiveCapacity.branchLimit} สาขา · {c.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {formatThaiDateTime(c.effectiveCapacity.temporary.expiresAt)}</p>}
        <p className="text-sm text-gray-500">ตรวจข้อมูลการชำระเงินล่าสุด: {formatThaiDateTime(c.observedAt, 'ยังไม่เคยตรวจ')}</p>
      </section>
    </div>
    <section hidden={view !== 'payments'} aria-label="รายการชำระเงินของบริษัท" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900">รายการชำระเงิน</h2><p className="text-gray-600">เลือกเอกสารเมื่อต้องตรวจยอดชำระ การคืนเงิน หรือเอกสารปรับยอด</p>
      {c.financial === null ? <p>บัญชีนี้ไม่มีสิทธิ์ดูรายละเอียดจำนวนเงิน</p> : <>
        {!c.financial.invoices.length && <p className="rounded-lg bg-gray-50 p-5 text-gray-600">ยังไม่มีรายการชำระเงินในหน้านี้</p>}
        <div className="divide-y divide-gray-100">{c.financial.invoices.map(invoice => <article key={invoice.id} className="flex flex-wrap items-center justify-between gap-4 py-4"><div><h3 className="font-semibold text-gray-900">{invoice.number ?? 'ใบแจ้งหนี้ (ยังไม่มีเลขเอกสาร)'}</h3><p className="mt-1 text-sm text-gray-600">{formatThaiDateTime(invoice.createdAt)} · {billingLabel('payment', invoice.paymentState)}</p><p className="mt-1 text-sm text-gray-600">การเปิดแพ็กเกจ: {billingLabel('apply', invoice.applyState)}</p>{invoice.refundedSatang !== null && <p className="mt-1 text-sm text-gray-600">ยอดคืนเงินที่ Stripe บันทึก {money(invoice.refundedSatang)}</p>}{invoice.disputed && <p className="mt-1 text-amber-800">มีข้อพิพาท ต้องตรวจเป็นรายกรณี</p>}</div><div className="flex items-center gap-4"><p className="font-semibold">{money(invoice.amountSatang)}</p><Link onClick={leaving} className={billingControl} href={`${base}/invoices/${encodeURIComponent(invoice.id)}`}>ดูเอกสารและยอดเงิน</Link></div></article>)}</div>
        <div className="flex flex-wrap justify-end gap-3"><button type="button" className={billingControl} disabled={loading || !cursor} aria-busy={Boolean(loading)} onClick={() => onPage(null)}>หน้าแรก</button><button type="button" className={billingControl} disabled={loading || !c.financial.nextCursor} aria-busy={Boolean(loading)} onClick={() => onPage(c.financial!.nextCursor)}>หน้าถัดไป</button></div>
      </>}
    </section>
    <div hidden={view !== 'history'}>{(historyOpened || view === 'history') && <BillingTimelinePanel companyId={c.companyId} />}</div>
    <section hidden={view !== 'manage'} aria-label="ปรับแพ็กเกจและตรวจสอบบริษัท" className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-gray-900">เลือกงานที่ต้องการทำ</h2><p className="text-gray-600">ใช้เมื่อมีคำขอจากลูกค้าหรือต้องตรวจข้อมูลเพิ่มเติม ทุกการเปลี่ยนสิทธิ์มีขั้นตรวจผลกระทบก่อนยืนยัน</p>
      <div className="divide-y divide-gray-100">{[
        ...(c.financial ? [{ path: 'plan-adjustments', title: 'ปรับแพ็กเกจและวันใช้งาน', help: 'กำหนดสิทธิ์ชั่วคราว เพิ่มวัน หรือพักการเก็บเงิน' }, { path: 'receipt-adjustments', title: 'เพิ่มหรือลดสิทธิ์อ่านใบเสร็จ', help: 'ปรับจำนวนใบเสร็จ พร้อมเหตุผลและประวัติผู้แก้ไข' }] : []),
        ...(c.accountId ? [{ path: 'apply-invoices', title: 'ตรวจการเปิดแพ็กเกจ', help: 'ตรวจรายการเดิมที่จ่ายแล้วแต่ยังเปิดแพ็กเกจไม่ได้' }, { path: 'checkouts', title: 'ตรวจหน้าชำระเงินที่ค้าง', help: 'ตรวจรายการที่ลูกค้าเริ่มซื้อแล้วแต่ยังไม่จบ' }, { path: 'deliveries', title: 'ตรวจการส่งแจ้งเตือน', help: 'ตรวจว่าข้อความทาง LINE และอีเมลส่งสำเร็จหรือไม่' }] : []),
      ].map(tool => <div key={tool.path} className="flex flex-wrap items-center justify-between gap-3 py-4"><div><h3 className="font-semibold text-gray-900">{tool.title}</h3><p className="mt-1 text-sm text-gray-600">{tool.help}</p></div><Link onClick={leaving} className="inline-flex min-h-11 items-center px-2 text-brand-800 underline" href={`${base}/${tool.path}`}>เปิด{tool.title}</Link></div>)}</div>
      {!c.accountId && <p className="text-gray-600">ยังไม่มีบัญชีชำระเงิน จึงยังตรวจรายการกับ Stripe ไม่ได้</p>}
      {c.accountId && <details className="border-t border-gray-100 pt-3"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-600">ตรวจข้อมูลกับ Stripe เพิ่มเติม</summary><div className="space-y-4 pt-3"><p className="text-gray-600">ใช้เมื่อข้อมูลการชำระเงินไม่ตรงกัน หากมีปัญหาที่ระบบบันทึกไว้ ให้เปิดปัญหานั้นจากภาพรวมก่อน</p><Link onClick={leaving} className="inline-flex min-h-11 items-center text-brand-800 underline" href={`${base}/invoice-scans`}>ค้นหาใบแจ้งหนี้ที่ยังไม่เข้ามั่งมี</Link><BillingOperationPanel companyId={c.companyId} companyVersion={c.version} canReconcile={!loading && Boolean(overview?.capabilities.includes('system.billing.reconcile.run'))} initialReason="ตรวจข้อมูลการชำระเงินของบริษัทให้ตรงกับ Stripe" /></div></details>}
      <details className="border-t border-gray-100 pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm text-gray-600">ข้อมูลอ้างอิงบริษัท</summary><div className="space-y-2 break-all text-sm text-gray-600"><p>ใช้ตรวจสอบภายใน ระบบบันทึกให้เอง ไม่ต้องกรอกหรือจำ</p><p>เลขบริษัท: {c.companyId}</p><p>รุ่นข้อมูล: {c.version}</p><p>สถานะสมาชิก Stripe: {billingLabel('subscription', c.subscriptionState)}</p>{c.pendingAttemptId && <p>รายการชำระที่รอผล: {c.pendingAttemptId}</p>}{c.pendingPlanChangeId && <p>รายการเปลี่ยนแพ็กเกจ: {c.pendingPlanChangeId}</p>}{c.collectionOperationId && <p>รายการจัดการต่ออายุ: {c.collectionOperationId}</p>}</div></details>
    </section>
  </div>;
}
