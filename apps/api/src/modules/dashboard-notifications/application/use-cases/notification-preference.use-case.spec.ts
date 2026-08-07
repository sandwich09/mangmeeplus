import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UpdatePreferenceUseCase } from './notification.use-cases';
import { PrismaNotificationPreferenceRepository } from '../../infrastructure/prisma-notification.repository';
import { DEFAULT_ENABLED_CHANNELS, IMPLEMENTED_TRIGGER_KEYS } from '../../domain/models/notification.model';

const noopAudit = { log: async () => undefined } as any;

function ctx() {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'user-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'], permissions: ['notification.preference.manage'],
    scopes: {}, authProvider: 'dev',
  } as any;
}

/** Real repository over a fake client, so the create-vs-update branch of upsert is exercised. */
function harness(existingRow?: Record<string, unknown>) {
  const state = { row: (existingRow ?? null) as any };
  const captured = { create: undefined as any, update: undefined as any };
  const client = {
    notificationPreference: {
      findUnique: async () => state.row,
      upsert: async ({ create, update }: any) => {
        if (state.row) {
          captured.update = update;
          state.row = { ...state.row, ...update };
        } else {
          captured.create = create;
          state.row = { id: 'pref-1', quietHoursStart: null, quietHoursEnd: null, ...create };
        }
        return state.row;
      },
    },
  };
  return {
    useCase: new UpdatePreferenceUseCase(new PrismaNotificationPreferenceRepository({ client } as any), noopAudit),
    captured,
    row: () => state.row,
  };
}

function existingPreference(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pref-1', companyId: 'co-1', userId: 'user-1',
    enabledChannelsJson: ['web', 'line'], enabledTriggerKeysJson: ['stock_low'],
    timezone: 'Asia/Bangkok', digestFrequency: 'NONE',
    quietHoursStart: null, quietHoursEnd: null, ...overrides,
  };
}

describe('UpdatePreferenceUseCase row creation defaults', () => {
  it('saving only quiet hours as the first ever save keeps every channel and trigger enabled', async () => {
    const h = harness();

    const result = await h.useCase.execute(ctx(), 'co-1', { quietHoursStart: '22:00', quietHoursEnd: '07:00' } as any);

    // The `[]` column defaults would have meant "suppress every LINE push", silently and
    // permanently, for a user who only set quiet hours.
    assert.deepEqual(h.captured.create.enabledTriggerKeysJson, IMPLEMENTED_TRIGGER_KEYS);
    assert.deepEqual(h.captured.create.enabledChannelsJson, DEFAULT_ENABLED_CHANNELS);
    assert.deepEqual(result.enabledTriggerKeys, IMPLEMENTED_TRIGGER_KEYS);
    assert.deepEqual(result.enabledChannels, DEFAULT_ENABLED_CHANNELS);
    // The reimbursement notification chain must survive that first save.
    assert.ok(h.captured.create.enabledTriggerKeysJson.includes('workflow.reimbursement_pending_approval'));
    assert.ok(h.captured.create.enabledChannelsJson.includes('line'));
  });

  it('honours an explicit empty opt-out at creation time', async () => {
    const h = harness();
    await h.useCase.execute(ctx(), 'co-1', { enabledTriggerKeys: [], enabledChannels: [] } as any);
    assert.deepEqual(h.captured.create.enabledTriggerKeysJson, []);
    assert.deepEqual(h.captured.create.enabledChannelsJson, []);
  });

  it('never re-widens an existing row: a quiet-hours-only update leaves the user narrowing intact', async () => {
    const h = harness(existingPreference());

    const result = await h.useCase.execute(ctx(), 'co-1', { quietHoursStart: '23:00' } as any);

    assert.equal('enabledTriggerKeysJson' in h.captured.update, false);
    assert.equal('enabledChannelsJson' in h.captured.update, false);
    assert.deepEqual(h.row().enabledTriggerKeysJson, ['stock_low']);
    assert.deepEqual(result.enabledTriggerKeys, ['stock_low']);
    assert.equal(h.row().quietHoursStart, '23:00');
  });

  it('honours an explicit empty array on update as "opt out of all"', async () => {
    const h = harness(existingPreference());

    const result = await h.useCase.execute(ctx(), 'co-1', { enabledTriggerKeys: [], enabledChannels: [] } as any);

    assert.deepEqual(h.captured.update.enabledTriggerKeysJson, []);
    assert.deepEqual(h.captured.update.enabledChannelsJson, []);
    assert.deepEqual(result.enabledTriggerKeys, []);
    assert.deepEqual(result.enabledChannels, []);
  });
});
