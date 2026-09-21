'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingApplyInvoiceView, BillingOperatorIssue, BillingOperatorOverview } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { billingControl, billingPrimaryControl, billingLabel } from '../billing/billing-display';
import BillingOperationPanel from './BillingOperationPanel';

export default function BillingIssueResolutionPanel({ issue, overview, onRefresh, refreshing, leaving, sourceIssueQuery='' }: {
  sourceIssueQuery?: string; issue: BillingOperatorIssue; overview: BillingOperatorOverview; onRefresh: () => void; refreshing: boolean;
  leaving: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const [invoice, setInvoice] = useState<BillingApplyInvoiceView | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [submitted,setSubmitted]=useState(false);
  const company = issue.companyId ? `/system/billing/companies/${encodeURIComponent(issue.companyId)}` : null;
  const paid = ['PAID_NOT_APPLIED', 'PAID_HELD'].includes(issue.kind), resolved = issue.state === 'RESOLVED';
  useEffect(()=>{setInvoice(null);setSubmitted(false);},[company,paid,issue.relatedInvoiceId,resolved]);
  useEffect(() => {
    let active = true; setError('');
    if (!paid || !company || !issue.relatedInvoiceId || resolved) { setLoading(false); return; }
    setLoading(true);
    void authedApiFetch<BillingApplyInvoiceView>(`${company}/apply-invoices/${encodeURIComponent(issue.relatedInvoiceId)}`, { cache: 'no-store', suppressErrorToast: true })
      .then(value => { if (active) setInvoice(value); })
      .catch(error => { if (active) {if([401,403,404].includes(error?.status))setInvoice(null);setError('โหลดหลักฐานรายการเดิมไม่ได้ ลองใหม่หรือตรวจสิทธิ์การเข้าถึง');} })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [company, paid, issue.relatedInvoiceId, resolved, reload]);
  const guide = nextStep(issue, overview, company);
  const resolvedSource = paid && company && issue.relatedInvoiceId ? `${company}/apply-invoices/${encodeURIComponent(issue.relatedInvoiceId)}` : guide.href;
  return <section aria-label="วิธีแก้ปัญหา" className="space-y-5 border-t border-gray-100 pt-5">
    {resolved ? <div role="status" className="rounded-xl border border-brand-200 bg-brand-50 p-5 text-brand-900">
      <h3 className="text-lg font-semibold">แก้ไขรายการนี้แล้ว</h3>
      <p className="mt-2">ระบบมีผลตรวจยืนยันและปิดรายการนี้แล้ว{issue.resolvedAt ? ` เมื่อ ${new Date(issue.resolvedAt).toLocaleString('th-TH')}` : ''}</p>
      {resolvedSource && resolvedSource !== company && <Link onClick={leaving} className="mt-3 mr-5 inline-flex min-h-11 items-center underline" href={resolvedSource}>ดูรายการต้นทาง</Link>}
      {company && <Link onClick={leaving} className="mt-3 inline-flex min-h-11 items-center underline" href={company}>ดูสิทธิ์ปัจจุบันของบริษัท</Link>}
    </div> : <>
      <div className="space-y-3"><h3 className="text-lg font-semibold text-gray-900">1. ปัญหาที่พบ</h3><p className="mt-2 text-gray-600">{paid ? 'ลูกค้าชำระเงินแล้ว แต่ยังมีปัญหาในการเปิดใช้แพ็กเกจ ต้องตรวจรายการชำระเดิม' : guide.description}</p></div>
      <div className="space-y-3 border-t border-gray-100 pt-5"><h3 className="text-lg font-semibold text-gray-900">2. ตรวจรายการและยืนยัน</h3>
        {paid && issue.relatedInvoiceId ? <>
          {loading && <p role="status">กำลังตรวจข้อมูลใบแจ้งหนี้เดิม…</p>}
          {error && <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-800"><p>{error}</p><button className={`${billingControl} mt-3`} onClick={() => setReload(value => value + 1)}>ลองโหลดหลักฐานอีกครั้ง</button></div>}
          {invoice && <>
            <p className="text-gray-600">สถานะปัจจุบัน: <strong className="font-semibold text-gray-900">{billingLabel('apply', invoice.applyState)}</strong></p>
            {invoice.errorCode === 'BILLING_ENTITLEMENT_REVIEW_REQUIRED' && <p className="rounded-lg bg-amber-50 p-4 text-amber-900">สิทธิ์เมนูเปลี่ยนจากรายการที่ลูกค้ายืนยันก่อนชำระ ต้องตรวจสิทธิ์ปัจจุบันกับรายการเดิมก่อนเปิดแพ็กเกจหรือคืนเงิน ห้ามสร้าง Checkout ใหม่หรือแก้ snapshot ของรายการที่จ่ายแล้ว</p>}
            {invoice.applyState==='APPLIED'&&<p className="text-gray-600">รายการนี้เปิดแพ็กเกจแล้ว ให้ตรวจยืนยันเพื่อปิดปัญหาที่ค้าง โดยไม่เพิ่มวันหรือโควตาซ้ำ</p>}
            {!invoice.canRetry && <p className="rounded-lg bg-amber-50 p-4 text-amber-900">ยังดำเนินการไม่ได้: ต้องมีสิทธิ์ตรวจการเปิดแพ็กเกจ ระบบชำระเงินเปิดใช้งาน และหลักฐานจ่ายครบ ดูข้อมูลบริษัทเพื่อตรวจเงื่อนไข</p>}
            <BillingOperationPanel companyId={issue.companyId!} companyVersion={invoice.accountVersion} invoiceId={invoice.id} invoiceSourceHash={invoice.sourceHash}
              canRetry={invoice.canRetry&&!loading&&!error} onSubmittedChange={setSubmitted} sourceIssueId={issue.id} sourceIssueQuery={sourceIssueQuery} onReloadSource={()=>setReload(value=>value+1)} onCompleted={onRefresh}
              initialReason="ตรวจและแก้การเปิดสิทธิ์จากรายการชำระเดิม" />
          </>}
        </> : <>
          {paid && <p className="text-gray-600">ยังจับคู่กับใบแจ้งหนี้ที่บันทึกในมั่งมีไม่ได้ ตรวจประวัติของบริษัทนี้ก่อน แล้วเลือกนำใบเดิมเข้าระบบเพื่อตรวจสิทธิ์ต่อ</p>}
          {guide.href ? <Link onClick={leaving} className={billingPrimaryControl} href={guide.href}>{guide.action}</Link> : <p className="rounded-lg bg-amber-50 p-4 text-amber-900">บัญชีนี้ไม่มีสิทธิ์เปิดเครื่องมือที่ต้องใช้ ให้ผู้ดูแลมั่งมีที่มีสิทธิ์รายการนี้ดำเนินการต่อ</p>}
        </>}
      </div>
      <div className="space-y-3 border-t border-gray-100 pt-5"><h3 className="text-lg font-semibold text-gray-900">3. ผลการแก้ไข</h3>
        <p className="text-gray-600">{paid&&issue.relatedInvoiceId&&!submitted?'ยืนยันในข้อ 2 ก่อน แล้วระบบจะแสดงผลให้ที่นี่':paid?'ระบบจะแสดงผลเมื่อดำเนินการเสร็จ หากปัญหายังอยู่ ให้ดูผลตรวจในข้อ 2 เพื่อดำเนินการต่อ':'เมื่อดำเนินการในหน้าที่เปิดไปแล้ว กลับมาตรวจผลของปัญหานี้'}</p>
        {(!paid||!issue.relatedInvoiceId||submitted)&&<button className={billingControl} disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}>{refreshing?'กำลังตรวจผล…':'ตรวจผลการแก้ไข'}</button>}
      </div>
    </>}
    <div className="flex flex-wrap gap-x-5 gap-y-2">{company && !resolved && <Link onClick={leaving} className="inline-flex min-h-11 items-center text-brand-800 underline" href={company}>ดูข้อมูลและสิทธิ์ของบริษัท</Link>}</div>
  </section>;
}

function nextStep(issue: BillingOperatorIssue, overview: BillingOperatorOverview, company: string | null) {
  const ref = encodeURIComponent(issue.reference), platform = overview.platformScope, financial = overview.capabilities.includes('system.billing.financial.read');
  let description = 'ตรวจรายการต้นทางและประวัติของบริษัทเพื่อหาสาเหตุ แล้วดำเนินการจากเครื่องมือของรายการนั้น', action = 'เปิดข้อมูลบริษัทเพื่อตรวจสาเหตุ', href: string | null = company;
  if (['PAID_HELD','PAID_NOT_APPLIED','PROVIDER_INVOICE_REVIEW','PROVIDER_INVOICE_SCAN_FAILED','ZERO_INVOICE_REVIEW'].includes(issue.kind)) {
    description = 'ต้องตรวจใบแจ้งหนี้เดิมและหลักฐานการชำระก่อนตัดสินใจให้สิทธิ์'; action = 'ตรวจใบแจ้งหนี้ของบริษัท'; href = company ? `${company}/invoice-scans${issue.kind === 'PROVIDER_INVOICE_SCAN_FAILED' ? `/${ref}` : ''}` : null;
  } else if (issue.kind === 'PROVIDER_EVENT_FAILED') {
    description = 'มั่งมีรับข้อมูลจาก Stripe แล้ว แต่ตรวจรายการนั้นไม่สำเร็จ เปิดรายการเดิมเพื่อตรวจและลองประมวลผลอีกครั้ง'; action = 'ตรวจรายการแจ้งจาก Stripe'; href = platform ? `/system/billing/provider-events/${ref}` : null;
  } else if (issue.kind.startsWith('PROVIDER_SCAN_')) {
    description = 'การค้นหารายการจาก Stripe มีปัญหาหรือมีช่วงเวลาที่ข้อมูลตกหล่น ตรวจงานเดิมและช่วงเวลาที่ต้องค้นหา'; action = 'ตรวจงานค้นหารายการ Stripe'; href = platform ? `/system/billing/provider-scans${['PROVIDER_SCAN_FAILED','PROVIDER_SCAN_VERSION_UNSUPPORTED'].includes(issue.kind) ? `/${ref}` : ''}` : null;
  } else if (issue.kind.startsWith('SETTLEMENT_')) {
    description = 'ยอดเงินต้องตรวจเทียบกับ Stripe เปิดผลตรวจเดิมเพื่อดูรายการที่ไม่ตรงกัน'; action = 'ตรวจยอดเงินรายการนี้'; href = platform && financial ? `/system/billing/settlements/${ref}` : null;
  } else if (issue.kind === 'CONTROL_OPERATION_REVIEW') {
    description = 'คำสั่งก่อนหน้ายังต้องตรวจผล เปิดคำสั่งเดิมก่อน เพื่อไม่ส่งงานซ้ำ'; action = 'ตรวจคำสั่งเดิม'; href = issue.operationType === 'REFUND' && !financial ? null : `/system/billing/${issue.operationType === 'REFUND' ? 'refunds' : issue.operationType === 'EXPIRE_CHECKOUT' ? 'checkout-expiry' : 'operations'}/${ref}`;
  } else if (issue.kind === 'CUSTOMER_COLLECTION_REVIEW' && ['GRANT_FREE_DAYS','CHANGE_COLLECTION'].includes(issue.operationType ?? '')) {
    description = 'คำขอปรับวันใช้งานหรือการเก็บเงินยังต้องตรวจผล ให้ตรวจคำขอเดิมก่อนส่งใหม่'; action = 'ตรวจคำขอปรับการต่ออายุเดิม'; href = financial ? `/system/billing/plan-adjustments/${ref}` : null;
  } else if (issue.kind.startsWith('CONFIGURATION_') || issue.kind === 'CONFIG_DRIFT') {
    description = 'การตั้งค่ามั่งมีกับ Stripe ต้องตรวจให้ตรงกัน ดูผลตรวจหรือคำขอตั้งค่าเดิมก่อนแก้'; action = 'ตรวจการตั้งค่าที่มีปัญหา'; href = platform ? `/system/billing/${issue.kind === 'CONFIGURATION_SCHEDULE_REVIEW' ? `configuration-changes/${ref}` : 'configuration-checks'}` : null;
  } else if (issue.kind.startsWith('NOTIFICATION_')) {
    description = 'การส่งข้อความแจ้งลูกค้ามีปัญหา ตรวจผู้รับและผลส่งเดิมก่อนเลือกตรวจผลหรือส่งซ้ำ'; action = 'ตรวจข้อความแจ้งลูกค้า'; href = company ? `${company}/deliveries` : null;
  } else if (issue.kind === 'REFUND_FAILED') {
    description = 'Stripe แจ้งว่าการคืนเงินไม่สำเร็จ ต้องตรวจผลคืนเงินเดิมก่อนพิจารณาขั้นต่อไป ไม่ควรสร้างรายการคืนเงินซ้ำทันที'; action = issue.relatedRefundOperationId ? 'ตรวจคำขอคืนเงินเดิม' : 'ตรวจประวัติการคืนเงินของบริษัท'; href = financial ? issue.relatedRefundOperationId ? `/system/billing/refunds/${encodeURIComponent(issue.relatedRefundOperationId)}` : company : null;
  } else if (['RECONCILIATION_FAILED','RENEWAL_REVIEW','REPEAT_RECOVERY','UNKNOWN_ATTEMPT','GRACE_CANCELLATION_UNKNOWN'].includes(issue.kind)) {
    description = 'ผลรายการซื้อหรือต่ออายุเดิมยังต้องตรวจ เปิดข้อมูลบริษัทแล้วใช้ “ตรวจสอบและกู้คืนรายการเดิม” ก่อนให้ลูกค้าซื้อใหม่';
  } else if (issue.kind === 'FINANCIAL_REVIEW') {
    description = 'ยอดคืนเงินหรือข้อพิพาทอาจมีผลต่อสิทธิ์ลูกค้า ต้องตรวจประวัติการเงินและตัดสินใจตามนโยบายบริษัท'; href = financial ? company : null;
  } else if (issue.kind === 'DUPLICATE_SUBSCRIPTION') {
    description = 'พบรายการสมาชิก Stripe มากกว่าหนึ่งรายการ ต้องตรวจสัญญาเดิมให้ชัดก่อนยกเลิกหรือคืนเงิน เพื่อไม่กระทบแพ็กเกจที่ลูกค้าใช้อยู่'; href = financial ? company : null;
  }
  return { description, action, href };
}
