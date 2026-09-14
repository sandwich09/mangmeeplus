import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { checkBillingCompanyRead } from './billing-company-read-smoke';

export async function checkBillingHistoryExport(input:Parameters<typeof checkBillingCompanyRead>[0]) {
  const {prisma,request,delegated,targetId,companyIds,browser}=input,db=prisma.client,companyId=companyIds[2]!;
  const base=`/v1/system/billing/companies/${companyId}/timeline`,permissionKeys=['system.billing.export','system.billing.financial.read','system.billing.audit.read'];
  const membership=await db.companyMembership.findFirstOrThrow({where:{userId:targetId,status:'ACTIVE'},include:{roles:{include:{role:true}}}});
  const role=membership.roles.find(r=>r.role.key.startsWith('BILLING_SCOPES_'))!.role;
  const permissions=await db.permission.findMany({where:{key:{in:permissionKeys}}});assert.equal(permissions.length,3);
  const grant=async(key:string)=>{const identity={roleId:role.id,permissionId:permissions.find(p=>p.key===key)!.id};await db.rolePermission.upsert({where:{roleId_permissionId:identity},create:identity,update:{}});};
  const revoke=async(key:string)=>db.rolePermission.deleteMany({where:{roleId:role.id,permissionId:permissions.find(p=>p.key===key)!.id}});
  const exportPage=(cursor?:string,asFinance=false)=>(asFinance?request:delegated)(`${base}/export`,'POST',cursor?{cursor}:{});
  const originalName=(await db.company.findUniqueOrThrow({where:{id:companyId}})).name,unsafeName='=HYPERLINK("https://example.test")\nบริษัททดสอบ';
  const accountIds=(await db.billingAccount.findMany({where:{companyId},select:{id:true}})).map(row=>row.id);
  const invoiceWhere={billingAccountId:{in:accountIds}};
  const financialBefore=await db.billingInvoice.findMany({where:invoiceWhere,orderBy:{id:'asc'}});
  const grantBefore=await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}});
  const captured:string[]=[];
  try {
    assert.equal((await exportPage()).status,403,'read permission alone does not grant export');
    await grant('system.billing.export');
    await db.company.update({where:{id:companyId},data:{name:unsafeName}});
    const page=(await delegated(base)).body;
    assert.equal(page.canExport,true);assert.ok(page.nextCursor);
    const limited=await exportPage();assert.equal(limited.status,200,JSON.stringify(limited.body));
    assert.equal(limited.body.financialIncluded,false);assert.equal(limited.body.auditIncluded,false);
    assert.ok(limited.body.csv.startsWith('\uFEFF'));assert.match(limited.body.csv,/"'=HYPERLINK\(""https:\/\/example.test""\)\nบริษัททดสอบ"/);
    assert.doesNotMatch(limited.body.csv,/ยอดเอกสาร \(บาท\)|249\.00|AUDIT:|FORBIDDEN_TIMELINE|SECRET_LIVE|in_ScopedTest/);
    assert.equal(limited.body.sha256,createHash('sha256').update(limited.body.csv).digest('hex'));
    assert.ok(limited.body.rowCount>0&&limited.body.rowCount<=25);captured.push('history-export-read-export-scope-and-safe-thai-csv-without-financial-or-audit');
    await grant('system.billing.financial.read');
    const financial=await exportPage();assert.equal(financial.status,200);assert.equal(financial.body.auditIncluded,false);
    assert.match(financial.body.csv,/ยอดเอกสาร \(บาท\)/);assert.match(financial.body.csv,/249\.00/);assert.doesNotMatch(financial.body.csv,/AUDIT:/);
    await grant('system.billing.audit.read');
    const audit=await exportPage();assert.equal(audit.status,200);assert.equal(audit.body.auditIncluded,true);assert.match(audit.body.csv,/AUDIT:/);
    assert.doesNotMatch(audit.body.csv,/FORBIDDEN_TIMELINE|SECRET_LIVE|in_ScopedTest/);
    await revoke('system.billing.financial.read');
    const auditOnly=await exportPage();assert.equal(auditOnly.status,200);assert.match(auditOnly.body.csv,/AUDIT:/);assert.doesNotMatch(auditOnly.body.csv,/249\.00|ยอดเอกสาร \(บาท\)/);
    captured.push('history-export-financial-and-audit-capabilities-remain-independent');
    assert.equal((await delegated(`${base}/export`,'POST',{limit:1000})).status,400);
    assert.equal((await delegated(`${base}/export`,'POST',{cursor:'x'.repeat(181)})).status,400);
    assert.equal((await delegated(`/v1/system/billing/companies/${companyIds[3]}/timeline/export`,'POST',{})).status,404);
    assert.equal((await delegated(`/v1/system/billing/companies/${companyIds[0]}/timeline/export`,'POST',{cursor:page.nextCursor})).status,404);
    const grantIdentity={roleId:role.id,permissionId:(await db.permission.findUniqueOrThrow({where:{key:'system.billing.read'}})).id};
    await db.rolePermission.delete({where:{roleId_permissionId:grantIdentity}});
    assert.equal((await exportPage()).status,403,'export permission alone cannot read company history');
    await db.rolePermission.create({data:grantIdentity});captured.push('history-export-strict-input-foreign-company-cursor-and-export-without-read-denied');
    // Withdraw authority after its initial company read, before the final release check.
    const readCompany=db.company.findFirst.bind(db.company);
    let withdraw=true;
    db.company.findFirst=(async(...args:Parameters<typeof db.company.findFirst>)=>{
      const result=await readCompany(...args);
      if(withdraw&&result?.id===companyId){withdraw=false;await revoke('system.billing.audit.read');}
      return result;
    }) as typeof db.company.findFirst;
    try{const changed=await exportPage(page.nextCursor);assert.equal(changed.status,409);assert.equal(changed.body.code,'CONTROL_EXPORT_CHANGED');assert.equal(changed.body.csv,undefined);}
    finally{db.company.findFirst=readCompany;}
    captured.push('history-export-withdrawn-audit-during-read-refuses-prepared-content');
    const scope=await db.billingOperatorScope.findFirstOrThrow({where:{companyId,userId:targetId,revokedAt:null}});
    withdraw=true;
    db.company.findFirst=(async(...args:Parameters<typeof db.company.findFirst>)=>{
      const result=await readCompany(...args);
      if(withdraw&&result?.id===companyId){withdraw=false;await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:new Date()}});}
      return result;
    }) as typeof db.company.findFirst;
    try{const changed=await exportPage(page.nextCursor);assert.equal(changed.status,404);assert.equal(changed.body.csv,undefined);}
    finally{db.company.findFirst=readCompany;await db.billingOperatorScope.update({where:{id:scope.id},data:{revokedAt:null}});}
    captured.push('history-export-withdrawn-company-scope-before-release-refuses-prepared-content');
    const trigger=`billing_export_fail_${randomUUID().replace(/-/g,'')}`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${trigger}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='billing.history.exported' AND NEW."companyId"='${companyId.replace(/'/g,"''")}' THEN RAISE EXCEPTION 'synthetic export audit failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION "${trigger}"()`);
    const auditCount=await db.auditLog.count({where:{companyId,action:'billing.history.exported'}});
    try{const failed=await exportPage();assert.equal(failed.status,500);assert.equal(failed.body.csv,undefined);assert.equal(await db.auditLog.count({where:{companyId,action:'billing.history.exported'}}),auditCount);}
    finally{await db.$executeRawUnsafe(`DROP TRIGGER "${trigger}" ON "AuditLog"`);await db.$executeRawUnsafe(`DROP FUNCTION "${trigger}"()`);}
    const retry=await exportPage();assert.equal(retry.status,200);
    const last=await db.auditLog.findFirstOrThrow({where:{companyId,action:'billing.history.exported'},orderBy:{createdAt:'desc'}});
    assert.equal((last.metadataJson as any).sha256,retry.body.sha256);assert.doesNotMatch(JSON.stringify(last.metadataJson),/HYPERLINK|FORBIDDEN_TIMELINE|https|csv/);
    captured.push('history-export-audit-failure-withholds-file-and-fresh-retry-has-content-hash');
    await db.company.update({where:{id:companyId},data:{name:originalName}});
    if(browser){
      const p=browser.page;await p.setViewportSize({width:390,height:844});await p.goto(`${browser.origin}/system/billing/companies/${companyId}`,{waitUntil:'domcontentloaded'});
      const panel=p.getByRole('region',{name:'ประวัติแพ็กเกจและการชำระเงิน',exact:true}),button=panel.getByRole('button',{name:'ดาวน์โหลดประวัติหน้านี้ (CSV)',exact:true});
      await button.waitFor();
      const downloadPromise=p.waitForEvent('download');await button.focus();await button.press('Enter');const download=await downloadPromise,stream=await download.createReadStream();assert.ok(stream);
      const parts:Buffer[]=[];for await(const part of stream)parts.push(Buffer.from(part));const text=Buffer.concat(parts).toString('utf8');
      assert.match(download.suggestedFilename(),/^mangmee-billing-history-[\dT-]+\.csv$/);assert.ok(text.startsWith('\uFEFF'));assert.match(text,/เวลาส่งออก \(UTC\)/);assert.match(text,/249\.00/);
      await panel.getByRole('status').filter({hasText:'ดาวน์โหลดประวัติ'}).waitFor();
      await panel.getByRole('button',{name:'ประวัติหน้าถัดไป',exact:true}).click();await button.waitFor();
      const secondReference=(await panel.locator('article details p').first().textContent())!.replace('อ้างอิง ','');
      const secondPromise=p.waitForEvent('download');await button.click();const second=await secondPromise,secondStream=await second.createReadStream();assert.ok(secondStream);
      const secondParts:Buffer[]=[];for await(const part of secondStream)secondParts.push(Buffer.from(part));assert.ok(Buffer.concat(secondParts).toString('utf8').includes(secondReference),'download matches the selected timeline page');
      await p.route('**/timeline/export',route=>route.abort('failed'),{times:1});await button.click();await panel.getByRole('alert').waitFor();
      assert.equal(await button.isEnabled(),true);const retryDownload=p.waitForEvent('download');await button.click();await retryDownload;
      await panel.getByRole('status').filter({hasText:'ดาวน์โหลดประวัติ'}).waitFor();
      await button.scrollIntoViewIfNeeded();await p.screenshot({path:`${browser.evidenceDir}/admin-history-export-mobile.png`});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await p.reload({waitUntil:'domcontentloaded'});await button.waitFor();
      const lateDownloads:unknown[]=[];const onDownload=(file:unknown)=>lateDownloads.push(file);p.on('download',onDownload);
      try{for(const leave of [false,true]){
        let accepted!:()=>void,release!:()=>void;
        const ready=new Promise<void>(resolve=>{accepted=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
        const pattern='**/timeline/export';
        await p.route(pattern,async route=>{const response=await route.fetch();assert.equal(response.status(),200);accepted();await held;await route.fulfill({response});},{times:1});
        try{
          await button.click();await ready;assert.equal(await button.isEnabled(),false,'one download at a time');
          if(leave){await p.getByRole('link',{name:'บริษัท',exact:true}).click();await p.waitForURL(`${browser.origin}/system/billing`);}
          else{await panel.getByRole('button',{name:'โหลดประวัติล่าสุด',exact:true}).click();await button.waitFor();}
          const delivered=p.waitForResponse(response=>response.url().endsWith('/timeline/export'));release();await (await delivered).finished();
          await p.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
          assert.equal(lateDownloads.length,0,'late export cannot download after reloading or leaving its timeline');
          assert.equal(await p.getByRole('status').filter({hasText:'ดาวน์โหลดประวัติ'}).count(),0);
        }finally{release();await p.unroute(pattern);}
      }}finally{p.off('download',onDownload);}
      captured.push('browser-history-export-actual-thai-bytes-pagination-error-retry-reload-return-mobile');
      captured.push('browser-history-export-overlap-and-late-response-after-refresh-or-company-return');
    }
    assert.deepEqual(await db.billingInvoice.findMany({where:invoiceWhere,orderBy:{id:'asc'}}),financialBefore);
    assert.deepEqual(await db.billingReceiptGrant.findMany({where:{companyId},orderBy:{id:'asc'}}),grantBefore);
    return captured;
  }finally{
    await db.company.update({where:{id:companyId},data:{name:originalName}});
    await db.rolePermission.deleteMany({where:{roleId:role.id,permissionId:{in:permissions.map(p=>p.id)}}});
    await db.auditLog.deleteMany({where:{companyId,action:'billing.history.exported'}});
  }
}
