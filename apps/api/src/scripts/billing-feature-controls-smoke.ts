import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {ALL_FEATURE_ENTITLEMENT_KEYS,FEATURE_PACKAGE_PRESETS} from '@watchdog-bms/contracts';
import {EXPLICIT_COHORT,NORMALIZER_VERSION} from '../modules/employee-access/application/normalize-entitlements';
import type {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';

/** Explicit synthetic company, actual Admin HTTP/PG/browser commands; no provider or launch-gate changes. */
export async function checkBillingFeatureControls(input:Parameters<typeof checkBillingConfigurationDrafts>[0],companyId:string){
  const {request,browser}=input,db=input.prisma.client,path=`/v1/system/partners/${companyId}`,cases:string[]=[];
  const starter=new Set<string>(FEATURE_PACKAGE_PRESETS.starter.featureKeys);
  const rows=ALL_FEATURE_ENTITLEMENT_KEYS.map(featureKey=>({companyId,featureKey,enabled:starter.has(featureKey)}));
  await db.companyFeatureEntitlement.createMany({data:rows});
  await db.companyEntitlementSet.create({data:{companyId}});
  await db.companyEntitlementNormalization.create({data:{companyId,status:'COMPLETED',snapshotHash:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),runId:randomUUID(),cohortKind:EXPLICIT_COHORT,normalizerVersion:NORMALIZER_VERSION,completedAt:new Date()}});
  const state=()=>db.companyEntitlementSet.findUniqueOrThrow({where:{companyId}});
  const enabled=async()=> (await db.companyFeatureEntitlement.findMany({where:{companyId,enabled:true}})).map(r=>r.featureKey).sort();
  const change=async(features:Array<{featureKey:string;enabled:boolean}>,extra:Record<string,unknown>={})=>request(`${path}/features`,'PUT',{features,commandId:randomUUID(),expectedSetVersion:(await state()).setVersion,...extra});
  try{
    assert.equal((await request(path)).status,200);assert.deepEqual(await enabled(),[...starter].sort());
    const start=(await state()).setVersion;
    const foundation=await change([{featureKey:'company_settings',enabled:false}]);assert.equal(foundation.status,422,JSON.stringify(foundation));assert.equal(foundation.body.code,'platform_feature_not_disableable');
    await db.companyEntitlementNormalization.update({where:{companyId},data:{status:'STARTED'}});
    const pending=await change([{featureKey:'expenses.list',enabled:false}]);assert.equal(pending.status,409,JSON.stringify(pending));assert.equal(pending.body.code,'company_entitlement_normalization_pending');
    if(browser){await browser.page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});await browser.page.getByText('ระบบกำลังเตรียมสิทธิ์ให้ ไม่ต้องดำเนินการ',{exact:true}).waitFor();assert.equal(await browser.page.getByRole('button',{name:'เริ่มต้น',exact:true}).isDisabled(),true);}
    await db.companyEntitlementNormalization.update({where:{companyId},data:{status:'COMPLETED'}});
    assert.equal((await state()).setVersion,start);assert.deepEqual(await enabled(),[...starter].sort());
    cases.push('admin-feature-foundation-and-normalization-refusal-no-partial-write-with-browser-disabled-exit');
    const commandId=randomUUID(),payload={features:[{featureKey:'expenses.list',enabled:false}],commandId,expectedSetVersion:start};
    const saved=await request(`${path}/features`,'PUT',payload);assert.equal(saved.status,200,JSON.stringify(saved));
    assert.equal((await request(`${path}/features`,'PUT',payload)).status,200);
    assert.equal((await change([{featureKey:'expenses.upload',enabled:false}],{expectedSetVersion:start})).status,409);
    assert.equal((await change([{featureKey:'expenses.upload',enabled:false}],{commandId})).status,409);
    assert.equal((await state()).setVersion,start+1);assert.equal(await db.entitlementCommand.count({where:{companyId,commandId}}),1);
    cases.push('admin-feature-child-off-current-set-version-original-replay-stale-admin-and-key-reuse-safe');
    if(browser){const page=browser.page,url=`${browser.origin}/system/partners/${companyId}`;await page.setViewportSize({width:390,height:844});await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.getByRole('button',{name:'เริ่มต้น',exact:true}).click();
      assert.equal((await enabled()).includes('expenses.list'),false); // Selecting a preset is a local preview only.
      await page.getByRole('button',{name:'ตรวจสอบและบันทึก',exact:true}).click();await page.getByRole('dialog',{name:'ตรวจสอบการเปลี่ยนแปลงแพ็กเกจ',exact:true}).waitFor();
      const sent:any[]=[];await page.route(`**${path}/features`,async route=>{sent.push(route.request().postDataJSON());const r=await route.fetch();assert.equal(r.status(),200);await route.abort('connectionreset');},{times:1});
      const failed=page.waitForEvent('requestfailed',r=>r.url().endsWith(`${path}/features`));await page.getByRole('button',{name:'ยืนยันและบันทึก',exact:true}).click();await failed;
      await page.getByText('การเชื่อมต่อขาดหาย กดบันทึกอีกครั้งได้ ระบบจะไม่ทำรายการซ้ำ',{exact:true}).waitFor();
      await page.getByRole('button',{name:'ตรวจสอบและบันทึก',exact:true}).click();const replay=page.waitForResponse(r=>r.url().endsWith(`${path}/features`));await page.getByRole('button',{name:'ยืนยันและบันทึก',exact:true}).click();const response=await replay;assert.equal(response.status(),200);assert.deepEqual(response.request().postDataJSON(),sent[0]);
      await page.getByText(/บันทึกแพ็กเกจแล้ว/).waitFor();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'แพ็กเกจการใช้งาน',exact:true}).waitFor();
      assert.deepEqual(await enabled(),[...starter].sort());assert.equal((await state()).setVersion,start+2);assert.equal(await db.entitlementCommand.count({where:{companyId,commandId:sent[0].commandId}}),1);
      const audit=await db.auditLog.findMany({where:{targetId:companyId,action:'system.partner_feature.update'}});assert.equal(audit.filter(r=>(r.metadataJson as any)?.commandId===sent[0].commandId).length,1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.getByRole('heading',{name:'แพ็กเกจการใช้งาน',exact:true}).evaluate(el=>scrollTo(0,el.getBoundingClientRect().top+scrollY-90));await page.screenshot({path:`${browser.evidenceDir}/admin-feature-preset-mobile.png`});
      cases.push('browser-admin-starter-preset-preview-review-lost-response-identical-replay-reload-17-keys');
    }else assert.equal((await change([{featureKey:'expenses.list',enabled:true}])).status,200);
    const dependent=['procurement','procurement.vendor_bills','procurement.supplier_payments','procurement.ap_aging'];
    assert.equal((await change(dependent.map(featureKey=>({featureKey,enabled:true})))).status,200);
    const before=(await state()).setVersion;
    const cascade=await change([{featureKey:'procurement.vendor_bills',enabled:false}]);assert.equal(cascade.status,422,JSON.stringify(cascade));assert.equal(cascade.body.code,'feature_cascade_confirmation_required');assert.equal((await state()).setVersion,before);
    const off=await change([{featureKey:'procurement.vendor_bills',enabled:false}],{confirmCascade:true});assert.equal(off.status,200,JSON.stringify(off));assert.equal((await enabled()).some(key=>dependent.slice(1).includes(key)),false);
    assert.equal((await change(dependent.map(featureKey=>({featureKey,enabled:false})))).status,200);assert.deepEqual(await enabled(),[...starter].sort());
    cases.push('admin-feature-dependency-cascade-explicit-confirm-and-preserved-starter-access');
    return cases;
  }finally{await db.auditLog.deleteMany({where:{targetId:companyId,action:'system.partner_feature.update'}});}
}
