import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BILLING_CONFIGURATION_IMPACT_KINDS } from '@watchdog-bms/contracts';
import type { Prisma } from '../generated/prisma/client';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';

export async function checkBillingConfigurationImpact(input: Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const {request,approveRequest,browser}=input,db=input.prisma.client,base='/v1/system/billing',run=randomUUID(),operations:string[]=[];
  const companies=Array.from({length:27},(_,n)=>({id:`impact-${run}-${n}`,name:`Impact company ${run} ${n}`}));
  const boundary=new Date('2032-01-31T17:00:00.000Z');
  const accounts=companies.map(c=>({id:randomUUID(),companyId:c.id,stripeAccountId:input.stripeAccountId,livemode:false,baseSubscriptionId:`sub_impact${randomUUID().replaceAll('-','')}`,subscriptionState:'active',paidThrough:boundary}));
  const before=(await request(`${base}/settings`)).body;
  const grants=await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}});
  const preview=async(type='SET_ACTION_GATE',policy?:unknown)=>{const s=(await request(`${base}/settings`)).body;const r=await request(`${base}/configuration-changes/preview`,'POST',{
    type,expectedVersion:s.version,policy:policy??s.policy,gates:s.gates,reason:'ตรวจรายชื่อผลกระทบก่อนเปลี่ยนการตั้งค่า'});
    assert.equal(r.status,200,JSON.stringify(r));operations.push(r.body.id);return r.body;};
  const page=(op:any,kind='SUBSCRIPTION',cursor?:string,hash?:string)=>request(`${base}/configuration-changes/${op.id}/affected?${new URLSearchParams({kind,...cursor?{cursor}:{},...hash?{sourceHash:hash}:{}})}`);
  const ensureProof=async(actor=request)=>{if(!(await actor(`${base}/settings`)).body.reauthenticatedUntil)assert.equal((await actor(`${base}/reauthenticate`,'POST',{password:input.password})).status,200);};
  const submit=async(op:any)=>{await ensureProof();const result=await request(`${base}/configuration-changes/${op.id}/submit`,'POST',{
    expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`impact-submit-${op.id}`});assert.equal(result.status,200,JSON.stringify(result));return result.body;};
  const approve=async(op:any)=>{await ensureProof(approveRequest);return approveRequest(`${base}/configuration-changes/${op.id}/approve`,'POST',{expectedVersion:op.version,previewHash:op.previewHash});};
  const viewport=browser?.page.viewportSize();
  try {
    await db.company.createMany({data:companies});await db.billingAccount.createMany({data:accounts});
    await db.billingAccount.create({data:{...accounts[0]!,id:randomUUID(),stripeAccountId:`foreign-${run}`,livemode:true}});
    const original=await preview();assert.match(original.impact.sourceHash,/^[a-f0-9]{64}$/);
    const first=await page(original);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.body.items.length,25);assert.ok(first.body.nextCursor);assert.equal(first.body.matchesPreview,true);
    const second=await page(original,'SUBSCRIPTION',first.body.nextCursor,first.body.sourceHash);assert.equal(second.status,200);assert.equal(second.body.nextCursor,null);
    assert.equal(new Set([...first.body.items,...second.body.items].map(i=>i.reference)).size,original.impact.subscriptions);
    const own=[...first.body.items,...second.body.items].filter(i=>companies.some(c=>c.id===i.companyId));assert.equal(own.length,27);
    assert.ok(own.every(i=>i.boundary===boundary.toISOString()),'UTC boundary survives JSON/SQL projection exactly');
    assert.equal(JSON.stringify(first.body).includes('sub_impact'),false,'read model cannot leak provider subscription IDs');
    assert.equal((await page(original,'SUBSCRIPTION',first.body.nextCursor)).status,409);
    assert.equal((await page(original,'ATTEMPT',first.body.nextCursor,first.body.sourceHash)).status,404);
    assert.equal((await page(original,'SUBSCRIPTION','SUBSCRIPTION:'+randomUUID(),first.body.sourceHash)).status,404);
    assert.equal((await page(original,'unknown')).status,400);
    for(const kind of BILLING_CONFIGURATION_IMPACT_KINDS){const result=await page(original,kind);assert.equal(result.status,200);assert.ok(result.body.items.every((i:{kind:string})=>i.kind===kind));}
    const raw=await db.billingOperation.findUniqueOrThrow({where:{id:original.id}});
    const foreign=await db.billingOperation.create({data:{stripeAccountId:`foreign-${run}`,livemode:true,type:raw.type,proposedJson:raw.proposedJson as Prisma.InputJsonValue,
      sourceVersion:raw.sourceVersion,requestHash:raw.requestHash,expiresAt:raw.expiresAt,reason:raw.reason,initiatorUserId:raw.initiatorUserId}});operations.push(foreign.id);
    assert.equal((await page(foreign)).status,404);
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});
    try{assert.equal((await page(original)).status,403);}finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}

    const waiting=await submit(original);
    await db.billingAccount.delete({where:{id:accounts[0]!.id}});
    await db.billingAccount.create({data:{...accounts[0]!,id:randomUUID()}});
    const replaced=await page(original);assert.equal(replaced.body.matchesPreview,false);assert.notEqual(replaced.body.sourceHash,first.body.sourceHash);
    assert.equal((await page(original,'SUBSCRIPTION',first.body.nextCursor,first.body.sourceHash)).status,409);
    const rejected=await approve(waiting);assert.equal(rejected.body.code,'CONTROL_PREVIEW_STALE');
    assert.equal((await request(`${base}/settings`)).body.version,before.version,'same count identity replacement cannot publish');
    const material=await preview();await db.billingAccount.update({where:{id:accounts[1]!.id},data:{nextChargeAt:new Date('2032-02-01T17:00:00.000Z')}});
    assert.equal((await page(material)).body.matchesPreview,false,'material subscription boundary change invalidates unchanged identities');
    const currentFirst=(await page(material)).body,currentSecond=(await page(material,'SUBSCRIPTION',currentFirst.nextCursor,currentFirst.sourceHash)).body;
    assert.equal([...currentFirst.items,...currentSecond.items].find(i=>i.recordId===accounts[1]!.id).nextChargeAt,'2032-02-01T17:00:00.000Z');
    assert.equal((await approve(await submit(material))).body.code,'CONTROL_PREVIEW_STALE');

    const legacy=await preview(),legacyRow=await db.billingOperation.findUniqueOrThrow({where:{id:legacy.id}}),proposed=legacyRow.proposedJson as any;
    delete proposed.impact.sourceHash;await db.billingOperation.update({where:{id:legacy.id},data:{proposedJson:proposed}});
    assert.equal((await page(legacy)).body.matchesPreview,false);assert.equal((await approve(await submit(legacy))).body.code,'CONTROL_PREVIEW_STALE');

    const policyAfter={...before.policy,consentRevision:`impact-${run}`};
    assert.equal((await approve(await submit(await preview('PUBLISH_POLICY',policyAfter)))).body.state,'SUCCEEDED');
    const staleDraft=await request(`${base}/configuration-drafts`,'POST',{type:'SET_ACTION_GATE',expectedVersion:0,reason:original.reason,...original.proposed},
      {'idempotency-key':`impact-stale-copy-${run}`});
    assert.equal(staleDraft.body.code,'CONTROL_GATE_POLICY_STALE','gate-only copy must not restore a superseded policy');

    if(browser){const p=browser.page;await p.setViewportSize({width:390,height:844});await p.goto(`${browser.origin}/system/billing/configuration-changes/${original.id}`);
      await p.getByRole('link',{name:'เปิดดูรายการที่เกี่ยวข้อง',exact:true}).click();await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).locator('article').first().waitFor();
      assert.equal(await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).locator('article').count(),25);
      await p.getByRole('button',{name:'รายการผลกระทบหน้าถัดไป',exact:true}).click();await p.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='รายการผลกระทบหน้าถัดไป'));
      await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).locator('article').first().waitFor();
      await p.getByRole('button',{name:'โหลดรายการใหม่จากหน้าแรก',exact:true}).click();await p.getByRole('button',{name:'รายการผลกระทบหน้าถัดไป',exact:true}).waitFor();
      await db.billingAccount.update({where:{id:accounts[2]!.id},data:{nextChargeAt:new Date('2032-02-02T17:00:00.000Z')}});
      await p.getByRole('button',{name:'รายการผลกระทบหน้าถัดไป',exact:true}).click();await p.getByRole('alert').filter({hasText:'ข้อมูลเปลี่ยนหรือคำขอหมดอายุ'}).waitFor();
      await p.getByRole('button',{name:'โหลดรายการใหม่จากหน้าแรก',exact:true}).click();await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).locator('article').first().waitFor();
      await p.getByLabel('ประเภทที่ต้องตรวจ',{exact:true}).selectOption('QUOTE');await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).waitFor();
      await p.getByLabel('ประเภทที่ต้องตรวจ',{exact:true}).selectOption('SUBSCRIPTION');await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).locator('article').first().waitFor();
      assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:`${browser.evidenceDir}/admin-configuration-impact-mobile.png`,fullPage:false});
      await p.getByRole('region',{name:'รายการผลกระทบ',exact:true}).getByRole('link').first().click();await p.getByRole('heading',{name:'การชำระเงินของบริษัท',exact:true}).waitFor();await p.goBack();
      await p.getByRole('link',{name:'กลับคำขอการตั้งค่าเดิม',exact:true}).click();await p.getByRole('button',{name:'สร้างฉบับร่างจากคำขอนี้',exact:true}).click();
      await p.getByRole('status').filter({hasText:'ฉบับร่างที่บันทึกไว้'}).waitFor();const draftHref=await p.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');operations.push(draftHref!.split('/').at(-1)!);
      const copy=(await request(`${base}/configuration-changes/${operations.at(-1)}`)).body;
      assert.deepEqual(copy.proposed.policy,policyAfter);assert.deepEqual(copy.proposed.gates,original.proposed.gates);
      assert.equal((await request(`${base}/configuration-changes/${original.id}`)).body.proposed.policy.consentRevision,before.policy.consentRevision);
      await p.getByRole('button',{name:'ตรวจผลกระทบการตั้งค่า',exact:true}).click();await p.getByRole('status').filter({hasText:'ตรวจผลกระทบก่อนส่ง'}).waitFor();
      await p.getByRole('button',{name:'ส่งคำขอให้ผู้อนุมัติ',exact:true}).click();await p.getByRole('status').filter({hasText:'รอผู้อนุมัติอีกคน'}).waitFor();
      const href=await p.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');operations.push(href!.split('/').at(-1)!);
      await ensureProof(approveRequest);const other=await input.secondBrowser!.newPage();await other.goto(`${browser.origin}${href}`);await other.getByRole('button',{name:'อนุมัติและใช้ค่าชุดนี้',exact:true}).click();
      await other.getByRole('status').filter({hasText:'การตั้งค่านี้มีผลแล้ว'}).waitFor();await other.close();
    }else{assert.equal((await approve(await submit(await preview()))).body.state,'SUCCEEDED');}
    assert.deepEqual((await request(`${base}/settings`)).body.gates,before.gates);
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}}),grants);
    return ['admin-configuration-impact-bounded-pages-scope-mode-cursor-redaction-and-utc',
      'admin-configuration-impact-same-count-identity-and-material-change-block-approval',
      'admin-configuration-impact-legacy-preview-readable-and-fresh-review-required',
      'admin-configuration-old-gate-copy-uses-current-policy-without-restoring-superseded-policy',
      ...(browser?['browser-admin-configuration-impact-pagination-stale-copy-review-independent-approval-return-mobile']:[])];
  }catch(error){if(browser)console.error('Impact browser failure:',browser.page.url(),await browser.page.locator('main').last().innerText());throw error;}
  finally{if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.auditLog.deleteMany({where:{targetType:'BillingOperation',targetId:{in:operations}}});await db.billingOperation.deleteMany({where:{id:{in:operations}}});
    await db.billingAccount.deleteMany({where:{companyId:{in:companies.map(c=>c.id)}}});await db.company.deleteMany({where:{id:{in:companies.map(c=>c.id)}}});}
}
