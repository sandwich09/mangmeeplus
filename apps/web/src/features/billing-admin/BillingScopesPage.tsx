'use client';
import { billingApprovalLabel, billingControl, billingLabel, billingPermissionLabel } from '../billing/billing-display';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingOperatorScopeView, BillingScopeChange, BillingScopeDirectory } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import { apiErrorMessage } from '@/common/api/api-error-message';
const base='/system/billing', button=billingControl;
const get=<T,>(path:string)=>authedApiFetch<T>(base+path,{cache:'no-store',suppressErrorToast:true});
const post=<T,>(path:string,body:unknown,key?:string)=>authedApiFetch<T>(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:JSON.stringify(body),suppressErrorToast:true});
const date=(value:string|null)=>value?new Date(value).toLocaleString('th-TH'):'ไม่กำหนดวันหมดอายุ';
const states:Record<string,string>={PREVIEW:'ตรวจสอบขอบเขตก่อนยืนยัน',AWAITING_APPROVAL:'รอยืนยันรายการ',SUCCEEDED:'บันทึกขอบเขตแล้ว',CANCELLED:'ยกเลิกคำขอแล้ว'};
export default function BillingScopesPage({operationId}:{operationId?:string}) {
  const [scopes,setScopes]=useState<{items:BillingOperatorScopeView[];nextCursor:string|null}|null>(null),[changes,setChanges]=useState<{items:BillingScopeChange[];nextCursor:string|null}|null>(null);
  const [change,setChange]=useState<BillingScopeChange|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [cursor,setCursor]=useState(''),[changesCursor,setChangesCursor]=useState(''),[reload,setReload]=useState(0),[password,setPassword]=useState('');
  const [userId,setUserId]=useState(''),[companyId,setCompanyId]=useState(''),[reason,setReason]=useState(''),[expiry,setExpiry]=useState(''),[permanent,setPermanent]=useState(false);
  const [directories,setDirectories]=useState<Record<string,BillingScopeDirectory>>({}),[search,setSearch]=useState({companies:'',operators:''});
  const load=useCallback(()=>{setReload(v=>v+1);},[]);
  useEffect(()=>{let active=true;setError('');
    Promise.all([get<{items:BillingOperatorScopeView[];nextCursor:string|null}>(`/operator-scopes${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`),
      get<{items:BillingScopeChange[];nextCursor:string|null}>(`/scope-changes${changesCursor?`?cursor=${encodeURIComponent(changesCursor)}`:''}`),operationId?get<BillingScopeChange>(`/scope-changes/${operationId}`):null])
      .then(([s,c,op])=>{if(active){setScopes(s);setChanges(c);if(op)setChange(op);}})
      .catch(()=>{if(active){setScopes(null);setChanges(null);setChange(null);setError('โหลดขอบเขตไม่ได้ ตรวจสอบสิทธิ์ผู้ดูแลระบบหรือเข้าสู่ระบบใหม่แล้วลองอีกครั้ง');}});
    return()=>{active=false;};
  },[cursor,changesCursor,reload,operationId]);
  async function act(work:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await work();}catch(cause){setError(apiErrorMessage(cause));}finally{setBusy(false);}}
  const directory=(kind:'companies'|'operators',cursor?:string)=>act(async()=>{const data=await get<BillingScopeDirectory>(`/scope-directory/${kind}?search=${encodeURIComponent(search[kind])}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);setDirectories(d=>({...d,[kind]:data}));if(kind==='operators')setUserId('');else setCompanyId('');});
  const preview=(type:'GRANT_SCOPE'|'REVOKE_SCOPE',scope?:BillingOperatorScopeView)=>act(async()=>{setChange(await post<BillingScopeChange>('/scope-changes/preview',{
    type,userId:scope?.userId??userId,companyId:scope?.companyId??companyId,expiresAt:type==='REVOKE_SCOPE'||permanent?null:new Date(expiry).toISOString(),reason}));});
  return <main className="mx-auto max-w-5xl space-y-5 break-words p-4 sm:p-8">
    <h1 className="text-2xl font-bold">บริษัทที่เจ้าหน้าที่การชำระเงินดูแล</h1>
    <nav className="flex flex-wrap gap-3"><Link className={button} href="/system/billing">กลับหน้าดูแลการชำระเงิน</Link><Link className={button} href="/system/billing/operator-scopes">รายการขอบเขตทั้งหมด</Link></nav>
    <p>เลือกบริษัทที่เจ้าหน้าที่ดูแลได้ สิทธิ์ทำงานยังเป็นไปตามบทบาทเดิม ผู้ดูแลระบบตรวจและยืนยันเพิ่มขอบเขตได้เอง การถอนขอบเขตไม่ลบผู้ใช้หรือข้อมูลบริษัท</p>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-3">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={load}>โหลดข้อมูลล่าสุด</button>
    {!scopes&&!error&&<p role="status">กำลังโหลดขอบเขต…</p>}
    {scopes&&<>
      <section className="space-y-3 rounded-xl border bg-white p-5" aria-label="ยืนยันตัวตนผู้ดูแล">
        <label className="block">รหัสผ่านปัจจุบัน<input className="mt-2 block w-full rounded-lg border p-3" type="password" autoComplete="current-password" maxLength={1024} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button className={button} disabled={busy||!password} aria-busy={Boolean(busy)} onClick={()=>void act(async()=>{const proof=await post<{reauthenticatedUntil:string}>('/reauthenticate',{password});setPassword('');setNotice(`ยืนยันตัวตนถึง ${date(proof.reauthenticatedUntil)}`);})}>ยืนยันตัวตนก่อนเปลี่ยนขอบเขต</button>
      </section>
      {!operationId&&<section className="space-y-4 rounded-xl border bg-white p-5" aria-label="เพิ่มขอบเขตเจ้าหน้าที่">
        <h2 className="text-lg font-bold">เพิ่มหรือปรับระยะเวลาขอบเขต</h2>
        {(['operators','companies'] as const).map(kind=><div key={kind} className="space-y-2">
          <label className="block">{kind==='operators'?'ค้นหาเจ้าหน้าที่':'ค้นหาบริษัท'}<input className="mt-1 block w-full rounded-lg border p-3" value={search[kind]} maxLength={100} onChange={e=>{setSearch(s=>({...s,[kind]:e.target.value}));setDirectories(d=>({...d,[kind]:{items:[],nextCursor:null}}));if(kind==='operators')setUserId('');else setCompanyId('');}}/></label>
          <button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void directory(kind)}>{kind==='operators'?'ค้นหารายชื่อเจ้าหน้าที่':'ค้นหารายชื่อบริษัท'}</button>
          {directories[kind]&&<><label className="block" htmlFor={`billing-scope-${kind}`}>{kind==='operators'?'เจ้าหน้าที่ที่เลือก':'บริษัทที่เลือก'}</label><select id={`billing-scope-${kind}`} className="mt-1 block w-full rounded-lg border p-3" value={kind==='operators'?userId:companyId} onChange={e=>kind==='operators'?setUserId(e.target.value):setCompanyId(e.target.value)}><option value="">กรุณาเลือก</option>{directories[kind]!.items.map(i=><option key={i.id} value={i.id}>{i.name} · {i.id}</option>)}</select>
            {!directories[kind]!.items.length&&<p>ไม่พบรายการ ลองเปลี่ยนคำค้น</p>}{directories[kind]!.nextCursor&&<button className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void directory(kind,directories[kind]!.nextCursor!)}>รายชื่อหน้าถัดไป</button>}</>}
        </div>)}
        <label className="block">หมดอายุขอบเขต<input type="datetime-local" className="mt-1 block rounded-lg border p-3" disabled={permanent} value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={permanent} onChange={e=>setPermanent(e.target.checked)}/>ยืนยันให้ขอบเขตนี้โดยไม่กำหนดวันหมดอายุ</label>
        <button className={button} disabled={busy||!userId||!companyId||!reason.trim()||(!permanent&&!expiry)} aria-busy={Boolean(busy)} onClick={()=>void preview('GRANT_SCOPE')}>ตรวจผลกระทบการให้ขอบเขต</button>
      </section>}
      <div><label className="block" htmlFor="billing-scope-reason">เหตุผลการเปลี่ยนขอบเขต</label><textarea id="billing-scope-reason" className="mt-2 block w-full rounded-lg border p-3" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></div>
      {change&&<section className="space-y-3 rounded-xl border-2 border-green-700 bg-white p-5" aria-label="คำขอขอบเขต">
        <h2 role="status" className="font-bold">{states[change.state]??billingLabel('operation',change.state)}</h2><p>{billingLabel('mode',change.mode)} · {change.userName} · {change.companyName}</p>
        <p>{change.type==='GRANT_SCOPE'?'ให้/ปรับขอบเขต':'ถอนขอบเขตทันทีเมื่อยืนยัน'} · เดิม {change.current?billingLabel('scope',change.current.state):'ยังไม่มีขอบเขต'} · {change.type==='GRANT_SCOPE'?date(change.scopeExpiresAt):'ไม่มีสิทธิ์ผ่านขอบเขตนี้หลังถอน'}</p>
        <p>สิทธิ์ตามบทบาทปัจจุบัน: {change.capabilities.map(billingPermissionLabel).join(' · ')||'ไม่มี'}</p><p>เหตุผล: {change.reason}</p><p>ตรวจได้ถึง {date(change.expiresAt)}</p><details><summary className="min-h-11 cursor-pointer py-2">ข้อมูลอ้างอิงคำขอ</summary><p>เลขอ้างอิง {change.id} · เวอร์ชัน {change.version}</p><p>{change.capabilities.join(", ")}</p></details>
        {change.approvalMode&&<p>{billingApprovalLabel(change.approvalMode)}</p>}
        <p>ผู้ดูแลระบบยืนยันคำขอของตนเองได้ โดยต้องตรวจข้อมูลและยืนยันรหัสผ่านก่อน</p>
        <div className="flex flex-wrap gap-3">{change.allowedActions.map(action=><button key={action} className={button} disabled={busy} aria-busy={Boolean(busy)} onClick={()=>void act(async()=>{
          const result=await post<BillingScopeChange>(`/scope-changes/${change.id}/${action}`,{expectedVersion:change.version,previewHash:change.previewHash},action==='submit'?`billing-scope-${change.id}`:undefined);setChange(result);load();
        })}>{action==='submit'?(change.type==='GRANT_SCOPE'?'บันทึกคำขอก่อนยืนยัน':'ยืนยันถอนขอบเขต'):action==='approve'?'อนุมัติขอบเขตนี้':'ยกเลิกคำขอนี้'}</button>)}</div>
        <Link className="inline-block underline" href={`/system/billing/scope-changes/${change.id}`}>เปิดคำขอขอบเขตนี้</Link>
      </section>}
      <section className="space-y-3" aria-label="ขอบเขตปัจจุบัน"><h2 className="text-lg font-bold">ขอบเขตปัจจุบัน</h2>
        {scopes.items.map(scope=><article key={scope.id} className="space-y-2 rounded-xl border bg-white p-4"><p>{billingLabel('mode',scope.mode)} · {scope.userName} · {scope.companyName}</p><p>{billingLabel('scope',scope.state)} · {date(scope.expiresAt)} · เวอร์ชัน {scope.version}</p>
          {scope.state!=='REVOKED'&&<button className={button} disabled={busy||!reason.trim()} aria-busy={Boolean(busy)} onClick={()=>void preview('REVOKE_SCOPE',scope)}>ตรวจถอนขอบเขต {scope.companyName}</button>}</article>)}
        {!scopes.items.length&&<p>ยังไม่มีขอบเขตในหน้านี้</p>}{scopes.nextCursor&&<button className={button} onClick={()=>setCursor(scopes.nextCursor!)}>ขอบเขตหน้าถัดไป</button>}{cursor&&<button className={button} onClick={()=>setCursor('')}>ขอบเขตหน้าแรก</button>}
      </section>
      <section className="space-y-3" aria-label="ประวัติคำขอขอบเขต"><h2 className="text-lg font-bold">คำขอและรายการรออนุมัติ</h2>{changes?.items.map(op=><p key={op.id}><Link className="underline" href={`/system/billing/scope-changes/${op.id}`}>{op.companyName} · {op.userName} · {states[op.state]??billingLabel('operation',op.state)}</Link></p>)}
        {changes?.nextCursor&&<button className={button} onClick={()=>setChangesCursor(changes.nextCursor!)}>คำขอหน้าถัดไป</button>}{changesCursor&&<button className={button} onClick={()=>setChangesCursor('')}>คำขอหน้าแรก</button>}
      </section>
    </>}
  </main>;
}
