import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { checkBillingConfigurationDrafts } from './billing-configuration-drafts-smoke';
import { hashPassword } from '../modules/auth/domain/logic/password-credential.logic';

/** Configuration and identity proof only; no refund dispatch is implemented by this check. */
export async function checkBillingRefundControls(input:Parameters<typeof checkBillingConfigurationDrafts>[0]) {
  const {request,approveRequest,browser,stripeAccountId,password}=input,db=input.prisma.client,base='/v1/system/billing',run=randomUUID();
  const cases:string[]=[],settings=async()=>(await request(`${base}/settings`)).body,initial=await settings(),viewport=browser?.page.viewportSize();
  const accountIds=(await db.billingAccount.findMany({where:{stripeAccountId},select:{id:true}})).map(row=>row.id);
  const financial=async()=>({invoices:await db.billingInvoice.findMany({where:{billingAccountId:{in:accountIds}},orderBy:{id:'asc'}}),grants:await db.billingReceiptGrant.findMany({where:{billingAccountId:{in:accountIds}},orderBy:{id:'asc'}})});
  const before=await financial();let providerWrites=0;
  input.transport(async(url,init)=>{if(url.hostname==='api.stripe.com'&&init?.method&&init.method!=='GET'){providerWrites++;throw Error('No financial mutation in refund controls proof');}return undefined;});
  const preview=async(limit:unknown,enabled=false)=>{const s=await settings();return request(`${base}/configuration-changes/preview`,'POST',{
    type:'PUBLISH_POLICY',expectedVersion:s.version,policy:{...s.policy,refundLimitSatang:limit},gates:{...s.gates,refunds:enabled},reason:'ทดสอบวงเงินคืนเงินโดยไม่คืนเงินจริง'});};
  const proof=async(actor=request)=>{if(!(await actor(`${base}/settings`)).body.reauthenticatedUntil)assert.equal((await actor(`${base}/reauthenticate`,'POST',{password})).status,200);};
  const submit=async(op:any)=>{await proof();const r=await request(`${base}/configuration-changes/${op.id}/submit`,'POST',{expectedVersion:op.version,previewHash:op.previewHash},{'idempotency-key':`refund-control-${op.id}`});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  const approve=async(op:any)=>{await proof(approveRequest);const r=await approveRequest(`${base}/configuration-changes/${op.id}/approve`,'POST',{expectedVersion:op.version,previewHash:op.previewHash});assert.equal(r.status,200,JSON.stringify(r));return r.body;};
  let targetRoleId:string|null=null,targetMemberId:string|null=null;
  const targetId=`refund-proof-${run}`,targetCompanyId=`refund-company-${run}`,foreignCompanyId=`refund-foreign-${run}`;
  try {
    assert.equal(initial.policy.refundLimitSatang==null,true);assert.equal(initial.gates.refunds,false);
    for(const value of [0,-1,0.5,2147483648,'24900',true])assert.equal((await preview(value)).status,400);
    assert.equal((await preview(null,true)).body.code,'CONTROL_REFUND_CONFIG_REQUIRED');
    cases.push('refund-controls-legacy-closed-integer-bounds-and-no-unapproved-limit');
    await proof();await proof(approveRequest);
    if(browser){
      const p=browser.page;await p.setViewportSize({width:390,height:844});await p.goto(`${browser.origin}/system/billing/settings`,{waitUntil:'domcontentloaded'});
      const limit=p.getByLabel('วงเงินคืนเงินสูงสุดต่อคำขอ (บาท)',{exact:true});await limit.fill('249.001');
      await p.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).fill('กำหนดวงเงินคืนเงินจำลองที่ต้องอนุมัติทีละคำขอ');
      await p.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();assert.equal(await limit.evaluate(node=>(node as HTMLInputElement).validity.valid),false);
      await limit.fill('249.01');await p.getByLabel('รับคำขอคืนเงินที่ต้องอนุมัติ',{exact:true}).check();
      await p.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();await p.getByRole('status').filter({hasText:'ฉบับร่างที่บันทึกไว้'}).waitFor();
      const draftHref=await p.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');assert.ok(draftHref);
      await p.goto(`${browser.origin}${draftHref}`,{waitUntil:'domcontentloaded'});await limit.waitFor();assert.equal(await limit.inputValue(),'249.01');
      await p.getByRole('button',{name:'ตรวจผลกระทบการตั้งค่า',exact:true}).click();await p.getByRole('region',{name:'ผลต่อวงเงินคืนเงิน',exact:true}).waitFor();
      await p.getByRole('button',{name:'ส่งคำขอให้ผู้อนุมัติ',exact:true}).click();await p.getByRole('status').filter({hasText:'รอผู้อนุมัติอีกคน'}).waitFor();
      const href=await p.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');assert.ok(href);
      const waiting=(await request(`${base}/configuration-changes/${href.split('/').at(-1)}`)).body;
      assert.equal((await request(`${base}/configuration-changes/${waiting.id}/approve`,'POST',{expectedVersion:waiting.version,previewHash:waiting.previewHash})).status,403);
      const other=input.secondBrowser!.pages()[0]!;await other.goto(`${browser.origin}${href}`,{waitUntil:'domcontentloaded'});
      await other.getByRole('button',{name:'อนุมัติและใช้ค่าชุดนี้',exact:true}).click();await other.getByRole('status').filter({hasText:'การตั้งค่านี้มีผลแล้ว'}).waitFor();
      await other.reload({waitUntil:'domcontentloaded'});await other.getByRole('region',{name:'ผลต่อวงเงินคืนเงิน',exact:true}).waitFor();
      assert.equal(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await other.screenshot({path:`${browser.evidenceDir}/admin-refund-limit-mobile.png`,fullPage:true});
      cases.push('browser-refund-limit-precision-draft-reload-impact-independent-approval-mobile');
    }else{const p=await preview(24901,true);assert.equal(p.status,200,JSON.stringify(p));await approve(await submit(p.body));}
    const enabled=await settings();assert.equal(enabled.policy.refundLimitSatang,24901);assert.equal(enabled.gates.refunds,true);
    assert.equal(enabled.policyRevisionId===initial.policyRevisionId,false);
    const closed=await request(`${base}/settings/emergency-close`,'POST',{gates:{...enabled.gates,refunds:false},expectedVersion:enabled.version,reason:'ปิดรับคำขอคืนเงินจำลอง'},{'idempotency-key':`refund-close-${run}`});
    assert.equal(closed.status,200,JSON.stringify(closed));const afterClose=await settings();assert.equal(afterClose.gates.refunds,false);assert.equal(afterClose.policy.refundLimitSatang,24901);
    for(const key of Object.keys(enabled.gates).filter(key=>key!=='refunds'))assert.equal(afterClose.gates[key],enabled.gates[key]);
    const off=await preview(null,false);assert.equal(off.status,200);await approve(await submit(off.body));
    assert.equal((await settings()).policy.refundLimitSatang,null);cases.push('refund-controls-approved-revision-emergency-close-and-cleared-limit-without-restart');

    await db.company.createMany({data:[{id:targetCompanyId,name:'บริษัททดสอบขอบเขตการเงิน'},{id:foreignCompanyId,name:'บริษัทนอกขอบเขต'}]});
    const keys=['system.billing.read','system.billing.financial.read','system.billing.refund.manage','account.session.read'];
    const permissions=await db.permission.findMany({where:{key:{in:keys}}});assert.equal(permissions.length,4);
    const role=await db.role.create({data:{key:`REFUND_PROOF_${run}`,scopeKey:'system',isSystem:true,name:'Synthetic scoped Finance',permissions:{create:permissions.map(row=>({permissionId:row.id}))}}});targetRoleId=role.id;
    await db.user.create({data:{id:targetId,displayName:'เจ้าหน้าที่การเงินจำลอง'}});input.userIds.push(targetId);
    await db.userCredential.create({data:{userId:targetId,passwordHash:hashPassword(password)}});
    const member=await db.companyMembership.create({data:{userId:targetId,companyId:input.companyId,roles:{create:{roleId:role.id}}}});targetMemberId=member.id;await input.recordLegal(targetId,member.id);
    const sid=randomUUID(),token=input.signToken(sid,targetId);await db.authSession.create({data:{userId:targetId,tokenId:sid,expiresAt:new Date(Date.now()+3600000)}});
    const delegated:typeof request=(path,method,body)=>request(path,method,body,{authorization:`Bearer ${token}`});
    const scope=await db.billingOperatorScope.create({data:{userId:targetId,companyId:targetCompanyId,stripeAccountId,livemode:false,createdByUserId:input.userIds[0]!}});
    const path=`${base}/companies/${targetCompanyId}/reauthenticate`;
    assert.equal((await delegated(path)).body.reauthenticatedUntil,null);
    assert.equal((await delegated(`${base}/companies/${foreignCompanyId}/reauthenticate`,'POST',{password})).status,404);
    assert.equal((await delegated(path,'POST',{password:'wrong'})).status,403);
    const accepted=await delegated(path,'POST',{password});assert.equal(accepted.status,200,JSON.stringify(accepted));assert.ok(accepted.body.reauthenticatedUntil);
    assert.deepEqual(Object.keys(accepted.body),['reauthenticatedUntil']);assert.ok((await delegated(path)).body.reauthenticatedUntil);
    const audit=await db.auditLog.findFirstOrThrow({where:{companyId:targetCompanyId,actorUserId:targetId,action:'billing.reauthenticated'}});
    assert.equal(JSON.stringify(audit).includes(password),false);
    assert.equal((await delegated(`${base}/settings`)).status,403);assert.equal((await delegated(`${base}/reauthenticate`,'POST',{password})).status,403);
    assert.equal(await db.companyMembership.count({where:{userId:targetId,companyId:targetCompanyId}}),0);
    assert.equal(await db.billingAccount.count({where:{companyId:targetCompanyId}}),0);
    cases.push('refund-scoped-password-proof-without-company-membership-or-platform-settings-access');
    const identity={roleId:role.id,permissionId:permissions.find(row=>row.key==='system.billing.refund.manage')!.id};
    await db.rolePermission.delete({where:{roleId_permissionId:identity}});assert.equal((await delegated(path)).status,403);await db.rolePermission.create({data:identity});
    const readCredential=db.userCredential.findUnique.bind(db.userCredential);let revoke=true;
    db.userCredential.findUnique=(async(...args:Parameters<typeof db.userCredential.findUnique>)=>{const result=await readCredential(...args);if(revoke&&result?.userId===targetId){revoke=false;await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:new Date()}});}return result;}) as unknown as typeof db.userCredential.findUnique;
    try{assert.equal((await delegated(path,'POST',{password})).status,404);}finally{db.userCredential.findUnique=readCredential;await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:null}});}
    await db.userCredential.update({where:{userId:targetId},data:{updatedAt:new Date(Date.now()+1000)}});assert.equal((await delegated(path)).body.reauthenticatedUntil,null);
    cases.push('refund-scoped-proof-rechecks-withdrawn-authority-and-current-credential-version');
    assert.deepEqual(await financial(),before);assert.equal(providerWrites,0);cases.push('refund-controls-never-mutate-invoices-grants-or-provider-money');return cases;
  }catch(error){if(browser){console.error(JSON.stringify({stage:'refund-controls',path:new URL(browser.page.url()).pathname,completed:cases,alerts:await browser.page.getByRole('alert').allTextContents()}));await browser.page.screenshot({path:`${browser.evidenceDir}/refund-controls-failure.png`,fullPage:true});}throw error;
  }finally{
    input.transport();await db.billingOperatorScope.deleteMany({where:{userId:targetId}});
    if(targetMemberId){await db.membershipRole.deleteMany({where:{membershipId:targetMemberId}});await db.companyMembership.delete({where:{id:targetMemberId}});}
    if(targetRoleId)await db.role.delete({where:{id:targetRoleId}});
    await db.company.deleteMany({where:{id:{in:[targetCompanyId,foreignCompanyId]}}});if(browser&&viewport)await browser.page.setViewportSize(viewport);
  }
}
