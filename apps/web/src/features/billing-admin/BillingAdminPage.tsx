'use client';
import { billingLeavesPage, billingControl, billingLabel, billingIssueLabel } from '../billing/billing-display';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import BillingSupportOutcomesPanel from './BillingSupportOutcomesPanel';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import BillingCompanyOverview from './BillingCompanyOverview';
import type { BillingOperatorOverview, BillingOperatorCompanyDetail, BillingOperatorIssue, BillingScopeDirectory } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorCode,apiErrorMessage } from '@/common/api/api-error-message';
import BillingCompanyDirectory from './BillingCompanyDirectory';
import BillingIssueDirectory from './BillingIssueDirectory';
import BillingIssueResolutionPanel from './BillingIssueResolutionPanel';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';

const button = billingControl;
const issueKind = billingIssueLabel;
const time = (value: string | null) => value ? formatThaiDateTime(value) : 'ยังไม่มี';
const get = <T,>(path: string) => authedApiFetch<T>(`/system/billing${path}`, { cache: 'no-store', suppressErrorToast: true });
const effectiveFollowUp=(issue:BillingOperatorIssue)=>issue.effectiveFollowUpAt??issue.followUpAt;
const states: Record<string, string> = { OPEN: 'รอรับงาน', ASSIGNED: 'รับงานแล้ว', IN_PROGRESS: 'กำลังดำเนินการ', WAITING_PROVIDER: 'รอผู้ให้บริการ',
  WAITING_APPROVAL: 'รออนุมัติ', WAITING_CUSTOMER: 'รอลูกค้า', VERIFYING: 'ตรวจผล', RESOLVED: 'แก้ไขแล้ว' };
export default function BillingAdminPage({ companyId, issueId, issuesOnly = false, userId }: {
  companyId?: string; issueId?: string; issuesOnly?: boolean; userId: string;
}) {
  const params=useSearchParams(),router=useRouter(),queuePage=Boolean(issuesOnly||issueId);
  const directory = !companyId && !issueId && !issuesOnly;
  const rawDirectoryPage = Number(params.get('page') ?? 1);
  const directoryPage = Number.isSafeInteger(rawDirectoryPage) && rawDirectoryPage > 0 && rawDirectoryPage <= 1_000_000 ? rawDirectoryPage : 1;
  const query = directory ? params.get('search') ?? '' : '';
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
  const [search,setSearch]=useState(query);
  const [requestId,setRequestId]=useState<string|null>(null);
  useEffect(()=>setSearch(query),[query]);
  // Purchase without setup PR E (R-E4): the "เปิดรายการ" link from the support inbox / package-change
  // queue lands here with ?lookup=<ref> and searches automatically, once.
  const initialLookup=directory?params.get('lookup')??'':'';
  const [lookup,setLookup]=useState(initialLookup),[lookupError,setLookupError]=useState('');
  const autoLookedUp=useRef(false);
  async function runLookup(value=lookup) {
    if(!value.trim())return;setLookupError('');
    try{
      const result=await get<{href:string}>(`/lookup?reference=${encodeURIComponent(value.trim())}`);
      router.push(result.href);
    }catch(e){
      const status=(e as {status?:number}).status,code=apiErrorCode(e);
      setLookupError(status===404?'ไม่พบรายการจากเลขอ้างอิงนี้ หรืออยู่นอกบริษัทที่คุณดูแล':code==='BILLING_LOOKUP_TOO_SHORT'?'เลขอ้างอิงต้องมีอย่างน้อย 8 ตัวอักษร':code==='BILLING_LOOKUP_AMBIGUOUS'?'เลขอ้างอิงนี้ตรงหลายรายการ ให้ใช้เลขใบแจ้งหนี้หรือรหัสเต็ม':apiErrorMessage(e));
    }
  }
  useEffect(()=>{
    if(!initialLookup||autoLookedUp.current)return;autoLookedUp.current=true;void runLookup(initialLookup);
  },[initialLookup]); // eslint-disable-line react-hooks/exhaustive-deps
  function changeDirectory(searchValue: string, pageValue = 1) {
    const next = new URLSearchParams();
    if (searchValue.trim()) next.set('search', searchValue.trim());
    if (pageValue > 1) next.set('page', String(pageValue));
    invalidate();
    window.history.replaceState(null, '', `/system/billing${next.size ? `?${next}` : ''}`);
    setReload(value=>value+1);
  }
  function changeQueue(value: string, page: string | null = null) {
    invalidate();
    window.history.replaceState(null, '', `/system/billing/issues${queueQuery(value,page)}`);
    setReload(value=>value+1);
  }
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const detailReads=useRef(0);
  const [refreshing,setRefreshing]=useState(false),[savedMessage,setSavedMessage]=useState('');
  const [note, setNote] = useState(''), [state, setState] = useState('IN_PROGRESS');
  const [assignee,setAssignee]=useState(''),[backup,setBackup]=useState(''),[priority,setPriority]=useState('NORMAL'),[followUp,setFollowUp]=useState(''),[followUpChanged,setFollowUpChanged]=useState(false);
  const [operatorSearch,setOperatorSearch]=useState(''),[operators,setOperators]=useState<BillingScopeDirectory|null>(null),[operatorNames,setOperatorNames]=useState<Record<string,string>>({});
  useEffect(()=>{invalidate();setCursor(null);setNote('');setCompany(null);setIssue(null);setOperators(null);setOperatorNames({});setOperatorSearch('');setAssignee('');setBackup('');setSaving(false);setRefreshing(false);setSavedMessage('');return invalidate;},[companyId,issueId,issuesOnly]);
  useEffect(() => {
    const token=generation.current;let active = true; setLoading(true); setError(''); setRequestId(null);
    const overviewQuery=new URLSearchParams({search:query,page:String(directoryPage)}).toString();
    Promise.all([get<BillingOperatorOverview>(`/overview${!companyId && !issueId && !issuesOnly ? `?${overviewQuery}` : ''}`),
      companyId ? get<BillingOperatorCompanyDetail>(`/companies/${encodeURIComponent(companyId)}${cursor ? `?invoiceCursor=${encodeURIComponent(cursor)}` : ''}`) : null,
      issuesOnly ? get<{ items: BillingOperatorIssue[]; nextCursor: string | null }>(`/issues?${new URLSearchParams({...cursor?{cursor}:{},...queue?{queue}:{}})}`) : null,
      issueId ? get<BillingOperatorIssue>(`/issues/${encodeURIComponent(issueId)}`) : null,
    ]).then(([o, c, q, i]) => { if (active&&token===generation.current) { setOverview(o); setCompany(c); setIssues(q); setIssue(i); if (i) {setState(i.state === 'RESOLVED' ? 'VERIFYING' : i.state);
      setAssignee(i.assigneeUserId??'');setBackup(i.backupUserId??'');setPriority(i.priority);setFollowUp(localDate(i.followUpAt));setFollowUpChanged(false);
      setOperatorNames(names=>({...names,...i.assigneeUserId?{[i.assigneeUserId]:i.assigneeName??i.assigneeUserId}:{},...i.backupUserId?{[i.backupUserId]:i.backupName??i.backupUserId}:{}}));} } })
      .catch((e: unknown) => { if (active&&token===generation.current) {
        const status = (e as { status?: number }).status;
        const reference = (e as {details?:{requestId?:unknown}}).details?.requestId;
        setRequestId(typeof reference === 'string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(reference) ? reference : null);
        if ((!directory && !issuesOnly) || status === 401 || status === 403) setOverview(null);
        setCompany(null); setIssue(null); setIssues(null);
        setError(status === 403 ? 'บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลการชำระเงินที่เลือก' : status === 404 ? 'ไม่พบรายการนี้ หรือบัญชีนี้ไม่มีสิทธิ์ดูรายการ' : status === 401 ? 'กรุณาเข้าสู่ระบบอีกครั้ง' : 'โหลดข้อมูลไม่ได้ กรุณาลองใหม่');
      } }).finally(() => { if (active&&token===generation.current) setLoading(false); });
    return () => { active = false; };
  }, [companyId, issueId, issuesOnly, cursor, reload,query,queue,directoryPage,directory]);
  async function refreshIssue() {
    if (!issueId) return;
    const token=generation.current,read=++detailReads.current;setRefreshing(true);setError('');
    try {
      const [updated,permissions]=await Promise.all([get<BillingOperatorIssue>(`/issues/${encodeURIComponent(issueId)}`),get<BillingOperatorOverview>('/overview')]);
      if(token===generation.current&&read===detailReads.current){
        setOverview(permissions);
        setIssue(current=>current&&current.version>updated.version?current:updated);
        // Rebase untouched fields; keep edits made before or during this read.
        if(issue){
          setState(value=>value===(issue.state==='RESOLVED'?'VERIFYING':issue.state)?(updated.state==='RESOLVED'?'VERIFYING':updated.state):value);
          setAssignee(value=>value===(issue.assigneeUserId??'')?updated.assigneeUserId??'':value);
          setBackup(value=>value===(issue.backupUserId??'')?updated.backupUserId??'':value);
          setPriority(value=>value===issue.priority?updated.priority:value);
          setFollowUp(value=>value===localDate(issue.followUpAt)?localDate(updated.followUpAt):value);
          setOperatorNames(names=>({...names,...updated.assigneeUserId?{[updated.assigneeUserId]:updated.assigneeName??updated.assigneeUserId}:{},...updated.backupUserId?{[updated.backupUserId]:updated.backupName??updated.backupUserId}:{}}));
        }
      }
    } catch(error) {
      if(token===generation.current&&read===detailReads.current){
        const denied=[401,403,404].includes((error as {status?:number}).status??0);
        if(denied){invalidate();setIssue(null);setOverview(null);setRefreshing(false);setSaving(false);}
        setError(denied?'ไม่พบรายการหรือสิทธิ์เข้าถึง กรุณาตรวจบัญชีที่เข้าสู่ระบบ':'โหลดสถานะล่าสุดไม่ได้ กรุณาลองอีกครั้ง ข้อมูลที่กำลังกรอกยังอยู่');
      }
    } finally {if(token===generation.current&&read===detailReads.current)setRefreshing(false);}
  }
  async function findOperators(cursor?:string) {
    if(!issue||saving)return;const token=generation.current;setSaving(true);setError('');
    try{const result=await get<BillingScopeDirectory>(`/issues/${issue.id}/operators?${new URLSearchParams({search:operatorSearch,...cursor?{cursor}:{}})}`);
      if(token===generation.current){setOperators(result);setOperatorNames(names=>({...names,...Object.fromEntries(result.items.map(i=>[i.id,i.name]))}));}
    }catch{if(token===generation.current)setError('โหลดผู้รับผิดชอบไม่ได้ กรุณาตรวจสิทธิ์และลองค้นหาใหม่');}finally{if(token===generation.current)setSaving(false);}
  }
  async function update(action: 'take'|'save'|'return') {
    if (!issue || saving || (action!=='take' && !note.trim())) return;
    const token=generation.current;++detailReads.current;setRefreshing(false);setSaving(true);setSavedMessage('');setError('');
    try {
      const updated = await authedApiFetch<BillingOperatorIssue>(`/system/billing/issues/${issue.id}`, { method: 'PATCH', suppressErrorToast: true,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedVersion: issue.version, state: action==='take' ? 'ASSIGNED' : action==='return'?'OPEN':state,
          note: action==='take' ? 'รับเรื่องเพื่อตรวจและแก้ปัญหาการชำระเงิน' : note.trim(), assigneeUserId: action==='take' ? userId : action==='return'?null:assignee||null,
          backupUserId:action==='return'?null:action==='take'?(issue.backupUserId===userId?null:issue.backupUserId):backup||null,priority:action==='take'?issue.priority:priority,...action!=='take'&&followUpChanged?{followUpAt:followUp?new Date(followUp).toISOString():null}:{} }) });
      if(token===generation.current){
        // PATCH omits detail-only source links. Preserve them and other panels' drafts.
        setIssue(current=>current&&current.version>updated.version?current:{...current,...updated});
        setState(current=>current===state?updated.state:current);
        setAssignee(current=>current===assignee?updated.assigneeUserId??'':current);
        setBackup(current=>current===backup?updated.backupUserId??'':current);
        setOperatorNames(names=>({...names,...updated.assigneeUserId?{[updated.assigneeUserId]:updated.assigneeName??updated.assigneeUserId}:{}}));
        if(action!=='take')setNote(current=>current===note?'':current);
        setSavedMessage(action==='take'?'รับเรื่องแล้ว':action==='return'?'คืนเรื่องแล้ว':'บันทึกสถานะแล้ว');
      }
    } catch(error) { if(token===generation.current)setError(apiErrorCode(error)==='BILLING_RATE_LIMIT'||(error as {status?:number})?.status===429?apiErrorMessage(error):apiErrorCode(error)==='CONTROL_SLA_REVIEW'?'ไม่พบเกณฑ์เวลาเดิม กรุณาระบุเวลาติดตามก่อนเปลี่ยนระดับความสำคัญ':'ยังบันทึกไม่ได้ กรุณาโหลดข้อมูลล่าสุดและตรวจสอบเคสก่อนบันทึกอีกครั้ง'); }
    finally { if(token===generation.current)setSaving(false); }
  }
  const nextCursor = issueId ? null : company ? company.financial?.nextCursor : issues ? issues.nextCursor : overview?.nextCursor;
  const refresh = () => { if(issueId&&issue){void refreshIssue();return;} invalidate(); setReload(value => value + 1); };
  const tabClass = (active: boolean) => `inline-flex min-h-14 items-center border-b-2 px-1 text-base font-semibold ${active ? 'border-brand-700 text-brand-800' : 'border-transparent text-gray-600 hover:text-gray-900'}`;
  return <main className="mx-auto max-w-7xl space-y-6 break-words p-4 sm:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-sm text-gray-500">ดูแลลูกค้า</p><h1 className="text-2xl font-semibold text-gray-900">{issueId ? 'แก้ปัญหาการชำระเงิน' : companyId ? 'การชำระเงินของบริษัท' : issuesOnly ? 'ปัญหาการชำระเงิน' : 'แพ็กเกจและการชำระเงิน'}</h1>
        {directory && <p className="mt-2 text-base text-gray-600">ดูแพ็กเกจ สถานะชำระเงิน และสิทธิ์ใช้งานของแต่ละบริษัท</p>}
        {issuesOnly && <p className="mt-2 max-w-2xl text-base text-gray-600">ติดตามปัญหาการชำระเงินและการเปิดสิทธิ์ลูกค้า เช่น จ่ายแล้วแต่ยังใช้งานไม่ได้</p>}</div>
      {overview && <p className={`rounded-lg border px-3 py-2 text-sm ${overview.mode === 'LIVE' ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{billingLabel('mode',overview.mode)}</p>}
    </header>
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-gray-200">
      <nav aria-label="ส่วนงานการชำระเงิน" className="flex flex-wrap gap-5">
        <Link onClick={leaving} href="/system/billing" aria-current={!queuePage ? 'page' : undefined} className={tabClass(!queuePage)}>บริษัท</Link>
        <Link onClick={leaving} href={`/system/billing/issues${queueQuery()}`} aria-current={queuePage ? 'page' : undefined} className={tabClass(queuePage)}>ปัญหาการชำระเงิน</Link>
        {overview?.platformScope && overview.capabilities.includes('system.billing.financial.read') && overview.mode !== 'DISABLED' && <Link onClick={leaving} href="/system/billing/settlements" className={tabClass(false)}>ตรวจยอดรับเงิน</Link>}
      </nav>
      <div className="flex flex-wrap items-center gap-3 pb-2">
        {overview && overview.mode !== 'DISABLED' && <details className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false; }} onKeyDown={event => { if(event.key==='Escape') { event.currentTarget.open=false; event.currentTarget.querySelector('summary')?.focus(); } }}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 [&::-webkit-details-marker]:hidden">ตรวจสอบกับ Stripe <span aria-hidden="true">⌄</span></summary>
          <div className="absolute left-0 z-20 mt-2 w-72 sm:left-auto sm:right-0 max-w-[calc(100vw-2rem)] space-y-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
            <Link onClick={leaving} href="/system/billing/batches" className="block rounded-lg p-3 hover:bg-gray-50"><span className="font-medium text-gray-900">ตรวจสถานะหลายบริษัท</span><span className="mt-1 block text-sm text-gray-600">เทียบข้อมูลกับ Stripe และจัดการรายการค้างหลังยืนยัน</span></Link>
            {overview.platformScope && <Link onClick={leaving} href="/system/billing/provider-events" className="block rounded-lg p-3 hover:bg-gray-50"><span className="font-medium text-gray-900">ประวัติแจ้งสถานะจาก Stripe</span><span className="mt-1 block text-sm text-gray-600">ดูสถานะที่ Stripe ส่งมา และรายการที่ประมวลผลไม่สำเร็จ</span></Link>}
          </div>
        </details>}
        {overview?.platformScope && <Link onClick={leaving} href="/system/billing/settings" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-gray-600 hover:underline">ตั้งค่าการชำระเงิน</Link>}
        {overview?.platformScope && <Link onClick={leaving} href="/system/billing/campaigns" className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-gray-600 hover:underline">แคมเปญโปรโมชั่น</Link>}
        {overview?.canManageScopes && <Link onClick={leaving} href="/system/billing/operator-scopes" className="inline-flex min-h-11 items-center px-2 text-sm text-gray-600 hover:underline">สิทธิ์เจ้าหน้าที่</Link>}
      </div>
    </div>
    {!directory && !issuesOnly && <>
      {loading && <p role="status">กำลังโหลดข้อมูล…</p>}
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800"><p>{error}</p>{requestId && <p className="mt-2 break-all text-sm">เลขอ้างอิงสำหรับตรวจสอบภายใน: {requestId}</p>}</div>}
      {(!companyId&&!issueId || error) && <button className={button} disabled={loading || saving || refreshing} aria-busy={Boolean(loading || saving || refreshing)} onClick={refresh}>{issueId ? 'ลองโหลดอีกครั้ง' : 'โหลดข้อมูลล่าสุด'}</button>}
    </>}
    {directory && <BillingCompanyDirectory overview={overview} loading={loading} error={error} requestId={requestId} search={search} query={query} page={directoryPage}
      onSearchChange={setSearch} onSearch={()=>changeDirectory(search)} onClear={()=>{setSearch('');changeDirectory('');}} onPage={page=>changeDirectory(query,page)} onReload={refresh} leaving={leaving}
      lookup={lookup} onLookupChange={setLookup} onLookup={()=>void runLookup()} lookupError={lookupError} />}
    {issuesOnly && <BillingIssueDirectory items={issues?.items ?? []} loading={loading} error={error} requestId={requestId}
      queue={queue} cursor={queueCursor} nextCursor={issues?.nextCursor ?? null} disabled={overview?.mode === 'DISABLED'} scoped={Boolean(overview && !overview.platformScope)}
      onFilter={value=>changeQueue(value)} onPage={cursor=>changeQueue(queue,cursor)} onReload={refresh}
      issueHref={id=>`/system/billing/issues/${encodeURIComponent(id)}${queueQuery()}`} leaving={leaving} />}
    {company && company.companyId===companyId && <BillingCompanyOverview key={company.companyId} company={company} overview={overview} loading={loading} cursor={cursor} onPage={setCursor} onRefresh={refresh} leaving={leaving} />}
    {!loading && issue && <section className="space-y-5 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-label="รายละเอียดเคส">
      <Link onClick={leaving} className="inline-flex min-h-11 items-center text-brand-800 underline" href={`/system/billing/issues${queueQuery()}`}>กลับรายการปัญหา</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-gray-600">{issue.companyId?issue.companyName??'บริษัทของรายการนี้':'รายการระดับระบบ'}</p>
        <h2 className="mt-1 text-xl font-semibold text-gray-900">{issueKind(issue.kind)}</h2></div>
        <span role="status" aria-label="สถานะปัญหา" className={`rounded-lg px-3 py-2 text-sm font-medium ${issue.state==='RESOLVED'?'bg-brand-50 text-brand-800':'bg-amber-50 text-amber-900'}`}>{states[issue.state] ?? 'ต้องตรวจสอบสถานะ'}</span></div>
      <p className="text-sm text-gray-600">{issue.assigneeUserId?`ผู้รับผิดชอบ ${issue.assigneeName}${issue.assigneeAvailable?'':' (ไม่มีสิทธิ์แล้ว)'}`:'ยังไม่มีคนรับเรื่อง'} · {issue.overdue?'เกินกำหนดติดตาม · ':''}{effectiveFollowUp(issue)?`ติดตามภายใน ${time(effectiveFollowUp(issue))}`:'ยังไม่ได้กำหนดเวลาติดตาม'}</p>
      {overview && <BillingIssueResolutionPanel sourceIssueQuery={queueQuery()} issue={issue} overview={overview} onRefresh={refresh} refreshing={refreshing} leaving={leaving} />}
      <details className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">ผู้รับผิดชอบและบันทึกติดตาม</summary>
      <div className="space-y-4 pt-3">
      <p className="text-gray-600">ใช้จดงานที่ทำและนัดติดตาม การบันทึกส่วนนี้ไม่เปลี่ยนยอดเงินหรือสิทธิ์ลูกค้า</p>
      {issue.note && <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4">บันทึกล่าสุด: {issue.note}</p>}
      {overview?.capabilities.includes('system.billing.issue.manage') && issue.state !== 'RESOLVED' && <div className="space-y-3">
        {!issue.assigneeUserId && <button className={button} disabled={saving} aria-busy={saving} onClick={() => void update('take')}>รับเรื่องนี้</button>}
        <details className="rounded-lg border border-gray-200 p-3"><summary className="min-h-11 cursor-pointer py-2 font-medium text-gray-700">เปลี่ยนผู้รับผิดชอบ</summary><div className="space-y-3 pt-2"><p className="text-gray-600">ใช้เมื่อต้องส่งต่อให้เจ้าหน้าที่คนอื่น หากดูแลคนเดียว ใช้ปุ่มรับเรื่องได้เลย</p>
        <label className="block">ค้นหาผู้รับผิดชอบ<input className="mangmee-input mt-2 block w-full !text-base" maxLength={100} value={operatorSearch} onChange={e=>setOperatorSearch(e.target.value)}/></label>
        <button className={button} disabled={saving} aria-busy={Boolean(saving)} onClick={()=>void findOperators()}>ค้นหาเจ้าหน้าที่ที่มีสิทธิ์</button>
        {(['assignee','backup'] as const).map(kind=><div key={kind}><label htmlFor={`billing-issue-${kind}`} className="block">{kind==='assignee'?'ผู้รับผิดชอบที่เลือก':'ผู้สำรองที่เลือก'}</label>
          <ThemedSelect aria-label={kind==='assignee'?'ผู้รับผิดชอบที่เลือก':'ผู้สำรองที่เลือก'} id={`billing-issue-${kind}`} className="mangmee-input mt-2 block w-full !text-base" value={kind==='assignee'?assignee:backup} onChange={e=>kind==='assignee'?setAssignee(e.target.value):setBackup(e.target.value)}>
            <option value="">ยังไม่กำหนด</option>{[...new Set([assignee,backup,...operators?.items.map(o=>o.id)??[]].filter(Boolean))].map(id=><option key={id} value={id}>{operatorNames[id]??id}</option>)}
          </ThemedSelect></div>)}
        {operators?.nextCursor&&<button className={button} disabled={saving} aria-busy={Boolean(saving)} onClick={()=>void findOperators(operators.nextCursor!)}>รายชื่อผู้รับผิดชอบหน้าถัดไป</button>}
        </div></details>
        <label className="block">ความเร่งด่วน<ThemedSelect aria-label="ความเร่งด่วน" className="mangmee-input mt-2 min-h-11 w-full !text-base" value={priority} onChange={e=>setPriority(e.target.value)}><option value="NORMAL">ปกติ</option><option value="HIGH">สูง</option><option value="CRITICAL">เร่งด่วนมาก</option></ThemedSelect></label>
        <label className="block">เวลาติดตามภายใน<input type="datetime-local" className="mangmee-input mt-2 block max-w-full !text-base" value={followUp} onChange={e=>{setFollowUp(e.target.value);setFollowUpChanged(true);}}/></label>
        {issue.slaDueAt&&<p className="text-base">เว้นว่างเพื่อใช้เกณฑ์ส่วนกลางของรอบนี้ การเปลี่ยนระดับความสำคัญคำนวณจากเวลาเริ่มรอบเดิม</p>}
        <p className="text-base text-gray-600">ใช้ติดตามงานภายใน ไม่ใช่การเปลี่ยนระยะผ่อนผันหรือกำหนดเวลาที่แจ้งลูกค้า</p>
        <label className="block">สถานะ<ThemedSelect aria-label="สถานะ" className="mangmee-input mt-2 min-h-11 w-full !text-base" value={state} onChange={e => setState(e.target.value)}>{Object.entries(states).filter(([key]) => key !== 'RESOLVED').map(([key, text]) => <option key={key} value={key}>{text}</option>)}</ThemedSelect></label>
        <div><label className="block" htmlFor="billing-company-note">บันทึกการดำเนินการ</label><textarea id="billing-company-note" className="mangmee-input mt-2 block w-full !text-base" value={note} maxLength={1000} onChange={e => setNote(e.target.value)} /></div>
        <div className="flex flex-wrap gap-2">{issue.assigneeUserId && issue.assigneeUserId!==userId && <button className={button} disabled={saving} aria-busy={Boolean(saving)} onClick={() => void update('take')}>รับผิดชอบด้วยตัวเอง</button>}
          <button className={button} disabled={saving || !note.trim()} aria-busy={Boolean(saving)} onClick={() => void update('save')}>บันทึกสถานะ</button><button className={button} disabled={saving||!note.trim()} aria-busy={Boolean(saving)} onClick={()=>void update('return')}>คืนเรื่องให้คนอื่นรับต่อ</button></div>
        {savedMessage&&<p role="status" className="text-brand-800">{savedMessage}</p>}
        <p className="text-base text-gray-600">สถานะเคสแยกจากผลชำระเงินและการเปิดสิทธิ์ การปิดเคสต้องมีผลตรวจยืนยัน</p>
      </div>}
      <p className="text-sm text-gray-500">อัปเดต {time(issue.updatedAt)} · {billingLabel('priority',issue.priority)} · รอบปัญหา {issue.episode}</p>
      </div></details>
      <details open={Boolean(params.get('outcome'))} className="border-t border-gray-100 pt-2"><summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">ประวัติการติดต่อและบันทึกเพิ่มเติม</summary>
        <BillingSupportOutcomesPanel key={issue.id} issue={issue} canManage={Boolean(overview?.capabilities.includes('system.billing.issue.manage'))} onRecorded={refreshIssue}/></details>
      <details className="border-t border-gray-100 pt-2 text-sm text-gray-500"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงสำหรับตรวจสอบภายใน</summary><p className="mb-2">เลขปัญหาใช้ค้นประวัติในมั่งมี ส่วนรายการต้นทางใช้ตามกลับไปยังรายการที่เกิดปัญหา ระบบเชื่อมให้แล้ว ไม่ต้องกรอกเอง</p><p className="break-all">เลขปัญหา {issue.id} · {issue.kind} · อ้างอิง {issue.reference}</p><p>{states[issue.state] ?? 'ต้องตรวจสอบสถานะ'} · เวอร์ชัน {issue.version}</p><p>ตรวจพบล่าสุด {time(issue.lastSeenAt)}</p>
        {issue.slaDueAt&&<p>กำหนดจากเกณฑ์ส่วนกลาง {time(issue.slaDueAt)} · เริ่มรอบ {time(issue.slaStartedAt??null)}{issue.followUpAt?' · ใช้เวลาที่ผู้ดูแลกำหนดทับอยู่':''}</p>}</details>
    </section>}
    {!directory && !companyId && !issuesOnly && nextCursor && <button className={button} disabled={loading} aria-busy={Boolean(loading)} onClick={() => setCursor(nextCursor)}>หน้าถัดไป</button>}
    {!directory && !companyId && !issuesOnly && cursor && !issueId && <button className={button} disabled={loading} aria-busy={Boolean(loading)} onClick={() => setCursor(null)}>หน้าแรก</button>}
  </main>;
}
function localDate(value:string|null) { if(!value)return '';const date=new Date(value);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
