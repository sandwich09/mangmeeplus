'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  COMPANY_BUSINESS_CATEGORIES,
  PLAN_TIER_PRESETS,
  type PlanTierKey,
  SIGNUP_REJECTION_REASON_MAX_LENGTH,
  SIGNUP_RESOLUTION_NOTE_MAX_LENGTH,
  signupDiscoveryLabel,
  type AdminSignupDecisionBody,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { Modal, useConfirm } from '@/common/components/modal';
import { Button } from '@/common/components/button';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  decidePackageChangeRequest,
  decideSignupRequest,
  listAutoApprovedSignups,
  listPackageChangeRequests,
  listSignupRequests,
  reissueSignupClaim,
  type AdminPackageChangeItemDto,
  type AdminSignupQueueItemDto,
} from './signup-requests.api';
import {
  approveBlockedOnCategory,
  approveLabel,
  BUSINESS_CATEGORY_LABELS,
  canApproveSignup,
  canRejectSignup,
  canReissueSignup,
  canRetrySignupIntake,
  canSuspendSignup,
  isAbandonedEmptyAttempt,
  queueEmptyForReal,
  rejectNotifyDefault,
  rejectNotifyLabel,
  requiresCategoryChoice,
  signupBusinessSummary,
  signupFailureChip,
  signupHintChips,
  isFinishingStrandedRow,
  isLineSignup,
  suspendLeavesShopRunning,
  signupIdleChip,
  signupStateChip,
  tabLoadsOwnList,
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
  'min-h-10 rounded border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40';


/**
 * The buttons one queue row offers. Extracted from the table so the gating can be RENDERED in a
 * spec: the page itself only reaches its rows behind `useEffect`, and the rule that matters here —
 * which PROVISIONING rows may be suspended — is exactly the kind that a source assertion can agree
 * with while the markup does something else.
 */
export function SignupRowActions({ item, busy, onApprove, onReject, onReissue, onRetryIntake, onSuspend }: {
  item: AdminSignupQueueItemDto;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReissue: () => void;
  onRetryIntake: () => void;
  onSuspend: () => void;
}) {
  const approve = canApproveSignup(item.state, item);
  const reject = canRejectSignup(item.state);
  const reissue = canReissueSignup(item.state);
  const suspend = canSuspendSignup(item);
  const retryIntake = canRetrySignupIntake(item);

  return (
    <div className="flex flex-wrap gap-2">
      {!isLineSignup(item)&&item.source!=='email-otp'&&<Link className={`${rowActionClass} border-gray-300 bg-white text-gray-700`} href={`/system/signup-requests/${encodeURIComponent(item.requestId)}/mail`}>ประวัติอีเมลรับบัญชี</Link>}
      {approve && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onApprove}
          className={`${rowActionClass} border-green-300 bg-green-50 text-green-700 hover:bg-green-100`}
        >
          {busy ? 'กำลังทำรายการ...' : approveLabel(item.state, item)}
        </button>
      )}
      {/* Rejecting is only a decision before one has been made; every other state answers 409, so
          the button used to be a dead end. */}
      {reject && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onReject}
          className={`${rowActionClass} border-red-200 bg-red-50 text-red-600 hover:bg-red-100`}
        >
          ปฏิเสธ
        </button>
      )}
      {reissue && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onReissue}
          className={`${rowActionClass} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
        >
          {busy ? 'กำลังทำรายการ...' : 'ส่งลิงก์ใหม่'}
        </button>
      )}
      {retryIntake && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onRetryIntake}
          className={`${rowActionClass} border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100`}
        >
          {busy ? 'กำลังทำรายการ...' : 'ทำขั้นตอนรับคำขอต่อ'}
        </button>
      )}
      {suspend && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onSuspend}
          className={`${rowActionClass} border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100`}
        >
          ระงับ
        </button>
      )}
      {!approve && !reject && !reissue && !retryIntake && !suspend && <span className="text-xs text-gray-400">—</span>}
    </div>
  );
}

export default function SignupQueuePage() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [items, setItems] = useState<AdminSignupQueueItemDto[]>([]);
  // The two tabs that read their own endpoint. `null` = not fetched yet, so the tab shows no count
  // rather than a confident zero, and a 403 on either cannot break the main queue.
  const [autoItems, setAutoItems] = useState<AdminSignupQueueItemDto[] | null>(null);
  const [packageItems, setPackageItems] = useState<AdminPackageChangeItemDto[] | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [tab, setTab] = useState<SignupQueueTab>('ALL');
  // R13: how far this tab has been paged, and how many rows the DATABASE holds per tab — the page
  // can only ever count what it was handed, which is how a tab came to claim it was empty.
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Reject needs its own dialog. The default follows the RAIL: silent for the web form (spec §4D —
  // the mailbox is unproven), on for LINE (§8 — the chat is the applicant's own, and silence there
  // is a shop wondering forever).
  const [rejecting, setRejecting] = useState<AdminSignupQueueItemDto | null>(null);
  const [notifyApplicant, setNotifyApplicant] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  // R10: approving now carries the business category, so it gets a dialog of its own — the PDPA
  // health tripwire reads that enum and free Thai text can never map onto it.
  const [approving, setApproving] = useState<AdminSignupQueueItemDto | null>(null);
  const [businessCategory, setBusinessCategory] = useState<string>('OTHER');
  // F2: "อื่น ๆ" is a legitimate answer — a barber shop really is one — so it is confirmed, not
  // refused. Reset with every dialog so a confirmation never carries to the next shop.
  const [confirmedOther, setConfirmedOther] = useState(false);
  const [resolutionAction, setResolutionAction] = useState<AdminSignupDecisionBody['action'] | ''>('');
  const [targetCompanyId, setTargetCompanyId] = useState('');
  const [resolutionNote, setResolutionNote] = useState('');
  const [grantRepeatTrial, setGrantRepeatTrial] = useState(false);
  const [trialGrantNote, setTrialGrantNote] = useState('');
  const [acknowledgeSharedContact, setAcknowledgeSharedContact] = useState(false);
  const [sharedContactNote, setSharedContactNote] = useState('');
  // Keyed by request id: one shared box put the note an operator typed for one shop onto whichever
  // shop they decided next.
  const [packageNotes, setPackageNotes] = useState<Record<string, string>>({});

  // R13: one page of ONE tab, from the server. Reloading always restarts at the first page —
  // an action that changed a row must not leave the operator looking at a stale later page.
  const load = async (forTab: SignupQueueTab = tab) => {
    setLoading(true);
    setError(null);
    try {
      const page = await listSignupRequests({ tab: tabLoadsOwnList(forTab) ? 'ALL' : forTab });
      setItems(page.items);
      setNextCursor(page.nextCursor ?? null);
      setCounts(page.counts ?? null);
    } catch (err) {
      const e = err as Error & { status?: number };
      setError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูคำขอสมัครใช้งาน' : apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await listSignupRequests({ tab, cursor: nextCursor });
      // Appended: a "load more" that replaces the list is a pager that loses what you were reading.
      setItems((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor ?? null);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  // Lazily, on first visit: an operator who lacks the partner permission would otherwise 403 the
  // whole page just by opening the queue.
  const loadTab = async (next: SignupQueueTab) => {
    setTabError(null);
    try {
      if (next === 'AUTO_APPROVED') setAutoItems((await listAutoApprovedSignups()).items);
      if (next === 'PACKAGE_CHANGE') setPackageItems((await listPackageChangeRequests()).items);
    } catch (err) {
      const e = err as Error & { status?: number };
      setTabError(e.status === 403 ? 'คุณไม่มีสิทธิ์ดูรายการนี้' : apiErrorMessage(err));
    }
  };

  const selectTab = (next: SignupQueueTab) => {
    setTab(next);
    // A failure belongs to the tab that produced it: leaving it up over another tab reports a
    // problem the operator is not looking at, on a list that loaded fine.
    setTabError(null);
    // R13: the tab is a server-side filter now, so switching one is a fetch, not a re-filter of
    // whatever page happened to be in memory.
    if (tabLoadsOwnList(next)) void loadTab(next);
    else void load(next);
  };

  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // R10: approving is where the business category is decided, so it needs a form rather than a
  // yes/no. `useConfirm` renders one sentence and nothing else.
  const openApprove = (item: AdminSignupQueueItemDto) => {
    // Default to what the server mapped, so a row the mapping DID read is one click as before.
    setBusinessCategory(item.businessCategory ?? 'OTHER');
    setConfirmedOther(false);
    setResolutionAction(isLineSignup(item)
      ? (isFinishingStrandedRow(item.state) ? 'CREATE_NEW_SHOP' : '')
      : 'APPROVE');
    setTargetCompanyId('');
    setResolutionNote('');
    setGrantRepeatTrial(false);
    setTrialGrantNote('');
    setAcknowledgeSharedContact(false);
    setSharedContactNote('');
    setApproving(item);
  };

  const handleApprove = async () => {
    if (!approving) return;
    const item = approving;
    setBusyId(item.requestId);
    try {
      // The API answers 200 with the CURRENT state, so a close-out that found the run still going
      // comes back as PROVISIONING. Reporting that as done would be the same lie the chip told.
      const fromLine = isLineSignup(item);
      const finishing = (fromLine || item.source === 'email-otp') && isFinishingStrandedRow(item.state);
      if (!resolutionAction) return;
      const body: AdminSignupDecisionBody = {
        action: resolutionAction,
        ...(fromLine ? { version: item.version } : {}),
        ...(!finishing && (resolutionAction === 'APPROVE' || resolutionAction === 'CREATE_NEW_SHOP')
          ? { businessCategory } : {}),
        ...(resolutionAction === 'RETURN_EXISTING' ? { targetCompanyId } : {}),
        ...(resolutionAction === 'REQUEST_INFO' ? { resolutionNote: resolutionNote.trim() } : {}),
        ...(!finishing && resolutionAction === 'CREATE_NEW_SHOP' && item.requiresRepeatTrialGrant
          ? { grantRepeatTrial, ...(trialGrantNote.trim() ? { trialGrantNote: trialGrantNote.trim() } : {}) }
          : {}),
        ...(!finishing && resolutionAction === 'CREATE_NEW_SHOP' && item.contactEmailConflict
          ? {
              acknowledgeSharedContact,
              ...(sharedContactNote.trim() ? { sharedContactNote: sharedContactNote.trim() } : {}),
            }
          : {}),
      };
      const decided = await decideSignupRequest(item.requestId, body);
      if (decided.state === 'PROVISIONING') {
        toast.warning('ยังเปิดร้านอยู่ รอสักครู่แล้วลองใหม่');
      } else if (resolutionAction === 'REQUEST_INFO') {
        if (decided.customerNotification === 'QUEUED') {
          toast.success('บันทึกข้อมูลที่ต้องขอและเข้าคิวแจ้งลูกค้าทาง LINE แล้ว');
        } else {
          toast.warning('บันทึกข้อมูลที่ต้องขอแล้ว แต่ยังแจ้งลูกค้าทาง LINE ไม่ได้ กรุณาติดต่อผ่านเคสช่วยเหลือ');
        }
      } else if (resolutionAction === 'RETURN_EXISTING') {
        toast.success('ปิดคำขอโดยให้กลับร้านเดิมแล้ว');
      } else if (resolutionAction === 'CREATE_NEW_SHOP' && item.requiresRepeatTrialGrant && !grantRepeatTrial) {
        toast.success('บันทึกรอจัดแพ็กเกจแล้ว ยังไม่ได้เปิดร้าน');
      } else {
        toast.success(finishing
          ? 'ปิดงานเรียบร้อย'
          : (fromLine || item.source === 'email-otp') ? 'อนุมัติแล้ว เปิดร้านให้เรียบร้อย' : 'อนุมัติแล้ว ระบบกำลังส่งอีเมลตั้งรหัส');
      }
      setApproving(null);
      await load();
      if (tabLoadsOwnList(tab)) await loadTab(tab);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRetryIntake = async (item: AdminSignupQueueItemDto) => {
    setBusyId(item.requestId);
    try {
      const decided = await decideSignupRequest(item.requestId, {
        action: 'RETRY_INTAKE',
        version: item.version,
      });
      if (decided.state === 'PENDING_REVIEW') {
        toast.success('ทำขั้นตอนรับคำขอต่อแล้ว ส่งเข้าคิวตรวจสอบเรียบร้อย');
      } else if (decided.state === 'COMPLETED') {
        toast.success('ทำคำขอเดิมต่อและเปิดร้านเรียบร้อย');
      } else {
        toast.warning(`ทำคำขอเดิมต่อแล้ว สถานะล่าสุด: ${signupStateChip(decided.state).label}`);
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
      if (tabLoadsOwnList(tab)) await loadTab(tab);
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
      message: isAbandonedEmptyAttempt(item)
        // Nothing was built, so there is no shop to talk about — only a dead row to close.
        ? `หยุดคำขอที่ค้างและยังไม่มีร้าน ของ ${item.companyName} ใช่หรือไม่`
        : suspendLeavesShopRunning(item.state)
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
      if (tabLoadsOwnList(tab)) await loadTab(tab);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  // §8 "คำขอเปลี่ยนแพ็กเกจ". APPROVE moves the tier through the partner plan-term writer; the
  // operator can still open the partner page instead when the move needs a conversation first.
  const handlePackageDecision = async (item: AdminPackageChangeItemDto, action: 'APPROVE' | 'REJECT') => {
    const accepted = await confirm({
      title: action === 'APPROVE' ? 'อนุมัติเปลี่ยนแพ็กเกจ' : 'ไม่อนุมัติคำขอ',
      message: action === 'APPROVE'
        ? `เปลี่ยนแพ็กเกจของร้าน ${item.companyName} เป็น ${item.requestedTierKey} และแจ้งลูกค้าทางไลน์ ใช่หรือไม่`
        : `ปิดคำขอของร้าน ${item.companyName} โดยไม่เปลี่ยนแพ็กเกจ ใช่หรือไม่`,
      confirmLabel: action === 'APPROVE' ? 'เปลี่ยนแพ็กเกจ' : 'ไม่อนุมัติ',
      variant: action === 'APPROVE' ? 'primary' : 'danger',
    });
    if (!accepted) return;
    setBusyId(item.id);
    try {
      const note = (packageNotes[item.id] ?? '').trim();
      await decidePackageChangeRequest(item.id, { action, ...(note ? { note } : {}) });
      toast.success(action === 'APPROVE' ? 'เปลี่ยนแพ็กเกจและแจ้งลูกค้าแล้ว' : 'ปิดคำขอแล้ว');
      setPackageNotes((current) => ({ ...current, [item.id]: '' }));
      await loadTab('PACKAGE_CHANGE');
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

  // P10-L: a LINE application has no address, so approving it opens the shop immediately and the
  // customer hears about it in LINE. Promising an email here would be a promise nothing keeps —
  // and for a row whose shop already exists, so would promising to open one (review LOW-2).
  const approveFromLine = approving ? isLineSignup(approving) : false;
  const approveFromEmail = approving?.source === 'email-otp';
  const approveFinishing = (approveFromLine || approveFromEmail) && isFinishingStrandedRow(approving!.state);
  const approveDialogTitle = approveFinishing ? 'ทำคำขอเดิมต่อ' : approveFromLine ? 'เลือกผลคำขอ LINE' : 'อนุมัติคำขอ';
  const approveDialogConfirmLabel = approveFinishing
    ? 'ทำรายการเดิมต่อ'
    : resolutionAction === 'RETURN_EXISTING' ? 'ยืนยันกลับร้านเดิม'
      : resolutionAction === 'REQUEST_INFO' ? 'บันทึกและแจ้งข้อมูลที่ต้องขอ'
        : resolutionAction === 'CREATE_NEW_SHOP' ? 'ยืนยันผลเปิดร้านใหม่'
          : approveFromLine ? 'เลือกผลก่อน' : approveFromEmail ? 'อนุมัติและเปิดร้าน' : 'อนุมัติและส่งอีเมล';
  const approveDialogMessage = !approving
    ? ''
    : approveFinishing
      ? `ทำคำขอเดิมของร้าน ${approving.companyName} ต่อ ระบบจะใช้ผลตรวจและสิทธิ์ทดลองที่บันทึกไว้เดิม`
      : approveFromLine
        ? `เลือกผลที่จะเกิดกับคำขอของร้าน ${approving.companyName} ให้ชัดเจนก่อนบันทึก`
        : approveFromEmail ? `เปิดร้านให้ ${approving.ownerDisplayName} ผู้สมัครกลับเข้าด้วยรหัสอีเมลเดิมได้ โดยไม่ต้องตั้งรหัสผ่าน`
        : `อนุมัติและส่งอีเมลตั้งรหัสให้ ${approving.contactEmail ?? approving.ownerDisplayName} ใช่หรือไม่`;
  // R10/F2: a row whose free text the mapping could not read may not be approved on the DEFAULT —
  // but "อื่น ๆ" chosen on purpose is a decision, and the checkbox is how it says so.
  const approveNeedsOtherConfirmed = approving !== null
    && requiresCategoryChoice(approving)
    && (resolutionAction === 'APPROVE' || resolutionAction === 'CREATE_NEW_SHOP')
    && businessCategory === 'OTHER';
  const approveBlocked = approving !== null && (
    (!approveFinishing && approveFromLine && !resolutionAction)
    || (resolutionAction === 'RETURN_EXISTING' && !targetCompanyId)
    || (resolutionAction === 'REQUEST_INFO' && !resolutionNote.trim())
    || (resolutionAction === 'CREATE_NEW_SHOP' && approving.requiresRepeatTrialGrant === true
      && grantRepeatTrial && !trialGrantNote.trim())
    || (resolutionAction === 'CREATE_NEW_SHOP' && approving.contactEmailConflict === true
      && (!acknowledgeSharedContact || !sharedContactNote.trim()))
    || ((resolutionAction === 'APPROVE' || resolutionAction === 'CREATE_NEW_SHOP')
      && approveBlockedOnCategory(approving, businessCategory, confirmedOther))
  );

  const visible = tab === 'AUTO_APPROVED' ? (autoItems ?? []) : items;
  // R13: "no applications in this group" is a claim about the DATABASE, so it may only be made
  // when the server counted zero. A page that simply has not loaded says nothing.
  const emptyForReal = tab === 'AUTO_APPROVED'
    ? autoItems !== null && autoItems.length === 0
    : queueEmptyForReal(visible, counts, tab);

  /** Counted server-side over the whole queue; the two own-endpoint tabs still count their list. */
  const tabCount = (key: SignupQueueTab): number | null => {
    if (key === 'AUTO_APPROVED') return autoItems?.length ?? null;
    if (key === 'PACKAGE_CHANGE') return packageItems?.length ?? null;
    return counts?.[key] ?? null;
  };

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      {confirmDialog}

      {/* R10. Approving is the last moment anyone looks at this application before a company
          exists, and the PDPA health tripwire reads an enum the public form cannot produce: it asks
          for free text, and "คลินิก" maps to OTHER. So the reviewer picks — defaulted to whatever
          the server mapped, and REQUIRED when the mapping could not read what was typed. */}
      <Modal
        open={approving !== null}
        title={approveDialogTitle}
        size="sm"
        onClose={() => setApproving(null)}
        footer={(
          <>
            <Button type="button" variant="secondary" onClick={() => setApproving(null)} disabled={busyId !== null}>
              ยกเลิก
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleApprove()}
              disabled={busyId !== null || approveBlocked} loading={Boolean(busyId !== null)}
            >
              {busyId !== null ? 'กำลังบันทึก...' : approveDialogConfirmLabel}
            </Button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>{approveDialogMessage}</p>
          {approveFromLine && !approveFinishing && (
            <fieldset className="space-y-2">
              <legend className="font-medium text-gray-900">ผลของคำขอนี้</legend>
              <label className="flex min-h-12 items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="radio"
                  name="signup-resolution"
                  className="mt-1 h-4 w-4"
                  checked={resolutionAction === 'CREATE_NEW_SHOP'}
                  onChange={() => setResolutionAction('CREATE_NEW_SHOP')}
                />
                <span><strong className="block text-gray-900">เปิดร้านใหม่</strong>สร้างร้านใหม่ให้บัญชี LINE ที่พิสูจน์แล้ว</span>
              </label>
              {(approving?.eligibleExistingCompanies ?? []).filter((company) => company.canEnter).length > 0 && (
                <label className="flex min-h-12 items-start gap-3 rounded-lg border border-gray-200 p-3">
                  <input
                    type="radio"
                    name="signup-resolution"
                    className="mt-1 h-4 w-4"
                    checked={resolutionAction === 'RETURN_EXISTING'}
                    onChange={() => setResolutionAction('RETURN_EXISTING')}
                  />
                  <span><strong className="block text-gray-900">กลับร้านเดิม</strong>ไม่สร้างร้าน บริษัท สมาชิก หรือสิทธิ์ทดลองใหม่</span>
                </label>
              )}
              <label className="flex min-h-12 items-start gap-3 rounded-lg border border-gray-200 p-3">
                <input
                  type="radio"
                  name="signup-resolution"
                  className="mt-1 h-4 w-4"
                  checked={resolutionAction === 'REQUEST_INFO'}
                  onChange={() => setResolutionAction('REQUEST_INFO')}
                />
                <span><strong className="block text-gray-900">ขอข้อมูลเพิ่ม</strong>เก็บคำขอเดิมไว้ และขอสิ่งที่ขาดทั้งหมดในครั้งเดียว</span>
              </label>
            </fieldset>
          )}

          {resolutionAction === 'RETURN_EXISTING' && (
            <div className="space-y-1.5">
              <label htmlFor="signup-existing-company" className="block font-medium text-gray-700">ร้านที่ให้กลับเข้าใช้</label>
              <select
                id="signup-existing-company"
                value={targetCompanyId}
                onChange={(event) => setTargetCompanyId(event.target.value)}
                className="min-h-12 w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              >
                <option value="">เลือกร้านจากสิทธิ์ LINE ที่ตรวจแล้ว</option>
                {(approving?.eligibleExistingCompanies ?? []).filter((company) => company.canEnter).map((company) => (
                  <option key={company.companyId} value={company.companyId}>{company.companyName}</option>
                ))}
              </select>
            </div>
          )}

          {resolutionAction === 'REQUEST_INFO' && (
            <div className="space-y-1.5">
              <label htmlFor="signup-resolution-note" className="block font-medium text-gray-700">
                ข้อมูลที่ต้องขอทั้งหมด
              </label>
              <textarea
                id="signup-resolution-note"
                rows={5}
                maxLength={SIGNUP_RESOLUTION_NOTE_MAX_LENGTH}
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
                placeholder={'เช่น\n1. ชื่อร้านตามทะเบียน\n2. อีเมลติดต่อที่ถูกต้อง\n3. ยังเข้า LINE หรือบัญชีเดิมได้หรือไม่'}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              />
              <p className="text-xs text-gray-500">ลูกค้าจะเห็นข้อความนี้ ({resolutionNote.length}/{SIGNUP_RESOLUTION_NOTE_MAX_LENGTH})</p>
            </div>
          )}

          {(resolutionAction === 'APPROVE' || (resolutionAction === 'CREATE_NEW_SHOP' && !approveFinishing)) && (
          <div className="space-y-1.5">
            <label htmlFor="signup-business-category" className="block text-sm font-medium text-gray-700">
              ประเภทธุรกิจของร้านนี้
            </label>
            {/* What the applicant actually typed, next to the choice it is being turned into. */}
            {approving?.businessType && (
              <p className="text-xs text-gray-500">
                ผู้สมัครกรอกว่า “{approving.businessType}”
              </p>
            )}
            <select
              id="signup-business-category"
              value={businessCategory}
              onChange={(e) => setBusinessCategory(e.target.value)}
              disabled={busyId !== null}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none disabled:bg-gray-50"
            >
              {COMPANY_BUSINESS_CATEGORIES.map((category) => (
                <option key={category} value={category}>{BUSINESS_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500">
              เลือกให้ตรงกับสิ่งที่ร้านทำจริง คลินิก สปา หรือร้านขายยา จะเข้าสู่การตรวจ PDPA เพิ่ม
            </p>
            {/* F2: shown only where the mapping could not read the free text AND the reviewer is
                staying on "อื่น ๆ". Ticking it is the record that a human looked and decided —
                which is the whole point of moving this decision to review. */}
            {approveNeedsOtherConfirmed && (
              <label className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={confirmedOther}
                  onChange={(e) => setConfirmedOther(e.target.checked)}
                  disabled={busyId !== null}
                />
                <span className="text-xs text-gray-700">
                  ตรวจแล้ว เป็นอื่น ๆ
                  <span className="mt-0.5 block text-gray-500">
                    ระบบอ่าน “{approving?.businessType}” ไม่ได้ ยืนยันว่าร้านนี้ไม่ใช่คลินิก สปา หรือร้านขายยา
                  </span>
                </span>
              </label>
            )}
          </div>
          )}

          {resolutionAction === 'CREATE_NEW_SHOP' && !approveFinishing && approving?.requiresRepeatTrialGrant && (
            <div className="space-y-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
              <p className="font-medium text-gray-900">บัญชีนี้เคยได้รับสิทธิ์ทดลองแล้ว</p>
              <label className="flex min-h-12 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={grantRepeatTrial}
                  onChange={(event) => setGrantRepeatTrial(event.target.checked)}
                />
                <span>อนุญาตทดลองใช้ฟรีเพิ่มอีกครั้ง</span>
              </label>
              {grantRepeatTrial ? (
                <textarea
                  aria-label="เหตุผลที่ให้ทดลองใช้ฟรีเพิ่ม"
                  rows={3}
                  maxLength={SIGNUP_RESOLUTION_NOTE_MAX_LENGTH}
                  value={trialGrantNote}
                  onChange={(event) => setTrialGrantNote(event.target.value)}
                  placeholder="ระบุเหตุผลที่อนุญาต"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
                />
              ) : (
                <p className="text-xs text-gray-700">หากไม่อนุญาต ระบบจะเก็บไว้ที่ “รอจัดแพ็กเกจ” และยังไม่เปิดร้าน</p>
              )}
            </div>
          )}

          {resolutionAction === 'CREATE_NEW_SHOP' && !approveFinishing && approving?.contactEmailConflict && (
            <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3">
              <p className="font-medium text-gray-900">อีเมลติดต่อซ้ำกับบุคคลอื่น</p>
              <p className="text-xs">อีเมลนี้ไม่ใช้ยืนยันเจ้าของและไม่ย้ายบัญชี ลูกค้ารายนี้จะเข้าใช้ด้วย LINE</p>
              <label className="flex min-h-12 items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={acknowledgeSharedContact}
                  onChange={(event) => setAcknowledgeSharedContact(event.target.checked)}
                />
                <span>ตรวจแล้ว เป็นข้อมูลติดต่อที่ใช้ร่วมกันโดยตั้งใจ</span>
              </label>
              <textarea
                aria-label="เหตุผลที่ยอมรับอีเมลติดต่อร่วมกัน"
                rows={3}
                maxLength={SIGNUP_RESOLUTION_NOTE_MAX_LENGTH}
                value={sharedContactNote}
                onChange={(event) => setSharedContactNote(event.target.value)}
                placeholder="บันทึกสิ่งที่ตรวจแล้ว"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900"
              />
            </div>
          )}
        </div>
      </Modal>

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
            <Button type="button" variant="danger" onClick={handleReject} disabled={busyId !== null} loading={Boolean(busyId !== null)}>
              {busyId !== null ? 'กำลังบันทึก...' : 'ปฏิเสธคำขอ'}
            </Button>
          </>
        )}
      >
        <div className="space-y-3 text-sm text-gray-600">
          <p>
            ปฏิเสธคำขอของ <span className="font-medium text-gray-900">{rejecting?.companyName}</span> ใช่หรือไม่
          </p>
          {/* The default follows the rail. Spec §4D: OFF for the web form, because the mailbox is
              still unproven and an unsolicited notice would make the platform a spam cannon aimed
              at whoever they typed. §8: ON for LINE, because the chat is the applicant's own and
              the alternative is a shop that never hears anything again. */}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={notifyApplicant}
              onChange={(e) => setNotifyApplicant(e.target.checked)}
              disabled={busyId !== null}
            />
            <span>
              {rejecting ? rejectNotifyLabel(rejecting) : 'ส่งอีเมลแจ้งผู้สมัคร'}
              <span className="mt-0.5 block text-xs text-gray-500">
                {rejecting && isLineSignup(rejecting)
                  ? 'ค่าเริ่มต้นคือส่ง เพราะลูกค้าเปิดแชทนี้เอง ข้อความที่ส่งจะไม่เปิดเผยเหตุผลภายใน'
                  : rejecting?.source === 'email-otp' ? 'ผู้สมัครตรวจผลได้ในหน้าสมัคร เลือกส่งอีเมลเพิ่มได้หากจำเป็น'
                  : 'ค่าเริ่มต้นคือไม่ส่ง เพราะอีเมลนี้ยังไม่ผ่านการยืนยัน ข้อความที่ส่งจะไม่เปิดเผยเหตุผลภายใน'}
              </span>
            </span>
          </label>

          {/* The paragraph rides the EMAIL rail only. A LINE rejection sends the fixed §7 copy,
              which already carries the phone number and the address to come back on — offering a
              box here would promise the shop a message that never travels. */}
          {notifyApplicant && rejecting && !isLineSignup(rejecting) && (
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
            const count = tabCount(t.key);
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
            <button type="button" className="ml-3 underline" disabled={loading} aria-busy={loading} onClick={() => void load()}>
              ลองใหม่
            </button>
          </div>
        )}

        {tabError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {tabError}
          </div>
        )}

        {/* §8 "คำขอเปลี่ยนแพ็กเกจ": its own shape — a shop, a move, and who asked. */}
        {tab === 'PACKAGE_CHANGE' && !tabError && (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
              ข้อความถึงร้านจะถูกส่งเข้าไลน์ของลูกค้าต่อท้ายผลการตัดสิน ใส่ลิงก์ได้เฉพาะเว็บของเราและ LIFF
            </p>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3">ร้าน</th>
                    <th className="px-4 py-3">แพ็กเกจที่ขอ</th>
                    <th className="px-4 py-3">ผู้ขอ</th>
                    <th className="px-4 py-3">เวลา</th>
                    <th className="px-4 py-3">การทำงาน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {(packageItems ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                        ไม่มีคำขอเปลี่ยนแพ็กเกจที่รออยู่
                      </td>
                    </tr>
                  ) : (packageItems ?? []).map((item) => {
                    const busy = busyId === item.id;
                    return (
                      <tr key={item.id} className="align-top hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{item.companyName}</p>
                          {item.note && <p className="mt-0.5 text-xs text-gray-500">{item.note}</p>}
                          {/* Per row: a note typed for one shop must not follow the operator to
                              the next one. Bounded and link-fenced server-side (SEC-05). */}
                          <input
                            aria-label={`ข้อความถึงร้าน ${item.companyName}`}
                            maxLength={200}
                            value={packageNotes[item.id] ?? ''}
                            onChange={(e) => setPackageNotes((current) => ({ ...current, [item.id]: e.target.value }))}
                            disabled={busy}
                            placeholder="ข้อความถึงร้าน — ลูกค้าจะเห็นใน LINE (ไม่บังคับ)"
                            className="mt-1.5 w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-brand-400 focus:outline-none disabled:bg-gray-50"
                          />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          {item.currentTierKey ? `${PLAN_TIER_PRESETS[item.currentTierKey as PlanTierKey]?.labelTh ?? item.currentTierKey} → ` : ''}
                          {PLAN_TIER_PRESETS[item.requestedTierKey as PlanTierKey]?.labelTh ?? item.requestedTierKey}
                          {item.billingReviewPath && <p className="mt-2 text-sm">คำขอนี้จะปิดเมื่อชำระเงินและเปิดสิทธิ์แล้ว การให้สิทธิ์ชั่วคราวยังคงคำขอนี้ไว้</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{item.requestedByDisplayName ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{formatThaiDateTime(item.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            {item.billingReviewPath ? <Link href={item.billingReviewPath} className={`${rowActionClass} border-green-300 bg-green-50 text-green-700`}>ตรวจแพ็กเกจที่ชำระเงิน</Link> : <button
                              type="button"
                              disabled={busy} aria-busy={Boolean(busy)}
                              onClick={() => void handlePackageDecision(item, 'APPROVE')}
                              className={`${rowActionClass} border-green-300 bg-green-50 text-green-700 hover:bg-green-100`}
                            >
                              {busy ? 'กำลังทำรายการ...' : 'เปลี่ยนแพ็กเกจให้'}
                            </button>}
                            <button
                              type="button"
                              disabled={busy} aria-busy={Boolean(busy)}
                              onClick={() => void handlePackageDecision(item, 'REJECT')}
                              className={`${rowActionClass} border-red-200 bg-red-50 text-red-600 hover:bg-red-100`}
                            >
                              ไม่อนุมัติ
                            </button>
                            {/* The move sometimes needs a conversation and a term date first —
                                that lives on the partner page, which is also where the tier
                                writer this button calls actually lives. */}
                            <a
                              href={`/system/partners/${item.companyId}`}
                              className={`${rowActionClass} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
                            >
                              เปิดหน้าพาร์ทเนอร์
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!error && tab !== 'PACKAGE_CHANGE' && (
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
                        {emptyForReal ? 'ไม่มีคำขอในกลุ่มนี้' : 'ยังโหลดรายการไม่ได้ กดลองใหม่อีกครั้ง'}
                      </td>
                    </tr>
                  ) : (
                    visible.map((item) => {
                      const busy = busyId === item.requestId;
                      const idle = signupIdleChip(item);
                      const hints = signupHintChips(item);
                      const failure = signupFailureChip(item);
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
                            {/* §8: an admin reads this queue on a phone. A number that is only text
                                is a number they have to retype into the dialler. */}
                            {item.phoneNumber ? (
                              <a
                                href={`tel:${item.phoneNumber}`}
                                className="text-xs text-brand-700 underline underline-offset-2"
                              >
                                {item.phoneNumber}
                              </a>
                            ) : (
                              <p className="text-xs text-gray-500">—</p>
                            )}
                            {item.discoverySource && (
                              <p className="mt-1 break-words text-xs text-gray-600">
                                รู้จักเราทางไหน: {signupDiscoveryLabel(item.discoverySource, item.discoverySourceOther)}
                              </p>
                            )}
                            {/* LEGAL-LIFF-01: the binding acceptance happened before this row
                                existed, and its time is the evidence an operator may be asked for. */}
                            {item.legalAcceptedAt && (
                              <p className="mt-0.5 text-xs text-gray-400">
                                ยอมรับข้อกำหนด {formatThaiDateTime(item.legalAcceptedAt)}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{signupBusinessSummary(item)}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <ChipBadge chip={signupStateChip(item.state, item)} />
                              {/* Why it failed, when the code names something an admin can fix. */}
                              {failure && <ChipBadge chip={failure} />}
                              {idle && <ChipBadge chip={idle} />}
                              {hints.map((chip) => (
                                <ChipBadge key={chip.label} chip={chip} />
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{formatThaiDateTime(item.createdAt)}</td>
                          <td className="px-4 py-3">
                            <SignupRowActions
                              item={item}
                              busy={busy}
                              onApprove={() => openApprove(item)}
                              onReject={() => {
                                setNotifyApplicant(rejectNotifyDefault(item));
                                setRejectionReason('');
                                setRejecting(item);
                              }}
                              onReissue={() => void handleReissue(item)}
                              onRetryIntake={() => void handleRetryIntake(item)}
                              onSuspend={() => void handleSuspend(item)}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {/* R13: the way past the first page. Without it the queue simply stopped at whatever it
                had read, and rows behind that were unreachable from the console at all. */}
            {tab !== 'AUTO_APPROVED' && nextCursor && (
              <div className="border-t border-gray-100 px-4 py-3 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  {loadingMore ? 'กำลังโหลด...' : 'โหลดเพิ่ม'}
                </button>
                <p className="mt-1.5 text-xs text-gray-400">
                  แสดง {visible.length} จาก {counts?.[tab] ?? visible.length} รายการ
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
