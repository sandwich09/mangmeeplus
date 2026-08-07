import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GetCrmInboxPolicyUseCase, UpdateCrmInboxPolicyUseCase } from './crm-inbox-policy.use-case';

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'admin-1', companyId: 'co-1',
    membershipId: 'm', roles: ['ADMIN'],
    permissions: ['crm.inbox.policy_manage'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, log: async (entry: any) => { entries.push(entry); } } as any;
}
const noopOutbox = { append: async () => undefined } as any;

function policyRow(overrides: Partial<any> = {}) {
  return {
    id: 'pol-1', companyId: 'co-1', firstResponseMinutes: 60,
    businessHoursJson: { start: '08:00', end: '17:00', timezone: 'Asia/Bangkok' },
    updatedByUserId: 'admin-1', createdAt: new Date(), updatedAt: new Date('2026-07-06T05:00:00Z'),
    ...overrides,
  } as any;
}

function makeRepo(row: any = null) {
  const calls: any[] = [];
  return {
    calls,
    getInboxPolicy: async () => row,
    upsertInboxPolicy: async (companyId: string, data: any) => {
      calls.push({ companyId, data });
      return policyRow({ firstResponseMinutes: data.firstResponseMinutes, businessHoursJson: data.businessHoursJson });
    },
  } as any;
}

describe('GetCrmInboxPolicyUseCase', () => {
  it('returns the spec defaults with isDefault when no row exists', async () => {
    const dto = await new GetCrmInboxPolicyUseCase(makeRepo(null)).execute(ctx());
    assert.deepEqual(dto, {
      firstResponseMinutes: 30,
      businessHours: { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' },
      isDefault: true,
      updatedAt: undefined,
    });
  });

  it('maps a saved row, including the explicit 24/7 (null hours) choice', async () => {
    const dto = await new GetCrmInboxPolicyUseCase(makeRepo(policyRow({ businessHoursJson: null }))).execute(ctx());
    assert.equal(dto.firstResponseMinutes, 60);
    assert.equal(dto.businessHours, null);
    assert.equal(dto.isDefault, false);
    assert.equal(dto.updatedAt, '2026-07-06T05:00:00.000Z');
  });

  it('rejects callers without crm.inbox.policy_manage', async () => {
    await assert.rejects(
      new GetCrmInboxPolicyUseCase(makeRepo(null)).execute(ctx({ permissions: ['crm.inbox.read'] })),
      /crm\.inbox\.policy_manage/,
    );
  });
});

describe('UpdateCrmInboxPolicyUseCase', () => {
  const hours = { start: '09:00', end: '18:00', timezone: 'Asia/Bangkok' };

  it('upserts, audits HIGH, and returns the saved policy', async () => {
    const repo = makeRepo(null);
    const audit = makeAudit();
    const dto = await new UpdateCrmInboxPolicyUseCase(repo, audit, noopOutbox).execute(ctx(), {
      firstResponseMinutes: 45,
      businessHours: hours,
    });
    assert.equal(repo.calls.length, 1);
    assert.deepEqual(repo.calls[0].data, { firstResponseMinutes: 45, businessHoursJson: hours, updatedByUserId: 'admin-1' });
    assert.equal(dto.firstResponseMinutes, 45);
    assert.deepEqual(dto.businessHours, hours);
    assert.equal(dto.isDefault, false);
    assert.equal(audit.entries.length, 1);
    assert.equal(audit.entries[0].action, 'crm.inbox.policy_update');
    assert.equal(audit.entries[0].riskLevel, 'HIGH');
  });

  it('persists null business hours as the 24/7 clock', async () => {
    const repo = makeRepo(policyRow());
    const dto = await new UpdateCrmInboxPolicyUseCase(repo, makeAudit(), noopOutbox).execute(ctx(), {
      firstResponseMinutes: 30,
      businessHours: null,
    });
    assert.equal(repo.calls[0].data.businessHoursJson, null);
    assert.equal(dto.businessHours, null);
  });

  it('rejects invalid inputs with stable error codes', async () => {
    const uc = new UpdateCrmInboxPolicyUseCase(makeRepo(null), makeAudit(), noopOutbox);
    await assert.rejects(uc.execute(ctx(), { firstResponseMinutes: 0, businessHours: null }), /minutes_out_of_range/);
    await assert.rejects(
      uc.execute(ctx(), { firstResponseMinutes: 30, businessHours: { ...hours, end: '08:00' } }),
      /business_hours_end_before_start/,
    );
    await assert.rejects(
      uc.execute(ctx(), { firstResponseMinutes: 30, businessHours: { ...hours, timezone: 'Not/AZone' } }),
      /invalid_timezone/,
    );
  });

  it('rejects callers without crm.inbox.policy_manage', async () => {
    await assert.rejects(
      new UpdateCrmInboxPolicyUseCase(makeRepo(null), makeAudit(), noopOutbox).execute(
        ctx({ permissions: ['crm.inbox.resolve'] }),
        { firstResponseMinutes: 30, businessHours: null },
      ),
      /crm\.inbox\.policy_manage/,
    );
  });
});
