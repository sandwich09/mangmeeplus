'use client';
import { useEffect, useRef, useState } from 'react';
import type { BillingCapacityOptions, BillingCapacitySelection } from '@watchdog-bms/contracts';

const button = 'mangmee-btn mangmee-btn-secondary';
export default function BillingCapacityPicker({ options, repair, onConfirm, onRefresh, onCancel }: {
  options: BillingCapacityOptions; repair: boolean; onConfirm: (selection: BillingCapacitySelection) => Promise<void>;
  onRefresh: () => Promise<void>; onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.scrollIntoView({ block: 'start' }); heading.current?.focus({ preventScroll: true }); }, []);
  const [branches, setBranches] = useState(options.branches.filter(b => b.required || !options.overCapacity).map(b => b.id));
  const [members, setMembers] = useState(options.memberships.filter(m => m.required || !options.overCapacity).map(m => ({ id: m.id, defaultBranchId: m.defaultBranchId })));
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const valid = branches.length > 0 && branches.length <= options.branchLimit && members.length > 0 && members.length <= options.employeeLimit &&
    options.branches.some(b => b.headOffice && branches.includes(b.id)) && members.every(m => {
      const source = options.memberships.find(s => s.id === m.id)!;
      const allowed = branches.filter(id => source.allBranches || source.branchIds.includes(id));
      return allowed.length > 0 && (m.defaultBranchId === null ? source.allBranches : allowed.includes(m.defaultBranchId));
    });
  async function run(work: () => Promise<void>) { setBusy(true); setError(''); try { await work(); } catch { setError('ข้อมูลอาจเปลี่ยนหรือยังจัดการรายการค้างไม่ครบ กรุณาโหลดข้อมูลล่าสุดแล้วตรวจการเลือกอีกครั้ง'); } finally { setBusy(false); } }
  return <section aria-label="เลือกสาขาและผู้ใช้" className="mangmee-card space-y-4 p-5 sm:p-6">
    <h2 ref={heading} tabIndex={-1} className="scroll-mt-[calc(var(--app-header-h,0px)+1.5rem)] text-lg font-bold">เลือกสาขาและผู้ใช้ที่จะคงสิทธิ์</h2>
    <p>{repair ? 'ชำระแล้ว การยืนยันนี้ใช้รายการเดิม ไม่มีการเรียกเก็บซ้ำ' : 'รายการที่ไม่ได้เลือกจะถูกพักเมื่อชำระสำเร็จและเริ่มแพ็กเกจใหม่'} ประวัติและเอกสารยังอยู่ครบ</p>
    <p>เลือกสาขา {branches.length} / {options.branchLimit} · ผู้ใช้ {members.length} / {options.employeeLimit} รวมเจ้าของ</p>
    <fieldset disabled={busy} className="space-y-2"><legend className="font-semibold">สาขาที่คงไว้</legend>
      {options.branches.map(branch => <label key={branch.id} className="flex items-start gap-3 rounded-xl border border-gray-200 p-3">
        <input type="checkbox" className="mt-1 size-5" checked={branches.includes(branch.id)} disabled={branch.required} onChange={event => { setAccepted(false); setBranches(old => event.target.checked ? [...old, branch.id] : old.filter(id => id !== branch.id)); }} />
        <span>{branch.name}{branch.headOffice && ' · สำนักงานใหญ่'}{branch.openReimbursements > 0 && ` · มีรายการเบิกค้าง ${branch.openReimbursements} รายการ ต้องคงไว้ก่อน`}</span>
      </label>)}
    </fieldset>
    <fieldset disabled={busy} className="space-y-3"><legend className="font-semibold">ผู้ใช้ที่คงไว้</legend>
      {options.memberships.map(member => { const selected = members.find(m => m.id === member.id); return <div key={member.id} className="space-y-2 rounded-xl border border-gray-200 p-3">
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={!!selected} disabled={member.required} onChange={event => { setAccepted(false); setMembers(old => event.target.checked ? [...old, { id: member.id, defaultBranchId: member.defaultBranchId }] : old.filter(m => m.id !== member.id)); }} />
          <span>{member.name}{member.owner ? ' · เจ้าของ' : member.required ? ' · มีงานค้าง ต้องคงไว้ก่อน' : ''}</span></label>
        {selected && <label className="block text-sm">สาขาเริ่มต้นของ {member.name}<select aria-label={`สาขาเริ่มต้นของ ${member.name}`} className="mangmee-input mt-2 w-full" value={selected.defaultBranchId ?? ''} onChange={event => { setAccepted(false); setMembers(old => old.map(m => m.id === member.id ? { ...m, defaultBranchId: event.target.value || null } : m)); }}>
          <option value="">{member.allBranches ? 'เลือกสาขาเมื่อเข้าใช้งาน' : 'กรุณาเลือกสาขาที่มีสิทธิ์'}</option>
          {options.branches.filter(b => branches.includes(b.id) && (member.allBranches || member.branchIds.includes(b.id))).map(b => <option value={b.id} key={b.id}>{b.name}</option>)}
          {selected.defaultBranchId && !branches.includes(selected.defaultBranchId) && <option value={selected.defaultBranchId} disabled>สาขาเดิมไม่ได้คงไว้ กรุณาเลือกใหม่</option>}
        </select></label>}
      </div>; })}
    </fieldset>
    <p>พักสาขา: {options.branches.filter(b => !branches.includes(b.id)).map(b => b.name).join(', ') || 'ไม่มี'}<br />พักผู้ใช้: {options.memberships.filter(m => !members.some(s => s.id === m.id)).map(m => m.name).join(', ') || 'ไม่มี'}</p>
    {!valid && <p role="status">ต้องคงสำนักงานใหญ่และเจ้าของ เลือกไม่เกินเพดาน และกำหนดสาขาที่มีสิทธิ์ให้ผู้ใช้ทุกคน</p>}
    <p className="text-sm">หากงานค้างทำให้เลือกไม่พอ ให้จัดการงานเดิมก่อนหรือเลือกแพ็กเกจที่รองรับจำนวนปัจจุบัน</p>
    <a className="inline-block underline" href={`/companies/${options.companyId}/reimbursements`}>ดูรายการเบิกเดิม</a>
    <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 size-5" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />ฉันตรวจสอบรายการที่คงไว้และรายการที่จะพักแล้ว</label>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <div className="flex flex-wrap gap-2"><button className="mangmee-btn mangmee-btn-primary" disabled={busy || !valid || !accepted} aria-busy={Boolean(busy)} onClick={() => run(() => onConfirm({ sourceHash: options.sourceHash, branchIds: branches, memberships: members }))}>{repair ? 'ยืนยันการเลือกสำหรับรายการที่จ่ายแล้ว' : 'ใช้การเลือกนี้และตรวจสอบราคา'}</button>
      {error && <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={() => run(onRefresh)}>โหลดข้อมูลล่าสุด</button>}<button className={button} disabled={busy} onClick={onCancel}>กลับ</button></div>
  </section>;
}
