import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { checkBillingConfiguration } from './billing-configuration-smoke';

export async function checkBillingCompanyRead(input: Parameters<typeof checkBillingConfiguration>[0] & {
  delegated: Parameters<typeof checkBillingConfiguration>[0]['request']; targetId: string; companyIds: string[];
}) {
  const { request, delegated, targetId, companyIds, stripeAccountId, browser } = input, client=input.prisma.client;
  const base='/v1/system/billing', [trialId,manualId,paidId]=companyIds as [string,string,string], run=randomUUID(), now=new Date(), end=new Date(now.getTime()+86400000);
  const accounts:string[]=[], invoiceIds:string[]=[], eventIds:string[]=[];
  const viewport=browser?.page.viewportSize();
  try {
    for (const [companyId,tierKey] of [[trialId,'FREE_TRIAL_15'],[manualId,'BASIC_499'],[paidId,'FREE_TRIAL_15']] as const) {
      await client.companyPlanTerm.create({data:{companyId,tierKey,branchLimit:1,employeeLimit:2,monthlySlipLimit:15,termStartAt:now,termEndsAt:end}});
      await client.billingOperatorScope.create({data:{companyId,userId:targetId,stripeAccountId,livemode:false,createdByUserId:input.userIds[0]!}});
    }
    for (const livemode of [false,true]) {
      const account=await client.billingAccount.create({data:{companyId:paidId,stripeAccountId,livemode,subscriptionState:'active',paidThrough:end,observedAt:now}});accounts.push(account.id);
      const invoice=await client.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_${livemode?'SECRET_LIVE':'ScopedTest'}${run}`,
        policyRevisionId:run,offerSnapshot:{offerKey:'STARTER_249',interval:'month'},currency:'thb',totalSatang:livemode?999000:24900,paidSatang:livemode?999000:24900,
        periodStart:now,periodEnd:end,providerStatus:'paid',applyStatus:'HELD',evidenceHash:run}});invoiceIds.push(invoice.id);
      await client.billingProviderEvent.create({data:{stripeAccountId,livemode,eventId:`evt_${randomUUID()}`,eventType:'invoice.paid',objectId:invoice.providerInvoiceId,apiVersion:'synthetic',evidenceHash:run,status:'PROCESSED',processedAt:now}});
      await client.auditLog.create({data:{companyId:paidId,actorUserId:input.userIds[0],action:'billing.invoice.observed',targetType:'BillingInvoice',targetId:invoice.id,
        requestId:run,result:'SUCCESS',metadataJson:{secret:'FORBIDDEN_TIMELINE_PAYLOAD',amount:999000,providerId:invoice.providerInvoiceId}}});
      const event=await client.notificationEvent.create({data:{companyId:paidId,triggerKey:'billing.package_updated',sourceModule:'billing',sourceType:'invoice',sourceId:invoice.id,
        severity:'INFO',title:'FORBIDDEN_TIMELINE_TITLE',body:'FORBIDDEN_TIMELINE_RECIPIENT',dedupKey:`timeline-${invoice.id}`,
        recipients:{create:{companyId:paidId,userId:input.userIds[0]!,recipientReason:'OWNER',deliveries:{create:{companyId:paidId,channel:'LINE',status:'SENT',sentAt:now,providerMessageId:'FORBIDDEN_TIMELINE_PROVIDER'}}}}}});eventIds.push(event.id);
    }
    const issues=await Promise.all(Array.from({length:28},(_,n)=>client.billingIssue.create({data:{companyId:paidId,stripeAccountId,livemode:false,
      kind:'TIMELINE_FIXTURE',referenceId:`timeline-${run}-${n}`,createdAt:now,note:'FORBIDDEN_TIMELINE_NOTE'}})));
    const operation=await client.billingOperation.create({data:{companyId:paidId,stripeAccountId,livemode:false,type:'RECONCILE',state:'SUCCEEDED',sourceVersion:0,
      reason:'FORBIDDEN_TIMELINE_REASON',initiatorUserId:input.userIds[0]!,proposedJson:{},requestHash:run,expiresAt:end,observedAt:now}});
    const before={accounts:await client.billingAccount.count({where:{stripeAccountId}}),invoices:await client.billingInvoice.count({where:{billingAccountId:{in:accounts}}}),
      grants:await client.billingReceiptGrant.count({where:{companyId:{in:companyIds}}})};
    const trial=await delegated(`${base}/companies/${trialId}`);assert.equal(trial.status,200);assert.equal(trial.body.accountId,null);assert.equal(trial.body.source,'TRIAL');
    assert.equal(trial.body.paymentState,'NONE');assert.equal(trial.body.applyState,'NONE');assert.equal(trial.body.usage.remaining,15);assert.equal(trial.body.usage.cadence,'LEGACY_MONTH');
    const manual=(await delegated(`${base}/companies/${manualId}`)).body;assert.equal(manual.source,'MANUAL');assert.equal(manual.paymentState,'NONE');assert.equal(manual.branchLimit,1);
    const paid=(await delegated(`${base}/companies/${paidId}`)).body;assert.equal(paid.accountId,accounts[0]);assert.equal(paid.paymentState,'PAID');assert.equal(paid.applyState,'HELD');assert.equal(paid.accessState,'ACTIVE');assert.equal(paid.source,'TRIAL');
    const owner=(await request(`${base}/companies/${paidId}`)).body;assert.equal(owner.financial.invoices.length,1);assert.equal(owner.financial.invoices[0].amountSatang,24900);
    await client.billingAccount.update({where:{id:accounts[0]!},data:{subscriptionState:'past_due',graceEndsAt:end,cancelAtPeriodEnd:true}});
    const grace=(await delegated(`${base}/companies/${paidId}`)).body;assert.equal(grace.paymentState,'FAILED');assert.equal(grace.graceEndsAt,end.toISOString());assert.equal(grace.cancelEffectiveAt,end.toISOString());
    await client.company.update({where:{id:trialId},data:{status:'DISABLED'}});
    assert.equal((await delegated(`${base}/companies/${trialId}`)).body.accessState,'HELD');
    await client.companyPlanTerm.update({where:{companyId:trialId},data:{termEndsAt:new Date(now.getTime()-1000),termDisabledAt:now}});
    assert.equal((await delegated(`${base}/companies/${trialId}`)).body.accessState,'EXPIRED');
    assert.equal((await delegated(`${base}/overview?search=${trialId}`)).body.companies[0].companyId,trialId);
    assert.equal((await delegated(`${base}/overview?search=${companyIds[3]}`)).body.companies.length,0);
    assert.equal((await delegated(`${base}/overview?cursor=${companyIds[3]}`)).status,404);
    const first=(await request(`${base}/overview?search=Scope%20directory`)).body;assert.equal(first.companies.length,25);assert.ok(first.nextCursor);
    const next=(await request(`${base}/overview?search=Scope%20directory&cursor=${first.nextCursor}`)).body;assert.equal(next.companies.length,1);
    const entries:any[]=[];let cursor:string|null=null;
    do {
      const result:{status:number;body:any}=await delegated(`${base}/companies/${paidId}/timeline${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`);assert.equal(result.status,200,JSON.stringify(result.body));
      assert.equal(result.body.auditIncluded,false);assert.equal(result.body.financialIncluded,false);entries.push(...result.body.items);cursor=result.body.nextCursor;
      assert.ok(entries.length<100,'timeline cursor must progress');
    } while(cursor);
    assert.equal(new Set(entries.map(e=>e.reference)).size,entries.length);assert.equal(entries.filter(e=>e.kind==='ISSUE').length,28);
    assert.equal(entries.filter(e=>e.kind==='INVOICE').length,1);assert.equal(entries.filter(e=>e.kind==='DELIVERY').length,1);assert.equal(entries.filter(e=>e.kind==='PROVIDER_EVENT').length,1);
    assert.ok(entries.every(e=>e.kind!=='AUDIT'&&e.amountSatang===null));assert.doesNotMatch(JSON.stringify(entries),/FORBIDDEN_TIMELINE|SECRET_LIVE|in_ScopedTest/);
    const provider=entries.find(e=>e.kind==='PROVIDER_EVENT');assert.equal(provider.occurredAt,null);assert.ok(provider.observedAt);
    const finance:any[]=[];cursor=null;
    do {const result:{items:any[];nextCursor:string|null}=(await request(`${base}/companies/${paidId}/timeline${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`)).body;finance.push(...result.items);cursor=result.nextCursor;}while(cursor);
    assert.equal(finance.filter(e=>e.kind==='AUDIT').length,1);assert.equal(finance.find(e=>e.kind==='INVOICE').amountSatang,24900);
    assert.equal((await delegated(`${base}/companies/${paidId}/timeline?cursor=${encodeURIComponent(finance.find(e=>e.kind==='AUDIT').reference)}`)).status,404,'audit cursor cannot bypass its permission');
    assert.equal((await delegated(`${base}/companies/${trialId}/timeline?cursor=${encodeURIComponent(entries[0]!.reference)}`)).status,404);
    assert.equal((await delegated(`${base}/companies/${companyIds[3]}/timeline`)).status,404);
    const manualTimeline=(await delegated(`${base}/companies/${manualId}/timeline`)).body.items;
    assert.equal(manualTimeline.length,1);assert.equal(manualTimeline[0].type,'CURRENT_PLAN_TERM');assert.equal(manualTimeline[0].origin,'ERP');
    if(browser) {
      const page=browser.page;await page.setViewportSize({width:390,height:844});
      await page.goto(`${browser.origin}/system/billing`,{waitUntil:'domcontentloaded'});
      await page.getByLabel('ค้นหาบริษัทในขอบเขต',{exact:true}).fill(trialId);await page.getByRole('button',{name:'ค้นหาบริษัท',exact:true}).click();
      const link=page.locator(`a[href="/system/billing/companies/${trialId}"]`);await link.click();await page.waitForURL(`${browser.origin}/system/billing/companies/${trialId}`);
      const summary=page.getByRole('region',{name:'ข้อมูลการชำระเงินบริษัท',exact:true});await summary.getByText(/แหล่งสิทธิ์ ทดลองใช้ฟรี/).waitFor();
      assert.equal(await page.getByRole('button',{name:'ตรวจสอบผลกระทบ',exact:true}).count(),0,'no provider account means no reconcile action');
      await page.getByRole('region',{name:'ประวัติแพ็กเกจและการชำระเงิน',exact:true}).getByText(/แพ็กเกจปัจจุบัน/).waitFor();
      await page.screenshot({path:`${browser.evidenceDir}/admin-trial-mobile.png`,fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.getByRole('link',{name:'บริษัท',exact:true}).click();await page.waitForURL(`${browser.origin}/system/billing`);
      await page.getByLabel('ค้นหาบริษัทในขอบเขต',{exact:true}).fill(paidId);await page.getByRole('button',{name:'ค้นหาบริษัท',exact:true}).click();
      await page.locator(`a[href="/system/billing/companies/${paidId}"]`).click();await page.waitForURL(`${browser.origin}/system/billing/companies/${paidId}`);
      const timeline=page.getByRole('region',{name:'ประวัติแพ็กเกจและการชำระเงิน',exact:true});await timeline.getByRole('button',{name:'ประวัติหน้าถัดไป',exact:true}).click();
      await timeline.locator('article').filter({hasText:finance[25]!.reference}).locator('summary').click();await timeline.getByText(`อ้างอิง ${finance[25]!.reference}`,{exact:true}).waitFor();await timeline.getByRole('button',{name:'ประวัติหน้าแรก',exact:true}).click();
      await timeline.locator('article').filter({hasText:finance[0]!.reference}).locator('summary').click();await timeline.getByText(`อ้างอิง ${finance[0]!.reference}`,{exact:true}).waitFor();
      await timeline.getByRole('link',{name:'เปิดรายการที่เกี่ยวข้อง',exact:true}).first().click();
      await page.waitForURL(/\/system\/billing\/(?:operations|issues)\//);await page.goBack();
      await page.waitForURL(`${browser.origin}/system/billing/companies/${paidId}`);await page.getByRole('button',{name:'โหลดข้อมูลล่าสุด',exact:true}).click();
      await page.getByRole('region',{name:'ข้อมูลการชำระเงินบริษัท',exact:true}).getByText(/ชำระเงิน เรียกเก็บเงินไม่สำเร็จ/).waitFor();
      assert.equal(await page.getByRole('region',{name:'คำสั่งตรวจสอบการชำระเงิน',exact:true}).count(),1,'back/refresh must not retain duplicate operation panels');
      assert.equal(await page.getByRole('region',{name:'ประวัติแพ็กเกจและการชำระเงิน',exact:true}).count(),1);
      await timeline.getByRole('button',{name:'ประวัติหน้าถัดไป',exact:true}).waitFor();await page.screenshot({path:`${browser.evidenceDir}/admin-timeline-mobile.png`,fullPage:true});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    }
    assert.deepEqual({accounts:await client.billingAccount.count({where:{stripeAccountId}}),invoices:await client.billingInvoice.count({where:{billingAccountId:{in:accounts}}}),
      grants:await client.billingReceiptGrant.count({where:{companyId:{in:companyIds}}})},before,'reads never provision a billing account or mutate money/quota');
    assert.equal(await client.billingAccount.count({where:{companyId:{in:[trialId,manualId]}}}),0);
    return ['admin-company-trial-manual-paid-held-grace-and-expiry-provenance','admin-company-scoped-search-stable-pagination-and-read-without-provisioning',
      'admin-timeline-timestamp-ties-mode-scope-financial-audit-and-recipient-redaction',...(browser?['browser-admin-trial-search-no-account-and-mobile','browser-admin-timeline-pages-related-record-back-refresh-and-mobile']:[])];
  } finally {
    if(browser&&viewport)await browser.page.setViewportSize(viewport);
    await client.billingOperatorScope.deleteMany({where:{userId:targetId,companyId:{in:companyIds},stripeAccountId}});
    await client.notificationEvent.deleteMany({where:{id:{in:eventIds}}});
    await client.auditLog.deleteMany({where:{requestId:run}});
    await client.billingOperation.deleteMany({where:{requestHash:run}});
    await client.billingIssue.deleteMany({where:{referenceId:{startsWith:`timeline-${run}-`}}});
    await client.billingProviderEvent.deleteMany({where:{evidenceHash:run}});
    await client.billingInvoice.deleteMany({where:{id:{in:invoiceIds}}});
    await client.billingAccount.deleteMany({where:{id:{in:accounts}}});
    await client.companyPlanTerm.deleteMany({where:{companyId:{in:companyIds}}});
  }
}
