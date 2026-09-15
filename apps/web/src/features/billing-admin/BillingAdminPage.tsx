'use client';
import {billingLeavesPage,billingMonthlyAllowanceText} from '../billing/billing-display';
import { billingControl, billingLabel, billingPlanLabel, billingIssueLabel } from '../billing/billing-display';
import BillingSupportOutcomesPanel from './BillingSupportOutcomesPanel';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import BillingOperationPanel from './BillingOperationPanel';
import BillingTimelinePanel from './BillingTimelinePanel';
import type { BillingOperatorOverview, BillingOperatorCompanyDetail, BillingOperatorIssue, BillingScopeDirectory } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorCode,apiErrorMessage } from '@/common/api/api-error-message';
import { PLAN_TERM_CONTACT_EMAIL } from '@/features/plan-term/plan-term.logic';

const button = billingControl;
const issueKind = billingIssueLabel;
const time = (value: string | null) => value ? new Date(value).toLocaleString('th-TH') : 'ยังไม่มี';
const money = (value: number) => new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(value / 100);
const get = <T,>(path: string) => authedApiFetch<T>(`/system/billing${path}`, { cache: 'no-store', suppressErrorToast: true });
const effectiveFollowUp=(issue:BillingOperatorIssue)=>issue.effectiveFollowUpAt??issue.followUpAt;
const states: Record<string, string> = { OPEN: 'รอรับงาน', ASSIGNED: 'รับงานแล้ว', IN_PROGRESS: 'กำลังดำเนินการ', WAITING_PROVIDER: 'รอผู้ให้บริการ',
  WAITING_APPROVAL: 'รออนุมัติ', WAITING_CUSTOMER: 'รอลูกค้า', VERIFYING: 'ตรวจผล', RESOLVED: 'แก้ไขแล้ว' };
export default function BillingAdminPage({ companyId, issueId, issuesOnly = false, userId }: {
  companyId?: string; issueId?: string; issuesOnly?: boolean; userId: string;
}) {
  const router=useRouter(),params=useSearchParams(),queuePage=Boolean(issuesOnly||issueId);
  const generation=useRef(0),invalidate=()=>{generation.current++;};
  const leaving=(event:React.MouseEvent<HTMLAnchorElement>)=>{if(billingLeavesPage(event))invalidate();};
  const queue=queuePage&&['UNASSIGNED','OVERDUE'].includes(params.get('queue')??'')?params.get('queue')!:'';
  const queueCursor=queuePage&&/^[a-f0-9-]{36}$/i.test(params.get('cursor')??'')?params.get('cursor'):null;
  const queueQuery=(value=queue,page=queueCursor)=>{const q=new URLSearchParams({...value?{queue:value}:{},...page?{cursor:page}:{}});return q.size?`?${q}`:'';};
  const [overview, setOverview] = useState<BillingOperatorOverview | null>(null);
  const [company, setCompany] = useState<BillingOperatorCompanyDetail | null>(null);
  const [issues, setIssues] = useState<{ items: BillingOperatorIssue[]; nextCursor: string | null } | null>(null);
  const [issue, setIssue] = useState<BillingOperatorIssue | null>(null);
  const [pageCursor, setCursor] = useState<string | null>(null), [reload, setReload] = useState(0);
  const cursor=queuePage?queueCursor:pageCursor;
  const [search,setSearch]=useState(''),[query,setQuery]=useState('');
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [note, setNote] = useState(''), [state, setState] = useState('IN_PROGRESS');
  const [assignee,setAssignee]=useState(''),[backup,setBackup]=useState(''),[priority,setPriority]=useState('NORMAL'),[followUp,setFollowUp]=useState(''),[followUpChanged,setFollowUpChanged]=useState(false);
  const [operatorSearch,setOperatorSearch]=useState(''),[operators,setOperators]=useState<BillingScopeDirectory|null>(null),[operatorNames,setOperatorNames]=useState<Record<string,string>>({});
  useEffect(()=>{invalidate();setCursor(null);setNote('');setCompany(null);setIssue(null);setOperators(null);setOperatorNames({});setOperatorSearch('');setAssignee('');setBackup('');setSaving(false);return invalidate;},[companyId,issueId,issuesOnly]);
  useEffect(() => {
    const token=generation.current;let active = true; setLoading(true); setError('');
    const overviewQuery=new URLSearchParams({search:query,...(cursor?{cursor}:{})}).toString();
    Promise.all([get<BillingOperatorOverview>(`/overview${!companyId && !issueId && !issuesOnly ? `?${overviewQuery}` : ''}`),
      companyId ? get<BillingOperatorCompanyDetail>(`/companies/${encodeURIComponent(companyId)}${cursor ? `?invoiceCursor=${encodeURIComponent(cursor)}` : ''}`) : null,
      issuesOnly ? get<{ items: BillingOperatorIssue[]; nextCursor: string | null }>(`/issues?${new URLSearchParams({...cursor?{cursor}:{},...queue?{queue}:{}})}`) : null,
      issueId ? get<BillingOperatorIssue>(`/issues/${encodeURIComponent(issueId)}`) : null,
    ]).then(([o, c, q, i]) => { if (active&&token===generation.current) { setOverview(o); setCompany(c); setIssues(q); setIssue(i); if (i) {setState(i.state === 'RESOLVED' ? 'VERIFYING' : i.state);
      setAssignee(i.assigneeUserId??'');setBackup(i.backupUserId??'');setPriority(i.priority);setFollowUp(localDate(i.followUpAt));setFollowUpChanged(false);
      setOperatorNames(names=>({...names,...i.assigneeUserId?{[i.assigneeUserId]:i.assigneeName??i.assigneeUserId}:{},...i.backupUserId?{[i.backupUserId]:i.backupName??i.backupUserId}:{}}));} } })
      .catch((e: unknown) => { if (active&&token===generation.current) {
        const status = (e as { status?: number }).status; setOverview(null); setCompany(null); setIssue(null); setIssues(null);
        setError(status === 403 ? 'ไม่มีสิทธิ์ดูขอบเขตนี้ ติดต่อผู้ดูแลสิทธิ์' : status === 404 ? 'ไม่พบรายการในขอบเขตที่คุณดูแล' : status === 401 ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : 'โหลดข้อมูลไม่ได้ กรุณาลองใหม่');
      } }).finally(() => { if (active&&token===generation.current) setLoading(false); });
    return () => { active = false; };
  }, [companyId, issueId, issuesOnly, cursor, reload,query,queue]);
  async function findOperators(cursor?:string) {
    if(!issue||saving)return;const token=generation.current;setSaving(true);setError('');
    try{const result=await get<BillingScopeDirectory>(`/issues/${issue.id}/operators?${new URLSearchParams({search:operatorSearch,...cursor?{cursor}:{}})}`);
      if(token===generation.current){setOperators(result);setOperatorNames(names=>({...names,...Object.fromEntries(result.items.map(i=>[i.id,i.name]))}));}
    }catch{if(token===generation.current)setError('โหลดผู้รับผิดชอบไม่ได้ กรุณาตรวจสิทธิ์และลองค้นหาใหม่');}finally{if(token===generation.current)setSaving(false);}
  }
  async function update(action: 'take'|'save'|'return') {
    if (!issue || saving || !note.trim()) return;
    const token=generation.current;setSaving(true); setError('');
    try {
      const updated = await authedApiFetch<BillingOperatorIssue>(`/system/billing/issues/${issue.id}`, { method: 'PATCH', suppressErrorToast: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: issue.version, state: action==='take' ? 'ASSIGNED' : action==='return'?'OPEN':state,
          note: note.trim(), assigneeUserId: action==='take' ? userId : action==='return'?null:assignee||null,
          backupUserId:action==='return'?null:backup||null,priority,...followUpChanged?{followUpAt:followUp?new Date(followUp).toISOString():null}:{} }) });
      if(token===generation.current){setIssue(updated); setNote(''); setReload(v => v + 1);}
    } catch(error) { if(token===generation.current)setError(apiErrorCode(error)==='BILLING_RATE_LIMIT'||(error as {status?:number})?.status===429?apiErrorMessage(error):apiErrorCode(error)==='CONTROL_SLA_REVIEW'?'ไม่พบเกณฑ์เวลาเดิม กรุณาระบุเวลาติดตามก่อนเปลี่ยนระดับความสำคัญ':'ยังบันทึกไม่ได้ กรุณาโหลดข้อมูลล่าสุดและตรวจสอบเคสก่อนบันทึกอีกครั้ง'); }
    finally { if(token===generation.current)setSaving(false); }
  }
  const issueList = issues?.items ?? company?.issues;
  const nextCursor = issueId ? null : company ? company.financial?.nextCursor : issues ? issues.nextCursor : overview?.nextCursor;
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <header><p className="text-base text-gray-600">{overview ? billingLabel('mode',overview.mode) : 'กำลังตรวจสอบโหมด'} · {overview?.platformScope ? 'ระดับระบบ' : 'เฉพาะบริษัทที่ได้รับสิทธิ์'}</p>
      <h1 className="text-2xl font-bold">{issueId ? 'เคสการชำระเงิน' : companyId ? 'การชำระเงินของบริษัท' : issuesOnly ? 'คิวตรวจสอบการชำระเงิน' : 'ดูแลแพ็กเกจและการชำระเงิน'}</h1></header>
    <nav className="flex flex-wrap gap-3"><Link onClick={leaving} href="/system/billing" className={button}>บริษัท</Link><Link onClick={leaving} href={`/system/billing/issues${queueQuery()}`} className={button}>คิวตรวจสอบ</Link>
      {overview&&overview.mode!=='DISABLED'&&<Link onClick={leaving} href="/system/billing/batches" className={button}>ตรวจหลายบริษัท</Link>}
      {overview?.platformScope && overview.mode!=='DISABLED' && <Link onClick={leaving} href="/system/billing/provider-events" className={button}>เหตุการณ์จาก Stripe</Link>}
      {overview?.platformScope && overview.capabilities.includes('system.billing.financial.read') && overview.mode!=='DISABLED' && <Link onClick={leaving} href="/system/billing/settlements" className={button}>ตรวจยอดและเงินโอน</Link>}
      {overview?.canManageScopes && <Link onClick={leaving} href="/system/billing/operator-scopes" className={button}>ขอบเขตเจ้าหน้าที่</Link>}
      {overview?.platformScope && <Link onClick={leaving} href="/system/billing/settings" className={button}>ตั้งค่าการชำระเงิน</Link>}</nav>
    {loading && <p role="status">กำลังโหลดข้อมูล…</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4">{error}</p>}
    <button className={button} disabled={loading || saving} onClick={() => {invalidate();setReload(v => v + 1);}}>โหลดข้อมูลล่าสุด</button>
    {!loading && overview?.mode === 'DISABLED' && <p>ยังไม่ได้เปิดระบบชำระเงิน ติดต่อผู้ดูแลการตั้งค่า</p>}
    {!companyId&&!issueId&&!issuesOnly&&<form className="flex flex-wrap gap-3" onSubmit={e=>{e.preventDefault();setCursor(null);setQuery(search.trim());setReload(v=>v+1);}}>
      <label>ค้นหาบริษัทในขอบเขต<input className="ml-2 min-h-11 rounded-lg border p-2" value={search} maxLength={100} onChange={e=>setSearch(e.target.value)}/></label><button className={button} disabled={loading}>ค้นหาบริษัท</button>
    </form>}
    {issuesOnly&&<label className="block">กรองคิว<select className="ml-2 min-h-11 rounded-lg border p-2" aria-label="กรองคิว" disabled={loading} value={queue} onChange={e=>router.replace(`/system/billing/issues${queueQuery(e.target.value,null)}`,{scroll:false})}>
      <option value="">เคสที่ยังเปิดทั้งหมด</option><option value="UNASSIGNED">ยังไม่มีผู้รับผิดชอบ</option><option value="OVERDUE">เลยเวลาติดตาม</option></select></label>}
    {!loading && !companyId && !issueId && !issuesOnly && overview && <section className="space-y-3" aria-label="บริษัทในขอบเขต">
      {overview.companies.length === 0 && <p>ไม่พบบริษัทในขอบเขตและคำค้นนี้</p>}
      {overview.companies.map(c => <article key={c.companyId} className="space-y-2 rounded-xl border bg-white p-4">
        <Link onClick={leaving} href={`/system/billing/companies/${encodeURIComponent(c.companyId)}`} className="font-bold underline">{c.companyName}</Link>
        <p>{billingPlanLabel(c.tierKey)} · {sourceLabel(c.source)} · {billingLabel('subscription',c.subscriptionState)}</p><p>ชำระเงิน {billingLabel('payment',c.paymentState)} · สิทธิ์ {billingLabel('access',c.accessState)} · จ่ายถึง {time(c.paidThrough)}</p><p className="text-base text-gray-600">ตรวจล่าสุด {time(c.observedAt)}</p>
      </article>)}
    </section>}
    {!loading && company && <section className="space-y-3 rounded-xl border bg-white p-5" aria-label="ข้อมูลการชำระเงินบริษัท">
      <h2 className="text-xl font-bold">{company.companyName}</h2><p>{billingLabel('mode',company.mode)} · {billingLabel('company',company.companyStatus)} · {billingLabel('subscription',company.subscriptionState)}</p>
      <p>แพ็กเกจ {billingPlanLabel(company.tierKey)} · ใช้สิทธิ์ได้ถึง {time(company.termEndsAt)}{company.paidThrough&&` · ชำระไว้ถึง ${time(company.paidThrough)}`}</p>
      <p>ใบเสร็จเหลือ {company.usage.remaining ?? 'ไม่จำกัด'}{company.usage.remaining!==null&&' ใบ'}{company.nextChargeAt&&` · ตัดเงินถัดไป ${time(company.nextChargeAt)}`}</p>
      {company.usage.monthlyAllowance&&<p>{billingMonthlyAllowanceText(company.usage)}</p>}
      <p>แหล่งสิทธิ์ {sourceLabel(company.source)} · ช่องทางซื้อ {company.origin?billingLabel('channel',company.origin):'ยังไม่มีรายการซื้อ'}</p>
      <p>ชำระเงิน {billingLabel('payment',company.paymentState)} · สิทธิ์จากยอดชำระ: {billingLabel('apply',company.applyState)} · {billingLabel('access',company.accessState)}</p>
      {company.graceEndsAt&&<p>ระยะผ่อนผันถึง {time(company.graceEndsAt)}</p>}{company.cancelEffectiveAt&&<p>ยกเลิกมีผล {time(company.cancelEffectiveAt)}</p>}
      <p>สูงสุด {company.branchLimit??'ยังไม่กำหนด'} สาขา · {company.employeeLimit??'ยังไม่กำหนด'} ผู้ใช้ · ใบเสร็จ{company.usage.cadence==='PAID_GRANTS'?'ตามแพ็กเกจที่จ่ายแล้ว':'รายเดือน'}{company.usage.expiresAt&&` · วันหมดอายุใบที่ใกล้ที่สุด ${time(company.usage.expiresAt)}`}</p>
      {company.effectiveCapacity?.temporary&&<p className="rounded-lg border border-emerald-300 p-3">สิทธิ์ชั่วคราว: {billingPlanLabel(company.effectiveCapacity.tierKey)} · {company.effectiveCapacity.branchLimit} สาขา · {company.effectiveCapacity.employeeLimit} ผู้ใช้ ถึง {time(company.effectiveCapacity.temporary.expiresAt)}</p>}

      <p className="text-base text-gray-600">ตรวจล่าสุด {time(company.observedAt)}</p>
      <details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงบริษัท</summary><p className="break-all">เลขบริษัท {company.companyId} · รุ่นข้อมูล {company.version}</p>{company.pendingAttemptId && <p className="break-all">รายการที่กำลังตรวจสอบ {company.pendingAttemptId}</p>}
      {company.pendingPlanChangeId&&<p className="break-all">คำสั่งลดแพ็กเกจ {company.pendingPlanChangeId}</p>}{company.collectionOperationId&&<p className="break-all">คำสั่งจัดการต่ออายุ {company.collectionOperationId}</p>}</details>
      {company.financial === null ? <p>ขอบเขตนี้ไม่มีสิทธิ์ดูรายละเอียดจำนวนเงิน</p> : <div className="space-y-3" aria-label="ประวัติการเงิน">
        {company.financial.invoices.map(i => <article className="rounded-lg bg-gray-50 p-3" key={i.id}><p>{i.number ?? 'ใบแจ้งหนี้ที่ยังไม่มีเลขเอกสาร'} · {money(i.amountSatang)}</p>
          <p>{billingLabel('payment',i.paymentState)} · {billingLabel('apply',i.applyState)} · {time(i.createdAt)}</p>
          <p>ยอดคืนเงินที่ Stripe บันทึก {money(i.refundedSatang)} · {i.disputed ? 'มีข้อพิพาท ต้องตรวจรายกรณี' : i.financialObservedAt ? 'ไม่พบข้อพิพาทจากผลตรวจล่าสุด' : 'ยังไม่ได้ตรวจสถานะการเงิน'} · ตรวจการเงิน {time(i.financialObservedAt)}</p>
          <Link onClick={leaving} className="inline-block underline" href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/invoices/${encodeURIComponent(i.id)}`}>ตรวจการคืนเงินและเอกสารปรับยอด</Link></article>)}
      </div>}
    </section>}
    {!loading && company?.accountId && <Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/apply-invoices`}>ตรวจสิทธิ์จากใบเสร็จเดิม</Link>}
    {!loading&&company?.accountId&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/invoice-scans`}>ตรวจประวัติใบแจ้งหนี้ Stripe</Link>}
    {!loading&&company?.accountId&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/checkouts`}>ตรวจหน้าชำระและรายการค้าง</Link>}
    {!loading&&company?.financial&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/plan-adjustments`}>ปรับแพ็กเกจชั่วคราวและดูประวัติ</Link>}
    {!loading&&company?.financial&&<Link onClick={leaving} className={button} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/receipt-adjustments`}>เพิ่มใบเสร็จและดูประวัติผู้ดูแล</Link>}
    {!loading && company?.accountId && <BillingOperationPanel key={`operation-${company.companyId}`} companyId={company.companyId} companyVersion={company.version} canReconcile={overview?.capabilities.includes('system.billing.reconcile.run')} />}
    {!loading&&company?.accountId&&<Link onClick={leaving} className="inline-block underline" href={`/system/billing/companies/${encodeURIComponent(company.companyId)}/deliveries`}>รายการแจ้งเตือนแพ็กเกจ</Link>}
    {!loading && company && <BillingTimelinePanel key={`timeline-${company.companyId}`} companyId={company.companyId}/>}
    {!loading && issueList && <section aria-label="รายการเคส" className="space-y-3">{issueList.length === 0 && <p>ไม่พบเคสที่ยังเปิดในหน้านี้</p>}
      {issueList.map(i => <article key={i.id} className="rounded-xl border bg-white p-4"><Link onClick={leaving} className="font-semibold underline" href={`/system/billing/issues/${i.id}${queueQuery()}`}>{issueKind(i.kind)}</Link>
        <p className="font-semibold">{i.companyId?i.companyName??'ไม่พบชื่อบริษัท ดูเลขในข้อมูลอ้างอิง':'รายการระดับระบบ'}</p>
        <p>{states[i.state] ?? 'ต้องตรวจสอบสถานะ'} · {i.assigneeUserId ? `${i.assigneeName}${i.assigneeAvailable?'':' · ผู้รับผิดชอบเดิมไม่มีสิทธิ์แล้ว'}` : 'ยังไม่มีผู้รับผิดชอบ'}</p>
        <p>{billingLabel('priority',i.priority)} · รอบปัญหา {i.episode} · {i.overdue?'เลยเวลาติดตาม':effectiveFollowUp(i)?`ติดตาม ${time(effectiveFollowUp(i))}`:'ยังไม่ได้กำหนดเวลาติดตาม'}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงเคส</summary><p className="break-all">{i.companyId&&`เลขบริษัท ${i.companyId} · `}อ้างอิง {i.reference}</p></details></article>)}
      {company && <Link onClick={leaving} href="/system/billing/issues" className="inline-block underline">เปิดคิวทั้งหมด</Link>}
    </section>}
    {!loading && issue && <section className="space-y-4 rounded-xl border bg-white p-5" aria-label="รายละเอียดเคส">
      <p className="font-semibold">{issue.companyId?issue.companyName??'ไม่พบชื่อบริษัท ดูเลขในข้อมูลอ้างอิง':'รายการระดับระบบ'}</p>
      <h2 className="font-bold">{issueKind(issue.kind)}</h2><p>{states[issue.state] ?? 'ต้องตรวจสอบสถานะ'}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงเคส</summary><p>{states[issue.state] ?? 'ต้องตรวจสอบสถานะ'} · เวอร์ชัน {issue.version}</p><p className="break-all">เลขเคส {issue.id} · {issue.kind} · {issue.reference}</p>{issue.companyId&&<p className="break-all">เลขบริษัท {issue.companyId}</p>}</details>
      <p>อัปเดต {time(issue.updatedAt)}</p>{issue.note && <p className="whitespace-pre-wrap">{issue.note}</p>}
      <p>รอบปัญหา {issue.episode} · ตรวจพบล่าสุด {time(issue.lastSeenAt)} · {billingLabel('priority',issue.priority)}</p>
      <p>{issue.assigneeUserId?`ผู้รับผิดชอบ ${issue.assigneeName}${issue.assigneeAvailable?'':' (ไม่มีสิทธิ์แล้ว เลือกคนใหม่หรือคืนคิว)'}`:'ยังไม่มีผู้รับผิดชอบ'}</p>
      <p>{issue.backupUserId?`ผู้สำรอง ${issue.backupName}${issue.backupAvailable?'':' (ไม่มีสิทธิ์แล้ว)'}`:'ยังไม่ได้กำหนดผู้สำรอง'} · {issue.overdue?'เลยเวลาติดตาม · ':''}{effectiveFollowUp(issue)?time(effectiveFollowUp(issue)):'ยังไม่ได้กำหนดเวลาติดตาม'}</p>
      {issue.slaDueAt&&<p>กำหนดจากเกณฑ์ส่วนกลาง {time(issue.slaDueAt)} · เริ่มรอบ {time(issue.slaStartedAt??null)}{issue.followUpAt?' · ใช้เวลาที่ผู้ดูแลกำหนดทับอยู่':''}</p>}
      {issue.kind==='PROVIDER_EVENT_FAILED'&&overview?.platformScope&&<Link onClick={leaving} className="inline-block underline" href={`/system/billing/provider-events/${encodeURIComponent(issue.reference)}`}>ตรวจเหตุการณ์ Stripe เดิมของเคสนี้</Link>}
      {['PROVIDER_SCAN_SCHEDULE_BLOCKED','PROVIDER_SCAN_COVERAGE_GAP'].includes(issue.kind)&&overview?.platformScope&&<Link onClick={leaving} className="inline-block underline" href="/system/billing/provider-scans">ตรวจการตั้งค่าและช่วงเวลาที่ตกหล่น</Link>}
      {['PROVIDER_SCAN_FAILED','PROVIDER_SCAN_VERSION_UNSUPPORTED'].includes(issue.kind)&&overview?.platformScope&&<Link onClick={leaving} className="inline-block underline" href={`/system/billing/provider-scans/${encodeURIComponent(issue.reference)}`}>เปิดงานค้นหาเหตุการณ์ของเคสนี้</Link>}
      {issue.companyId&&['PROVIDER_INVOICE_REVIEW','PROVIDER_INVOICE_SCAN_FAILED'].includes(issue.kind)&&<Link onClick={leaving} className="inline-block underline" href={`/system/billing/companies/${encodeURIComponent(issue.companyId)}/invoice-scans${issue.kind==='PROVIDER_INVOICE_SCAN_FAILED'?`/${encodeURIComponent(issue.reference)}`:''}`}>เปิดงานตรวจใบแจ้งหนี้ของบริษัท</Link>}
      {['SETTLEMENT_REVIEW','SETTLEMENT_SCAN_FAILED'].includes(issue.kind)&&overview?.platformScope&&overview.capabilities.includes('system.billing.financial.read')&&<Link onClick={leaving} className="inline-block underline" href={`/system/billing/settlements/${encodeURIComponent(issue.reference)}`}>เปิดงานตรวจยอดของเคสนี้</Link>}
      {issue.kind === 'CONTROL_OPERATION_REVIEW' && <Link onClick={leaving} className="inline-block underline" href={`/system/billing/${issue.operationType==='REFUND'?'refunds':issue.operationType==='EXPIRE_CHECKOUT'?'checkout-expiry':'operations'}/${encodeURIComponent(issue.reference)}`}>เปิดคำสั่งเดิมของเคสนี้</Link>}
      {issue.kind==='CONFIGURATION_DRIFT'&&overview?.platformScope&&<Link onClick={leaving} className="inline-block underline" href="/system/billing/configuration-checks">ตรวจการเชื่อมต่อ Stripe และประวัติ</Link>}
      {issue.kind==='CONFIGURATION_SCHEDULE_REVIEW'&&overview?.platformScope&&<Link onClick={leaving} className="inline-block underline" href={`/system/billing/configuration-changes/${encodeURIComponent(issue.reference)}`}>ตรวจคำขอตั้งค่าที่รอแก้ไข</Link>}
      {issue.companyId && <Link onClick={leaving} className="inline-block underline" href={`/system/billing/companies/${encodeURIComponent(issue.companyId)}`}>กลับไปบริษัทนี้</Link>}
      {issue.companyId&&issue.kind.startsWith('NOTIFICATION_')&&<Link onClick={leaving} className="block underline" href={`/system/billing/companies/${encodeURIComponent(issue.companyId)}/deliveries`}>ตรวจรายการแจ้งเตือนเดิม</Link>}
      {overview?.capabilities.includes('system.billing.issue.manage') && issue.state !== 'RESOLVED' && <div className="space-y-3">
        <label className="block">ค้นหาผู้รับผิดชอบ<input className="mt-2 block w-full rounded-lg border p-3" maxLength={100} value={operatorSearch} onChange={e=>setOperatorSearch(e.target.value)}/></label>
        <button className={button} disabled={saving} onClick={()=>void findOperators()}>ค้นหาเจ้าหน้าที่ที่มีสิทธิ์</button>
        {(['assignee','backup'] as const).map(kind=><div key={kind}><label htmlFor={`billing-issue-${kind}`} className="block">{kind==='assignee'?'ผู้รับผิดชอบที่เลือก':'ผู้สำรองที่เลือก'}</label>
          <select id={`billing-issue-${kind}`} className="mt-2 block w-full rounded-lg border p-3" value={kind==='assignee'?assignee:backup} onChange={e=>kind==='assignee'?setAssignee(e.target.value):setBackup(e.target.value)}>
            <option value="">ยังไม่กำหนด</option>{[...new Set([assignee,backup,...operators?.items.map(o=>o.id)??[]].filter(Boolean))].map(id=><option key={id} value={id}>{operatorNames[id]??id}</option>)}
          </select></div>)}
        {operators?.nextCursor&&<button className={button} disabled={saving} onClick={()=>void findOperators(operators.nextCursor!)}>รายชื่อผู้รับผิดชอบหน้าถัดไป</button>}
        <label className="block">ความเร่งด่วน<select aria-label="ความเร่งด่วน" className="ml-2 min-h-11 rounded-lg border p-2" value={priority} onChange={e=>setPriority(e.target.value)}><option value="NORMAL">ปกติ</option><option value="HIGH">สูง</option><option value="CRITICAL">เร่งด่วนมาก</option></select></label>
        <label className="block">เวลาติดตามภายใน<input type="datetime-local" className="mt-2 block rounded-lg border p-3" value={followUp} onChange={e=>{setFollowUp(e.target.value);setFollowUpChanged(true);}}/></label>
        {issue.slaDueAt&&<p className="text-base">เว้นว่างเพื่อใช้เกณฑ์ส่วนกลางของรอบนี้ การเปลี่ยนระดับความสำคัญคำนวณจากเวลาเริ่มรอบเดิม</p>}
        <p className="text-base text-gray-600">ใช้ติดตามงานภายใน ไม่ใช่การเปลี่ยนระยะผ่อนผันหรือกำหนดเวลาที่แจ้งลูกค้า</p>
        <label className="block">สถานะ<select aria-label="สถานะ" className="ml-3 min-h-11 rounded-lg border p-2" value={state} onChange={e => setState(e.target.value)}>{Object.entries(states).filter(([key]) => key !== 'RESOLVED').map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
        <div><label className="block" htmlFor="billing-company-note">บันทึกการดำเนินการ</label><textarea id="billing-company-note" className="mt-2 block w-full rounded-lg border p-3" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={saving || !note.trim()} onClick={() => void update('take')}>รับเคสนี้</button>
          <button className={button} disabled={saving || !note.trim()} onClick={() => void update('save')}>บันทึกสถานะ</button><button className={button} disabled={saving||!note.trim()} onClick={()=>void update('return')}>คืนเคสเข้าคิว</button></div>
        <p className="text-base text-gray-600">สถานะเคสแยกจากผลชำระเงินและการเปิดสิทธิ์ การปิดเคสต้องมีผลตรวจยืนยัน</p>
      </div>}
    </section>}
    {issue&&<BillingSupportOutcomesPanel key={issue.id} issue={issue} canManage={Boolean(overview?.capabilities.includes('system.billing.issue.manage'))} onRecorded={()=>setReload(v=>v+1)}/>}
    {nextCursor && <button className={button} disabled={loading} onClick={() => issuesOnly?router.replace(`/system/billing/issues${queueQuery(queue,nextCursor)}`,{scroll:false}):setCursor(nextCursor)}>หน้าถัดไป</button>}
    {cursor && !issueId && <button className={button} disabled={loading} onClick={() => issuesOnly?router.replace(`/system/billing/issues${queueQuery(queue,null)}`,{scroll:false}):setCursor(null)}>หน้าแรก</button>}
    <footer className="border-t pt-4 text-base"><a className="underline" href={`mailto:${PLAN_TERM_CONTACT_EMAIL}`}>ติดต่อผู้ดูแลพร้อมเลขอ้างอิง</a></footer>
  </main>;
}
function sourceLabel(source:BillingOperatorCompanyDetail['source']) { return {TRIAL:'ทดลองใช้ฟรี',MANUAL:'แพ็กเกจที่เจ้าหน้าที่กำหนด',STRIPE:'สิทธิ์จากการชำระผ่าน Stripe',OTHER_BILLING:'สิทธิ์จากบัญชีหรือโหมดชำระเงินอื่น',NONE:'ยังไม่มีข้อมูลแพ็กเกจ'}[source]; }
function localDate(value:string|null) { if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
