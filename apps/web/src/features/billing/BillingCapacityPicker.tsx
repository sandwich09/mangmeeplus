'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { THAI_SYSTEM_ROLE_NAMES, PLAN_TIER_PRESETS, type PlanTierKey, type BillingCapacityOptions, type BillingCapacitySelection } from '@watchdog-bms/contracts';
import { MangmeeBadge } from '@/common/components/mangmee';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { CheckCircleIcon } from '@/common/icons';
import { billingBackControl } from './billing-display';

const button = 'mangmee-btn mangmee-btn-secondary';
const checkbox = 'mt-0.5 size-5 shrink-0 rounded border-gray-300 accent-brand-600';
export default function BillingCapacityPicker({ options, repair, scheduledAt, currentTierKey, currentInterval, initialSelection, onConfirm, onRefresh, onCancel }: {
  options: BillingCapacityOptions; repair: boolean; scheduledAt?: string; currentTierKey?: string | null; currentInterval?: 'month' | 'year' | null; initialSelection?: BillingCapacitySelection;
  onConfirm: (selection: BillingCapacitySelection) => Promise<void>; onRefresh: () => Promise<void>; onCancel: (selection: BillingCapacitySelection) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const backNavigation = useRef<HTMLDivElement>(null);
  const branchesToggle = useRef<HTMLButtonElement>(null);
  const membersToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { backNavigation.current?.scrollIntoView({ block: 'start' }); heading.current?.focus({ preventScroll: true }); }, []);
  const draft = initialSelection?.sourceHash === options.sourceHash ? initialSelection : undefined;
  const [branches, setBranches] = useState(draft?.branchIds ?? options.branches.filter(b => b.required).map(b => b.id));
  const [members, setMembers] = useState(draft?.memberships ?? options.memberships.filter(m => m.required).map(m => ({ id: m.id, defaultBranchId: m.defaultBranchId })));
  const [showAdditionalBranches, setShowAdditionalBranches] = useState(false);
  const [showAdditionalMembers, setShowAdditionalMembers] = useState(false);
  const branchesListId = useId();
  const membersListId = useId();
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const currentPlan = currentTierKey && currentTierKey in PLAN_TIER_PRESETS ? PLAN_TIER_PRESETS[currentTierKey as PlanTierKey].labelTh : null;
  const targetPlan = options.offerKey in PLAN_TIER_PRESETS ? PLAN_TIER_PRESETS[options.offerKey as PlanTierKey].labelTh : 'แพ็กเกจที่เลือก';
  const suspendedBranches = options.branches.length - branches.length, suspendedMembers = options.memberships.length - members.length;
  const remainingBranches = Math.max(0, options.branchLimit - branches.length), remainingMembers = Math.max(0, options.employeeLimit - members.length);
  const blockedByWork = (options.branches.some(b => b.openReimbursements > 0) || options.memberships.some(m => m.required && !m.owner)) &&
    (options.branches.filter(b => b.required).length > options.branchLimit || options.memberships.filter(m => m.required).length > options.employeeLimit);
  const valid = branches.length > 0 && branches.length <= options.branchLimit && members.length > 0 && members.length <= options.employeeLimit &&
    options.branches.some(b => b.headOffice && branches.includes(b.id)) && members.every(m => {
      const source = options.memberships.find(s => s.id === m.id)!;
      const allowed = branches.filter(id => source.allBranches || source.branchIds.includes(id));
      return allowed.length > 0 && (m.defaultBranchId === null ? source.allBranches : allowed.includes(m.defaultBranchId));
    });
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch { setError('ข้อมูลอาจเปลี่ยนหรือยังจัดการรายการค้างไม่ครบ กรุณาโหลดข้อมูลล่าสุดแล้วตรวจการเลือกอีกครั้ง'); } finally { setBusy(false); } }
  return <>
    <div ref={backNavigation} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] space-y-1"><button type="button" className={billingBackControl} disabled={busy} onClick={() => onCancel({ sourceHash: options.sourceHash, branchIds: branches, memberships: members })}><span className="text-base leading-none" aria-hidden="true">←</span>{repair ? 'กลับไปสถานะการชำระเงิน' : 'กลับไปเลือกแพ็กเกจ'}</button>
      <h2 ref={heading} tabIndex={-1} className="text-xl font-bold text-gray-900 sm:text-2xl">เลือกสาขาและผู้ใช้ที่จะใช้งานต่อ</h2></div>
    <section aria-label="เลือกสาขาและผู้ใช้" className="mangmee-card space-y-5 p-5 sm:p-6">
      <p className="text-sm text-gray-600">{currentPlan && (currentTierKey !== options.offerKey || currentInterval !== options.interval) ? `จาก ${currentPlan}${currentInterval ? ` · ${currentInterval === 'year' ? 'รายปี' : 'รายเดือน'}` : ''} เป็น ` : repair ? 'แพ็กเกจที่ชำระแล้ว: ' : 'แพ็กเกจที่เลือก: '}<strong className="text-gray-900">{targetPlan} · {options.interval === 'year' ? 'รายปี' : 'รายเดือน'}</strong></p>
    {scheduledAt ? <p className="rounded-xl bg-brand-50 p-4 text-sm text-brand-800">ใช้แพ็กเกจเดิมได้ถึง {new Date(scheduledAt).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })} แพ็กเกจใหม่เริ่มเมื่อชำระรอบถัดไปสำเร็จ วันนี้ยังไม่เรียกเก็บเงิน</p>
      : repair && <p className="rounded-xl bg-brand-50 p-4 text-sm text-brand-800">ชำระแล้ว การยืนยันนี้ใช้รายการเดิม ไม่มีการเรียกเก็บซ้ำ</p>}
    <div className="grid gap-6 lg:grid-cols-2">
      <fieldset disabled={busy} className="min-w-0 space-y-2"><legend className="mb-2 font-semibold">สาขา <span className="ml-2 text-sm font-normal text-gray-500">เลือก {branches.length} / {options.branchLimit}</span></legend>
        <div id={branchesListId} className="space-y-2">{options.branches.filter(branch => showAdditionalBranches || branches.includes(branch.id)).map(branch => {
          const selected = branches.includes(branch.id);
          const atLimit = !selected && branches.length >= options.branchLimit;
          return <label key={branch.id} className={`flex min-h-12 items-start gap-3 rounded-xl border p-3 ${selected ? 'border-brand-200 bg-brand-50/40' : atLimit ? 'cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400' : 'cursor-pointer border-gray-200'}`}>
          {branch.required ? <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" /> : <input type="checkbox" className={checkbox} checked={selected} disabled={atLimit} onChange={event => { const checked = event.target.checked; setAccepted(false); if (!checked && !showAdditionalBranches) branchesToggle.current?.focus(); setBranches(old => checked ? old.length < options.branchLimit && !old.includes(branch.id) ? [...old, branch.id] : old : old.filter(id => id !== branch.id)); }} />}
          <span className="min-w-0 flex-1 space-y-1"><span className="flex flex-wrap items-center gap-2"><span className="break-words">{branch.name}</span>{branch.required ? <MangmeeBadge>จำเป็นต้องคงไว้</MangmeeBadge> : branch.headOffice && branch.name !== 'สำนักงานใหญ่' && <MangmeeBadge>สำนักงานใหญ่</MangmeeBadge>}</span>
            {branch.openReimbursements > 0 && <span className="block text-sm text-gray-500">มีรายการเบิกค้าง {branch.openReimbursements} รายการ</span>}</span>
        </label>; })}</div>
        {branches.length >= options.branchLimit && options.branches.some(branch => !branches.includes(branch.id)) && <p className="text-sm text-gray-500">ครบจำนวนสาขาที่แพ็กเกจรองรับแล้ว</p>}
        {options.branches.some(branch => !branch.required) && <button ref={branchesToggle} type="button" className={button} aria-expanded={showAdditionalBranches} aria-controls={branchesListId} onClick={() => setShowAdditionalBranches(value => !value)}>{showAdditionalBranches ? 'ซ่อนสาขาที่ยังไม่เลือก' : remainingBranches > 0 ? 'เลือกสาขาเพิ่ม' : 'ดูสาขาที่ไม่ได้เลือก'}</button>}
        {remainingBranches > 0 && <p className="text-sm text-gray-500">เลือกเพิ่มได้อีก {remainingBranches} สาขา หรือเปิดใช้งานภายหลังที่เมนูสาขา</p>}
      </fieldset>
      <fieldset disabled={busy} className="min-w-0 space-y-2"><legend className="mb-2 font-semibold">ผู้ใช้ <span className="ml-2 text-sm font-normal text-gray-500">เลือก {members.length} / {options.employeeLimit} รวม{THAI_SYSTEM_ROLE_NAMES.OWNER}</span></legend>
        <div id={membersListId} className="space-y-2">{options.memberships.filter(member => showAdditionalMembers || members.some(m => m.id === member.id)).map(member => {
          const selected = members.find(m => m.id === member.id);
          const atLimit = !selected && members.length >= options.employeeLimit;
          const allowed = options.branches.filter(b => branches.includes(b.id) && (member.allBranches || member.branchIds.includes(b.id)));
          const singleBranch = allowed.length === 1 && (selected?.defaultBranchId === allowed[0].id || (selected?.defaultBranchId === null && member.allBranches));
          return <div key={member.id} className={`space-y-2 rounded-xl border p-3 ${selected ? 'border-brand-200 bg-brand-50/40' : atLimit ? 'border-gray-200 bg-gray-50 text-gray-400' : 'border-gray-200'}`}>
            <label className={`flex min-h-6 items-start gap-3${member.required ? '' : atLimit ? ' cursor-not-allowed' : ' cursor-pointer'}`}>
              {member.required ? <CheckCircleIcon className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" /> : <input type="checkbox" className={checkbox} checked={!!selected} disabled={atLimit} onChange={event => { const checked = event.target.checked; setAccepted(false); if (!checked && !showAdditionalMembers) membersToggle.current?.focus(); setMembers(old => checked ? old.length < options.employeeLimit && !old.some(m => m.id === member.id) ? [...old, { id: member.id, defaultBranchId: member.defaultBranchId }] : old : old.filter(m => m.id !== member.id)); }} />}
              <span className="min-w-0 flex-1 space-y-1"><span className="flex flex-wrap items-center gap-2"><span className="break-words">{member.name}</span>{member.required && <MangmeeBadge>จำเป็นต้องคงไว้</MangmeeBadge>}</span>{member.required && !member.owner && <span className="block text-sm text-gray-500">มีรายการเบิกหรืออนุมัติค้าง</span>}</span>
            </label>
            {selected && (singleBranch ? <p className="pl-8 text-sm text-gray-500">สาขาที่ใช้งาน: {allowed[0].name}</p> : <label className="block text-sm text-gray-600">สาขาเริ่มต้น<ThemedSelect aria-label={`สาขาเริ่มต้นของ ${member.name}`} className="mt-2 w-full" disabled={busy} value={selected.defaultBranchId ?? ''} onChange={event => { setAccepted(false); setMembers(old => old.map(m => m.id === member.id ? { ...m, defaultBranchId: event.target.value || null } : m)); }}>
              <option value="">{member.allBranches ? 'เลือกสาขาเมื่อเข้าใช้งาน' : 'กรุณาเลือกสาขาที่มีสิทธิ์'}</option>
              {allowed.map(b => <option value={b.id} key={b.id}>{b.name}</option>)}
              {selected.defaultBranchId && !allowed.some(b => b.id === selected.defaultBranchId) && <option value={selected.defaultBranchId} disabled>สาขาเดิมไม่ได้คงไว้ กรุณาเลือกใหม่</option>}
            </ThemedSelect></label>)}
          </div>;
        })}</div>
        {members.length >= options.employeeLimit && options.memberships.some(member => !members.some(m => m.id === member.id)) && <p className="text-sm text-gray-500">ครบจำนวนผู้ใช้ที่แพ็กเกจรองรับแล้ว</p>}
        {options.memberships.some(member => !member.required) && <button ref={membersToggle} type="button" className={button} aria-expanded={showAdditionalMembers} aria-controls={membersListId} onClick={() => setShowAdditionalMembers(value => !value)}>{showAdditionalMembers ? 'ซ่อนพนักงานที่ยังไม่เลือก' : remainingMembers > 0 ? 'เลือกพนักงานเพิ่ม' : 'ดูพนักงานที่ไม่ได้เลือก'}</button>}
        {remainingMembers > 0 && <p className="text-sm text-gray-500">เลือกเพิ่มได้อีก {remainingMembers} คน หรือเปิดใช้งานภายหลังที่เมนูพนักงาน</p>}
      </fieldset>
    </div>
    <div className="space-y-2 border-t border-gray-200 pt-4">
      {suspendedBranches + suspendedMembers > 0 ? <><p className="font-medium">เมื่อเริ่มแพ็กเกจใหม่ จะพัก {suspendedBranches} สาขา · {suspendedMembers} ผู้ใช้</p><p className="text-sm text-gray-500">รายการที่ไม่เลือกจะถูกพัก ข้อมูลและเอกสารเดิมยังอยู่ เปิดกลับได้จากเมนูสาขาหรือพนักงาน ภายในจำนวนที่แพ็กเกจรองรับ</p></> : <p className="text-sm text-gray-500">คงสาขาและผู้ใช้ทั้งหมด ไม่มีรายการที่ถูกพัก</p>}
      {!valid && <p role="status" className="text-sm text-amber-800">ต้องคงสำนักงานใหญ่และ{THAI_SYSTEM_ROLE_NAMES.OWNER} เลือกไม่เกินจำนวนที่แพ็กเกจรองรับ และกำหนดสาขาที่มีสิทธิ์ให้ผู้ใช้ทุกคน</p>}
      {blockedByWork && <p className="text-sm text-amber-800">มีรายการเบิกหรืออนุมัติค้าง ทำให้จำนวนที่ต้องคงไว้เกินแพ็กเกจ กรุณา<a className="font-semibold underline" href={`/companies/${options.companyId}/reimbursements`}>จัดการรายการเบิกค้าง</a>ก่อน หรือเลือกแพ็กเกจที่รองรับจำนวนปัจจุบัน</p>}
    </div>
    <label className="flex min-h-11 items-start gap-3 py-2"><input type="checkbox" className={checkbox} checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว</label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-3"><button className="mangmee-btn mangmee-btn-primary" disabled={busy || !valid || !accepted} aria-busy={busy} onClick={() => run(() => onConfirm({ sourceHash: options.sourceHash, branchIds: branches, memberships: members }))}>{repair ? 'ยืนยันการเลือกสำหรับรายการที่จ่ายแล้ว' : scheduledAt ? 'ตรวจสอบการเปลี่ยนแพ็กเกจ' : 'ใช้การเลือกนี้และตรวจสอบราคา'}</button>
      {error && <button className={button} disabled={busy} aria-busy={busy} onClick={() => run(onRefresh)}>โหลดข้อมูลล่าสุด</button>}</div>
  </section></>;
}
