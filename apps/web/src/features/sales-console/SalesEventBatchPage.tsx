'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  SALES_EVENT_REASON_MAX,
  type SalesEventBatchAction, type SalesEventBatchView, type SalesEventQr, type SalesEventTicketView,
} from '@watchdog-bms/contracts';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { TextareaField } from '@/common/components/field';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  changeSalesEventBatchState, getSalesEventBatch, issueSalesEventQr, listSalesEventTickets, revokeSalesEventTicket,
} from './sales.api';
import {
  actionNeedsReason, batchActions, batchRewardLines, batchScopeText, batchStatusMeta, countdownText, qrSecondsLeft,
  SALES_EVENT_ACTION_COPY, ticketStatusMeta, ticketUsableUntil,
} from './sales-events.logic';
import SalesEventBatchForm from './SalesEventBatchForm';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';

const STALE_MESSAGE = 'ชุดนี้ถูกแก้ไขจากที่อื่นแล้ว กด "โหลดข้อมูลล่าสุด" แล้วทำรายการอีกครั้ง';

/** "แสดง QR" at the booth (spec §3.2): big enough to scan from a phone, with its own countdown. */
function QrPanel({ batch, onFailure }: { batch: SalesEventBatchView; onFailure: (message: string) => void }) {
  const [qr, setQr] = useState<SalesEventQr | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, [qr]);

  const seconds = qr ? qrSecondsLeft(qr.expiresAt, now) : 0;
  const full = batch.issuedCount >= batch.issueCap;
  const show = async () => {
    setBusy(true);
    try {
      const next = await issueSalesEventQr(batch.id);
      setNow(new Date());
      setQr(next);
    } catch (cause) {
      setQr(null);
      onFailure(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MangmeeCard className="grid gap-3 p-4">
      <p className="text-[15px] font-bold text-gray-900">QR สำหรับลูกค้า</p>
      {qr && seconds > 0 ? (
        <>
          {/* A data: URL rendered by the API — the link inside never leaves as a query to anyone. */}
          <img src={qr.qrImageUrl} alt="QR สำหรับรับส่วนลดจากงาน" className="mx-auto aspect-square w-full max-w-72 rounded-xl border border-gray-200 bg-white p-2" />
          <p className="text-center text-sm text-gray-700" role="timer" aria-live="off">QR นี้ใช้ได้อีก <span className="font-bold">{countdownText(seconds)}</span> นาที</p>
          <p className="text-center text-xs text-gray-500">ให้ลูกค้าสแกนด้วยกล้องมือถือหรือ LINE สแกนได้หลายคนจนกว่า QR จะหมดเวลา</p>
        </>
      ) : (
        <p className="text-sm text-gray-600">
          {!batch.claimOpen ? 'ชุดนี้ยังไม่ถึงเวลาเปิดรับ ปิดรับแล้ว หรือถูกพักไว้ จึงแสดง QR ไม่ได้'
            : full ? 'ส่วนลดของชุดนี้ถูกแจกครบจำนวนแล้ว'
              : qr ? 'QR หมดเวลาแล้ว กดสร้าง QR ใหม่ให้ลูกค้าคนต่อไป' : 'กดแสดง QR ให้ลูกค้าสแกนรับส่วนลด QR แต่ละอันใช้ได้ 5 นาที'}
        </p>
      )}
      <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy || !batch.claimOpen || full} aria-busy={busy}
        onClick={() => void show()}>
        {qr ? 'สร้าง QR ใหม่' : 'แสดง QR'}
      </button>
    </MangmeeCard>
  );
}

function TicketRow({ ticket, canRevoke, onRevoke }: { ticket: SalesEventTicketView; canRevoke: boolean; onRevoke: () => void }) {
  const status = ticketStatusMeta(ticket);
  return (
    <div className="flex items-start justify-between gap-3 border-t border-gray-100 px-4 py-3 first:border-t-0">
      <div className="min-w-0 text-sm">
        <p className="font-bold text-gray-900">เลขส่วนลด {ticket.serial}</p>
        <p className="text-xs text-gray-500">แจกโดย {ticket.salesDisplayName || 'เซลล์'} · {formatThaiDateTime(ticket.issuedAt)}</p>
        {ticket.state === 'AVAILABLE' && <p className="text-xs text-gray-500">ใช้ได้ถึง {formatThaiDateTime(ticket.expiresAt)}</p>}
        {ticket.state === 'REVOKED' && ticket.revokeReason && <p className="break-words text-xs text-gray-500">เหตุผลที่เพิกถอน: {ticket.revokeReason}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <MangmeeBadge tone={status.tone}>{status.label}</MangmeeBadge>
        {canRevoke && ticket.state === 'AVAILABLE' && (
          <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={onRevoke}>เพิกถอน</button>
        )}
      </div>
    </div>
  );
}

export default function SalesEventBatchPage({ batchId, canManageEvents }: { batchId: string; canManageEvents: boolean }) {
  const [batch, setBatch] = useState<SalesEventBatchView | null>(null);
  const [tickets, setTickets] = useState<SalesEventTicketView[]>([]);
  const [ticketCursor, setTicketCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<SalesEventBatchAction | null>(null);
  const [revoking, setRevoking] = useState<SalesEventTicketView | null>(null);
  const [reason, setReason] = useState('');
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [view, page] = await Promise.all([getSalesEventBatch(batchId), listSalesEventTickets(batchId)]);
      if (!mounted.current) return;
      setBatch(view);
      setTickets(page.items);
      setTicketCursor(page.nextCursor);
    } catch (cause) {
      if (mounted.current) setError(apiErrorMessage(cause));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [batchId]);

  useEffect(() => { void load(); }, [load]);

  const failed = (cause: unknown) => setError(apiErrorCode(cause) === 'SALES_EVENT_BATCH_STALE' ? STALE_MESSAGE : apiErrorMessage(cause));

  const loadMoreTickets = async () => {
    if (!ticketCursor) return;
    try {
      const page = await listSalesEventTickets(batchId, ticketCursor);
      setTickets((previous) => [...previous, ...page.items]);
      setTicketCursor(page.nextCursor);
    } catch (cause) {
      failed(cause);
    }
  };

  const runDecision = async () => {
    if (!batch || !decision) return;
    const text = reason.trim();
    if (actionNeedsReason(decision) && !text) return;
    setBusy(true);
    setError(null);
    try {
      const next = await changeSalesEventBatchState(batch.id, { action: decision, expectedVersion: batch.version, ...(text ? { reason: text } : {}) });
      if (!mounted.current) return;
      setBatch(next);
      setNotice(`${SALES_EVENT_ACTION_COPY[decision].label}แล้ว`);
      setDecision(null);
    } catch (cause) {
      if (mounted.current) { setDecision(null); failed(cause); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const runRevoke = async () => {
    if (!revoking || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const next = await revokeSalesEventTicket(revoking.id, { reason: reason.trim(), expectedVersion: revoking.version });
      if (!mounted.current) return;
      setTickets((previous) => previous.map((ticket) => (ticket.id === next.id ? next : ticket)));
      setNotice(`เพิกถอนเลขส่วนลด ${next.serial} แล้ว`);
      setRevoking(null);
    } catch (cause) {
      if (mounted.current) { setRevoking(null); failed(cause); }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  if (loading && !batch) {
    return <MangmeePage eyebrow="ทีมขายมั่งมี" title="ส่วนลดจากงาน"><LoadingState label="กำลังโหลดชุดส่วนลด…" /></MangmeePage>;
  }
  if (!batch) {
    return (
      <MangmeePage eyebrow={<Link href="/sales/events" className="underline underline-offset-2">ส่วนลดจากงาน</Link>} title="ส่วนลดจากงาน">
        {error && <SalesNotice tone="error">{error}</SalesNotice>}
        <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" onClick={() => void load()}>ลองโหลดอีกครั้ง</button>
      </MangmeePage>
    );
  }

  const status = batchStatusMeta(batch, new Date());
  const counts = batch.counts;
  const left = Math.max(0, batch.issueCap - batch.issuedCount);
  return (
    <MangmeePage
      eyebrow={<Link href="/sales/events" className="underline underline-offset-2">ส่วนลดจากงาน</Link>}
      title={batch.eventName}
      description={batch.batchName}
      meta={<MangmeeBadge tone={status.tone}>{status.label}</MangmeeBadge>}
    >
      {error && <SalesNotice tone="error">{error}</SalesNotice>}
      {error === STALE_MESSAGE && (
        <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" onClick={() => void load()}>โหลดข้อมูลล่าสุด</button>
      )}
      {notice && <SalesNotice tone="info">{notice}</SalesNotice>}

      {batch.isDistributor && <QrPanel batch={batch} onFailure={setError} />}

      {editing ? (
        <SalesEventBatchForm batch={batch} onCancel={() => setEditing(false)}
          onSaved={(next) => { setBatch(next); setEditing(false); setNotice('บันทึกการเปลี่ยนแปลงแล้ว มีผลกับส่วนลดที่แจกหลังจากนี้'); }} />
      ) : (
        <MangmeeCard className="grid gap-3 p-4 text-sm">
          <div className="grid gap-1">
            {batchRewardLines(batch).map((line) => <p key={line} className="font-bold text-gray-900">{line}</p>)}
            {batch.discountSatang > 0 && <p className="text-gray-600">ลดได้: {batchScopeText(batch.scope)}</p>}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div><dt className="text-xs font-semibold text-gray-500">เปิดรับ</dt><dd className="text-gray-900">{formatThaiDateTime(batch.claimStartsAt)}</dd></div>
            <div><dt className="text-xs font-semibold text-gray-500">ปิดรับ</dt><dd className="text-gray-900">{formatThaiDateTime(batch.claimEndsAt)}</dd></div>
            <div className="col-span-2"><dt className="text-xs font-semibold text-gray-500">ส่วนลดที่แจกจากชุดนี้ใช้ได้ถึง</dt><dd className="text-gray-900">{formatThaiDateTime(ticketUsableUntil(batch.claimEndsAt))}</dd></div>
            <div><dt className="text-xs font-semibold text-gray-500">แจกแล้ว</dt><dd className="font-bold text-gray-900">{batch.issuedCount.toLocaleString('th-TH')} จาก {batch.issueCap.toLocaleString('th-TH')}</dd></div>
            <div><dt className="text-xs font-semibold text-gray-500">เหลือแจกได้</dt><dd className="font-bold text-gray-900">{left.toLocaleString('th-TH')}</dd></div>
          </dl>
          <p className="text-xs text-gray-500">
            {canManageEvents ? 'ทั้งชุด' : 'เฉพาะที่คุณแจก'}: ยังไม่ได้ใช้ {counts.available} · กำลังชำระ {counts.inPayment} · ใช้เป็นส่วนลด {counts.usedAsDiscount} · ใช้เป็นเครดิต {counts.usedAsCredit} · หมดอายุ {counts.expired} · เพิกถอน {counts.revoked}
          </p>
          <p className="text-xs text-gray-500">
            เซลล์ผู้แจก: {batch.agents.map((agent) => `${agent.displayName || 'เซลล์'}${agent.active ? '' : ' (ถอดแล้ว)'}`).join(', ')}
          </p>
          <p className="text-xs text-gray-400">สร้างโดย {batch.createdByDisplayName || 'ทีมขาย'} · {formatThaiDateTime(batch.createdAt)}</p>
        </MangmeeCard>
      )}

      {batch.canManage && !editing && (
        <div className="grid gap-2 sm:grid-cols-3">
          <button type="button" className="mangmee-btn mangmee-btn-secondary" disabled={busy} onClick={() => { setNotice(null); setEditing(true); }}>แก้ไขชุดนี้</button>
          {batchActions(batch.state).map((action) => (
            <button key={action} type="button" disabled={busy}
              className={`mangmee-btn ${action === 'SUSPEND' ? 'mangmee-btn-danger' : 'mangmee-btn-secondary'}`}
              onClick={() => { setReason(''); setDecision(action); }}>
              {SALES_EVENT_ACTION_COPY[action].label}
            </button>
          ))}
        </div>
      )}

      <section className="grid gap-2" aria-label="รายการส่วนลด">
        <h2 className="text-base font-bold text-gray-900">รายการส่วนลด</h2>
        {tickets.length === 0 ? <SalesEmpty>ยังไม่มีลูกค้ารับส่วนลดจากชุดนี้</SalesEmpty> : (
          <MangmeeCard>
            {tickets.map((ticket) => (
              <TicketRow key={ticket.id} ticket={ticket} canRevoke={batch.canManage}
                onRevoke={() => { setReason(''); setRevoking(ticket); }} />
            ))}
          </MangmeeCard>
        )}
        {ticketCursor && <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" onClick={() => void loadMoreTickets()}>โหลดรายการเพิ่ม</button>}
      </section>

      <Modal open={decision !== null} onClose={() => setDecision(null)} title={decision ? SALES_EVENT_ACTION_COPY[decision].title : ''}>
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-gray-600">{decision ? SALES_EVENT_ACTION_COPY[decision].hint : ''}</p>
          <TextareaField label={decision && actionNeedsReason(decision) ? 'เหตุผล (จำเป็น)' : 'เหตุผล (ไม่บังคับ)'} name="eventDecisionReason"
            maxLength={SALES_EVENT_REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setDecision(null)}>ปิด</button>
            <button type="button" className="mangmee-btn mangmee-btn-primary" aria-busy={busy}
              disabled={busy || (decision !== null && actionNeedsReason(decision) && !reason.trim())} onClick={() => void runDecision()}>
              {decision ? SALES_EVENT_ACTION_COPY[decision].label : ''}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={revoking !== null} onClose={() => setRevoking(null)} title="เพิกถอนส่วนลดนี้">
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-gray-600">
            เลขส่วนลด {revoking?.serial} จะใช้ไม่ได้อีก ทั้งเป็นส่วนลดและเป็นเครดิต และไม่คืนจำนวนแจกของชุด
          </p>
          <TextareaField label="เหตุผล (จำเป็น)" name="eventRevokeReason" maxLength={SALES_EVENT_REASON_MAX} value={reason}
            onChange={(event) => setReason(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setRevoking(null)}>ปิด</button>
            <button type="button" className="mangmee-btn mangmee-btn-danger" aria-busy={busy} disabled={busy || !reason.trim()}
              onClick={() => void runRevoke()}>เพิกถอน</button>
          </div>
        </div>
      </Modal>
    </MangmeePage>
  );
}
