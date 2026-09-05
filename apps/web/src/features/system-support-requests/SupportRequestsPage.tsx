'use client';

import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useConfirm } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  listSupportRequests,
  markSupportRequestAnswered,
  publishSupportOpenCount,
  resumeSupportRequestAi,
  type SupportRequestItemDto,
} from './support-requests.api';
import {
  SUPPORT_QUEUE_TABS,
  canMarkAnswered,
  canResumeAi,
  notifiedSummary,
  supportAnswerHref,
  supportAnswerLabel,
  supportClosedReasonTh,
  supportStatusChip,
  waitedLabelTh,
  waitedForTh,
  type Chip,
  type ChipTone,
  type SupportQueueTab,
} from './support-requests.logic';

const CHIP_CLASS: Record<ChipTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  info: 'bg-blue-50 text-blue-700 border-blue-200',
  warning: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  success: 'bg-green-50 text-green-700 border-green-200',
};

function ChipBadge({ chip }: { chip: Chip }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${CHIP_CLASS[chip.tone]}`}>
      {chip.label}
    </span>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-gray-100" />
        </td>
      ))}
    </tr>
  );
}

const rowActionClass =
  'rounded border px-3 py-1 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * The buttons one row offers. Exported so a spec can RENDER the gating rather than only read the
 * source — the page reaches its rows behind `useEffect`, and "which requests may still be acted
 * on" is exactly the rule a source assertion can agree with while the markup does something else.
 */
export function SupportRowActions({ item, busy, onAnswered, onResume }: {
  item: SupportRequestItemDto;
  busy: boolean;
  onAnswered: () => void;
  onResume: () => void;
}) {
  const href = supportAnswerHref(item);
  return (
    <div className="flex flex-wrap gap-2">
      {href && (
        <a
          href={href}
          className={`${rowActionClass} border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100`}
        >
          {supportAnswerLabel(item)}
        </a>
      )}
      {canMarkAnswered(item.status) && (
        <button
          type="button"
          disabled={busy}
          onClick={onAnswered}
          className={`${rowActionClass} border-green-300 bg-green-50 text-green-700 hover:bg-green-100`}
        >
          {busy ? 'กำลังทำรายการ...' : 'ตอบแล้ว'}
        </button>
      )}
      {canResumeAi(item.status) && (
        <button
          type="button"
          disabled={busy}
          onClick={onResume}
          className={`${rowActionClass} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
        >
          {busy ? 'กำลังทำรายการ...' : 'ให้ AI ทำงานต่อ'}
        </button>
      )}
      {!href && !canMarkAnswered(item.status) && !canResumeAi(item.status) && (
        <span className="text-xs text-gray-400">—</span>
      )}
    </div>
  );
}

/**
 * line-support-request-spec-th §2.3 — "คำขอคุยกับเจ้าหน้าที่".
 *
 * Owner 2026-09-05: no operator has LINE linked, so this page is the PRIMARY channel, not a
 * secondary view of one. A request appears here the moment a customer taps, whether or not any
 * notification went anywhere — which is why `notifiedSummary` reads as information and only the
 * "nothing reached anybody" case is coloured as a fault.
 */
export default function SupportRequestsPage() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<SupportRequestItemDto[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [tab, setTab] = useState<SupportQueueTab>('OPEN');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Which read is allowed to write state. Tab switches and post-action reloads overlap, and without
   * this the slower of two in-flight reads wins — showing the previous tab's rows under the new
   * tab's heading. A counter rather than only an AbortController because an abort is best-effort:
   * a response already in flight still resolves, and this is what makes it harmless.
   */
  const readSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = async (next: SupportQueueTab = tab) => {
    const seq = ++readSeq.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await listSupportRequests(next, { signal: controller.signal });
      if (seq !== readSeq.current) return;
      setItems(result.items);
      setOpenCount(result.openCount);
      // One number, one source: the nav badge above this page reads what we just read.
      publishSupportOpenCount(result.openCount);
    } catch (err) {
      if (seq !== readSeq.current) return;
      const e = err as Error & { status?: number };
      // Cleared, not left standing: rows under a permission error read as "the queue is empty",
      // and rows from the previous tab under a failed switch read as this tab's contents.
      setItems([]);
      setError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูคำขอคุยกับเจ้าหน้าที่' : apiErrorMessage(err));
    } finally {
      if (seq === readSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    void load('OPEN');
    return () => inFlight.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectTab = (next: SupportQueueTab) => {
    setTab(next);
    void load(next);
  };

  const handleAnswered = async (item: SupportRequestItemDto) => {
    setBusyId(item.id);
    try {
      await markSupportRequestAnswered(item.id);
      toast.success('บันทึกว่าตอบแล้ว');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleResume = async (item: SupportRequestItemDto) => {
    // The customer's chat changes the moment this lands, so it asks first — the same treatment the
    // signup queue gives every decision a customer can feel.
    const ok = await confirm({
      title: 'ให้ AI ทำงานต่อ',
      message: `น้องมั่งมีจะกลับมาตอบในแชทของ ${item.askerLabel} และคำขอนี้จะถูกปิด`,
      confirmLabel: 'ให้ AI ทำงานต่อ',
      variant: 'primary',
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      const result = await resumeSupportRequestAi(item.id);
      toast.success(result.pauseCleared ? 'น้องมั่งมีกลับมาตอบแล้ว' : 'ปิดคำขอแล้ว (ไม่มีการหยุด AI ค้างอยู่)');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      {confirmDialog}

      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">คำขอคุยกับเจ้าหน้าที่</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            ลูกค้าที่กด ติดต่อเจ้าหน้าที่ ใน LINE จะขึ้นที่นี่ทันที ตอบได้จากกล่อง ส่งข้อความถึงร้าน ในหน้าร้าน
            โดยไม่ต้องผูก LINE กับบัญชีทีมงาน
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {SUPPORT_QUEUE_TABS.map((t) => {
            const active = tab === t.key;
            // Only the OPEN total is known without loading that tab; the others show no count
            // rather than a confident zero.
            const count = t.key === 'OPEN' ? openCount : null;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => selectTab(t.key)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-brand-200 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:text-gray-900'
                }`}
              >
                {t.label}
                {count !== null && <span className="ml-1.5 text-xs text-gray-400">{count}</span>}
              </button>
            );
          })}
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            <button type="button" className="ml-3 underline" onClick={() => void load()}>
              ลองใหม่
            </button>
          </div>
        )}

        {/* Gated on `!error` like the signup queue: an empty table under a permission banner says
            "there is nothing waiting", which is the one thing a 403 does not tell us. */}
        {!error && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">ผู้ขอ</th>
                  <th className="px-4 py-3">รอมานาน</th>
                  <th className="px-4 py-3">ข้อความล่าสุด</th>
                  <th className="px-4 py-3">แจ้งทีมงาน</th>
                  <th className="px-4 py-3">การทำงาน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-700">
                {loading ? (
                  [...Array(4)].map((_, i) => <SkeletonRow key={i} />)
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                      ไม่มีคำขอในกลุ่มนี้
                    </td>
                  </tr>
                ) : items.map((item) => {
                  const busy = busyId === item.id;
                  const closedReason = supportClosedReasonTh(item.closedReason);
                  return (
                    <tr key={item.id} className="align-top hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{item.askerLabel}</p>
                        {/* §3 PDPA: a fragment of the hash, so two rows can be matched to one
                            person without a LINE id ever reaching this page. */}
                        <p className="mt-0.5 text-xs text-gray-400">รหัสผู้ขอ {item.askerRef}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          <ChipBadge chip={supportStatusChip(item.status)} />
                          {closedReason && <span className="text-xs text-gray-400">{closedReason}</span>}
                        </div>
                        {item.answeredByDisplayName && (
                          <p className="mt-0.5 text-xs text-gray-500">ตอบโดย {item.answeredByDisplayName}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {/* The clock stops when somebody answered or the request closed: a
                            settled row that keeps counting reads as a customer still waiting. */}
                        <p className="text-gray-500">{waitedLabelTh(item)}</p>
                        <p className="font-medium text-gray-900">{waitedForTh(item)}</p>
                        <p className="mt-0.5 text-gray-500">{formatThaiDateTime(item.requestedAt)}</p>
                      </td>
                      {/* 200 characters of Thai in an unconstrained cell pushed the action column
                          off a 390px screen. Bounded, clamped and breakable; the full text is on
                          the title attribute for anyone who needs it. */}
                      <td className="max-w-[16rem] px-4 py-3 text-xs text-gray-600">
                        {item.lastMessageText ? (
                          <span className="line-clamp-2 block break-words" title={item.lastMessageText}>
                            “{item.lastMessageText}”
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <ChipBadge chip={notifiedSummary(item)} />
                      </td>
                      <td className="px-4 py-3">
                        <SupportRowActions
                          item={item}
                          busy={busy}
                          onAnswered={() => void handleAnswered(item)}
                          onResume={() => void handleResume(item)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
