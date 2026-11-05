import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { LINE_ALLOWED_TOOL_CATEGORIES, LINE_DRAFT_UPDATE_TOOLS, LINE_DRAFT_UPDATE_TOOL_CATEGORY, LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES, LINE_TOOL_REGISTRY, hasToolFeature, toolFeatureKeys, type ToolMeta, type ToolResult } from '@watchdog-bms/contracts';

/** Constructor arity of the controller's tool list. Bumped whenever a tool is wired. */
const WIRED_TOOL_COUNT = 71;
function makeController(...args: any[]) {
  const controller = new (InternalToolsController as any)(...args);
  controller.readEvidence = { record: async () => 'synthetic-evidence' };
  return controller;
}
import { SECURITY_EVENT } from '../../../../common/logger/security-event';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { InternalToolsController } from './internal-tools.controller';

// SEC-02/SEC-03: the internal route re-resolves authorization from DB and ignores
// caller-supplied permissions. A fake resolver stands in for the DB-backed one.
function fakeResolver(access: {
  permissions: string[];
  membershipId?: string;
  companyId?: string;
  branchIds?: string[];
  locationIds?: string[];
  roles?: string[];
  /** permission key → the feature key whose OFF switch removed it, as the real resolver reports. */
  entitlementDeniedPermissions?: Record<string, string>;
} | null) {
  return {
    resolveAccess: async (_userId: string, companyId?: string) => {
      if (!access) throw new Error('No active company membership.');
      return {
        membershipId: access.membershipId ?? 'm1',
        companyId: access.companyId ?? companyId ?? 'c1',
        roles: access.roles ?? [],
        permissions: access.permissions,
        entitlementDeniedPermissions: access.entitlementDeniedPermissions,
        scopes: { branchIds: access.branchIds, locationIds: access.locationIds },
      };
    },
  } as any;
}

const AI = 'ai.tool.invoke';
const DELEGATION = 'signed-delegation';

function fakeDelegation(membershipId = 'm1') {
  return {
    consume: async (_token: string, expected: any) => ({
      v: 1,
      iss: 'watchdog-api',
      aud: 'watchdog-erp-core:internal-ai-tools',
      workload: 'ai-gateway',
      sub: expected.userId,
      companyId: expected.companyId,
      membershipId,
      requestId: expected.requestId || 'r1',
      toolName: expected.toolName,
      jti: 'delegation-1',
      iat: 1,
      exp: 2,
    }),
  } as any;
}

/** M-02: the write lands on a later tick, so a captured entry proves the controller awaited the
 *  audit write instead of firing it off and returning. Gates use `logOrThrow` (fail-closed);
 *  the post-execution failure row uses `log`. */
function recordingAudit() {
  const events: any[] = [];
  const write = async (entry: any) => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    events.push(entry);
  };
  return { events, audit: { log: write, logOrThrow: write } as any };
}

/** An audit store whose fail-closed writes reject (both insert attempts failed inside the service). */
function failingAudit(failsOn: (entry: any) => boolean = () => true) {
  return {
    log: async () => undefined,
    logOrThrow: async (entry: any) => { if (failsOn(entry)) throw new Error('audit insert failed'); },
  } as any;
}

/** `loadEntitledFeatureKeys` returns null for a company with no entitlement rows — the legacy
 *  fail-open case every pre-existing test here assumes. Pass rows to switch features on/off. */
function fakePrisma(rows: Array<{ featureKey: string; enabled: boolean }> = []) {
  return { client: { user: { findUnique: async () => ({ status: 'ACTIVE', aiAssistantOptOutAt: null }) }, companyFeatureEntitlement: { findMany: async () => rows } } } as any;
}

const okAudit = { log: async () => undefined, logOrThrow: async () => undefined } as any;

const STUBS = Array.from({ length: 55 }, () => ({}) as any);

describe('AP22 authoritative source producer', () => {
  for (const fault of ['none', 'store-failed', 'tool-mismatch', 'actor-disabled', 'actor-optout'] as const) {
    it(`records exact server-resolved input before releasing a private result: ${fault}`, async () => {
      const prisma = fakePrisma(), { events, audit } = recordingAudit();
      let calls = 0;
      prisma.client.user.findUnique = async () => ({ status: fault === 'actor-disabled' ? 'DISABLED' : 'ACTIVE', aiAssistantOptOutAt: fault === 'actor-optout' ? new Date() : null });
      const controller = makeController({ aiGatewayInternalSecret: 'secret' }, prisma, audit,
        fakeResolver({ permissions: [AI, 'expense.read_own'], branchIds: ['allowed'], roles: ['STAFF'] }), fakeDelegation(),
        ...Array.from({ length: WIRED_TOOL_COUNT }, () => ({})));
      controller.toolMap.set('expense.get_detail', { execute: async () => { calls++; return { toolName: fault === 'tool-mismatch' ? 'expense.list_recent' : 'expense.get_detail', status: 'ok', data: { secret: 'private-source' }, sourceRefs: [], asOf: new Date().toISOString() }; } });
      const records: any[] = [];
      controller.readEvidence = { record: async (...args: any[]) => { records.push(args); if (fault === 'store-failed') throw new Error('unavailable'); return 'evidence-1'; } };
      const result = await controller.invoke('secret', DELEGATION, { toolName: 'expense.get_detail', input: { expenseId: 'expense-1' },
        context: { requestId: 'verified-request', companyId: 'c1', userId: 'u1', membershipId: 'm1', permissions: ['everything'], branchIds: ['forged'], locale: 'th' } });
      if (fault === 'none') {
        assert.equal(result.status, 'ok'); assert.equal(records.length, 1);
        assert.equal(records[0][0].requestId, 'verified-request'); assert.deepEqual(records[0][0].branchIds, ['allowed']);
        assert.deepEqual(records[0][1], { expenseId: 'expense-1' });
      } else {
        assert.notEqual(result.status, 'ok'); assert.equal(result.data, undefined);
        assert.ok(events.some(event => event.result === 'DENIED' || event.result === 'FAILED'));
        if (fault.startsWith('actor-')) assert.equal(calls, 0);
        if (fault === 'tool-mismatch') assert.equal(records.length, 0);
      }
    });
  }
});

describe('InternalToolsController', () => {
  it('fails closed when internal secret is not configured', async () => {
    const stub = {} as any;
    const controller = makeController(
      { aiGatewayInternalSecret: '' } as any,
      fakePrisma(),
      okAudit,
      fakeResolver({ permissions: [AI] }),
      fakeDelegation(),
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );

    await assert.rejects(
      () => controller.invoke('anything', DELEGATION, { toolName: 'company.get_current_context', context: { companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' } }),
      (error: unknown) => error instanceof UnauthorizedException,
    );
  });

  it('denies at the execution boundary when the resolved access lacks ai.tool.invoke', async () => {
    const stub = {} as any;
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      okAudit,
      // Caller claims permissions, but the DB-resolved access lacks ai.tool.invoke.
      fakeResolver({ permissions: ['crm.report.read'] }),
      fakeDelegation(),
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'sales.get_sales_summary',
      context: { companyId: 'c1', userId: 'u1', permissions: [AI, 'crm.report.read', 'anything'], locale: 'th-TH' },
    });

    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'AI_PERMISSION_DENIED');
  });

  it('fails closed when the caller has no active company membership', async () => {
    const stub = {} as any;
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      okAudit,
      fakeResolver(null),
      fakeDelegation(),
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'company.get_current_context',
      context: { companyId: 'c1', userId: 'u1', permissions: [AI], locale: 'th-TH' },
    });

    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'AI_PERMISSION_DENIED');
  });

  it('returns unsupported_module for known tools whose source module is not wired yet', async () => {
    const stub = {} as any;
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      okAudit,
      fakeResolver({ permissions: [AI, 'crm.customer.read'] }),
      fakeDelegation(),
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'crm.suggest_sales_followups',
      context: { companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });

    assert.equal(result.status, 'unsupported_module');
    assert.equal(result.errorCode, 'SOURCE_MODULE_NOT_READY');
  });

  it('requires every registry permission before dispatching a tax tool', async () => {
    const stub = {} as any;
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      okAudit,
      // Missing tax.config.read: one of two required permissions is not enough.
      fakeResolver({ permissions: [AI, 'tax.profile.read'] }),
      fakeDelegation(),
      stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub, stub,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'tax.get_tax_code_profile',
      context: { companyId: 'c1', userId: 'u1', permissions: [AI, 'tax.profile.read', 'tax.config.read'], locale: 'th-TH' },
    });

    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'ERP_PERMISSION_DENIED');
    assert.deepEqual(result.sourceRefs, []);
    assert.equal(result.data, undefined);
  });

  it('dispatches the wired tax-code profile tool with DB-resolved scope', async () => {
    const tools: { execute: (ctx: any) => Promise<any> }[] = Array.from({ length: 32 }, () => ({ execute: async () => ({ status: 'ok' }) }));
    let seenCtx: any = null;
    tools[17] = {
      execute: async (ctx: any) => {
        seenCtx = ctx;
        return { toolName: 'tax.get_tax_code_profile', status: 'ok', data: { reviewRequired: false }, sourceRefs: [], asOf: new Date().toISOString() };
      },
    };
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' },
      fakePrisma(),
      okAudit,
      fakeResolver({ permissions: [AI, 'tax.profile.read', 'tax.config.read'], branchIds: ['b1'] }),
      fakeDelegation(),
      ...tools,
    ) as InternalToolsController;

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'tax.get_tax_code_profile',
      context: { companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });

    assert.equal(result.status, 'ok');
    assert.deepEqual(seenCtx.branchIds, ['b1']);
  });

  it('dispatches with DB-resolved context, not caller-supplied permissions', async () => {
    const tools: { execute: (ctx: any) => Promise<any> }[] = Array.from({ length: 32 }, () => ({ execute: async () => ({ status: 'ok' }) }));
    let seenCtx: any = null;
    tools[11] = {
      execute: async (ctx: any) => {
        seenCtx = ctx;
        return { toolName: 'sales.get_sales_summary', status: 'ok', data: { totalSales: '50' }, sourceRefs: [], asOf: new Date().toISOString() };
      },
    };
    const auditEvents: any[] = [];
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' },
      fakePrisma(),
      { log: async (entry: any) => { auditEvents.push(entry); }, logOrThrow: async (entry: any) => { auditEvents.push(entry); } },
      fakeResolver({ permissions: [AI, 'crm.report.read'], branchIds: ['b1'], membershipId: 'm9', companyId: 'c1', roles: ['SALES'] }),
      fakeDelegation('m9'),
      ...tools,
    ) as InternalToolsController;

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'sales.get_sales_summary',
      // Caller lies: claims extra permissions and a forged branch. Both must be ignored.
      context: { requestId: 'r1', companyId: 'c1', userId: 'u1', membershipId: 'm9', permissions: ['everything'], branchIds: ['b-forged'], locale: 'th-TH' },
    });

    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).totalSales, '50');
    // The tool received the DB-resolved permissions/scope, not the caller's.
    assert.deepEqual(seenCtx.permissions, [AI, 'crm.report.read']);
    assert.deepEqual(seenCtx.branchIds, ['b1']);
    assert.equal(seenCtx.membershipId, 'm9');
    assert.deepEqual(seenCtx.roles, ['SALES']);
    assert.equal(auditEvents[0]?.action, 'ai.actor_delegation.consume');
    assert.equal(auditEvents[0]?.actorUserId, 'u1');
    assert.equal(auditEvents[0]?.companyId, 'c1');
    assert.equal(auditEvents[0]?.requestId, 'r1');
    assert.deepEqual(auditEvents[0]?.metadataJson, {
      workload: 'ai-gateway',
      audience: 'watchdog-erp-core:internal-ai-tools',
      membershipId: 'm9',
      toolName: 'sales.get_sales_summary',
    });
    // M-02: the sensitive-tool success audit stays, now carrying the measured handler duration.
    assert.equal(auditEvents[1]?.action, 'ai.tool.invoke');
    assert.equal(auditEvents[1]?.result, 'SUCCESS');
    assert.equal(auditEvents[1]?.requestId, 'r1');
    assert.equal(typeof auditEvents[1]?.metadataJson?.durationMs, 'number');
  });

  it('writes no durable audit row when the actor delegation itself is invalid', async () => {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      fakeResolver({ permissions: [AI] }),
      { consume: async () => { throw new Error('bad delegation'); } } as any,
      ...STUBS,
    );

    await assert.rejects(
      () => controller.invoke('secret', DELEGATION, {
        toolName: 'company.get_current_context',
        // Nothing here is verified yet, so a durable row keyed to these ids would be audit spam.
        context: { requestId: 'r-forged', companyId: 'c-forged', userId: 'u-forged', permissions: [], locale: 'th-TH' },
      }),
      (error: unknown) => error instanceof UnauthorizedException,
    );
    assert.equal(events.length, 0);
  });

  it('does NOT execute the tool when the audit write fails (M-02 fail-closed)', async () => {
    // L-10 made the post-commit `log()` never throw, which is right for a caller whose financial
    // mutation already committed and wrong for a gate: without an explicit fail-closed path the
    // tool would run and its provenance would be gone. `logOrThrow` is that path.
    let executed = 0;
    const tools: any[] = Array.from({ length: 55 }, () => ({}));
    tools[11] = { execute: async () => { executed += 1; return { toolName: 'sales.get_sales_summary', status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }; } };
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      failingAudit(),
      fakeResolver({ permissions: [AI, 'crm.report.read'] }),
      fakeDelegation(),
      ...tools,
    );

    await assert.rejects(
      () => controller.invoke('secret', DELEGATION, {
        toolName: 'sales.get_sales_summary',
        context: { requestId: 'r-audit-down', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
      }),
      /audit insert failed/,
    );
    assert.equal(executed, 0, 'no durable provenance, no tool invocation');
  });

  it('does NOT return a quiet forbidden when the denial row cannot be written', async () => {
    // Only the DENIED row fails: the delegation-consume row lands, so this exercises the gate.
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      failingAudit((entry) => entry.result === 'DENIED'),
      fakeResolver({ permissions: ['crm.report.read'] }), // lacks the ai.tool.invoke gate
      fakeDelegation(),
      ...STUBS,
    );

    await assert.rejects(
      () => controller.invoke('secret', DELEGATION, {
        toolName: 'sales.get_sales_summary',
        context: { requestId: 'r-deny-unrecordable', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
      }),
      /audit insert failed/,
    );
  });

  it('audits a stale actor delegation as DENIED before rejecting the request', async () => {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      // Membership moved after the (still signature-valid, now consumed) delegation was issued.
      fakeResolver({ permissions: [AI], membershipId: 'm-current' }),
      fakeDelegation('m-stale'),
      ...STUBS,
    );

    await assert.rejects(
      () => controller.invoke('secret', DELEGATION, {
        toolName: 'company.get_current_context',
        context: { requestId: 'r-stale', companyId: 'c1', userId: 'u1', permissions: [AI], locale: 'th-TH' },
      }),
      (error: unknown) => error instanceof UnauthorizedException,
    );

    assert.equal(events.length, 1, 'the burned jti must leave exactly one durable row');
    assert.equal(events[0].action, 'ai.tool.invoke.denied');
    assert.equal(events[0].result, 'DENIED');
    assert.equal(events[0].riskLevel, 'MEDIUM');
    assert.equal(events[0].companyId, 'c1', 'verified company, not the delegation claim');
    assert.equal(events[0].actorUserId, 'u1');
    assert.equal(events[0].requestId, 'r-stale');
    assert.equal(events[0].targetId, 'company.get_current_context');
    assert.equal(events[0].metadataJson.reasonCode, 'STALE_ACTOR_DELEGATION');
    assert.equal(events[0].metadataJson.delegationCompanyId, 'c1');
    assert.equal(events[0].metadataJson.delegationMembershipId, 'm-stale');
    assert.equal(typeof events[0].metadataJson.durationMs, 'number');
  });

  it('audits the deny when the caller has no authoritative access, without a caller-claimed companyId', async () => {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      fakeResolver(null),
      fakeDelegation(),
      ...STUBS,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'company.get_current_context',
      context: { requestId: 'r-no-access', companyId: 'c-claimed', userId: 'u1', permissions: [AI], locale: 'th-TH' },
    });

    assert.equal(result.status, 'forbidden');
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'ai.tool.invoke.denied');
    assert.equal(events[0].result, 'DENIED');
    assert.equal(events[0].riskLevel, 'MEDIUM');
    assert.equal(events[0].requestId, 'r-no-access');
    assert.equal(events[0].companyId, undefined);
    assert.equal(events[0].metadataJson.reasonCode, 'NO_AUTHORITATIVE_ACCESS');
    assert.equal(events[0].metadataJson.claimedCompanyId, 'c-claimed');
    assert.equal(typeof events[0].metadataJson.durationMs, 'number');
  });

  it('audits the deny when the resolved access lacks the ai.tool.invoke gate', async () => {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      fakeResolver({ permissions: ['crm.report.read'] }),
      fakeDelegation(),
      ...STUBS,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'sales.get_sales_summary',
      context: { requestId: 'r-gate', companyId: 'c1', userId: 'u1', permissions: [AI], locale: 'th-TH' },
    });

    assert.equal(result.errorCode, 'AI_PERMISSION_DENIED');
    assert.equal(events.length, 2, 'delegation consume plus the deny row');
    assert.equal(events[1].action, 'ai.tool.invoke.denied');
    assert.equal(events[1].result, 'DENIED');
    assert.equal(events[1].riskLevel, 'MEDIUM');
    assert.equal(events[1].requestId, 'r-gate');
    assert.equal(events[1].companyId, 'c1');
    assert.equal(events[1].targetId, 'sales.get_sales_summary');
    assert.equal(events[1].metadataJson.reasonCode, 'AI_TOOL_GATE_MISSING');
    assert.equal(typeof events[1].metadataJson.durationMs, 'number');
  });

  it('audits the deny when an ERP registry permission is missing', async () => {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      fakeResolver({ permissions: [AI, 'tax.profile.read'] }),
      fakeDelegation(),
      ...STUBS,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'tax.get_tax_code_profile',
      context: { requestId: 'r-erp', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });

    assert.equal(result.errorCode, 'ERP_PERMISSION_DENIED');
    assert.equal(events.length, 2);
    assert.equal(events[1].action, 'ai.tool.invoke.denied');
    assert.equal(events[1].riskLevel, 'MEDIUM');
    assert.equal(events[1].requestId, 'r-erp');
    assert.equal(events[1].metadataJson.reasonCode, 'ERP_PERMISSION_DENIED');
  });

  it('audits unknown and not-yet-wired tools at LOW risk with distinct reason codes', async () => {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      fakeResolver({ permissions: [AI, 'crm.customer.read'] }),
      fakeDelegation(),
      ...STUBS,
    );
    const context = { requestId: 'r-unknown', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' };

    const known = await controller.invoke('secret', DELEGATION, { toolName: 'crm.suggest_sales_followups', context });
    const unknown = await controller.invoke('secret', DELEGATION, { toolName: 'not.a.real.tool', context });

    assert.equal(known.errorCode, 'SOURCE_MODULE_NOT_READY');
    assert.equal(unknown.errorCode, 'TOOL_NOT_FOUND');
    const denies = events.filter((entry) => entry.action === 'ai.tool.invoke.denied');
    assert.deepEqual(denies.map((entry) => entry.metadataJson.reasonCode), ['SOURCE_MODULE_NOT_READY', 'TOOL_NOT_FOUND']);
    assert.deepEqual(denies.map((entry) => entry.riskLevel), ['LOW', 'LOW']);
    assert.deepEqual(denies.map((entry) => entry.requestId), ['r-unknown', 'r-unknown']);
  });

  it('audits a sensitive tool execution error as FAILED at HIGH risk', async () => {
    const tools: any[] = Array.from({ length: 55 }, () => ({}));
    tools[11] = { execute: async () => { throw new Error('boom'); } };
    const { events, audit } = recordingAudit();
    const controller = makeController(
      { aiGatewayInternalSecret: 'secret' } as any,
      fakePrisma(),
      audit,
      fakeResolver({ permissions: [AI, 'crm.report.read'] }),
      fakeDelegation(),
      ...tools,
    );

    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'sales.get_sales_summary',
      context: { requestId: 'r-error', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });

    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'TOOL_EXECUTION_ERROR');
    assert.equal(events.length, 2);
    assert.equal(events[1].action, 'ai.tool.invoke.failed');
    assert.equal(events[1].result, 'FAILED');
    assert.equal(events[1].riskLevel, 'HIGH', 'sales.get_sales_summary is sensitiveAudit');
    assert.equal(events[1].requestId, 'r-error');
    assert.equal(events[1].companyId, 'c1');
    assert.equal(events[1].metadataJson.reasonCode, 'TOOL_EXECUTION_ERROR');
    assert.equal(typeof events[1].metadataJson.durationMs, 'number');
  });
});

/**
 * L-08: this executor is authoritative. The gateway's ToolPolicyEnforcerService can be bypassed by
 * anything holding the internal secret plus a valid delegation, so classification and the
 * final-mutation kill switch have to be re-decided here.
 */
describe('InternalToolsController — L-08 mutation classification at the ERP executor', () => {
  const OK_TOOL = { execute: async () => ({ status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }) };

  function build(options: { permissions: string[]; finalMutationEnabled?: boolean; draftEditEnabled?: boolean;
    reimbursementDraftWriteEnabled?: boolean; tools?: unknown[] }) {
    const { events, audit } = recordingAudit();
    const controller = makeController(
      {
        aiGatewayInternalSecret: 'secret',
        aiFinalMutationEnabled: options.finalMutationEnabled ?? false,
        // S-4: default OFF, so every existing assertion in this file describes the pre-S-4 executor.
        lineAiDraftEditEnabled: options.draftEditEnabled ?? false,
        lineAiReimbursementDraftWriteEnabled: options.reimbursementDraftWriteEnabled ?? false,
      } as any,
      fakePrisma(),
      audit,
      fakeResolver({ permissions: options.permissions }),
      fakeDelegation(),
      ...(options.tools ?? Array.from({ length: WIRED_TOOL_COUNT }, () => OK_TOOL)),
    );
    if (!options.tools) for (const name of controller.toolMap.keys()) {
      controller.toolMap.set(name, { execute: async () => ({ toolName: name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }) });
    }
    return { controller, events };
  }

  /** Adds a registry entry for the duration of one test; the registry is a shared module singleton. */
  function withRegistryEntry(entry: ToolMeta, run: () => Promise<ToolResult>): Promise<ToolResult> {
    LINE_TOOL_REGISTRY.push(entry);
    return run().finally(() => {
      LINE_TOOL_REGISTRY.splice(LINE_TOOL_REGISTRY.indexOf(entry), 1);
    });
  }

  const registryEntry = (name: string, category: string): ToolMeta => ({
    name,
    description: 'test-only entry',
    businessSubjects: [],
    questionKinds: ['summary'],
    category: category as ToolMeta['category'],
    // Deliberately empty: if classification ever ran *after* the permission check, an empty
    // requirement list would let this tool through, so the test would fail loudly.
    requiredPermissions: [],
    sourceModule: 'test',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  });

  const CONTEXT = { requestId: 'r-cat', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' };

  it('MC2 read-only list access never exposes voucher or substitute writes through internal tools', async () => {
    const { controller } = build({ permissions: [AI, 'expense.read', 'expense.review', 'expense.disbursement.read',
      'expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay', 'expense.disbursement.issue'],
      finalMutationEnabled: true });
    for (const toolName of ['voucher.create', 'voucher.approve', 'voucher.pay', 'voucher.issue',
      'expense.prepare_substitute_receipt', 'expense.sign_substitute_receipt']) {
      const result = await controller.invoke('secret', DELEGATION, { toolName, context: CONTEXT,
        input: { channel: 'line', lineConfirmed: true } });
      assert.equal(result.status, 'unavailable', toolName);
      assert.equal(result.errorCode, 'TOOL_NOT_FOUND', toolName);
      assert.equal(controller.toolMap.has(toolName), false);
    }
  });

  it('denies a tool name with no registry entry before any permission or dispatch decision', async () => {
    const { controller, events } = build({ permissions: [AI] });

    const result = await controller.invoke('secret', DELEGATION, { toolName: 'not.a.real.tool', context: CONTEXT });

    assert.equal(result.status, 'unavailable');
    assert.equal(result.errorCode, 'TOOL_NOT_FOUND');
    const denies = events.filter((entry: any) => entry.action === 'ai.tool.invoke.denied');
    assert.equal(denies.length, 1);
    assert.equal(denies[0].metadataJson.reasonCode, 'TOOL_NOT_FOUND');
  });

  it('keeps an unregistered name structurally undispatchable (every wired tool has a registry entry)', () => {
    const { controller } = build({ permissions: [AI] });
    const wired = [...((controller as any).toolMap as Map<string, unknown>).keys()];
    const registered = new Set(LINE_TOOL_REGISTRY.map((entry) => entry.name));
    const orphans = wired.filter((name) => !registered.has(name));
    assert.deepEqual(orphans, [], 'a wired tool with no registry entry could never be classified');
  });

  it('returns UNSUPPORTED_FILTER instead of silently dropping an undeclared input field', async () => {
    const { controller, events } = build({ permissions: [AI] });
    let executed = false;
    const entry = { ...registryEntry('test.strict_read', 'read_summary'), optionalInputFields: ['supported'] };
    controller.toolMap.set(entry.name, { execute: async () => { executed = true; return { toolName: entry.name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }; } });
    const result = await withRegistryEntry(entry, () => controller.invoke('secret', DELEGATION, {
      toolName: entry.name, context: CONTEXT, input: { silentlyIgnoredBefore: 'x' },
    }));
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
    assert.equal(executed, false);
    assert.equal(events.some((event: any) => event.metadataJson?.reasonCode === 'UNSUPPORTED_FILTER'), true);
  });

  it('rejects noncanonical expense enum values before list or breakdown adapter dispatch', async () => {
    for (const name of ['expense.list_recent', 'expense.get_breakdown']) {
      const { controller, events } = build({ permissions: [AI, 'expense.read'] });
      let executed = false;
      const entry = { ...registryEntry(name, 'read_summary'), optionalInputFields: ['documentStatus'],
        inputEnumValues: { documentStatus: ['DRAFT', 'CONFIRMED'] } };
      controller.toolMap.set(name, { execute: async () => { executed = true; return { toolName: name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }; } });
      const result = await withRegistryEntry(entry, () => controller.invoke('secret', DELEGATION, {
        toolName: name, context: CONTEXT, input: { documentStatus: 'confirmed' },
      }));
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
      assert.equal(executed, false);
      assert.equal(events.some((event: any) => event.metadataJson?.invalidEnumFields?.includes('documentStatus')), true);
    }
  });

  it('rejects a categoryName/vendorName outside its declared length before adapter dispatch', async () => {
    for (const name of ['expense.list_recent', 'expense.get_breakdown']) {
      const { controller, events } = build({ permissions: [AI, 'expense.read'] });
      let executed = false;
      const entry = { ...registryEntry(name, 'read_summary'), optionalInputFields: ['categoryName', 'vendorName'],
        inputLengthLimits: { categoryName: { min: 1, max: 80 }, vendorName: { min: 1, max: 80 } } };
      controller.toolMap.set(name, { execute: async () => { executed = true; return { toolName: name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString() }; } });
      const result = await withRegistryEntry(entry, () => controller.invoke('secret', DELEGATION, {
        toolName: name, context: CONTEXT, input: { categoryName: '' },
      }));
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
      assert.equal(executed, false);
      assert.equal(events.some((event: any) => event.metadataJson?.invalidLengthFields?.includes('categoryName')), true);

      const tooLong = await withRegistryEntry(entry, () => controller.invoke('secret', DELEGATION, {
        toolName: name, context: CONTEXT, input: { vendorName: 'x'.repeat(81) },
      }));
      assert.equal(tooLong.status, 'error');
      assert.equal(tooLong.errorCode, 'UNSUPPORTED_FILTER');
      assert.equal(executed, false);
    }
  });

  it('denies a registry-known tool whose category is not in the LINE-allowed set', async () => {
    const { controller, events } = build({ permissions: [AI] });

    const result = await withRegistryEntry(registryEntry('test.draft_create', 'draft_create'), () =>
      controller.invoke('secret', DELEGATION, { toolName: 'test.draft_create', context: CONTEXT }));

    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'AI_TOOL_CATEGORY_DENIED');
    const deny = events.find((entry: any) => entry.action === 'ai.tool.invoke.denied');
    assert.equal(deny.metadataJson.reasonCode, 'TOOL_CATEGORY_NOT_ALLOWED');
    assert.equal(deny.riskLevel, 'HIGH');
    assert.equal(deny.result, 'DENIED');
    assert.equal(deny.companyId, 'c1', 'the kill-switch trip is durable, not log-only');
  });

  it('denies an unrecognised category value', async () => {
    const { controller, events } = build({ permissions: [AI] });

    const result = await withRegistryEntry(registryEntry('test.nonsense', 'wildcard_everything'), () =>
      controller.invoke('secret', DELEGATION, { toolName: 'test.nonsense', context: CONTEXT }));

    assert.equal(result.errorCode, 'AI_TOOL_CATEGORY_DENIED');
    const deny = events.find((entry: any) => entry.action === 'ai.tool.invoke.denied');
    assert.equal(deny.metadataJson.reasonCode, 'TOOL_CATEGORY_UNKNOWN');
    assert.equal(deny.riskLevel, 'HIGH');
  });

  for (const category of ['final_mutation', 'approval_request']) {
    it(`denies the mutation category "${category}" while the ERP final-mutation switch is off`, async () => {
      const { controller, events } = build({ permissions: [AI], finalMutationEnabled: false });

      const result = await withRegistryEntry(registryEntry(`test.${category}`, category), () =>
        controller.invoke('secret', DELEGATION, { toolName: `test.${category}`, context: CONTEXT }));

      assert.equal(result.status, 'forbidden');
      const deny = events.find((entry: any) => entry.action === 'ai.tool.invoke.denied');
      assert.equal(deny.metadataJson.reasonCode, 'AI_FINAL_MUTATION_DISABLED');
      assert.equal(deny.riskLevel, 'HIGH');
    });
  }

  it('a kill-switch trip is alarmed, not just audited (L-14)', async () => {
    const { controller, events } = build({ permissions: [AI], finalMutationEnabled: false });
    const emitted: Record<string, unknown>[] = [];
    (controller as any).logger = { warn: (line: any) => emitted.push(line), error: (line: any) => emitted.push(line) };

    await withRegistryEntry(registryEntry('test.final_mutation', 'final_mutation'), () =>
      controller.invoke('secret', DELEGATION, { toolName: 'test.final_mutation', context: CONTEXT }));

    const alarm = emitted.find((line) => line['msg'] === 'ai.tool.invoke.denied');
    assert.ok(alarm, 'the production metric filter keys on this exact msg literal');
    assert.equal(alarm['riskLevel'], 'HIGH', 'riskLevel must be root-level for the existing alarm clause');
    assert.equal(alarm['reasonCode'], 'AI_FINAL_MUTATION_DISABLED');
    assert.equal(alarm['toolName'], 'test.final_mutation');
    assert.ok(
      events.some((entry: any) => entry.metadataJson?.reasonCode === 'AI_FINAL_MUTATION_DISABLED'),
      'and the durable row still exists — a kill-switch trip is never log-only',
    );
  });

  it('keeps the log event name and the audit action the same literal', () => {
    // The alarm reads logs; the audit trail reads rows. If these two drift, one of them stops
    // matching `$.msg = "ai.tool.invoke.denied"` silently.
    assert.equal(SECURITY_EVENT.aiToolInvokeDenied, AuditAction.AI_TOOL_INVOKE_DENIED);
  });

  it('still denies a mutation category with the switch on — the switch is necessary, not sufficient', async () => {
    const { controller, events } = build({ permissions: [AI], finalMutationEnabled: true });

    const result = await withRegistryEntry(registryEntry('test.final_mutation', 'final_mutation'), () =>
      controller.invoke('secret', DELEGATION, { toolName: 'test.final_mutation', context: CONTEXT }));

    assert.equal(result.errorCode, 'AI_TOOL_CATEGORY_DENIED');
    const deny = events.find((entry: any) => entry.action === 'ai.tool.invoke.denied');
    assert.equal(deny.metadataJson.reasonCode, 'TOOL_CATEGORY_NOT_ALLOWED');
  });

  it('every wired read tool keeps working — walked from the registry, not a hardcoded list', async () => {
    const { controller } = build({ permissions: [AI] });
    const wired = [...((controller as any).toolMap as Map<string, unknown>).keys()];
    assert.equal(wired.length, WIRED_TOOL_COUNT, 'the wired tool surface must not shrink');

    for (const toolName of wired) {
      const meta = LINE_TOOL_REGISTRY.find((entry) => entry.name === toolName)!;
      // S-4: the five `draft_update` tools are wired but gated on their own flag, which the walk
      // below leaves off. They get their own pair of tests instead of being smuggled in here.
      if (meta.category === LINE_DRAFT_UPDATE_TOOL_CATEGORY
        || (LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES as readonly string[]).includes(toolName)) continue;
      assert.ok(
        LINE_ALLOWED_TOOL_CATEGORIES.includes(meta.category),
        `${toolName} is categorised "${meta.category}", which the executor now denies`,
      );
      // Grant exactly what the registry entry demands, nothing more.
      const granted = [AI, ...meta.requiredPermissions, ...(meta.anyOfPermissions?.slice(0, 1) ?? [])];
      const { controller: scoped } = build({ permissions: granted });
      const result = await scoped.invoke('secret', DELEGATION, {
        toolName,
        context: { requestId: 'r-walk', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
      });
      assert.equal(result.status, 'ok', `${toolName} must still execute (got ${result.errorCode ?? result.status})`);
    }
  });

  // S-4 (draft-control spec §5.4/§8). The executor is the authoritative gate: whatever the gateway
  // catalog did or did not offer, a draft_update call is refused here unless this deployment
  // switched the lane on — and it is refused as ITSELF, not as a final mutation.
  it('refuses every draft_update tool while LINE_AI_DRAFT_EDIT_ENABLED is off', async () => {
    for (const toolName of LINE_DRAFT_UPDATE_TOOLS) {
      const { controller, events } = build({ permissions: [AI, 'expense.update'] });
      const result = await controller.invoke('secret', DELEGATION, {
        toolName,
        context: { requestId: 'r-off', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
      });
      assert.equal(result.status, 'forbidden', `${toolName} must not execute with the flag off`);
      assert.equal(result.errorCode, 'AI_TOOL_CATEGORY_DENIED');
      const deny = events.find((entry: any) => entry.action === 'ai.tool.invoke.denied');
      assert.equal(deny.metadataJson.reasonCode, 'LINE_DRAFT_EDIT_DISABLED');
    }
  });

  it('admits a draft_update tool with the flag on, and NOT via the final-mutation switch', async () => {
    const withFlag = build({ permissions: [AI, 'expense.update'], draftEditEnabled: true });
    const allowed = await withFlag.controller.invoke('secret', DELEGATION, {
      toolName: 'expense.draft.add_charge',
      context: { requestId: 'r-on', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });
    assert.equal(allowed.status, 'ok');

    // The final-mutation kill switch is a DIFFERENT switch: turning it on must not open this lane.
    const viaMutationSwitch = build({ permissions: [AI, 'expense.update'], finalMutationEnabled: true });
    const refused = await viaMutationSwitch.controller.invoke('secret', DELEGATION, {
      toolName: 'expense.draft.add_charge',
      context: { requestId: 'r-mut', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });
    assert.equal(refused.status, 'forbidden');
  });

  it('keeps all reimbursement draft tools behind their own default-off gate', async () => {
    for (const toolName of LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES) {
      const meta = LINE_TOOL_REGISTRY.find((entry) => entry.name === toolName)!;
      const permissions = [AI, ...meta.requiredPermissions, ...(meta.anyOfPermissions?.slice(0, 1) ?? [])];
      const off = build({ permissions });
      const denied = await off.controller.invoke('secret', DELEGATION, {
        toolName, context: { requestId: 'r-reimbursement-off', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
        input: Object.fromEntries((meta.requiredInputFields ?? []).map((field) => [field, field === 'subrequestIndex' ? 0 : {}])),
      });
      assert.equal(denied.status, 'forbidden');
      assert.equal(off.events.find((entry: any) => entry.action === 'ai.tool.invoke.denied')?.metadataJson.reasonCode,
        'LINE_REIMBURSEMENT_DRAFT_WRITE_DISABLED');
    }
  });

  it('admits reimbursement options with only its own switch and never the final-mutation switch', async () => {
    const permissions = [AI, 'reimbursement.create'];
    const on = build({ permissions, reimbursementDraftWriteEnabled: true });
    const admitted = await on.controller.invoke('secret', DELEGATION, {
      toolName: 'reimbursement.draft.get_options',
      context: { requestId: 'r-reimbursement-on', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
      input: { operation: 'CREATE', subrequestIndex: 0 },
    });
    assert.equal(admitted.status, 'ok');

    const wrongSwitch = build({ permissions, finalMutationEnabled: true });
    const denied = await wrongSwitch.controller.invoke('secret', DELEGATION, {
      toolName: 'reimbursement.draft.get_options',
      context: { requestId: 'r-reimbursement-wrong-switch', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
      input: { operation: 'CREATE', subrequestIndex: 0 },
    });
    assert.equal(denied.status, 'forbidden');
  });

  it('still requires expense.update — the same permission the web draft PATCH takes', async () => {
    const { controller } = build({ permissions: [AI], draftEditEnabled: true });
    const result = await controller.invoke('secret', DELEGATION, {
      toolName: 'expense.draft.add_charge',
      context: { requestId: 'r-perm', companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
    });
    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'ERP_PERMISSION_DENIED');
  });
});

// UAT 2026-08-15: the LINE menu stopped offering ยอดขายวันนี้ on a company with sales switched off,
// but typing the question as free text still reached sales.get_sales_summary and answered. The tool
// boundary is the authoritative gate, so the feature switch is enforced here too.
describe('InternalToolsController — company feature entitlement', () => {
  /** tax.get_tax_code_profile is wired at index 17 and owned by the `thai_tax` feature. */
  function taxController(rows: Array<{ featureKey: string; enabled: boolean }>, access?: Parameters<typeof fakeResolver>[0]) {
    const tools: { execute: (ctx: any) => Promise<any> }[] = Array.from({ length: 32 }, () => ({ execute: async () => ({ status: 'ok' }) }));
    tools[17] = {
      execute: async () => ({ toolName: 'tax.get_tax_code_profile', status: 'ok', data: { reviewRequired: false }, sourceRefs: [], asOf: new Date().toISOString() }),
    };
    return makeController(
      { aiGatewayInternalSecret: 'secret' },
      fakePrisma(rows),
      okAudit,
      fakeResolver(access ?? { permissions: [AI, 'tax.profile.read', 'tax.config.read'] }),
      fakeDelegation(),
      ...tools,
    ) as InternalToolsController;
  }

  const invokeTax = (controller: InternalToolsController) => controller.invoke('secret', DELEGATION, {
    toolName: 'tax.get_tax_code_profile',
    context: { companyId: 'c1', userId: 'u1', permissions: [], locale: 'th-TH' },
  } as any);

  it('refuses a tool whose owning feature the company switched off', async () => {
    const result = await invokeTax(taxController([{ featureKey: 'thai_tax', enabled: false }]));
    assert.equal(result.status, 'unsupported_module');
    assert.equal(result.errorCode, 'FEATURE_NOT_ENABLED');
    // A refusal never carries business data across the boundary.
    assert.equal(result.data, undefined);
    assert.deepEqual(result.sourceRefs, []);
  });

  it('runs the same tool once the feature is on', async () => {
    const result = await invokeTax(taxController([{ featureKey: 'thai_tax', enabled: true }]));
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.data, { reviewRequired: false });
  });

  it('leaves a legacy company with no entitlement rows untouched', async () => {
    const result = await invokeTax(taxController([]));
    assert.equal(result.status, 'ok', 'no entitlement rows is the fail-open legacy company');
  });

  it('reports a permission the feature switch removed as FEATURE_NOT_ENABLED, not a permission gap', async () => {
    // What the real resolver produces when thai_tax is off: the permission is stripped AND the
    // reason is recorded. Telling this user "🔒 คุณไม่มีสิทธิ์" would send them to an admin for a
    // grant their role already carries.
    const result = await invokeTax(taxController([{ featureKey: 'thai_tax', enabled: false }], {
      permissions: [AI, 'tax.profile.read'],
      entitlementDeniedPermissions: { 'tax.config.read': 'thai_tax' },
    }));
    assert.equal(result.status, 'unsupported_module');
    assert.equal(result.errorCode, 'FEATURE_NOT_ENABLED');
  });

  it('still reports a real permission gap as ERP_PERMISSION_DENIED even beside an unrelated feature switch', async () => {
    const result = await invokeTax(taxController([{ featureKey: 'thai_tax', enabled: true }], {
      permissions: [AI, 'tax.profile.read'],
      entitlementDeniedPermissions: { 'crm.report.read': 'crm' },
    }));
    assert.equal(result.status, 'forbidden');
    assert.equal(result.errorCode, 'ERP_PERMISSION_DENIED');
  });

  it('gates the reported sales tool, whose permission belongs to a different feature than its data', async () => {
    // sales.get_sales_summary requires crm.report.read but reads sales documents, so CRM being on
    // used to be enough. Only the tool-level feature key closes it.
    const salesTool = LINE_TOOL_REGISTRY.find((tool) => tool.name === 'sales.get_sales_summary');
    assert.deepEqual(toolFeatureKeys(salesTool!), ['sales_documents']);
    assert.equal(hasToolFeature(salesTool!, new Set(['crm', 'crm.overview'])), false);
    assert.equal(hasToolFeature(salesTool!, new Set(['sales_documents'])), true);
  });

  it('never gates reimbursement reads, which outlive their feature switch by owner decision', async () => {
    // Owner decision 2026-08-10 (launch matrix §6.3 r5): disabling reimbursement blocks new claims
    // but in-flight approvals keep flowing, so an approver must still be able to ask LINE.
    for (const name of ['reimbursement.list_pending_approvals', 'reimbursement.get_summary', 'reimbursement.get_detail', 'reimbursement.get_approval_backlog']) {
      const tool = LINE_TOOL_REGISTRY.find((entry) => entry.name === name);
      assert.deepEqual(toolFeatureKeys(tool!), [], `${name} must stay ungated`);
      assert.equal(hasToolFeature(tool!, new Set(['expenses'])), true, name);
    }
  });
});

it('Round 7A counterparty tools re-resolve permissions, retain branch scopes and use expenses OR sales feature admission', async () => {
  for (const feature of ['expenses', 'sales_documents', 'procurement']) {
    for (const name of ['counterparty.search', 'counterparty.get_detail', 'counterparty.action.preview']) {
      const seen: any[] = [], tools: any[] = Array.from({ length: 80 }, () => ({}));
      const index = name === 'counterparty.search' ? 77 : name === 'counterparty.get_detail' ? 78 : 79;
      tools[index] = { execute: async (ctx: any) => { seen.push(ctx); return { toolName: name, status: 'ok', sourceRefs: [], asOf: new Date().toISOString(), data: {} }; } };
      const controller = makeController({ aiGatewayInternalSecret: 'secret', lineAiDraftEditEnabled: false } as any,
        fakePrisma([{ featureKey: feature, enabled: true }]), okAudit,
        fakeResolver({ permissions: [AI, 'accounting.counterparty.read'], branchIds: ['b1'] }), fakeDelegation(), ...tools);
      const response = await controller.invoke('secret', DELEGATION, { toolName: name, context: { companyId: 'c1', userId: 'u1', locale: 'th-TH', permissions: ['accounting.counterparty.manage'], branchIds: ['attacker-branch'] },
        input: name === 'counterparty.action.preview' ? { action: 'UPDATE', counterpartyId: 'cp1', addressText: 'ใหม่' } : name === 'counterparty.get_detail' ? { counterpartyId: 'cp1' } : { search: 'ร้าน' } });
      if (feature === 'procurement') { assert.equal(response.errorCode, 'FEATURE_NOT_ENABLED'); assert.equal(seen.length, 0); }
      else { assert.equal(response.status, 'ok'); assert.deepEqual(seen[0].branchIds, ['b1']); assert.equal(seen[0].permissions.includes('accounting.counterparty.manage'), false); }
    }
  }
});
