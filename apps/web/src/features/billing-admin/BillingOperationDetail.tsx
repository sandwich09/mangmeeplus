'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import type { BillingRepairOperation } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingControl, billingPrimaryControl, billingLabel, billingDeliveryLabel } from '../billing/billing-display';

const tasks: Record<string, { title: string; effect: string }> = {
  RETRY_APPLY: { title: 'ตรวจและแก้การเปิดใช้แพ็กเกจ', effect: 'ตรวจยอดชำระและเงื่อนไขจากรายการเดิม แล้วเปิดแพ็กเกจเมื่อผ่านการตรวจ โดยไม่เรียกเก็บเงินเพิ่มหรือเพิ่มสิทธิ์ซ้ำ' },
  RECONCILE: { title: 'ตรวจสถานะการชำระเงินของบริษัท', effect: 'ตรวจข้อมูลล่าสุดกับ Stripe แล้วปรับข้อมูลในมั่งมีตามผลที่ตรวจพบ' },
  IMPORT_INVOICE: { title: 'นำใบแจ้งหนี้เดิมเข้ามั่งมี', effect: 'ตรวจหลักฐานแล้วบันทึกใบแจ้งหนี้เดิม โดยไม่เรียกเก็บเงินหรือเพิ่มสิทธิ์ ต้องตรวจการเปิดใช้แพ็กเกจแยกอีกขั้น' },
  RETRY_NOTIFICATION: { title: 'ส่งข้อความแจ้งเตือนเดิมอีกครั้ง', effect: 'นำข้อความเดิมกลับเข้าคิวส่งให้ผู้รับเดิม โดยไม่เรียกเก็บเงินหรือเพิ่มสิทธิ์' },
  RECONCILE_NOTIFICATION: { title: 'ตรวจผลการส่งอีเมลเดิม', effect: 'ตรวจผลกับ Postmark แล้วอัปเดตสถานะในมั่งมี โดยไม่ส่งอีเมลใหม่' },
  RETRY_PROVIDER_EVENT: { title: 'ประมวลผลข้อมูลจาก Stripe อีกครั้ง', effect: 'ตรวจหลักฐานล่าสุดและประมวลผลรายการเดิมตามเงื่อนไขของระบบ' },
};
const states: Record<string, { label: string; help: string }> = {
  PREVIEW: { label: 'รอยืนยัน', help: 'ตรวจรายละเอียดด้านล่างก่อนยืนยัน ระบบยังไม่ได้เริ่มดำเนินการครั้งนี้' },
  QUEUED: { label: 'รอระบบดำเนินการ', help: 'รับคำขอแล้ว ระบบจะแสดงผลเมื่อดำเนินการเสร็จ' },
  RUNNING: { label: 'กำลังดำเนินการ', help: 'ระบบกำลังทำรายการนี้ ไม่ต้องส่งคำขอซ้ำ' },
  SUCCEEDED: { label: 'ดำเนินการเสร็จแล้ว', help: 'ดูผลที่ระบบตรวจพบด้านล่าง สถานะนี้เป็นผลของการดำเนินการครั้งนี้' },
  CANCELLED: { label: 'ยกเลิกการดำเนินการครั้งนี้แล้ว', help: 'การยกเลิกครั้งนี้ไม่ได้หมายถึงการยกเลิกการชำระเงินหรือคืนเงินให้ลูกค้า' },
  FAILED: { label: 'ดำเนินการไม่สำเร็จ', help: 'เปิดรายการที่เกี่ยวข้องเพื่อตรวจสาเหตุและแก้ไข ก่อนลองดำเนินการอีกครั้ง' },
  BLOCKED: { label: 'ยังดำเนินการต่อไม่ได้', help: 'ตรวจหลักฐาน สิทธิ์ของผู้ดำเนินการ และเงื่อนไขของรายการที่เกี่ยวข้องก่อนลองอีกครั้ง' },
  UNKNOWN: { label: 'ยังยืนยันผลไม่ได้', help: 'ตรวจผลของรายการเดิมก่อนลองอีกครั้ง เพื่อป้องกันการดำเนินการซ้ำ' },
};

export const billingRepairTask = (type: string) => tasks[type] ?? { title: 'ตรวจสอบรายการชำระเงิน', effect: 'ตรวจรายละเอียดรายการที่เกี่ยวข้องก่อนดำเนินการ' };

export default function BillingOperationDetail({ operation, busy, stale, pollEnded, returnHref, returnLabel, onRefresh, onAct, leaving }: {
  operation: BillingRepairOperation; busy: boolean; stale: boolean; pollEnded: boolean;
  returnHref?: string; returnLabel?: string; onRefresh: () => void;
  onAct: (action: 'submit' | 'retry' | 'cancel') => void;
  leaving: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const task = billingRepairTask(operation.type);
  const status = states[operation.state] ?? { label: 'ตรวจสอบสถานะรายการ', help: 'เปิดรายการที่เกี่ยวข้องเพื่อดูขั้นตอนถัดไป' };
  const company = operation.scope.kind === 'COMPANY' ? `/system/billing/companies/${encodeURIComponent(operation.scope.companyId)}` : null;
  const ref = operation.referenceId ? encodeURIComponent(operation.referenceId) : null;
  const source = operation.type === 'RETRY_APPLY' && company ? { href: `${company}/apply-invoices${ref ? `/${ref}` : ''}`, label: 'เปิดรายการชำระเดิม' }
    : operation.type === 'IMPORT_INVOICE' && company && ref ? { href: `${company}/invoice-findings/${ref}`, label: 'เปิดผลตรวจใบแจ้งหนี้เดิม' }
    : ['RETRY_NOTIFICATION', 'RECONCILE_NOTIFICATION'].includes(operation.type) && company && ref ? { href: `${company}/deliveries/${ref}`, label: 'เปิดรายการส่งข้อความเดิม' }
    : operation.type === 'RETRY_PROVIDER_EVENT' && ref ? { href: `/system/billing/provider-events/${ref}`, label: 'เปิดข้อมูลเดิมจาก Stripe' }
    : company ? { href: company, label: 'ดูข้อมูลและสิทธิ์ของบริษัท' } : { href: '/system/billing', label: 'กลับหน้าการชำระเงิน' };
  const back = returnHref ? { href: returnHref, label: returnLabel! } : source;
  const tone = ['FAILED', 'BLOCKED', 'UNKNOWN'].includes(operation.state) ? 'border-amber-200 bg-amber-50 text-amber-900'
    : operation.state === 'SUCCEEDED' ? 'border-brand-200 bg-brand-50 text-brand-900' : 'border-gray-200 bg-gray-50 text-gray-700';
  const pending = ['QUEUED', 'RUNNING'].includes(operation.state);
  return <article aria-label="รายละเอียดการดำเนินการ" className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900">{task.title}</h2>
        <span className={`rounded-lg border px-3 py-1.5 text-sm ${operation.scope.mode === 'TEST' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-600'}`}>{billingLabel('mode', operation.scope.mode)}</span>
      </div>
      <div className="space-y-2"><p role="status" className={`inline-flex rounded-lg border px-3 py-2 font-semibold ${tone}`}>{status.label}</p><p className="max-w-3xl leading-relaxed text-gray-600">{status.help}</p></div>
      <dl className="grid gap-x-8 gap-y-5 text-base sm:grid-cols-2">
        <div><dt className="text-sm text-gray-500">บันทึกรายการเมื่อ</dt><dd className="mt-1 text-gray-900">{formatThaiDateTime(operation.createdAt)}</dd></div>
        <div><dt className="text-sm text-gray-500">มีผลตรวจเมื่อ</dt><dd className="mt-1 text-gray-900">{formatThaiDateTime(operation.observedAt, 'ยังไม่มีผลตรวจ')}</dd></div>
        {operation.invoiceImpact && <>
          <div><dt className="text-sm text-gray-500">รอบแพ็กเกจของรายการเดิม เริ่ม</dt><dd className="mt-1 text-gray-900">{formatThaiDateTime(operation.invoiceImpact.periodStart)}</dd></div>
          <div><dt className="text-sm text-gray-500">รอบแพ็กเกจของรายการเดิม สิ้นสุด</dt><dd className="mt-1 text-gray-900">{formatThaiDateTime(operation.invoiceImpact.periodEnd)}</dd></div>
          <div><dt className="text-sm text-gray-500">สถานะตอนตรวจรายการ</dt><dd className="mt-1 text-gray-900">{billingLabel('apply', operation.invoiceImpact.beforeState)}</dd></div>
        </>}
        {operation.observed?.invoiceApplyState && <div><dt className="text-sm text-gray-500">ผลการเปิดแพ็กเกจที่ตรวจพบ</dt><dd className="mt-1 font-semibold text-gray-900">{billingLabel('apply', operation.observed.invoiceApplyState)}</dd></div>}
      </dl>
    </div>
    <div className="space-y-4 p-4 sm:p-6">
      <h3 className="text-lg font-semibold text-gray-900">{operation.state === 'PREVIEW' ? 'ตรวจข้อมูลก่อนยืนยัน' : 'ทำอะไรต่อ'}</h3>
      <div className="max-w-3xl space-y-3 leading-relaxed text-gray-600">
        {operation.state === 'PREVIEW' ? <><p>{task.effect}</p><p>ยืนยันได้ถึง {formatThaiDateTime(operation.expiresAt)}</p>
          {!operation.allowedActions.includes('submit') && <p>ตอนนี้ยืนยันรายการนี้ไม่ได้ ข้อมูลอาจหมดอายุ เปลี่ยนไป หรือบัญชีนี้ไม่มีสิทธิ์ดำเนินการ ให้กลับไปตรวจรายการต้นทางอีกครั้ง</p>}</>
          : <p>{pending ? pollEnded ? 'ยังรอผลอยู่ กดอัปเดตสถานะหรือกลับมาตรวจภายหลังได้' : 'หน้านี้จะอัปเดตผลให้อัตโนมัติระหว่างที่เปิดอยู่ กลับมาตรวจภายหลังได้'
            : operation.state === 'CANCELLED' ? 'หากยังต้องแก้ปัญหา ให้กลับไปตรวจรายการเดิมและเริ่มดำเนินการใหม่'
            : operation.state === 'SUCCEEDED' ? operation.type === 'RETRY_APPLY' ? 'กลับไปดูผลของปัญหาและสิทธิ์ปัจจุบันของบริษัท การดำเนินการเสร็จไม่ได้หมายความว่าทุกปัญหาของบริษัทได้รับการแก้ไขแล้ว'
              : 'เปิดรายการที่เกี่ยวข้องเพื่อตรวจผลและดำเนินขั้นตอนถัดไป' : 'ตรวจรายการที่เกี่ยวข้องก่อน แล้วดำเนินการต่อด้วยปุ่มที่ระบบเปิดให้'}</p>}
        {operation.type === 'RETRY_APPLY' && !operation.invoiceImpact && <p>รายการเก่านี้ไม่ได้ระบุใบแจ้งหนี้ ต้องเลือกใบเดิมจากข้อมูลบริษัทก่อนตรวจใหม่</p>}
        {operation.findingImpact && <p>ใบแจ้งหนี้ที่ตรวจพบสร้างเมื่อ {formatThaiDateTime(operation.findingImpact.invoiceCreatedAt)} · สถานะที่พบ: {billingLabel('payment', operation.findingImpact.beforeState)}</p>}
        {operation.eventImpact && <p>สถานะข้อมูลจาก Stripe ก่อนดำเนินการ: {billingLabel('event', operation.eventImpact.beforeState)} · ประมวลผลมาแล้ว {operation.eventImpact.attempts} ครั้ง</p>}
        {operation.observed?.eventState && <p>ผลข้อมูลจาก Stripe ที่ตรวจพบ: {billingLabel('event', operation.observed.eventState)}</p>}
        {operation.deliveryImpact && <>
          <p>ส่งทาง{billingLabel('channel', operation.deliveryImpact.channel)} ถึง {operation.deliveryImpact.recipientName ?? 'ผู้รับเดิม (ดูชื่อในรายการส่งข้อความ)'}</p>
          <p>สถานะก่อนดำเนินการ: {billingDeliveryLabel(operation.deliveryImpact.beforeState, operation.deliveryImpact.channel)} · พยายามส่งแล้ว {operation.deliveryImpact.attemptCount} ครั้ง</p>
          {operation.deliveryImpact.possibleDuplicate && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">ยังยืนยันผลการส่งเดิมไม่ได้ การส่งอีกครั้งอาจทำให้ลูกค้าได้รับข้อความซ้ำ</p>}
          {operation.deliveryImpact.channel === 'LINE' && <p>{operation.deliveryImpact.retryUntil ? `ส่งรายการเดิมซ้ำได้ถึง ${formatThaiDateTime(operation.deliveryImpact.retryUntil)}` : 'ระยะเวลาที่ส่งซ้ำได้จะเริ่มนับเมื่อส่งคำขอครั้งแรก'}</p>}
        </>}
        {operation.observed?.deliveryState && <p>ผลการส่งที่ตรวจพบ: {billingDeliveryLabel(operation.observed.deliveryState, operation.deliveryImpact?.channel)}</p>}
        {['RETRY_NOTIFICATION', 'RECONCILE_NOTIFICATION'].includes(operation.type) && <p>การดำเนินการเสร็จยังไม่ยืนยันว่าลูกค้าได้รับข้อความ ให้ดูผลในรายการส่งข้อความเดิม</p>}
      </div>
      <div className="flex flex-wrap gap-3">
        {operation.allowedActions.map(action => <button key={action} type="button" disabled={busy || stale} aria-busy={busy} className={action === 'cancel' ? billingControl : billingPrimaryControl} onClick={() => onAct(action)}>
          {action === 'submit' ? 'ยืนยันดำเนินการ' : action === 'retry' ? 'ลองดำเนินการอีกครั้ง' : 'ยกเลิกครั้งนี้'}
        </button>)}
        <Link onClick={leaving} href={back.href} className={operation.allowedActions.length ? billingControl : billingPrimaryControl}>{back.label}</Link>
        {operation.type === 'IMPORT_INVOICE' && operation.observed?.invoiceId && company && <Link onClick={leaving} className={billingControl} href={`${company}/apply-invoices/${encodeURIComponent(operation.observed.invoiceId)}`}>ตรวจการเปิดแพ็กเกจจากใบที่บันทึก</Link>}
      </div>
      <button type="button" onClick={onRefresh} disabled={busy} aria-busy={Boolean(busy)} className="min-h-11 rounded-lg px-2 text-sm font-medium text-gray-600 underline underline-offset-4 hover:bg-gray-50 disabled:opacity-50">อัปเดตสถานะ</button>
    </div>
    <details className="group p-4 sm:px-6">
      <summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-600">ข้อมูลอ้างอิงสำหรับตรวจสอบ</summary>
      <div className="space-y-5 pt-3 text-sm text-gray-600">
        <p>เลขอ้างอิงใช้ค้นประวัติและตรวจสอบภายในมั่งมี ระบบบันทึกให้เอง ไม่ต้องกรอกหรือจำ</p>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><dt>เหตุผลที่บันทึกไว้</dt><dd className="mt-1 whitespace-pre-wrap break-words text-gray-900">{operation.reason}</dd></div>
          <div><dt>เลขการดำเนินการ</dt><dd className="mt-1 break-all text-gray-900">{operation.id}</dd></div>
          <div><dt>เลขรายการต้นทาง</dt><dd className="mt-1 break-all text-gray-900">{operation.referenceId ?? 'ไม่มี'}</dd></div>
          <div><dt>ผู้เริ่มดำเนินการ (รหัสบัญชี)</dt><dd className="mt-1 break-all text-gray-900">{operation.initiatorUserId}</dd></div>
          <div><dt>รุ่นข้อมูล</dt><dd className="mt-1 text-gray-900">{operation.version}</dd></div>
          {operation.errorCode && <div><dt>รหัสสาเหตุ</dt><dd className="mt-1 break-all text-gray-900">{operation.errorCode}</dd></div>}
          {operation.observed && <div><dt>ปัญหาคงค้างเมื่อครั้งที่ตรวจ</dt><dd className="mt-1 text-gray-900">{operation.observed.issueCount} รายการ{operation.observed.pendingAttemptId ? ' · มีรายการชำระเงินที่ยังรอผล' : ''}</dd></div>}
        </dl>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {source.href !== back.href && <Link onClick={leaving} className="inline-flex min-h-11 items-center text-brand-800 underline" href={source.href}>{source.label}</Link>}
          {company && source.href !== company && back.href !== company && <Link onClick={leaving} className="inline-flex min-h-11 items-center text-brand-800 underline" href={company}>ดูข้อมูลและสิทธิ์ของบริษัท</Link>}
        </div>
      </div>
    </details>
  </article>;
}
