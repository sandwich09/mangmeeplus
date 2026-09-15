import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {checkBillingConfiguration} from './billing-configuration-smoke';
import type {BrowserContext} from '@playwright/test';

export async function checkBillingConfigurationDrafts(input:Parameters<typeof checkBillingConfiguration>[0]&{
  approveRequest:Parameters<typeof checkBillingConfiguration>[0]['request'];password:string;adminRoleId:string;secondBrowser?:BrowserContext;
}){
  const {request,approveRequest,browser}=input,db=input.prisma.client,base='/v1/system/billing',ids:string[]=[];
  const settings=()=>request(`${base}/settings`),get=(id:string)=>request(`${base}/configuration-changes/${id}`),initial=(await settings()).body;
  const state=()=>db.billingSettings.findUniqueOrThrow({where:{id:`${input.stripeAccountId}:test`}}),before=await state();
  const grants=await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}});
  const save=(body:any,key:string,actor=request)=>actor(`${base}/configuration-drafts`,'POST',body,{'idempotency-key':key});
  const draftBody={type:'PUBLISH_POLICY',expectedVersion:0,reason:'ร่างที่ยังเชื่อมผู้ให้บริการไม่ครบ',policy:{...initial.policy,portalConfigurationId:null},gates:initial.gates};
  const key=`draft-create-${randomUUID()}`;
  const preview=(draft:any)=>request(`${base}/configuration-changes/preview`,'POST',{type:draft.type,expectedVersion:initial.version,policy:draft.proposed.policy,gates:draft.proposed.gates,
    reason:draft.reason,draftId:draft.id,draftVersion:draft.version});
  const ensureProof=async(actor=request)=>{if(!(await actor(`${base}/settings`)).body.reauthenticatedUntil)assert.equal((await actor(`${base}/reauthenticate`,'POST',{password:input.password})).status,200);};
  const viewport=browser?.page.viewportSize();
  try{
    await db.billingSettings.update({where:{id:before.id},data:{gatesJson:{...initial.gates,portal_change_plan:true}}});
    try {
      const effective=(await settings()).body;assert.equal(effective.gates.portal_change_plan,false);
      for(const action of ['plan_changes','portal_cancel_subscription'])assert.equal(effective.gates[action],initial.gates[action]);
      const blocked={...draftBody,gates:{...initial.gates,portal_change_plan:true}};
      assert.equal((await save(blocked,`unsupported-${randomUUID()}`)).body.code,'CONTROL_ACTION_NOT_SUPPORTED');
      assert.equal((await request(`${base}/configuration-changes/preview`,'POST',{...blocked,expectedVersion:initial.version})).body.code,'CONTROL_ACTION_NOT_SUPPORTED');
      assert.equal((await state()).version,before.version);
    }finally{await db.billingSettings.update({where:{id:before.id},data:{gatesJson:before.gatesJson!,updatedAt:before.updatedAt}});}
    const created=await save(draftBody,key);assert.equal(created.status,200,JSON.stringify(created));let draft=created.body;ids.push(draft.id);
    const legacy=await db.billingOperation.findUniqueOrThrow({where:{id:draft.id}});
    await db.billingOperation.update({where:{id:draft.id},data:{proposedJson:{...(legacy.proposedJson as any),gates:{...initial.gates,portal_change_plan:true}}}});
    draft=(await get(draft.id)).body;assert.equal(draft.proposed.gates.portal_change_plan,false);assert.equal(draft.previewHash,legacy.requestHash);
    assert.equal(draft.state,'DRAFT');assert.equal(draft.impact,null);assert.equal(draft.canEditDraft,true);assert.deepEqual(await state(),before);
    assert.equal((await save(draftBody,key)).body.id,draft.id);assert.equal((await preview(draft)).body.code,'CONTROL_POLICY_NOT_READY');
    assert.equal((await save({...draftBody,reason:'different'},key)).status,409);
    const update={...draftBody,draftId:draft.id,expectedVersion:draft.version,policy:initial.policy,reason:'เติมข้อมูลสำหรับตรวจผลกระทบ'};
    assert.equal((await save(update,`draft-foreign-${randomUUID()}`,approveRequest)).status,403);
    const edits=await Promise.all([save(update,`draft-edit-a-${randomUUID()}`),save({...update,reason:'อีกแท็บแก้พร้อมกัน'},`draft-edit-b-${randomUUID()}`)]);
    assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);draft=edits.find(r=>r.status===200)!.body;
    const editKey=`draft-edit-${randomUUID()}`,edit={...update,expectedVersion:draft.version,reason:'ตรวจสอบฉบับร่างที่บันทึกแล้ว'};
    const edited=await save(edit,editKey);assert.equal(edited.status,200,JSON.stringify(edited));draft=edited.body;
    assert.equal((await save(edit,editKey)).body.version,draft.version);assert.equal((await save({...edit,reason:'reuse key different body'},editKey)).status,409);
    assert.equal((await save(draftBody,key)).body.version,draft.version,'create replay returns current draft without reverting edits');
    await db.membershipRole.delete({where:{membershipId_roleId:{membershipId:input.membershipId,roleId:input.adminRoleId}}});
    try{assert.equal((await save({...edit,expectedVersion:draft.version},`draft-revoked-${randomUUID()}`)).status,403);}
    finally{await db.membershipRole.create({data:{membershipId:input.membershipId,roleId:input.adminRoleId}});}
    assert.deepEqual(await state(),before);
    const projected=await preview(draft);assert.equal(projected.status,200,JSON.stringify(projected));const immutable=projected.body;ids.push(immutable.id);
    const oldPreview=await db.billingOperation.findUniqueOrThrow({where:{id:immutable.id}});
    await db.billingOperation.update({where:{id:immutable.id},data:{proposedJson:{...(oldPreview.proposedJson as any),gates:{...initial.gates,portal_change_plan:true}}}});
    assert.equal((await get(immutable.id)).body.previewHash,oldPreview.requestHash,'compatibility projection preserves historical hash');
    assert.equal(immutable.referenceId,draft.id);assert.equal(immutable.sourceDraftVersion,draft.version);
    const changed=await save({...edit,expectedVersion:draft.version,policy:draftBody.policy},`draft-after-preview-${randomUUID()}`);assert.equal(changed.status,200);draft=changed.body;
    assert.deepEqual((await get(immutable.id)).body.proposed,immutable.proposed,'editing source draft cannot edit immutable preview');
    await ensureProof();await ensureProof(approveRequest);
    const submitted=await request(`${base}/configuration-changes/${immutable.id}/submit`,'POST',{expectedVersion:immutable.version,previewHash:immutable.previewHash},{'idempotency-key':`draft-publish-${immutable.id}`});
    assert.equal(submitted.status,200,JSON.stringify(submitted));assert.equal(submitted.body.state,'AWAITING_APPROVAL');
    const approval={expectedVersion:submitted.body.version,previewHash:submitted.body.previewHash};
    assert.equal((await request(`${base}/configuration-changes/${immutable.id}/approve`,'POST',approval)).status,403);
    assert.equal((await approveRequest(`${base}/configuration-changes/${immutable.id}/approve`,'POST',approval)).body.state,'SUCCEEDED');
    assert.deepEqual((await settings()).body.policy,initial.policy);
    assert.equal(((await state()).gatesJson as any).portal_change_plan,false,'legacy preview cannot enable native Portal plan updates');
    assert.equal((await request(`${base}/configuration-changes/${draft.id}/cancel`,'POST',{expectedVersion:draft.version})).body.state,'CANCELLED');
    assert.equal((await save(draftBody,key)).body.state,'CANCELLED');assert.equal((await save({...edit,expectedVersion:draft.version+1},`draft-closed-${randomUUID()}`)).status,409);
    assert.equal(await db.auditLog.count({where:{targetId:draft.id,action:'billing.configuration.draft_saved',metadataJson:{path:['commandKey'],equals:editKey}}}),1);

    if(browser){const page=browser.page;await page.setViewportSize({width:390,height:844});await page.goto(`${browser.origin}/system/billing/settings`,{waitUntil:'domcontentloaded'});
      await page.getByLabel('ซื้อซ้ำและเปลี่ยนแพ็กเกจ',{exact:true}).waitFor();
      assert.equal(await page.getByRole('checkbox',{name:'เปลี่ยนแพ็กเกจผ่าน Portal',exact:true}).count(),0);
      assert.equal(await page.getByRole('checkbox',{name:'ยกเลิกหรือกลับมาต่ออายุ',exact:true}).count(),1);
      await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).fill('บันทึกและแก้ร่างจากเว็บ');await page.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();
      await page.getByRole('status').filter({hasText:'ฉบับร่างที่บันทึกไว้'}).waitFor();await page.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).click();await page.waitForURL(/\/configuration-changes\//);
      const id=page.url().split('/').at(-1)!;ids.push(id);await page.reload();await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).fill('แก้ร่างหลังโหลดจากรายการเดิม');
      assert.equal(await page.getByRole('button',{name:'ตรวจผลกระทบการตั้งค่า',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'บันทึกฉบับร่าง',exact:true}).click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='ตรวจผลกระทบการตั้งค่า')?.disabled);
      await page.reload();assert.equal(await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).inputValue(),'แก้ร่างหลังโหลดจากรายการเดิม');
      await page.getByRole('button',{name:'ตรวจผลกระทบการตั้งค่า',exact:true}).click();await page.getByRole('status').filter({hasText:'ตรวจผลกระทบก่อนส่ง'}).waitFor();
      await page.getByRole('button',{name:'ส่งคำขอให้ผู้อนุมัติ',exact:true}).click();await page.getByRole('status').filter({hasText:'รอผู้อนุมัติอีกคน'}).waitFor();
      const href=await page.getByRole('link',{name:'เปิดลิงก์คำขอนี้',exact:true}).getAttribute('href');ids.push(href!.split('/').at(-1)!);
      const other=await input.secondBrowser!.newPage();await other.goto(`${browser.origin}${href}`,{waitUntil:'domcontentloaded'});await other.getByRole('button',{name:'อนุมัติและใช้ค่าชุดนี้',exact:true}).click();
      await other.getByRole('status').filter({hasText:'การตั้งค่านี้มีผลแล้ว'}).waitFor();await other.close();
      await page.getByRole('link',{name:/กลับฉบับร่างต้นทาง/}).click();await page.waitForURL(new RegExp(id));await page.reload();
      await page.getByRole('status').filter({hasText:'ฉบับร่างที่บันทึกไว้'}).waitFor();assert.equal(await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).inputValue(),'แก้ร่างหลังโหลดจากรายการเดิม');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${browser.evidenceDir}/admin-configuration-draft-mobile.png`,fullPage:true});
    }
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{companyId:input.companyId},orderBy:{id:'asc'}}),grants);
    return ['admin-configuration-draft-incomplete-provider-save-without-publication','admin-configuration-draft-create-edit-replay-concurrent-version-and-authority',
      'admin-configuration-draft-immutable-preview-independent-publication-and-cancel-no-reactivation',
      'admin-supported-gates-legacy-settings-draft-preview-recovery-and-no-native-portal-enable',
      ...(browser?['browser-admin-draft-save-reload-edit-preview-independent-approve-return-mobile','browser-admin-supported-plan-and-cancel-gates-without-inactive-toggle']:[])];
  }catch(error){
    if(browser){console.error('Draft browser failure:',browser.page.url(),await browser.page.locator('body').innerText());
      const id=browser.page.url().split('/').at(-1);if(id&&/^[a-f0-9-]{36}$/.test(id)){const result=await browser.page.request.get(`${browser.origin}/api${base}/configuration-changes/${id}`);console.error('Draft read facts',result.status(),await result.json());}}
    throw error;
  }finally{
    if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await db.auditLog.deleteMany({where:{targetType:'BillingOperation',targetId:{in:ids}}});await db.billingOperation.deleteMany({where:{id:{in:ids}}});
  }
}

/** Reuse an actual current scoped session proof; never reset the password rate limiter. */
export async function ensureBillingCompanyProof(request:Parameters<typeof checkBillingConfigurationDrafts>[0]['request'],companyId:string,password:string){
  const path=`/v1/system/billing/companies/${companyId}/reauthenticate`,current=await request(path);
  assert.equal(current.status,200,JSON.stringify(current));
  if(!current.body.reauthenticatedUntil)assert.equal((await request(path,'POST',{password})).status,200);
}
