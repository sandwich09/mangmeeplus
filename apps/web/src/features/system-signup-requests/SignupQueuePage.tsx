'use client';

import { useEffect, useState } from 'react';
import { SIGNUP_REJECTION_REASON_MAX_LENGTH } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { Modal, useConfirm } from '@/common/components/modal';
import { Button } from '@/common/components/button';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  decideSignupRequest,
  listSignupRequests,
  reissueSignupClaim,
  type AdminSignupQueueItemDto,
} from './signup-requests.api';
import {
  approveLabel,
  canApproveSignup,
  canRejectSignup,
  canReissueSignup,
  canSuspendSignup,
  filterSignupQueue,
  signupBusinessSummary,
  signupHintChips,
  isFinishingStrandedRow,
  isLineSignup,
  suspendLeavesShopRunning,
  signupIdleChip,
  signupStateChip,
  SIGNUP_QUEUE_TABS,
  type Chip,
  type ChipTone,
  type SignupQueueTab,
} from './signup-queue.logic';

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
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-gray-100" />
        </td>
      ))}
    </tr>
  );
}

const rowActionClass =
  'rounded border px-3 py-1 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed';

export default function SignupQueuePage() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<AdminSignupQueueItemDto[]>([]);
  const [tab, setTab] = useState<SignupQueueTab>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Reject needs its own dialog: the notify checkbox defaults OFF (spec §4D — silent reject,
  // because the applicant's mailbox is still unproven at this point).
  const [rejecting, setRejecting] = useState<AdminSignupQueueItemDto | null>(null);
  const [notifyApplicant, setNotifyApplicant] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await listSignupRequests()).items);
    } catch (err) {
      const e = err as Error & { status?: number };
      setError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูคำขอสมัครใช้งาน' : apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApprove = async (item: AdminSignupQueueItemDto) => {
    // P10-L: a LINE application has no address, so approving it opens the shop immediately and the
    // customer hears about it in LINE. Promising an email here would be a promise nothing keeps —
    // and for a row whose shop already exists, so would promising to open one (review LOW-2).
    const fromLine = isLineSignup(item);
    const finishing = fromLine && isFinishingStrandedRow(item.state);
    const accepted = await confirm({
      title: finishing ? 'ปิดงานคำขอ' : 'อนุมัติคำขอ',
      message: finishing
        ? `ปิดงานให้ร้าน ${item.companyName} ที่เปิดค้างอยู่ ใช่หรือไม่`
        : fromLine
          ? `อนุมัติและเปิดร้าน ${item.companyName} ให้ทันที (ลูกค้าจะได้รับแจ้งทาง LINE) ใช่หรือไม่`
          : `อนุมัติและส่งอีเมลตั้งรหัสให้ ${item.contactEmail ?? item.ownerDisplayName} ใช่หรือไม่`,
      confirmLabel: finishing ? 'ปิดงาน' : fromLine ? 'อนุมัติและเปิดร้าน' : 'อนุมัติและส่งอีเมล',
      variant: 'primary',
    });
    if (!accepted) return;
    setBusyId(item.requestId);
    try {
      // The API answers 200 with the CURRENT state, so a close-out that found the run still going
      // comes back as PROVISIONING. Reporting that as done would be the same lie the chip told.
      const decided = await decideSignupRequest(item.requestId, { action: 'APPROVE' });
      if (decided.state === 'PROVISIONING') {
        toast.warning('ยังเปิดร้านอยู่ รอสักครู่แล้วลองใหม่');
      } else {
        toast.success(finishing
          ? 'ปิดงานเรียบร้อย'
          : fromLine ? 'อนุมัติแล้ว เปิดร้านให้เรียบร้อย' : 'อนุมัติแล้ว ระบบกำลังส่งอีเมลตั้งรหัส');
      }
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    if (!rejecting) return;
    const item = rejecting;
    setBusyId(item.requestId);
    try {
      const reason = notifyApplicant ? rejectionReason.trim() : '';
      await decideSignupRequest(item.requestId, {
        action: 'REJECT',
        notifyApplicant,
        ...(reason ? { rejectionReason: reason } : {}),
      });
      toast.success(notifyApplicant ? 'ปฏิเสธคำขอและแจ้งผู้สมัครแล้ว' : 'ปฏิเสธคำขอแล้ว');
      setRejecting(null);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  // Spec §3.7: stopping a shop AUTO_FREE let through. The API has accepted SUSPEND since L-A;
  // until now nothing could reach it.
  const handleSuspend = async (item: AdminSignupQueueItemDto) => {
    // Suspending settles the APPLICATION. Where the shop already exists, saying "the shop will be
    // stopped" would be false — closing it is a separate action on the partner page.
    const accepted = await confirm({
      title: 'ระงับคำขอ',
      message: suspendLeavesShopRunning(item.state)
        ? `หยุดคำขอของร้าน ${item.companyName} ใช่หรือไม่ (ร้านที่เปิดไปแล้วยังใช้ได้ ต้องไปปิดที่หน้าพาร์ทเนอร์)`
        : `ระงับร้าน ${item.companyName} ใช่หรือไม่ ร้านจะถูกหยุดไว้จนกว่าทีมงานจะตรวจสอบ`,
      confirmLabel: 'ระงับ',
      variant: 'danger',
    });
    if (!accepted) return;
    setBusyId(item.requestId);
    try {
      await decideSignupRequest(item.requestId, { action: 'SUSPEND' });
      toast.success('ระงับคำขอแล้ว');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleReissue = async (item: AdminSignupQueueItemDto) => {
    const accepted = await confirm({
      title: 'ส่งลิงก์ตั้งรหัสใหม่',
      message: `ส่งลิงก์ตั้งรหัสใหม่ให้ ${item.contactEmail ?? item.ownerDisplayName} ใช่หรือไม่ ลิงก์เดิมจะใช้ไม่ได้ทันที`,
      confirmLabel: 'ส่งลิงก์ใหม่',
      variant: 'primary',
    });
    if (!accepted) return;
    setBusyId(item.requestId);
    try {
      const result = await reissueSignupClaim(item.requestId);
      toast.success(result.claimEmailQueued ? 'ส่งลิงก์ใหม่เข้าคิวแล้ว' : 'บันทึกคำขอส่งลิงก์ใหม่แล้ว');
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const visible = filterSignupQueue(items, tab);

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      {confirmDialog}

      <Modal
        open={rejecting !== null}
        title="ปฏิเสธคำขอสมัครใช้งาน"
        size="sm"
        onClose={() => setRejecting(null)}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setRejecting(null)} disabled={busyId !== null}>
              ยกเลิก
            </Button>
            <Button type="button" variant="danger" onClick={handleReject} disabled={busyId !== null}>
              {busyId !== null ? 'กำลังบันทึก...' : 'ปฏิเสธคำขอ'}
            </Button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            ปฏิเสธคำขอของ <span className="font-medium text-gray-900">{rejecting?.companyName}</span> ใช่หรือไม่
          </p>
          {/* Spec §4D: default OFF. The applicant's mailbox is still unproven at this point, so an
              unsolicited notice would make the platform a spam cannon aimed at whoever they typed. */}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={notifyApplicant}
              onChange={(e) => setNotifyApplicant(e.target.checked)}
              disabled={busyId !== null}
            />
            <span>
              ส่งอีเมลแจ้งผู้สมัคร
              <span className="mt-0.5 block text-xs text-gray-500">
                ค่าเริ่มต้นคือไม่ส่ง เพราะอีเมลนี้ยังไม่ผ่านการยืนยัน ข้อความที่ส่งจะไม่เปิดเผยเหตุผลภายใน
              </span>
            </span>
          </label>

          {notifyApplicant && (
            <div className="space-y-1.5">
              <label htmlFor="signup-rejection-reason" className="block text-sm font-medium text-gray-700">
                ข้อความถึงผู้สมัคร (ไม่บังคับ)
              </label>
              <textarea
                id="signup-rejection-reason"
                rows={3}
                maxLength={SIGNUP_REJECTION_REASON_MAX_LENGTH}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                disabled={busyId !== null}
                placeholder="เช่น ข้อมูลบริษัทไม่ครบ ติดต่อทีมงานเพื่อส่งใหม่ได้"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none disabled:bg-gray-50"
              />
              <p className="text-xs text-gray-500">
                เว้นว่างได้ ถ้าเว้นว่าง อีเมลจะแจ้งผลอย่างเดียว ไม่ระบุเหตุผล ({rejectionReason.length}/{SIGNUP_REJECTION_REASON_MAX_LENGTH})
              </p>
            </div>
          )}
        </div>
      </Modal>

      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">คำขอสมัครใช้งาน</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            ตรวจและอนุมัติร้านที่สมัครเข้ามาเอง อนุมัติแล้วระบบจะส่งลิงก์ตั้งรหัสผ่านทางอีเมล
            หรือเปิดร้านให้ทันทีสำหรับคำขอที่มาจาก LINE
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {SIGNUP_QUEUE_TABS.map((t) => {
            const active = tab === t.key;
            const count = filterSignupQueue(items, t.key).length;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(t.key)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-brand-200 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:text-gray-900'
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-xs text-gray-400">{count}</span>
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

        {!error && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">ร้าน / ผู้ติดต่อ</th>
                    <th className="px-4 py-3">ติดต่อ</th>
                    <th className="px-4 py-3">ประเภทธุรกิจ</th>
                    <th className="px-4 py-3">สถานะ</th>
                    <th className="px-4 py-3">เวลา</th>
                    <th className="px-4 py-3">การทำงาน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {loading ? (
                    [...Array(4)].map((_, i) => <SkeletonRow key={i} />)
                  ) : visible.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-sm text-gray-400">
                        ไม่มีคำขอในกลุ่มนี้
                      </td>
                    </tr>
                  ) : (
                    visible.map((item) => {
                      const busy = busyId === item.requestId;
                      const idle = signupIdleChip(item);
                      const hints = signupHintChips(item);
                      return (
                        <tr key={item.requestId} className="align-top hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium text-gray-900">
                              {item.companyName}
                              {isLineSignup(item) && (
                                <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-800">
                                  LINE
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-gray-500">
                              {item.lineDisplayName ?? item.ownerDisplayName}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-gray-700">{item.contactEmail ?? '—'}</p>
                            <p className="text-xs text-gray-500">{item.phoneNumber ?? '—'}</p>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{signupBusinessSummary(item)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <ChipBadge chip={signupStateChip(item.state, item)} />
                              {idle && <ChipBadge chip={idle} />}
                              {hints.map((chip) => (
                                <ChipBadge key={chip.label} chip={chip} />
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{formatThaiDateTime(item.createdAt)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              {canApproveSignup(item.state, item) && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void handleApprove(item)}
                                    className={`${rowActionClass} border-green-300 bg-green-50 text-green-700 hover:bg-green-100`}
                                  >
                                    {busy ? 'กำลังทำรายการ...' : approveLabel(item.state)}
                                  </button>
                                </>
                              )}
                              {/* Rejecting is only a decision before one has been made; every other
                                  state answers 409, so the button used to be a dead end. */}
                              {canRejectSignup(item.state) && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => { setNotifyApplicant(false); setRejectionReason(''); setRejecting(item); }}
                                  className={`${rowActionClass} border-red-200 bg-red-50 text-red-600 hover:bg-red-100`}
                                >
                                  ปฏิเสธ
                                </button>
                              )}
                              {canReissueSignup(item.state) && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleReissue(item)}
                                  className={`${rowActionClass} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
                                >
                                  {busy ? 'กำลังทำรายการ...' : 'ส่งลิงก์ใหม่'}
                                </button>
                              )}
                              {canSuspendSignup(item) && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void handleSuspend(item)}
                                  className={`${rowActionClass} border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100`}
                                >
                                  ระงับ
                                </button>
                              )}
                              {!canApproveSignup(item.state, item) && !canRejectSignup(item.state)
                                && !canReissueSignup(item.state) && !canSuspendSignup(item) && (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
