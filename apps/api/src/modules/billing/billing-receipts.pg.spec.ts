import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import type { PrismaService } from '../../common/database/prisma.service';
import { grantPaidPackageReceipts, paidReceiptBalance } from './application/billing-receipt-grants';
import { appendPackageInterval } from './domain/billing-package';
import { admitCompanyOcr, receiptQuotaSnapshot, releaseCompanyOcrAdmission } from '../line-ai/application/company-ocr-governance';
import { displayReceiptQuotaLimit, receiptQuotaExceededTextTh } from '../system-partner-management/domain/logic/receipt-quota.logic';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
test('paid package quota on real PostgreSQL (internal payment-apply seam, not Stripe/browser E2E)', { skip: !databaseUrl }, async (t) => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const prisma = { client } as PrismaService;
  const companyId = `receipt-pack-${randomUUID()}`, otherId = `${companyId}-other`;
  const now = new Date(), end = appendPackageInterval(now, 'year');
  let accountId = '';
  try {
    await client.$queryRaw`SELECT 1`;
    await client.company.createMany({ data: [{ id: companyId, name: 'Synthetic paid package' }, { id: otherId, name: 'Synthetic other company' }] });
    const account = await client.billingAccount.create({ data: { companyId, stripeAccountId: `acct_test_${randomUUID()}`, livemode: false } });
    accountId = account.id;
    await client.companyPlanTerm.create({ data: { companyId, tierKey: 'PRO_999', branchLimit: 5, employeeLimit: 10,
      monthlySlipLimit: 100, termStartAt: now, termEndsAt: end } });
    const initial = { companyId, billingAccountId: accountId, sourceKey: 'synthetic-initial-invoice', policyRevisionId: 'TEST_ONLY',
      kind: 'INITIAL' as const, units: 1200, serviceStart: now, serviceEnd: end, availableAt: now, expiresAt: end };
    const apply = (input: Parameters<typeof grantPaidPackageReceipts>[1]) => client.$transaction((tx) => grantPaidPackageReceipts(tx, input));
    const read = (requestId: string, sourceRoute: 'receipt-ocr-web' | 'receipt-ocr-line' = 'receipt-ocr-web', monthKey = '2026-09') =>
      admitCompanyOcr(prisma, { companyId, sourceRoute, requestId, monthKey, enforceReceiptQuota: false });

    await t.test('verified apply seam deduplicates concurrent/replayed source and rejects changed evidence', async () => {
      const [a, b] = await Promise.all([apply(initial), apply(initial)]);
      assert.equal(a.id, b.id);
      assert.equal(await client.billingReceiptGrant.count({ where: { companyId } }), 1);
      await assert.rejects(apply({ ...initial, units: 2400 }), /source_changed/);
      await assert.rejects(apply({ ...initial, sourceKey: 'wrong-company', companyId: otherId }), /account_mismatch/);
      assert.equal((await paidReceiptBalance(client, companyId, accountId)).remaining, 1200);
    });

    await t.test('all 1200 annual units are usable early across web/LINE/months; last-slot race cannot overspend', async () => {
      for (let i = 0; i < 1199; i += 1) {
        const admission = await read(`receipt-${i}`, i % 2 ? 'receipt-ocr-line' : 'receipt-ocr-web', i < 101 ? '2026-09' : '2026-10');
        assert.equal(admission.allowed, true, `annual receipt ${i + 1} must not hit the monthly equivalent`);
      }
      const race = await Promise.all([read('last-web'), read('last-line', 'receipt-ocr-line')]);
      assert.equal(race.filter((decision) => decision.allowed).length, 1);
      assert.equal(race.filter((decision) => !decision.allowed && decision.reason === 'plan_exceeded').length, 1);
      assert.equal((await receiptQuotaSnapshot(prisma, companyId, '2026-11')).usedCount, 1200);
      const blocked = await read('no-monthly-reset', 'receipt-ocr-line', '2026-11');
      assert.ok(!blocked.allowed && blocked.reason === 'plan_exceeded', 'paid grant enforcement does not follow legacy shadow flag');
      const before = await paidReceiptBalance(client, companyId, accountId);
      const bank = await admitCompanyOcr(prisma, { companyId, sourceRoute: 'bank-statement-extract', requestId: 'bank', monthKey: '2026-11' });
      assert.equal(bank.allowed, true);
      assert.deepEqual(await paidReceiptBalance(client, companyId, accountId), before, 'bank statements do not consume receipts');
    });

    await t.test('failed OCR releases its exact reservation once; replay does not recharge', async () => {
      const original = await client.companyOcrUsageEvent.findUniqueOrThrow({ where: { companyId_sourceRoute_requestId: { companyId, sourceRoute: 'receipt-ocr-web', requestId: 'receipt-0' } } });
      const release = { companyId, sourceRoute: 'receipt-ocr-web' as const, requestId: 'receipt-0', eventId: original.id };
      assert.equal(await releaseCompanyOcrAdmission(prisma, release), true);
      assert.equal(await releaseCompanyOcrAdmission(prisma, release), true);
      assert.equal((await paidReceiptBalance(client, companyId, accountId)).remaining, 1);
      assert.equal((await read('receipt-0')).allowed, true);
      assert.equal(await releaseCompanyOcrAdmission(prisma, release), true, 'stale execution cannot release replacement event');
      assert.equal((await paidReceiptBalance(client, companyId, accountId)).remaining, 0);
      const replay = await read('receipt-0');
      assert.ok(!replay.allowed && replay.reason === 'duplicate');
    });

    await t.test('paid repeat never extends an Admin receipt grant expiry', async () => {
      const gift=await client.billingReceiptGrant.create({data:{...initial,kind:'ADMIN_ADJUSTMENT',units:3,sourceKey:'synthetic-admin-gift',sourceHash:'synthetic-admin-proof'}});
      try {
        const extended=appendPackageInterval(end,'year');
        await assert.rejects(client.$transaction(async tx=>{
          await grantPaidPackageReceipts(tx,{...initial,kind:'REPEAT',sourceKey:'synthetic-rollback-repeat',serviceStart:end,serviceEnd:extended,expiresAt:extended});
          assert.equal((await tx.billingReceiptGrant.findUniqueOrThrow({where:{id:gift.id}})).expiresAt.toISOString(),end.toISOString());
          throw new Error('ROLLBACK_GIFT_CHECK');
        }),/ROLLBACK_GIFT_CHECK/);
        const expired=await paidReceiptBalance(client,companyId,accountId,new Date(end.getTime()+1));
        assert.equal(expired.remaining,0,'read-time expiry works with no sweep');
      }finally{await client.billingReceiptGrant.delete({where:{id:gift.id}});}
    });

    await t.test('full-package repeat grants 1200 now, extends valid balance and records future service separately', async () => {
      const extended = appendPackageInterval(end, 'year');
      const repeat = { ...initial, sourceKey: 'synthetic-full-package-repeat', kind: 'REPEAT' as const,
        serviceStart: end, serviceEnd: extended, expiresAt: extended };
      await client.$transaction(async (tx) => {
        await grantPaidPackageReceipts(tx, repeat);
        await tx.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: extended } });
      });
      await apply(repeat);
      const balance = await paidReceiptBalance(client, companyId, accountId);
      assert.equal(balance.limit, 2400);
      assert.equal(balance.used, 1200);
      assert.equal(balance.remaining, 1200);
      assert.equal((await client.billingReceiptGrant.findFirstOrThrow({ where: { companyId, kind: 'INITIAL' } })).expiresAt.toISOString(), extended.toISOString());
      assert.equal((await read('after-full-package-repeat', 'receipt-ocr-line')).allowed, true);
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } })).tierKey, 'PRO_999');
      const snapshot = await receiptQuotaSnapshot(prisma, companyId);
      assert.equal(snapshot.cadence, 'PAID_GRANTS');
      const copy = receiptQuotaExceededTextTh(displayReceiptQuotaLimit(snapshot.planLimit, snapshot.tierKey, snapshot.cadence), snapshot.tierKey, snapshot.cadence);
      assert.match(copy, /แพ็กเกจเพิ่ม/);
      assert.doesNotMatch(copy, /ต่อเดือน|ซื้อใบ/);
    });

    await t.test('payment apply races OCR without deadlock; a failed transaction grants nothing', async () => {
      const extended = appendPackageInterval(end, 'year');
      const upgrade = { ...initial, sourceKey: 'synthetic-proration', kind: 'UPGRADE' as const,
        units: 2, serviceEnd: extended, expiresAt: extended };
      const before = await paidReceiptBalance(client, companyId, accountId);
      await assert.rejects(client.$transaction(async (tx) => {
        await grantPaidPackageReceipts(tx, upgrade);
        throw new Error('synthetic-apply-crash');
      }), /synthetic-apply-crash/);
      assert.deepEqual(await paidReceiptBalance(client, companyId, accountId), before);
      await Promise.all([apply(upgrade), apply(upgrade), ...Array.from({ length: 5 }, (_, i) => read(`apply-race-${i}`))]);
      const after = await paidReceiptBalance(client, companyId, accountId);
      assert.equal(after.limit, before.limit + 2);
      assert.equal(after.used, before.used + 5);
      assert.equal(await client.billingReceiptGrant.count({ where: { companyId, sourceKey: upgrade.sourceKey } }), 1);
    });

    await t.test('expiry/hold and cross-company database references cannot bypass admission', async () => {
      const grant = await client.billingReceiptGrant.findFirstOrThrow({ where: { companyId, kind: 'REPEAT' } });
      await assert.rejects(client.companyOcrUsageEvent.create({ data: {
        companyId: otherId, sourceRoute: 'receipt-ocr-web', requestId: 'cross-company', monthKey: '2026-09', billingReceiptGrantId: grant.id,
      } }));
      await client.company.update({ where: { id: companyId }, data: { status: 'DISABLED' } });
      const held = await read('held');
      assert.ok(!held.allowed && held.reason === 'plan_inactive');
      await client.company.update({ where: { id: companyId }, data: { status: 'ACTIVE' } });
      await client.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: new Date(now.getTime() - 1) } });
      const expired = await read('expired');
      assert.ok(!expired.allowed && expired.reason === 'plan_inactive');
      const future = new Date(grant.expiresAt.getTime() + 1);
      assert.equal((await paidReceiptBalance(client, companyId, accountId, future)).remaining, 0);
      const event = await client.companyOcrUsageEvent.findFirstOrThrow({ where: { companyId, requestId: 'after-full-package-repeat' } });
      await releaseCompanyOcrAdmission(prisma, { companyId, sourceRoute: 'receipt-ocr-line', requestId: event.requestId, eventId: event.id });
      assert.equal((await paidReceiptBalance(client, companyId, accountId, future)).remaining, 0, 'late release cannot resurrect expired quota');
    });

    await t.test('signup/legacy monthly allowance retains its existing behavior without a billing pointer', async () => {
      await client.companyPlanTerm.create({ data: { companyId: otherId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2,
        monthlySlipLimit: 15, termStartAt: now, termEndsAt: end } });
      for (let i = 0; i < 15; i += 1) assert.equal((await admitCompanyOcr(prisma, {
        companyId: otherId, sourceRoute: 'receipt-ocr-web', requestId: `trial-${i}`, monthKey: '2026-09', enforceReceiptQuota: true,
      })).allowed, true);
      const denied = await admitCompanyOcr(prisma, { companyId: otherId, sourceRoute: 'receipt-ocr-line', requestId: 'trial-16', monthKey: '2026-09', enforceReceiptQuota: true });
      assert.ok(!denied.allowed && denied.reason === 'plan_exceeded');
      assert.deepEqual(await receiptQuotaSnapshot(prisma, otherId, '2026-10'), { usedCount: 0, planLimit: 15, tierKey: 'FREE_TRIAL_15' });
    });
  } finally {
    await client.companyOcrUsageEvent.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
    await client.companyPlanTerm.deleteMany({ where: { companyId: { in: [companyId, otherId] } } });
    await client.billingReceiptGrant.deleteMany({ where: { companyId } });
    if (accountId) await client.billingAccount.deleteMany({ where: { id: accountId } });
    await client.company.deleteMany({ where: { id: { in: [companyId, otherId] } } });
    await client.$disconnect();
  }
});


test('manual/trial receipt gifts on real PostgreSQL (no paid account or provider)', {skip:!databaseUrl},async(t)=>{
  const url=new URL(databaseUrl!);assert.ok(['localhost','127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_billing_20260912','/watchdog_postmark_ci'].includes(url.pathname));
  const client=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl!})}),prisma={client} as PrismaService;
  const companyId=`manual-receipts-${randomUUID()}`,now=new Date(),end=new Date(now.getTime()+30*86400000),giftEnd=new Date(now.getTime()+10*86400000);
  const read=(route:'receipt-ocr-web'|'receipt-ocr-line'='receipt-ocr-web',monthKey='2026-09',enforceReceiptQuota=true)=>
    admitCompanyOcr(prisma,{companyId,sourceRoute:route,requestId:randomUUID(),monthKey,enforceReceiptQuota});
  let giftId='',accountId='';
  try{
    await client.company.create({data:{id:companyId,name:'Synthetic manual receipt gift'}});
    await client.companyPlanTerm.create({data:{companyId,tierKey:'FREE_TRIAL_15',branchLimit:1,employeeLimit:2,monthlySlipLimit:15,termStartAt:now,termEndsAt:end}});
    await t.test('base15 first, no billing account, additive gift and concurrent final web/LINE unit',async()=>{
      for(let i=0;i<15;i++)assert.equal((await read()).allowed,true);
      assert.equal((await read()).allowed,false);
      const gift={companyId,billingAccountId:null,sourceKey:'TEST_ONLY_MANUAL_GIFT',sourceHash:'TEST_ONLY',kind:'ADMIN_ADJUSTMENT',units:2,serviceStart:now,serviceEnd:giftEnd,availableAt:now,expiresAt:giftEnd,policyRevisionId:'ADMIN_APPROVED'};
      giftId=(await client.billingReceiptGrant.create({data:gift})).id;
      await assert.rejects(client.billingReceiptGrant.create({data:gift}));
      await assert.rejects(client.billingReceiptGrant.create({data:{...gift,sourceKey:'INVALID_PAID',kind:'INITIAL'}}));
      assert.equal((await receiptQuotaSnapshot(prisma,companyId,'2026-09')).monthlyAllowance?.additionalRemaining,2);
      assert.equal((await read()).allowed,true);
      const race=await Promise.all([read(),read('receipt-ocr-line')]);assert.equal(race.filter(r=>r.allowed).length,1);
      assert.equal(await client.companyOcrUsageEvent.count({where:{companyId,billingReceiptGrantId:giftId}}),2);
      assert.equal(await client.billingAccount.count({where:{companyId}}),0);
    });
    await t.test('exact failed gift reservation releases once; monthly rollover renews only base allowance',async()=>{
      const event=await client.companyOcrUsageEvent.findFirstOrThrow({where:{companyId,billingReceiptGrantId:giftId}});
      const release={companyId,sourceRoute:event.sourceRoute as 'receipt-ocr-web'|'receipt-ocr-line',requestId:event.requestId,eventId:event.id};
      assert.equal(await releaseCompanyOcrAdmission(prisma,release),true);assert.equal(await releaseCompanyOcrAdmission(prisma,release),true);
      const next=await receiptQuotaSnapshot(prisma,companyId,'2026-10');assert.equal(next.monthlyAllowance?.additionalRemaining,1);assert.equal(next.planLimit!-next.usedCount,16);
      for(let i=0;i<15;i++)assert.equal((await read('receipt-ocr-line','2026-10')).allowed,true);
      assert.equal((await receiptQuotaSnapshot(prisma,companyId,'2026-10')).monthlyAllowance?.additionalRemaining,1);
      assert.equal((await read('receipt-ocr-line','2026-10')).allowed,true);assert.equal((await read('receipt-ocr-line','2026-10')).allowed,false);
    });
    await t.test('shadow reads do not spend a gift; lowering base quota does not erase remaining gifts',async()=>{
      await client.billingReceiptGrant.update({where:{id:giftId},data:{units:4}});
      assert.equal((await read('receipt-ocr-web','2026-10',false)).allowed,true);
      const snapshot=await receiptQuotaSnapshot(prisma,companyId,'2026-10');assert.equal(snapshot.planLimit!-snapshot.usedCount,2);
      await client.companyPlanTerm.update({where:{companyId},data:{monthlySlipLimit:10}});
      const lowered=await receiptQuotaSnapshot(prisma,companyId,'2026-10');assert.equal(lowered.planLimit!-lowered.usedCount,2);
      await client.company.update({where:{id:companyId},data:{status:'DISABLED'}});assert.equal((await read('receipt-ocr-web','2026-10')).allowed,false);
      await client.company.update({where:{id:companyId},data:{status:'ACTIVE'}});
      assert.equal((await read('receipt-ocr-web','2026-10')).allowed,true);
    });
    await t.test('paid conversion keeps the same fixed gift and consumption, without carrying monthly base',async()=>{
      const account=await client.billingAccount.create({data:{companyId,stripeAccountId:`acct_fixture_${randomUUID()}`,livemode:false}});accountId=account.id;
      await client.$transaction(tx=>grantPaidPackageReceipts(tx,{companyId,billingAccountId:accountId,sourceKey:'TEST_ONLY_CONVERSION',policyRevisionId:'TEST_ONLY',kind:'INITIAL',units:30,serviceStart:now,serviceEnd:end,availableAt:now,expiresAt:end}));
      const q=await receiptQuotaSnapshot(prisma,companyId,'2026-10');assert.equal(q.cadence,'PAID_GRANTS');assert.equal(q.planLimit!-q.usedCount,31);
      assert.equal(q.monthlyAllowance,undefined);assert.equal((await client.billingReceiptGrant.findUniqueOrThrow({where:{id:giftId}})).expiresAt.toISOString(),giftEnd.toISOString());
      assert.equal((await paidReceiptBalance(client,companyId,accountId,new Date(giftEnd.getTime()+1))).remaining,30);
      await client.billingReceiptGrant.update({where:{id:giftId},data:{revokedAt:new Date()}});
      assert.equal((await paidReceiptBalance(client,companyId,accountId)).remaining,30);
      assert.equal(await client.companyOcrUsageEvent.count({where:{companyId,billingReceiptGrantId:giftId}}),3);
    });
  }finally{
    await client.companyOcrUsageEvent.deleteMany({where:{companyId}});await client.companyPlanTerm.deleteMany({where:{companyId}});
    await client.billingReceiptGrant.deleteMany({where:{companyId}});if(accountId)await client.billingAccount.deleteMany({where:{id:accountId}});
    await client.company.deleteMany({where:{id:companyId}});await client.$disconnect();
  }
});
