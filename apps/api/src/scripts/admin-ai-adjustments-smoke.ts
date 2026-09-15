import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {PrismaService} from '../common/database/prisma.service';
import type {startBillingBrowser} from './billing-browser-smoke';
import {bangkokMonthKey,runWithCompanyAiBudgetAdmission} from '../modules/line-ai/application/company-ai-usage-meter';

export async function checkAdminAiAdjustments(input:{prisma:PrismaService;companyId:string;userId:string;
  request:(path:string,method?:string,body?:unknown)=>Promise<{status:number;body:any}>;browser?:Awaited<ReturnType<typeof startBillingBrowser>>}):Promise<string[]> {
  const {prisma,companyId,userId,request,browser}=input,db=prisma.client,base=`/v1/system/partners/${companyId}`;
  const historyPath=`${base}/ai-adjustments`,aiPath=`${base}/ai-model`;
  const beforeTerm=await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),beforeGrants=await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}});
  const usage=await request(`${base}/ai-usage`);assert.equal(usage.status,200);
  const first=Math.min(10_000,Math.floor(usage.body.budget.ceilingSatang/4));assert.ok(first>=2);
  const original={monthlyBudgetSatang:first,expectedMonthlyBudgetSatang:usage.body.budget.overrideSatang,reason:'เพิ่มงบให้ร้านตามคำขอ'};
  for(const reason of [undefined,'',' ','x'.repeat(501)]) {
    const response=await request(aiPath,'PUT',{...original,reason});assert.equal(response.status,400);
  }
  assert.equal((await request(aiPath,'PUT',{...original,source:'STRIPE'})).status,400);
  assert.equal((await request(aiPath,'PUT',{...original,expectedMonthlyBudgetSatang:undefined})).status,422);
  assert.equal((await request(aiPath,'PUT',original)).status,200);
  const auditCount=()=>db.auditLog.count({where:{companyId,action:'system.partner_ai_model.update'}});
  const savedCount=await auditCount();
  assert.equal((await request(aiPath,'PUT',original)).status,200);assert.equal(await auditCount(),savedCount);
  assert.equal((await request(aiPath,'PUT',{...original,monthlyBudgetSatang:first*2})).status,409);
  assert.equal((await request(aiPath,'PUT',{...original,expectedMonthlyBudgetSatang:first,monthlyBudgetSatang:first*2,reason:'ปรับงบหลังตรวจยอดล่าสุด'})).status,200);
  const current=await request(historyPath);assert.equal(current.status,200);
  assert.ok(current.body.items.some((row:any)=>row.reason==='ปรับงบหลังตรวจยอดล่าสุด'&&row.actorId===userId&&row.source==='ADMIN_ADJUSTMENT'
    &&row.changes.some((c:any)=>c.field==='monthlyBudgetSatang'&&c.before===first&&c.after===first*2)));
  // The Admin HTTP writer and cost-bearing reader use separate calls; no cache reset in between.
  const monthKey=bangkokMonthKey(),meterConfig={aiMonthlyBudgetSatang:usage.body.budget.defaultSatang} as any;
  await db.companyAiMonthlyUsage.create({data:{companyId,monthKey,costSatang:first*2}});
  let providerStarts=0;
  const admission=()=>runWithCompanyAiBudgetAdmission(prisma,meterConfig,undefined,companyId,async()=>++providerStarts);
  const blocked=await admission();assert.equal(blocked.allowed,false);if(!blocked.allowed)assert.equal(blocked.reason,'exceeded');
  assert.equal(providerStarts,0);
  assert.equal((await request(aiPath,'PUT',{...original,expectedMonthlyBudgetSatang:first*2,monthlyBudgetSatang:first*3})).status,200);
  assert.equal((await admission()).allowed,true);assert.equal(providerStarts,1);
  assert.equal((await request(aiPath,'PUT',{...original,expectedMonthlyBudgetSatang:first*3,monthlyBudgetSatang:first*2})).status,200);
  assert.equal((await admission()).allowed,false);assert.equal(providerStarts,1);
  const foreignId=randomUUID();
  try {
    await db.auditLog.create({data:{id:foreignId,actorUserId:userId,action:'system.partner_ai_model.update',targetType:'company',targetId:`other-${companyId}`,requestId:randomUUID(),result:'SUCCESS'}});
    assert.equal((await request(`${historyPath}?cursor=${foreignId}`)).status,404);
    assert.equal((await request(`${historyPath}?cursor[]=bad`)).status,400);
    const at=new Date();
    await db.auditLog.createMany({data:Array.from({length:27},(_,index)=>({companyId,actorUserId:userId,action:'system.partner_ai_model.update',targetType:'company',targetId:companyId,
      requestId:randomUUID(),result:'SUCCESS' as const,createdAt:at,metadataJson:{source:'ADMIN_ADJUSTMENT',reason:`ประวัติทดสอบ ${index}`,fromMonthlyBudgetSatang:null,toMonthlyBudgetSatang:first,secret:'must-not-cross-history'}}))});
    const ids=new Set<string>();let cursor:string|null=null,pages=0;
    do {
      const page=await request(`${historyPath}${cursor?`?cursor=${cursor}`:''}`);assert.equal(page.status,200);assert.ok(page.body.items.length<=25);
      assert.doesNotMatch(JSON.stringify(page.body),/must-not-cross-history|metadataJson/);
      for(const row of page.body.items){assert.ok(!ids.has(row.id));ids.add(row.id);}
      cursor=page.body.nextCursor;pages++;assert.ok(pages<5);
    }while(cursor);
    assert.ok(pages>=2);assert.equal(ids.size,await db.auditLog.count({where:{targetId:companyId,targetType:'company',result:'SUCCESS',action:{in:['system.partner_ai_model.update','system.partner_ocr_config.update']}}}));
    if(browser){
      const page=browser.page;await page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});
      await page.locator('#ai-monthly-budget').waitFor();
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      await page.getByText('กรุณาระบุเหตุผลที่ปรับงบ AI',{exact:true}).waitFor();
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับงบ AI',exact:true}).fill('เพิ่มงบจากหน้าร้านและตรวจประวัติ');
      await page.locator('#ai-monthly-budget').fill(String(first*3/100));
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      const dialog=page.getByRole('dialog');await dialog.getByText('ตรวจงบ AI ก่อนบันทึก',{exact:true}).waitFor();
      await dialog.getByRole('button',{name:'กลับไปแก้',exact:true}).filter({hasText:'กลับไปแก้'}).click();
      assert.equal((await db.companyAiConfiguration.findUniqueOrThrow({where:{companyId}})).monthlyBudgetSatang,first*2);
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      const changed=page.waitForResponse(r=>r.url().endsWith(aiPath)&&r.request().method()==='PUT');
      await dialog.getByRole('button',{name:'ยืนยันบันทึก',exact:true}).click();assert.equal((await changed).status(),200);
      const history=page.getByRole('region',{name:'ประวัติการปรับ AI',exact:true});
      await history.getByText('เหตุผล: เพิ่มงบจากหน้าร้านและตรวจประวัติ',{exact:true}).waitFor();
      await history.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();
      await history.locator('[data-adjustment-id]').first().waitFor();
      await history.getByRole('button',{name:'หน้าก่อน',exact:true}).click();
      await history.getByText('เหตุผล: เพิ่มงบจากหน้าร้านและตรวจประวัติ',{exact:true}).waitFor();
      await history.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();await history.locator('[data-adjustment-id]').first().waitFor();
      // An intervening Admin write is visible as a conflict, never silently replaced.
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับงบ AI',exact:true}).fill('ตรวจการเปลี่ยนงบพร้อมกัน');
      await page.locator('#ai-monthly-budget').fill(String(first/100));
      assert.equal((await request(aiPath,'PUT',{...original,expectedMonthlyBudgetSatang:first*3,monthlyBudgetSatang:first*2})).status,200);
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      const stale=page.waitForResponse(r=>r.url().endsWith(aiPath)&&r.request().method()==='PUT');
      await dialog.getByRole('button',{name:'ยืนยันบันทึก',exact:true}).click();assert.equal((await stale).status(),409);
      await page.getByText('มีผู้แก้การตั้งค่า AI แล้ว กรุณาโหลดข้อมูลล่าสุดและตรวจสอบก่อนบันทึกใหม่',{exact:true}).waitFor();
      await page.waitForFunction(value=>(document.querySelector('#ai-monthly-budget') as HTMLInputElement)?.value===value,String(first*2/100));
      assert.equal(await page.getByRole('textbox',{name:'เหตุผลที่ปรับงบ AI',exact:true}).inputValue(),'ตรวจการเปลี่ยนงบพร้อมกัน');
      // Deliver the real HTTP write, then lose only its browser response. Retry must not add an audit.
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับงบ AI',exact:true}).fill('ทดสอบคำตอบขาดหายหลังบันทึก');
      await page.locator('#ai-monthly-budget').fill(String(first*3/100));
      const beforeLost=await auditCount();
      await page.route(`**${aiPath}`,async route=>{const response=await route.fetch();assert.equal(response.status(),200);await route.abort('connectionreset');},{times:1});
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      const failed=page.waitForEvent('requestfailed',r=>r.url().endsWith(aiPath));
      await dialog.getByRole('button',{name:'ยืนยันบันทึก',exact:true}).click();await failed;
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).waitFor();
      assert.equal(await auditCount(),beforeLost+1);
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      const replay=page.waitForResponse(r=>r.url().endsWith(aiPath)&&r.request().method()==='PUT');
      await dialog.getByRole('button',{name:'ยืนยันบันทึก',exact:true}).click();assert.equal((await replay).status(),200);
      await history.getByText('เหตุผล: ทดสอบคำตอบขาดหายหลังบันทึก',{exact:true}).waitFor();assert.equal(await auditCount(),beforeLost+1);
      await history.getByRole('button',{name:'หน้าถัดไป',exact:true}).click();await history.locator('[data-adjustment-id]').first().waitFor();
      // Release an old company's successful response after client-side navigation away.
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับงบ AI',exact:true}).fill('บันทึกแล้วออกจากหน้าร้านเดิม');
      await page.locator('#ai-monthly-budget').fill(String(first/100));
      let release!:()=>void,ready!:()=>void,done!:()=>void;
      const held=new Promise<void>(r=>{release=r;}),arrived=new Promise<void>(r=>{ready=r;}),finished=new Promise<void>(r=>{done=r;});
      await page.route(`**${aiPath}`,async route=>{try{const response=await route.fetch();assert.equal(response.status(),200);ready();await held;await route.fulfill({response});}finally{done();}},{times:1});
      await page.getByRole('button',{name:'ตรวจงบก่อนบันทึก',exact:true}).click();
      await dialog.getByRole('button',{name:'ยืนยันบันทึก',exact:true}).click();await arrived;
      try {
        await page.getByRole('link',{name:'กลับไปรายชื่อพาร์ทเนอร์',exact:true}).click();
        await page.waitForURL(`${browser.origin}/system/partners`);
      }finally{release();await finished;}
      assert.equal(await page.getByText(`บันทึกงบ AI ต่อเดือน ${(first/100).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2})} บาท แล้ว`,{exact:true}).count(),0);
      await page.goto(`${browser.origin}/system/partners/${companyId}`,{waitUntil:'domcontentloaded'});
      await history.getByText('เหตุผล: บันทึกแล้วออกจากหน้าร้านเดิม',{exact:true}).waitFor();
      await page.waitForFunction(value=>(document.querySelector('#ai-monthly-budget') as HTMLInputElement)?.value===value,String(first/100));
      await page.reload({waitUntil:'domcontentloaded'});await history.locator('[data-adjustment-id]').first().waitFor();
      await history.evaluate(el=>el.scrollIntoView({block:'start'}));
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.screenshot({path:`${browser.evidenceDir}/admin-ai-adjustments-mobile.png`});
    }
    assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({where:{companyId}}),beforeTerm);
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),beforeGrants);
    return ['admin-ai-reason-source-current-value-and-idempotent-replay','admin-ai-history-25-row-pagination-safe-fields-and-foreign-cursor',
      'admin-ai-current-shared-admission-follows-raised-and-lowered-budget','admin-ai-adjustment-preserves-paid-term-and-receipt-grants',...(browser?['browser-admin-ai-reason-confirm-cancel-save-history-stale-reload-mobile','browser-admin-ai-lost-response-retry-and-late-navigation']:[])];
  }finally{await db.auditLog.deleteMany({where:{id:foreignId}});}
}
