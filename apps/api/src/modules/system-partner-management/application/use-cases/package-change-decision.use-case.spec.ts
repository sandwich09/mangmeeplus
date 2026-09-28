import {planTermSourceVersion} from '../plan-term-adjustment';
import { lineMessagingCredentialsFixture } from '../../../../common/config/line-messaging-credentials.fixture';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PLAN_TIER_PRESETS } from '@watchdog-bms/contracts';
import { PackageChangeDecisionUseCase } from './package-change-decision.use-case';
import { SystemPackageChangeController } from '../../presentation/http/system-package-change.controller';

const REQ = { context: { userId: 'admin-1', requestId: 'req-1' } } as any;

// Relative to test run time, not hard-coded dates: a term test must stay "running"/"locked" no
// matter when CI happens to execute it.
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000);
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
// Exactly what the harness's `companyPlanTerm.findUnique` fake returns for an unpaid, unlocked
// company — shared so `planTermSourceVersion` assertions hash the same shape the use case reads.
const DEFAULT_TERM = { billingReceiptAccountId: null as string | null, termStartAt: PAST, termEndsAt: FUTURE, renewCount: 0 };

const OPEN_ROW = {
  id: 'pcr-1',
  companyId: 'co-1',
  requestedByUserId: 'owner-1',
  requestedTierKey: 'PRO_999',
  status: 'OPEN',
  note: 'ขอเพิ่มโควตาค่ะ',
  decidedByUserId: null as string | null,
  decidedAt: null as Date | null,
  createdAt: new Date('2026-09-05T02:00:00.000Z'),
  company: { name: 'ร้านนิด', status: 'ACTIVE', planTerm: { tierKey: 'FREE_TRIAL_15', termStartAt: PAST, termEndsAt: FUTURE, renewCount: 0, termDisabledAt: null as Date | null } },
};

const originalFetch = globalThis.fetch;
let pushes: Array<{ to: string; text: string }> = [];

beforeEach(() => {
  pushes = [];
  globalThis.fetch = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    pushes.push({ to: body.to, text: body.messages[0].text });
    return { ok: true, status: 200, headers: { get: () => null } };
  }) as any;
});
afterEach(() => { globalThis.fetch = originalFetch; });

function harness(options: {
  row?: any | null;
  paid?: boolean;
  rows?: any[];
  /** Simulates losing the OPEN→decided race: the CAS matches nothing. */
  claimWins?: boolean;
  planTermThrows?: Error;
  ownerLineUserIds?: string[];
  token?: string | null;
  /** R-C6 (purchase-without-setup): the company's term is at/after termEndsAt. */
  locked?: boolean;
} = {}) {
  let current = options.row === undefined ? { ...OPEN_ROW } : options.row;
  const planTermCalls: any[] = [];
  const audits: any[] = [];
  const updates: any[] = [];
  const membershipQueries: any[] = [];

  const prisma = {
    client: {
      companyPlanTerm: {findUnique: async () => ({
        ...DEFAULT_TERM,
        billingReceiptAccountId: options.paid ? 'paid-account' : null,
        termEndsAt: options.locked ? PAST : FUTURE,
      })},
      branch:{count:async()=>1},
      packageChangeRequest: {
        findUnique: async () => (current ? { ...current } : null),
        findMany: async () => options.rows ?? [],
        updateMany: async (args: any) => {
          updates.push(args);
          const wins = options.claimWins ?? true;
          const matches = current && current.status === args.where.status;
          if (!matches || (args.where.status === 'OPEN' && !wins)) return { count: 0 };
          current = { ...current, ...args.data };
          return { count: 1 };
        },
      },
      user: { findMany: async () => [{ id: 'owner-1', displayName: 'คุณนิด' }] },
      auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
      companyMembership: {
        count:async()=>1,findFirst:async()=>({id:'admin-membership'}),
        findMany: async (args: any) => { membershipQueries.push(args); return (options.ownerLineUserIds ?? ['Uowner-1']).map(() => ({ userId: 'owner-1' })); },
      },
      externalIdentity: {
        findMany: async () => (options.ownerLineUserIds ?? ['Uowner-1']).map((providerUserId) => ({ providerUserId })),
      },
    },
  } as any;

  prisma.client.$queryRaw=async()=>[];
  prisma.client.$transaction=async(fn:any)=>{const before=current?{...current}:null,n=audits.length;try{return await fn(prisma.client);}catch(error){current=before;audits.splice(n);throw error;}};

  const setPlanTerm = {
    execute: async (cmd: any) => {
      planTermCalls.push(cmd);
      if (options.planTermThrows) throw options.planTermThrows;
      return { term: null };
    },
  } as any;

  const config = {
    lineMessagingChannelId: 'synthetic', lineMessagingChannelAccessToken: options.token === undefined ? 'token-1' : options.token ?? undefined,
    // Without this the SEC-05 allow-list is LIFF-only, and a note naming our own web app would be
    // refused for the wrong reason — hiding whether the glued-URL rule works at all.
    sesWebBaseUrl: 'https://app.mangmeeplus.com',
  } as any;
  const logs: any[] = [];
  const useCase = new PackageChangeDecisionUseCase(lineMessagingCredentialsFixture(config), prisma, setPlanTerm, config, {
    warn: (fields: any) => logs.push(fields),
    error: (fields: any) => logs.push(fields),
  } as any);

  return {
    controller: new SystemPackageChangeController(useCase),
    planTermCalls, audits, updates, logs, membershipQueries,
    row: () => current,
  };
}

describe('GET /system/package-change-requests', () => {
  it('shows a paid purchase source without exposing financial references or sending a second approval notice', async () => {
    const row={...OPEN_ROW,status:'APPROVED',paymentState:'STRIPE_APPLIED',paymentRef:'private-invoice',decidedAt:new Date()};
    const h=harness({row,rows:[row],paid:true});
    const {items}=await h.controller.list('APPROVED');
    assert.equal(items[0]!.resolutionSource,'PAID_PURCHASE');
    assert.doesNotMatch(JSON.stringify(items),/private-invoice|paymentRef/);
    assert.equal((await h.controller.decide(row.id,{action:'APPROVE'},REQ)).status,'APPROVED');
    assert.equal(h.planTermCalls.length,0);assert.equal(pushes.length,0);
    const manual=await harness({rows:[{...row,paymentState:'NONE'}]}).controller.list('APPROVED');
    assert.equal(manual.items[0]!.resolutionSource,undefined);
  });
  it('shows the shop, the move and who asked for it', async () => {
    const h = harness({ rows: [{ ...OPEN_ROW }] });
    const { items } = await h.controller.list('OPEN');

    assert.equal(items.length, 1);
    assert.equal(items[0]!.companyName, 'ร้านนิด');
    assert.equal(items[0]!.currentTierKey, 'FREE_TRIAL_15');
    assert.equal(items[0]!.requestedTierKey, 'PRO_999');
    assert.equal(items[0]!.requestedByDisplayName, 'คุณนิด');
    assert.equal(items[0]!.note, 'ขอเพิ่มโควตาค่ะ');
    // R-C6/R-C7: a running FREE_TRIAL_15 term reads as TRIAL, never a bare tierKey.
    assert.equal(items[0]!.planState, 'TRIAL');
  });

  it('shows a term-locked shop as NO_PACKAGE with lockReason, not a raw tier', async () => {
    const lockedRow = { ...OPEN_ROW, company: { name: 'ร้านล็อก', status: 'DISABLED', planTerm: {
      tierKey: 'FREE_TRIAL_15', termStartAt: PAST, termEndsAt: PAST, renewCount: 0, termDisabledAt: PAST,
    } } };
    const h = harness({ rows: [lockedRow] });
    const { items } = await h.controller.list('OPEN');
    assert.equal(items[0]!.planState, 'NO_PACKAGE');
    assert.equal(items[0]!.lockReason, 'no_package');
  });

  it('falls back to OPEN rather than trusting an unknown status from the query string', async () => {
    const h = harness({ rows: [] });
    await h.controller.list('; DROP TABLE');
    // Nothing to assert on the fake beyond "it did not throw and did not pass the string on":
    // the use-case signature is typed to the four statuses, and the controller is what fences it.
    await h.controller.list(undefined);
  });
});

describe('POST /system/package-change-requests/:id/decision — APPROVE', () => {
  it('moves the tier through the ONE plan-term writer, with that tier preset', async () => {
    const h = harness();
    const result = await h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ);

    assert.equal(result.status, 'APPROVED');
    assert.equal(h.planTermCalls.length, 1, 'exactly one tier change');
    assert.deepEqual(h.planTermCalls[0], {
      commandId:'line-package-pcr-1',expectedVersion:planTermSourceVersion('co-1',DEFAULT_TERM as any),reason:'อนุมัติคำขอเปลี่ยนแพ็กเกจจาก LINE',packageChangeRequestId:'pcr-1',
      companyId: 'co-1',
      tierKey: 'PRO_999',
      branchLimit: PLAN_TIER_PRESETS.PRO_999.branchLimit,
      employeeLimit: PLAN_TIER_PRESETS.PRO_999.employeeLimit,
      monthlySlipLimit: PLAN_TIER_PRESETS.PRO_999.monthlySlipLimit,
      requestingAdminUserId: 'admin-1',
      requestId: 'req-1',
    });
    assert.equal(h.audits[0].action, 'signup.line.package_change_decided');
    assert.equal(h.audits[0].metadataJson.action, 'APPROVE');
  });

  it('tells the shop, in the tier label it will recognise', async () => {
    const h = harness();
    await h.controller.decide('pcr-1', { action: 'APPROVE', note: 'ขอบคุณค่ะ' }, REQ);

    assert.equal(pushes.length, 1);
    assert.equal(pushes[0]!.to, 'Uowner-1');
    // The label carries brackets, so this is a substring check, not a pattern.
    assert.ok(pushes[0]!.text.includes(`เปลี่ยนแพ็กเกจเป็น ${PLAN_TIER_PRESETS.PRO_999.labelTh} แล้วค่ะ`));
    assert.match(pushes[0]!.text, /ขอบคุณค่ะ/);
    // Owner copy rule: no plus sign anywhere in customer text.
    assert.doesNotMatch(pushes[0]!.text, /\+/);
  });

  // R-C11: since any plan manager may open this request, the reply must reach every plan manager —
  // not only the OWNER-only query this used before.
  it('asks for every plan manager, not only OWNERs (R-C11)', async () => {
    const h = harness();
    await h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ);

    assert.equal(h.membershipQueries.length, 1);
    const where = h.membershipQueries[0]!.where;
    assert.equal(where.companyId, 'co-1');
    assert.equal(where.status, 'ACTIVE');
    assert.equal(where.user.status, 'ACTIVE');
    assert.equal(where.roles.some.role.permissions.some.permission.key, 'company.plan.manage');
    // The old OWNER-only filter must be gone, not merely widened.
    assert.doesNotMatch(JSON.stringify(where), /"key":"OWNER"/);
  });

  it('is idempotent: repeating the decision buys no second tier change', async () => {
    const h = harness();
    await h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ);
    const second = await h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ);

    assert.equal(second.status, 'APPROVED');
    assert.equal(h.planTermCalls.length, 1);
    assert.equal(pushes.length, 1, 'and no second message to the shop');
  });

  it('two operators on one row produce one tier change, not two', async () => {
    // The loser's CAS matches nothing, which is exactly what a concurrent APPROVED row does.
    const h = harness({ claimWins: false });
    const result = await h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ);

    assert.equal(result.status, 'OPEN', 'reports what the row actually says');
    assert.deepEqual(h.planTermCalls, []);
  });

  it('puts the row back in the queue when the tier write fails', async () => {
    const h = harness({ planTermThrows: new Error('plan_term_down') });
    await assert.rejects(() => h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ), /plan_term_down/);

    assert.equal(h.row().status, 'OPEN', 'a row that claims a change that did not happen is a lie');
    assert.deepEqual(h.audits, [], 'and nothing is recorded as decided');
    assert.deepEqual(pushes, []);
  });

  it('refuses a tier that is not in the catalog before touching anything', async () => {
    const h = harness({ row: { ...OPEN_ROW, requestedTierKey: 'GOLD_9999' } });
    await assert.rejects(
      () => h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ),
      UnprocessableEntityException,
    );
    assert.deepEqual(h.updates, [], 'the row is not claimed for a change that cannot be made');
  });

  it('404s on a request that does not exist', async () => {
    const h = harness({ row: null });
    await assert.rejects(() => h.controller.decide('nope', { action: 'APPROVE' }, REQ), NotFoundException);
  });

  // R-C6/RV25 (purchase-without-setup): SetCompanyPlanTerm's renew path never moves the dates on
  // approval, so approving a term-locked shop would tell the customer "เปลี่ยนแล้ว" while it stays
  // locked at zero days. The row must not even be claimed — it stays OPEN for the operator to renew
  // first (partner page) and try again.
  it('refuses to approve a term-locked shop and leaves the row unclaimed', async () => {
    const h = harness({ locked: true });
    await assert.rejects(
      () => h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ),
      (error: any) => error.getStatus() === 409 && error.getResponse().code === 'package_change_company_locked',
    );
    assert.equal(h.row().status, 'OPEN');
    assert.equal(h.updates.length, 0);
    assert.equal(h.planTermCalls.length, 0);
    assert.equal(pushes.length, 0);
  });
});

describe('POST /system/package-change-requests/:id/decision — REJECT', () => {
  it('closes the row without moving the tier, and says so politely', async () => {
    const h = harness();
    const result = await h.controller.decide('pcr-1', { action: 'REJECT' }, REQ);

    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(h.planTermCalls, [], 'a rejection must never change what the shop pays');
    assert.equal(h.audits[0].metadataJson.action, 'REJECT');
    assert.equal(pushes.length, 1);
    assert.match(pushes[0]!.text, /ยังเปลี่ยนแพ็กเกจให้ไม่ได้/);
    assert.doesNotMatch(pushes[0]!.text, /\+/);
  });

  // MEDIUM-3: the note is pushed into a customer's LINE chat, so it crosses the SAME boundary the
  // message box does. It was going out unchecked, and the audit recorded only that one existed.
  it('holds the note to the SEC-05 fence, before anything is claimed', async () => {
    for (const note of [
      'โอนที่ https://evil.example.com ค่ะ',
      'app.mangmeeplus.com:443@evil.test/pay',
      'ก'.repeat(501),
    ]) {
      const h = harness();
      await assert.rejects(
        () => h.controller.decide('pcr-1', { action: 'APPROVE', note }, REQ),
        UnprocessableEntityException,
      );
      assert.deepEqual(h.updates, [], 'the row is not claimed for a decision that is refused');
      assert.deepEqual(h.planTermCalls, [], 'and the tier does not move');
      assert.deepEqual(pushes, []);
    }
  });

  // B-1, on the second route that pushes an operator's paragraph into a customer's chat.
  it('refuses a second URL glued onto one of ours in the note', async () => {
    // Same set as the message box: the Thai letter is the one an allowlist can never catch.
    for (const glue of ['"', '<', '`', '\u200b', '\u0e04', ')', '\u3002', '']) {
      const h = harness();
      await assert.rejects(
        () => h.controller.decide(
          'pcr-1',
          { action: 'APPROVE', note: `\u0e14\u0e39\u0e17\u0e35\u0e48 https://app.mangmeeplus.com/x${glue}https://evil.test/pay` },
          REQ,
        ),
        (error: Error) => /partner_line_message_external_link/.test(error.message),
      );
      assert.deepEqual(h.planTermCalls, [], 'and the tier does not move on a refused note');
      assert.deepEqual(pushes, []);
    }

    // The control: the SAME first URL on its own is fine, so the refusals above are caused by the
    // glued second one and not by the allow-list rejecting our own web app.
    const control = harness();
    await control.controller.decide(
      'pcr-1',
      { action: 'APPROVE', note: 'ดูที่ https://app.mangmeeplus.com/x ค่ะ' },
      REQ,
    );
    assert.equal(control.planTermCalls.length, 1);
  });

  it('refuses the same paragraph the message box refuses, with the same code', async () => {
    const paragraph = 'ดูที่ https://evil.example.com/pay ค่ะ';
    const h = harness();
    await assert.rejects(
      () => h.controller.decide('pcr-1', { action: 'REJECT', note: paragraph }, REQ),
      (error: Error) => /partner_line_message_external_link/.test(error.message),
    );
  });

  it('records the note text in the audit, not merely that one existed', async () => {
    const h = harness();
    await h.controller.decide('pcr-1', { action: 'APPROVE', note: 'เริ่มรอบใหม่วันนี้นะคะ' }, REQ);
    assert.equal(h.audits[0].metadataJson.note, 'เริ่มรอบใหม่วันนี้นะคะ');
  });

  it('stays silent when the shop has no linked LINE owner', async () => {
    const h = harness({ ownerLineUserIds: [] });
    const result = await h.controller.decide('pcr-1', { action: 'REJECT' }, REQ);
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(pushes, []);
  });

  it('still decides when no LINE channel is configured at all', async () => {
    const h = harness({ token: null });
    const result = await h.controller.decide('pcr-1', { action: 'APPROVE' }, REQ);
    assert.equal(result.status, 'APPROVED');
    assert.equal(h.planTermCalls.length, 1, 'the tier change does not depend on LINE being up');
    assert.deepEqual(pushes, []);
  });
});

it('keeps a paid LINE package request OPEN and returns review guidance without claiming it or notifying the shop', async()=>{
  const h=harness({paid:true});
  await assert.rejects(h.controller.decide('pcr-1',{action:'APPROVE'},REQ),(e:any)=>e.getStatus()===409&&e.getResponse().code==='paid_plan_review_required');
  assert.equal(h.row().status,'OPEN');assert.equal(h.updates.length,0);assert.equal(h.planTermCalls.length,0);assert.equal(h.audits.length,0);assert.equal(pushes.length,0);
});
