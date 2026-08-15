'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { CRM_BOOKING_BUFFER_MINUTE_OPTIONS, type CrmBookingBufferMinutes, type CrmBookingStatus, type CrmBookingSummary, type CrmCustomerSummary, type CrmStaffBookingSource, type EmployeeSummary } from '@watchdog-bms/contracts';
import { cx } from '@/common/components/mangmee';
import { useConfirm } from '@/common/components/modal';
import { LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { useBranchFilter, useBranchScopeLabel } from '../web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '../web-core-workspace/branch-scope-label.logic';
import { listBranches, type Branch } from '../branch-settings/branches.api';
import { employeeShortName, listEmployees } from '../employee-access/employee-access.api';
import { listProducts } from '../inventory/inventory.api';
import type { ProductSummary } from '../inventory/inventory.model';
import { listCrmBookings, getCrmBookingSettings, updateCrmBookingSettings, createCrmBooking, updateCrmBooking, cancelCrmBooking, createCrmCustomer, listCrmCustomers, getCrmCustomer } from './crm.api';
import { localizedErrorMessage } from '@/common/i18n/error-message.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import {
  BK_CELL_HEIGHT,
  BK_DURATION_OPTIONS,
  BK_HOUR_LABELS,
  bookingAmountText,
  bookingOutstandingText,
  buildWeekColumns,
  countTodayBookings,
  customerOriginFromBookingSource,
  getCreateSubtitle,
  initialBookingWeekOffset,
  getWeekLabel,
  getWeekTag,
  slotToIsoRange,
  weekStartParam,
  type BookingDayColumn,
  type BookingEntry,
} from './bookings.model';
import { findCustomerDuplicateMatches, type CustomerDuplicateMatch } from './customers-prototype.model';

const BOOKING_STATUS_LABEL: Record<CrmBookingStatus, string> = {
  BOOKED: 'จองแล้ว',
  DONE: 'เสร็จสิ้น',
  NO_SHOW: 'ไม่มาตามนัด',
  CANCELLED: 'ยกเลิกแล้ว',
};

const STAFF_BOOKING_SOURCE_OPTIONS: Array<{ value: CrmStaffBookingSource; label: string }> = [
  { value: 'STAFF', label: 'พนักงานบันทึก' },
  { value: 'PHONE', label: 'โทรศัพท์' },
  { value: 'WEB', label: 'เว็บไซต์' },
  { value: 'FACEBOOK', label: 'Facebook' },
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'OTHER', label: 'ช่องทางอื่น' },
];

function localDateValue(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function localTimeValue(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function HourLabels({ withHeaderOffset }: { withHeaderOffset?: boolean }) {
  return (
    <div className={cx('w-[52px] shrink-0', withHeaderOffset && 'pt-16')}>
      {BK_HOUR_LABELS.map((label) => (
        <div key={label} className="text-right text-xs text-gray-400" style={{ height: BK_CELL_HEIGHT, lineHeight: `${BK_CELL_HEIGHT}px`, paddingRight: 8 }}>
          {label}
        </div>
      ))}
    </div>
  );
}

function DayEntries({
  entries,
  mobile,
  onSlotClick,
  onOpenBooking,
  canCreate,
  canManage,
}: {
  entries: BookingEntry[];
  mobile?: boolean;
  onSlotClick: (hour: number) => void;
  onOpenBooking: (id: string) => void;
  canCreate: boolean;
  canManage: boolean;
}) {
  return (
    <>
      {entries.map((entry) =>
        entry.booked ? (
          <div
            key={entry.hour}
            className="group relative mb-1.5 overflow-hidden rounded-[9px] px-[9px] py-1.5 text-white"
            style={{ height: entry.dur * BK_CELL_HEIGHT - 6, background: entry.color }}
          >
            {entry.status === 'BOOKED' && canManage && (
              <button
                type="button"
                onClick={() => onOpenBooking(entry.id)}
                className="absolute right-1 top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-black/20 px-1 text-xs"
                title="จัดการนัดหมาย"
                aria-label="จัดการนัดหมาย"
              >
                •••
              </button>
            )}
            <div className={cx('font-extrabold leading-tight', mobile ? 'text-[13px]' : 'text-xs')}>{entry.range}</div>
            <div className={cx('mt-px truncate font-semibold leading-tight', mobile ? 'text-[13px]' : 'text-xs')}>{entry.custName}</div>
            <div className={cx('truncate leading-tight opacity-90', mobile ? 'text-[11.5px]' : 'text-[10.5px]')}>{entry.service}</div>
            <div className={cx('leading-tight opacity-[.85]', mobile ? 'text-[11px]' : 'text-[10px]')}>
              พนักงานที่ดูแล {entry.staffLabel} · {entry.durText}
            </div>
            {entry.status !== 'BOOKED' && <div className="mt-0.5 text-[10px] font-bold opacity-90">{BOOKING_STATUS_LABEL[entry.status]}</div>}
          </div>
        ) : (
          <button
            key={entry.hour}
            type="button"
            disabled={entry.isPast || !canCreate}
            onClick={() => onSlotClick(entry.hour)}
            className={cx(
              'mb-1.5 flex w-full items-center justify-center rounded-[9px] border border-dashed text-[11.5px]',
              entry.isPast || !canCreate ? 'cursor-default border-gray-100 bg-gray-50 text-gray-200' : 'cursor-pointer border-gray-200 bg-white text-gray-300',
            )}
            style={{ height: BK_CELL_HEIGHT - 6 }}
          >
            ว่าง · {entry.timeLabel}
          </button>
        ),
      )}
    </>
  );
}

export function BookingsPrototypePage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const branchFilter = useBranchFilter();
  const canRead = permissions.includes('crm.booking.read');
  const canCreate = permissions.includes('crm.booking.create');
  const canUpdate = permissions.includes('crm.booking.update');
  const canCancel = permissions.includes('crm.booking.cancel');
  const canReadCustomers = permissions.includes('crm.customer.read');
  const canCreateCustomers = permissions.includes('crm.customer.create');
  const [today] = useState(() => new Date());
  const [weekOffset, setWeekOffset] = useState(() => initialBookingWeekOffset(today));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [services, setServices] = useState<ProductSummary[]>([]);
  const [bookings, setBookings] = useState<CrmBookingSummary[]>([]);
  const [bufferMinutes, setBufferMinutes] = useState<CrmBookingBufferMinutes>(60);
  const [bufferSaving, setBufferSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daySel, setDaySel] = useState<number | null>(null);
  const [create, setCreate] = useState<{ day: number; hour: number } | null>(null);
  const [draftCust, setDraftCust] = useState('');
  const [draftCustomerId, setDraftCustomerId] = useState('');
  const [draftCustomerPhone, setDraftCustomerPhone] = useState('');
  const [createNewCustomer, setCreateNewCustomer] = useState(false);
  const [customerOptions, setCustomerOptions] = useState<CrmCustomerSummary[]>([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);
  const [customerDuplicateMatches, setCustomerDuplicateMatches] = useState<CustomerDuplicateMatch[]>([]);
  const [draftSource, setDraftSource] = useState<CrmStaffBookingSource>('STAFF');
  const [draftServiceId, setDraftServiceId] = useState('');
  const [draftDur, setDraftDur] = useState<number>(2);
  const [draftStaffId, setDraftStaffId] = useState<string>('');
  const [draftBranchId, setDraftBranchId] = useState<string>('');
  const [draftTotalAmount, setDraftTotalAmount] = useState('');
  const [draftDepositAmount, setDraftDepositAmount] = useState('');
  const [selectedCustomerPhone, setSelectedCustomerPhone] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [reschedule, setReschedule] = useState<{ date: string; time: string; dur: number; staffUserId: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSaving, setActionSaving] = useState(false);

  // Two different questions, so two different values (spec R1). What the list is SHOWING is
  // scopeLabel below — all branches when nothing is selected. Where a NEW booking would be written
  // has to be one concrete branch: the server rejects an empty branchId (crm-booking.use-case.ts:176),
  // and the create modal only offers a branch picker when there is more than one to pick from.
  const activeBranchId = branchFilter?.branchId || branches[0]?.id || '';
  const scopeLabel = useBranchScopeLabel();

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await listCrmBookings(companyId, {
        branchId: branchFilter?.branchId || undefined,
        weekStart: weekStartParam(today, weekOffset),
      });
      setBookings(result.items);
    } catch (e) {
      if (isBranchScope403(e, branchFilter?.branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(localizedErrorMessage(e, locale, { fallback: 'error.load_failed' }));
    } finally {
      setLoading(false);
    }
  }, [companyId, branchFilter?.branchId, weekOffset, today, locale, canRead]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canRead) return;
    listBranches(companyId).then(setBranches).catch(() => setBranches([]));
    listEmployees(companyId).then(setEmployees).catch(() => setEmployees([]));
    listProducts(companyId, { status: 'ACTIVE', kind: 'SERVICE', customerVisible: true, pageSize: 100 })
      .then((result) => setServices(result.items))
      .catch(() => setServices([]));
    getCrmBookingSettings(companyId).then((settings) => setBufferMinutes(settings.bufferMinutes)).catch(() => undefined);
  }, [companyId, canRead]);

  useEffect(() => {
    if (!create || !canReadCustomers || draftCustomerId || createNewCustomer) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setCustomerSearchLoading(true);
      void listCrmCustomers(companyId, { scope: 'all', status: 'ACTIVE', search: draftCust.trim() || undefined, pageSize: 8 })
        .then((result) => { if (active) setCustomerOptions(result.items.flatMap((item) => item.projection === 'OPERATIONAL' ? [item.customer] : [])); })
        .catch(() => { if (active) setCustomerOptions([]); })
        .finally(() => { if (active) setCustomerSearchLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [companyId, create, canReadCustomers, draftCust, draftCustomerId, createNewCustomer]);

  const staffLabel = useCallback(
    (staffUserId?: string) => {
      if (!staffUserId) return 'ไม่ระบุ';
      // booking.staffUserId is a User id — match EmployeeSummary.userId, not the profile id
      const employee = employees.find((e) => e.userId === staffUserId);
      return employee ? employeeShortName(employee) : 'พนักงาน';
    },
    [employees],
  );

  const columns = useMemo(() => buildWeekColumns(bookings, weekOffset, today, staffLabel), [bookings, weekOffset, today, staffLabel]);
  const todayCount = countTodayBookings(bookings, today);
  const selectedDay = daySel ?? (weekOffset === 0 ? today.getDay() : 0);
  const mobileColumn: BookingDayColumn = columns[selectedDay] ?? columns[0]!;
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) ?? null;

  // Manage-appointment popup shows the customer's phone; fetched lazily per selection.
  const selectedCustomerId = selectedBooking?.customerId;
  useEffect(() => {
    setSelectedCustomerPhone(null);
    if (!selectedCustomerId || !canReadCustomers) return;
    let active = true;
    getCrmCustomer(companyId, selectedCustomerId)
      .then((detail) => { if (active) setSelectedCustomerPhone(detail.projection === 'OPERATIONAL' ? detail.customer.primaryPhone ?? null : null); })
      .catch(() => { if (active) setSelectedCustomerPhone(null); });
    return () => { active = false; };
  }, [companyId, canReadCustomers, selectedCustomerId]);

  const openCreate = (day: number, hour: number) => {
    if (!canCreate) return;
    setCreate({ day, hour });
    setDraftCust('');
    setDraftCustomerId('');
    setDraftCustomerPhone('');
    setCreateNewCustomer(false);
    setCustomerOptions([]);
    setCustomerDuplicateMatches([]);
    setDraftSource('STAFF');
    const firstService = services[0];
    setDraftServiceId(firstService?.id ?? '');
    setDraftDur((firstService?.bookingDurationMinutes ?? 60) / 60);
    setDraftStaffId('');
    setDraftBranchId(activeBranchId);
    setDraftTotalAmount('');
    setDraftDepositAmount('');
    setSaveError(null);
  };
  const hasCustomer = Boolean(draftCustomerId) || (createNewCustomer && canCreateCustomers && draftCust.trim().length > 0);
  const selectedService = services.find((service) => service.id === draftServiceId);
  const canSave = hasCustomer && draftBranchId.length > 0 && Boolean(selectedService);

  const saveBooking = async (duplicateOverride = false) => {
    if (!create || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      let customerId = draftCustomerId;
      if (!customerId && createNewCustomer) {
        if (!duplicateOverride) {
          const lookup = draftCustomerPhone.trim() || draftCust.trim();
          const candidateResults = await Promise.all((['ACTIVE', 'INACTIVE'] as const).map((status) =>
            listCrmCustomers(companyId, { scope: 'all', status, search: lookup, pageSize: 20 }),
          ));
          const matches = findCustomerDuplicateMatches(candidateResults.flatMap((result) => result.items.flatMap((item) => item.projection === 'OPERATIONAL' ? [item.customer] : [])), {
            displayName: draftCust.trim(), primaryPhone: draftCustomerPhone.trim(),
          });
          if (matches.length > 0) { setCustomerDuplicateMatches(matches); return; }
        }
        const createdCustomer = await createCrmCustomer(companyId, {
          branchId: draftBranchId,
          displayName: draftCust.trim(),
          primaryPhone: draftCustomerPhone.trim() || undefined,
          originSource: customerOriginFromBookingSource(draftSource),
          duplicateOverride,
        });
        customerId = createdCustomer.customer.id;
      }
      if (!customerId) throw new Error('customerId_required');
      const { startAt, endAt } = slotToIsoRange(create.day, create.hour, draftDur, weekOffset, today);
      await createCrmBooking(companyId, {
        branchId: draftBranchId,
        customerId,
        serviceName: selectedService!.name,
        staffUserId: draftStaffId || undefined,
        startAt,
        endAt,
        source: draftSource,
        ...(draftTotalAmount.trim() ? { totalAmount: draftTotalAmount.trim() } : {}),
        ...(draftDepositAmount.trim() ? { depositAmount: draftDepositAmount.trim() } : {}),
      });
      toast.success('บันทึกคิวเรียบร้อยแล้ว');
      setCreate(null);
      await load();
    } catch (e) {
      const duplicateWarnings = (e as { details?: { warnings?: unknown[] } }).details?.warnings;
      if ((e as { code?: string }).code === 'duplicate_candidate_requires_manager_review') {
        setCustomerDuplicateMatches([]);
        setSaveError('พบข้อมูลซ้ำที่คุณไม่มีสิทธิ์เปิด กรุณาให้ผู้จัดการตรวจสอบ');
      } else if (duplicateWarnings?.length && createNewCustomer) {
        const lookup = draftCustomerPhone.trim() || draftCust.trim();
        const candidateResults = await Promise.all((['ACTIVE', 'INACTIVE'] as const).map((status) =>
          listCrmCustomers(companyId, { scope: 'all', status, search: lookup, pageSize: 20 }),
        )).catch(() => []);
        const matches = findCustomerDuplicateMatches(candidateResults.flatMap((result) => result.items.flatMap((item) => item.projection === 'OPERATIONAL' ? [item.customer] : [])), {
          displayName: draftCust.trim(), primaryPhone: draftCustomerPhone.trim(),
        });
        setCustomerDuplicateMatches(matches);
        setSaveError(matches.length > 0 ? 'พบลูกค้าที่อาจเป็นคนเดียวกัน กรุณาเลือกข้อมูลเดิมหรือยืนยันสร้างใหม่' : 'พบข้อมูลซ้ำที่เปิดไม่ได้ กรุณาให้ผู้จัดการตรวจสอบ');
      } else {
        setSaveError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    if (!canCancel) return;
    if (!(await confirm('ยกเลิกคิวนี้ใช่หรือไม่?'))) return;
    setActionSaving(true);
    setActionError(null);
    try {
      await cancelCrmBooking(companyId, id);
      toast.success('ยกเลิกนัดเรียบร้อยแล้ว');
      setSelectedBookingId(null);
      await load();
    } catch (e) {
      setActionError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setActionSaving(false);
    }
  };

  const handleTerminalStatus = async (status: 'DONE' | 'NO_SHOW') => {
    if (!selectedBooking || !canUpdate) return;
    const confirmed = await confirm({
      message: status === 'DONE' ? 'ยืนยันว่าเสร็จสิ้นนัดหมายนี้?' : 'ยืนยันว่าลูกค้าไม่มาตามนัด?',
      variant: status === 'DONE' ? 'primary' : 'danger',
    });
    if (!confirmed) return;
    setActionSaving(true);
    setActionError(null);
    try {
      await updateCrmBooking(companyId, selectedBooking.id, { status });
      toast.success(status === 'DONE' ? 'บันทึกการให้บริการเสร็จสิ้นเรียบร้อยแล้ว' : 'บันทึกการไม่มาตามนัดเรียบร้อยแล้ว');
      setSelectedBookingId(null);
      await load();
    } catch (e) {
      setActionError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setActionSaving(false);
    }
  };

  const openReschedule = () => {
    if (!selectedBooking || !canUpdate) return;
    const durationHours = Math.max(1, Math.round(((new Date(selectedBooking.endAt).getTime() - new Date(selectedBooking.startAt).getTime()) / 3_600_000) * 2) / 2);
    setActionError(null);
    setReschedule({
      date: localDateValue(selectedBooking.startAt),
      time: localTimeValue(selectedBooking.startAt),
      dur: durationHours,
      staffUserId: selectedBooking.staffUserId ?? '',
    });
  };

  const saveReschedule = async () => {
    if (!selectedBooking || !reschedule || !canUpdate) return;
    const startAt = new Date(`${reschedule.date}T${reschedule.time}:00`);
    if (Number.isNaN(startAt.getTime())) {
      setActionError('กรุณาเลือกวันที่และเวลาใหม่');
      return;
    }
    if (startAt.getTime() < Date.now()) {
      setActionError('ไม่สามารถเลื่อนนัดหมายไปเป็นเวลาในอดีตได้');
      return;
    }
    setActionSaving(true);
    setActionError(null);
    try {
      await updateCrmBooking(companyId, selectedBooking.id, {
        startAt: startAt.toISOString(),
        endAt: new Date(startAt.getTime() + reschedule.dur * 3_600_000).toISOString(),
        ...(reschedule.staffUserId && reschedule.staffUserId !== selectedBooking.staffUserId
          ? { staffUserId: reschedule.staffUserId }
          : {}),
      });
      toast.success('บันทึกการเลื่อนนัดเรียบร้อยแล้ว');
      setReschedule(null);
      setSelectedBookingId(null);
      await load();
    } catch (e) {
      setActionError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setActionSaving(false);
    }
  };

  const openBookingActions = (id: string) => {
    setActionError(null);
    setReschedule(null);
    setSelectedBookingId(id);
  };

  const saveBufferMinutes = async (next: CrmBookingBufferMinutes) => {
    if (!canUpdate || bufferSaving) return;
    const previous = bufferMinutes;
    setBufferMinutes(next);
    setBufferSaving(true);
    setError(null);
    try {
      const saved = await updateCrmBookingSettings(companyId, { bufferMinutes: next });
      setBufferMinutes(saved.bufferMinutes);
      await load();
      toast.success(`บันทึกเวลาพักระหว่างคิว ${saved.bufferMinutes} นาทีแล้ว`);
    } catch (e) {
      setBufferMinutes(previous);
      setError(localizedErrorMessage(e, locale, { fallback: 'error.save_failed' }));
    } finally {
      setBufferSaving(false);
    }
  };

  const subtitle = create ? getCreateSubtitle(create.day, create.hour, draftDur, weekOffset, today) : null;

  if (!canRead) {
    return <div className="mangmee-card p-6 text-center text-sm text-gray-500">คุณไม่มีสิทธิ์ดูรายการนัดหมาย</div>;
  }

  return (
    <div className="mangmee-page">
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-[0.12em] text-brand-600">ตารางนัดหมาย</div>
            <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.03em] text-gray-900">การจองออนไลน์</h1>
            <p className="mt-1 text-sm text-gray-500">{canCreate ? 'เลือกช่วงเวลาว่างในตารางเพื่อเพิ่มนัดหมาย' : 'ดูตารางนัดหมายของสาขา'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* No resolved branch context: claim no scope at all rather than a wrong one (spec R3). */}
            {scopeLabel && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2">
                <div className="text-[11px] font-semibold text-gray-500">สาขาที่กำลังดู</div>
                <div className="mt-0.5 text-sm font-bold text-gray-800">{scopeLabel}</div>
              </div>
            )}
            <div className="rounded-xl border border-brand-100 bg-brand-50 px-3.5 py-2">
              <div className="text-[11px] font-semibold text-brand-700">คิววันนี้</div>
              <div className="mt-0.5 text-sm font-extrabold text-brand-800">{todayCount.toLocaleString('th-TH')} คิว</div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-gray-100 bg-gray-50/70 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-6">
          <div>
            <div className="mb-2 text-xs font-semibold text-gray-500">ช่วงเวลาที่แสดง</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="flex min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm sm:max-w-[390px]">
                <button type="button" onClick={() => setWeekOffset((w) => w - 1)} className="flex min-h-12 w-12 shrink-0 cursor-pointer items-center justify-center text-2xl text-gray-600 hover:bg-gray-50" aria-label="สัปดาห์ก่อนหน้า">‹</button>
                <div className="min-w-0 flex-1 border-x border-gray-100 px-3 py-2 text-center" aria-live="polite">
                  <div className="text-xs font-bold text-brand-700">{getWeekTag(weekOffset)}</div>
                  <div className="mt-0.5 truncate text-sm font-extrabold text-gray-900">{getWeekLabel(today, weekOffset)}</div>
                </div>
                <button type="button" onClick={() => setWeekOffset((w) => w + 1)} className="flex min-h-12 w-12 shrink-0 cursor-pointer items-center justify-center text-2xl text-gray-600 hover:bg-gray-50" aria-label="สัปดาห์ถัดไป">›</button>
              </div>
              <button type="button" disabled={weekOffset === 0} onClick={() => setWeekOffset(0)} className="min-h-12 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-default disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none">
                {weekOffset === 0 ? 'กำลังดูสัปดาห์นี้' : 'กลับมาวันนี้'}
              </button>
            </div>
          </div>
          <label className="block min-w-[220px]">
            <span className="text-xs font-semibold text-gray-500">เวลาพักระหว่างคิว</span>
            <span className="mt-0.5 block text-[11px] text-gray-400">ช่วยป้องกันนัดหมายต่อกันแน่นเกินไป</span>
            <ThemedSelect
              value={bufferMinutes}
              disabled={!canUpdate || bufferSaving}
              onChange={(event) => void saveBufferMinutes(Number(event.target.value) as CrmBookingBufferMinutes)}
              className="mt-2 min-h-12 w-full rounded-xl border-gray-200 bg-white px-3 text-sm font-bold text-gray-800 shadow-sm disabled:opacity-50"
            >
              {CRM_BOOKING_BUFFER_MINUTE_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>{minutes === 0 ? 'ไม่เว้นเวลา' : `${minutes} นาที`}</option>
              ))}
            </ThemedSelect>
          </label>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {loading && bookings.length === 0 && <LoadingState label="กำลังโหลด..." />}

      {!loading && (
        <>
          {/* Week grid (>=768px) */}
          <div className="mangmee-card hidden gap-1.5 overflow-x-auto p-4 md:flex">
            <HourLabels withHeaderOffset />
            {columns.map((col) => (
              <div key={col.day} className="min-w-[120px] flex-1">
                <div className={cx('mb-2 rounded-[10px] px-1 py-[9px] text-center', col.isToday ? 'bg-brand-500 text-white' : 'bg-gray-50 text-gray-600')}>
                  <div className="text-[12.5px] font-bold">{col.dayName}</div>
                  <div className="text-[19px] font-extrabold leading-[1.1]">{col.dateNum}</div>
                </div>
                <DayEntries
                  entries={col.entries}
                  onSlotClick={(hour) => openCreate(col.day, hour)}
                  onOpenBooking={openBookingActions}
                  canCreate={canCreate}
                  canManage={canUpdate || canCancel}
                />
              </div>
            ))}
          </div>

          {/* Mobile day view (<768px) */}
          <div className="md:hidden">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {columns.map((col) => {
                const on = col.day === selectedDay;
                return (
                  <button key={col.day} type="button" onClick={() => setDaySel(col.day)} className={cx('min-w-[46px] shrink-0 rounded-[11px] border-2 px-1 py-2 text-center', on ? 'border-brand-500 bg-brand-50' : 'border-transparent bg-gray-50')}>
                    <div className={cx('text-xs font-bold', on ? 'text-brand-700' : 'text-gray-500')}>{col.dayName}</div>
                    <div className={cx('text-[17px] font-extrabold', on ? 'text-brand-700' : 'text-gray-800')}>{col.dateNum}</div>
                  </button>
                );
              })}
            </div>
            <div className="mangmee-card mt-3.5 flex gap-2.5 p-4">
              <HourLabels />
              <div className="min-w-0 flex-1">
                <DayEntries
                  entries={mobileColumn.entries}
                  mobile
                  onSlotClick={(hour) => openCreate(mobileColumn.day, hour)}
                  onOpenBooking={openBookingActions}
                  canCreate={canCreate}
                  canManage={canUpdate || canCancel}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Create booking modal */}
      {create && subtitle && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-6" onClick={() => setCreate(null)}>
          <div className="w-[min(480px,calc(100vw-2rem))] max-w-full overflow-hidden rounded-[20px] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.28)]" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-gray-100 px-6 py-5">
              <div className="text-[19px] font-bold text-gray-900">จองคิวใหม่</div>
              <div className="mt-[3px] text-sm font-semibold text-brand-600">{subtitle.dayText} · {subtitle.rangeText}</div>
            </div>
            <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-6 py-5">
              {saveError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{saveError}</div>}
              {branches.length > 1 && (
                <div>
                  <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">สาขา *</div>
                  <ThemedSelect value={draftBranchId} onChange={(e) => setDraftBranchId(e.target.value)} className="w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none">
                    <option value="">— เลือกสาขา —</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </ThemedSelect>
                </div>
              )}
              <div>
                <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">ลูกค้า CRM *</div>
                <input
                  value={draftCust}
                  disabled={createNewCustomer}
                  onChange={(e) => {
                    setDraftCust(e.target.value);
                    setDraftCustomerId('');
                  }}
                  placeholder="ค้นหาด้วยชื่อ เบอร์โทร หรืออีเมล"
                  className="w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none disabled:bg-gray-50"
                />
                {!canReadCustomers && <div className="mt-1.5 text-xs text-red-600">ต้องมีสิทธิ์ดูลูกค้าเพื่อสร้างการจอง</div>}
                {draftCustomerId && <div className="mt-1.5 text-xs font-semibold text-green-700">เลือกลูกค้าแล้ว · ID {draftCustomerId}</div>}
                {!draftCustomerId && !createNewCustomer && canReadCustomers && (
                  <div className="mt-1.5 overflow-hidden rounded-[10px] border border-gray-100 bg-white">
                    {customerSearchLoading && <div className="px-3 py-2 text-xs text-gray-400">กำลังค้นหา...</div>}
                    {!customerSearchLoading && customerOptions.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => {
                          setDraftCustomerId(customer.id);
                          setDraftCust(customer.displayName);
                          setCustomerOptions([]);
                        }}
                        className="flex w-full items-center justify-between border-b border-gray-50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-brand-50"
                      >
                        <span className="font-semibold text-gray-800">{customer.displayName}</span>
                        <span className="text-xs text-gray-400">{customer.primaryPhone ?? customer.primaryEmail ?? 'ไม่มีข้อมูลติดต่อ'}</span>
                      </button>
                    ))}
                    {!customerSearchLoading && customerOptions.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">ไม่พบลูกค้าที่ตรงกัน</div>}
                  </div>
                )}
                {!draftCustomerId && !createNewCustomer && canCreateCustomers && draftCust.trim() && (
                  <button type="button" onClick={() => setCreateNewCustomer(true)} className="mt-2 text-sm font-bold text-brand-700">
                    + สร้างลูกค้าใหม่ “{draftCust.trim()}”
                  </button>
                )}
                {createNewCustomer && (
                  <div className="mt-2 rounded-[10px] border border-brand-100 bg-brand-50 p-3">
                    <div className="text-sm font-bold text-brand-800">สร้างลูกค้าใหม่: {draftCust.trim()}</div>
                    <input value={draftCustomerPhone} onChange={(e) => { setDraftCustomerPhone(e.target.value); setCustomerDuplicateMatches([]); }} placeholder="เบอร์โทร (แนะนำเพื่อป้องกันลูกค้าซ้ำ)" className="mt-2 w-full rounded-[9px] border border-brand-100 bg-white px-3 py-2 text-sm outline-none" />
                    {customerDuplicateMatches.length > 0 && <div className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3"><div className="text-sm font-bold text-amber-900">พบลูกค้าที่อาจเป็นคนเดียวกัน</div>{customerDuplicateMatches.map((match) => <button key={match.customer.id} type="button" className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-sm" onClick={() => { setDraftCustomerId(match.customer.id); setDraftCust(match.customer.displayName); setCreateNewCustomer(false); setCustomerDuplicateMatches([]); }}><span><strong>{match.customer.displayName}</strong><span className="ml-2 text-xs text-gray-500">{match.customer.primaryPhone ?? 'ไม่มีเบอร์'}</span></span><span className="font-bold text-brand-700">ใช้ข้อมูลนี้</span></button>)}<button type="button" className="text-sm font-bold text-amber-800 underline" disabled={saving} onClick={() => void saveBooking(true)}>ยืนยันสร้างลูกค้าใหม่และจองต่อ</button></div>}
                    <button type="button" onClick={() => setCreateNewCustomer(false)} className="mt-2 text-xs font-semibold text-gray-500">ย้อนกลับไปเลือกลูกค้าเดิม</button>
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">ช่องทางที่รับจอง *</div>
                <ThemedSelect value={draftSource} onChange={(e) => setDraftSource(e.target.value as CrmStaffBookingSource)} className="w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none">
                  {STAFF_BOOKING_SOURCE_OPTIONS.map((source) => <option key={source.value} value={source.value}>{source.label}</option>)}
                </ThemedSelect>
              </div>
              <div>
                <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">บริการ</div>
                {services.length === 0 ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    ยังไม่มีบริการที่เปิดให้ลูกค้าเห็น · <Link className="font-bold underline" href={`/companies/${companyId}/settings/crm-catalog`}>ตั้งค่าสินค้าและบริการ</Link>
                  </div>
                ) : (
                <div className="flex flex-wrap gap-[7px]">
                  {services.map((service) => {
                    const on = draftServiceId === service.id;
                    return (
                      <button key={service.id} type="button" onClick={() => { setDraftServiceId(service.id); setDraftDur((service.bookingDurationMinutes ?? 60) / 60); }} className={cx('cursor-pointer rounded-[20px] border px-[13px] py-[7px] text-[13.5px] font-semibold', on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-400')}>
                        {service.name}
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">ระยะเวลา</div>
                <div className="flex gap-2">
                  {BK_DURATION_OPTIONS.map((dur) => {
                    const on = draftDur === dur;
                    return (
                      <button key={dur} type="button" onClick={() => setDraftDur(dur)} className={cx('flex-1 cursor-pointer rounded-[9px] border-2 p-[9px] text-center text-sm font-bold', on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600')}>
                        {dur} ชม.
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">พนักงานที่ดูแล</div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setDraftStaffId('')} className={cx('cursor-pointer rounded-[20px] border px-[15px] py-2 text-sm font-semibold', !draftStaffId ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600')}>
                    ไม่ระบุ
                  </button>
                  {employees.map((emp) => {
                    const on = draftStaffId === emp.userId;
                    return (
                      <button key={emp.userId} type="button" onClick={() => setDraftStaffId(emp.userId)} className={cx('cursor-pointer rounded-[20px] border px-[15px] py-2 text-sm font-semibold', on ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600')}>
                        {employeeShortName(emp)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-[13.5px] font-semibold text-gray-700">
                  ราคารวม (บาท) <span className="font-normal text-gray-400">(ไม่บังคับ)</span>
                  <input type="number" min="0" step="0.01" value={draftTotalAmount} onChange={(event) => setDraftTotalAmount(event.target.value)} className="mt-1.5 w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none" />
                </label>
                <label className="text-[13.5px] font-semibold text-gray-700">
                  มัดจำ (บาท) <span className="font-normal text-gray-400">(ไม่บังคับ)</span>
                  <input type="number" min="0" step="0.01" value={draftDepositAmount} onChange={(event) => setDraftDepositAmount(event.target.value)} className="mt-1.5 w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none" />
                </label>
              </div>
            </div>
            <div className="flex gap-2.5 border-t border-gray-100 px-6 py-4">
              <button type="button" onClick={() => setCreate(null)} className="flex-1 rounded-[11px] bg-gray-100 p-3 text-center text-[15px] font-semibold text-gray-600">ยกเลิก</button>
              <button type="button" onClick={() => void saveBooking()} disabled={!canSave || saving} className={cx('flex-1 rounded-[11px] p-3 text-center text-[15px] font-bold text-white', canSave && !saving ? 'cursor-pointer bg-brand-500' : 'cursor-not-allowed bg-gray-300')}>
                {saving ? 'กำลังบันทึก...' : 'บันทึกคิว'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedBooking && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(16,24,40,0.45)] p-6"
          onClick={() => {
            if (!actionSaving) {
              setSelectedBookingId(null);
              setReschedule(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={reschedule ? 'เลื่อนนัด' : 'จัดการนัดหมาย'}
            className="w-[min(480px,calc(100vw-2rem))] max-w-full overflow-hidden rounded-[20px] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-gray-100 px-6 py-5">
              <div className="text-[19px] font-bold text-gray-900">{reschedule ? 'เลื่อนนัด' : 'จัดการนัดหมาย'}</div>
              <div className="mt-1 text-sm text-gray-500">
                {selectedBooking.customerName ?? 'ลูกค้า'} · {selectedBooking.serviceName}
              </div>
            </div>

            <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto px-6 py-5">
              {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}
              {actionSaving && <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-700">กำลังบันทึก...</div>}

              {!reschedule && (
                <div className="grid gap-2 rounded-[11px] bg-gray-50 px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3"><span className="text-gray-500">ชื่อลูกค้า</span><span className="font-semibold text-gray-800">{selectedBooking.customerName ?? '—'}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-gray-500">เบอร์โทร</span><span className="font-semibold text-gray-800">{selectedCustomerPhone ?? '—'}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-gray-500">มัดจำ</span><span className="font-semibold text-gray-800">{bookingAmountText(selectedBooking.depositAmount)}</span></div>
                  <div className="flex items-center justify-between gap-3"><span className="text-gray-500">คงเหลือที่ต้องจ่าย</span><span className="font-bold text-brand-700">{bookingOutstandingText(selectedBooking.depositAmount, selectedBooking.totalAmount)}</span></div>
                </div>
              )}

              {reschedule ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[13.5px] font-semibold text-gray-700">
                      วันที่
                      <ThemedDate
                        min={localDateValue(today.toISOString())}
                        value={reschedule.date}
                        onChange={(event) => setReschedule({ ...reschedule, date: event.target.value })}
                        className="mt-1.5 w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none"
                      />
                    </label>
                    <label className="text-[13.5px] font-semibold text-gray-700">
                      เวลา
                      <input
                        type="time"
                        min="09:00"
                        max="19:00"
                        step={1800}
                        value={reschedule.time}
                        onChange={(event) => setReschedule({ ...reschedule, time: event.target.value })}
                        className="mt-1.5 w-full rounded-[11px] border border-gray-200 px-3.5 py-[11px] text-[15px] outline-none"
                      />
                    </label>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">ระยะเวลา</div>
                    <div className="flex gap-2">
                      {BK_DURATION_OPTIONS.map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          onClick={() => setReschedule({ ...reschedule, dur })}
                          className={cx(
                            'flex-1 rounded-[9px] border-2 p-[9px] text-center text-sm font-bold',
                            reschedule.dur === dur ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600',
                          )}
                        >
                          {dur} ชม.
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 text-[13.5px] font-semibold text-gray-700">พนักงานที่ดูแล</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setReschedule({ ...reschedule, staffUserId: '' })}
                        className={cx(
                          'rounded-[20px] border px-[15px] py-2 text-sm font-semibold',
                          !reschedule.staffUserId ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600',
                        )}
                      >
                        ไม่เปลี่ยนพนักงาน
                      </button>
                      {employees.map((employee) => (
                        <button
                          key={employee.userId}
                          type="button"
                          onClick={() => setReschedule({ ...reschedule, staffUserId: employee.userId })}
                          className={cx(
                            'rounded-[20px] border px-[15px] py-2 text-sm font-semibold',
                            reschedule.staffUserId === employee.userId ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600',
                          )}
                        >
                          {employeeShortName(employee)}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : selectedBooking.status === 'BOOKED' ? (
                <div className="grid gap-2.5">
                  {canUpdate && (
                    <>
                      <button type="button" disabled={actionSaving} onClick={openReschedule} className="rounded-[11px] border border-gray-200 px-4 py-3 text-left text-sm font-bold text-gray-700 disabled:opacity-50">
                        เลื่อนนัด
                      </button>
                      <button type="button" disabled={actionSaving} onClick={() => void handleTerminalStatus('DONE')} className="rounded-[11px] border border-green-200 bg-green-50 px-4 py-3 text-left text-sm font-bold text-green-700 disabled:opacity-50">
                        เสร็จสิ้น
                      </button>
                      <button type="button" disabled={actionSaving} onClick={() => void handleTerminalStatus('NO_SHOW')} className="rounded-[11px] border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-bold text-amber-700 disabled:opacity-50">
                        ไม่มาตามนัด
                      </button>
                    </>
                  )}
                  {canCancel && (
                    <button type="button" disabled={actionSaving} onClick={() => void handleCancel(selectedBooking.id)} className="rounded-[11px] border border-red-200 bg-red-50 px-4 py-3 text-left text-sm font-bold text-red-700 disabled:opacity-50">
                      ยกเลิกนัด
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
                  สถานะ: {BOOKING_STATUS_LABEL[selectedBooking.status]} · ไม่สามารถแก้ไขนัดหมายนี้ได้
                </div>
              )}
            </div>

            <div className="flex gap-2.5 border-t border-gray-100 px-6 py-4">
              {reschedule ? (
                <>
                  <button type="button" disabled={actionSaving} onClick={() => setReschedule(null)} className="flex-1 rounded-[11px] bg-gray-100 p-3 text-[15px] font-semibold text-gray-600 disabled:opacity-50">กลับ</button>
                  <button
                    type="button"
                    disabled={actionSaving || !reschedule.date || !reschedule.time}
                    onClick={() => void saveReschedule()}
                    className="flex-1 rounded-[11px] bg-brand-500 p-3 text-[15px] font-bold text-white disabled:bg-gray-300"
                  >
                    {actionSaving ? 'กำลังบันทึก...' : 'บันทึกการเลื่อนนัด'}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={actionSaving}
                  onClick={() => setSelectedBookingId(null)}
                  className="w-full rounded-[11px] bg-gray-100 p-3 text-[15px] font-semibold text-gray-600 disabled:opacity-50"
                >
                  ปิด
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
