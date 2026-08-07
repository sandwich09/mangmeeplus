import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MessagingChannelSecretsService,
  ConnectMessagingChannelUseCase,
  ListMessagingChannelsUseCase,
  RevealMessagingChannelCredentialUseCase,
  DisableMessagingChannelUseCase,
  RotateMessagingChannelCredentialUseCase,
  TestMessagingChannelUseCase,
  UpdateMessagingChannelSettingsUseCase,
} from './messaging-channel.use-case';
import { MessagingChannelController } from '../../presentation/http/messaging-channel.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';

const KEY = Buffer.alloc(32, 7);
const fakeConfig = { credentialEncryptionKey: KEY, publicApiBaseUrl: 'https://api.example.com' } as any;

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'admin-1', companyId: 'co-1',
    membershipId: 'm', roles: ['ADMIN'],
    permissions: ['crm.channel.read', 'crm.channel.manage'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function makeAudit() {
  const entries: any[] = [];
  return { entries, log: async (entry: any) => { entries.push(entry); } } as any;
}
const noopOutbox = { append: async () => undefined } as any;
const okLine = {
  getBotInfo: async () => ({ ok: true, botDisplayName: 'ร้านบอท' }),
  getTokenChannelId: async () => null, // fail-open default (token type without verify support)
  verifyChannelSecret: async () => null, // fail-open default (oauth probe undeterminable)
} as any;

const secrets = new MessagingChannelSecretsService(fakeConfig);

function channelRecord(overrides: Partial<any> = {}) {
  return {
    id: 'ch-1', companyId: 'co-1', provider: 'LINE_OA', displayName: 'ร้าน',
    lineChannelId: '1234567890',
    encryptedSecretJson: secrets.encrypt({ channelId: '1234567890', channelSecret: 'secret-secret', accessToken: 'token-token-1234' }),
    credentialLast4: '1234', secretVersion: 1, webhookKey: 'whk-abc',
    status: 'CONNECTED', lastWebhookAt: null, lastValidatedAt: null, lastErrorAt: null, lastErrorCode: null,
    connectedByUserId: 'admin-1', disabledAt: null, disabledByUserId: null, disableReason: null,
    autoReplyEnabled: false, autoReplyDailyCap: 50,
    defaultBookingStaffUserId: null, defaultBookingBranchId: null,
    createdAt: new Date(), updatedAt: new Date(), ...overrides,
  } as any;
}

describe('ConnectMessagingChannelUseCase', () => {
  it('encrypts credentials, masks the DTO, and audits', async () => {
    let createdData: any = null;
    const repo = {
      findActiveChannelByLineChannelId: async () => null,
      findCompanyChannelByLineChannelId: async () => null,
      createChannel: async (data: any) => {
        createdData = data;
        return channelRecord({ encryptedSecretJson: data.encryptedSecretJson, webhookKey: data.webhookKey });
      },
    } as any;
    const audit = makeAudit();
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, okLine, audit, noopOutbox);

    const dto = await uc.execute(ctx(), {
      displayName: 'ร้าน', lineChannelId: '1234567890',
      channelSecret: 'secret-secret', accessToken: 'token-token-1234',
    });

    // stored encrypted, decryptable back to the original token
    assert.doesNotMatch(createdData.encryptedSecretJson, /token-token-1234/);
    const decrypted = secrets.decrypt(channelRecord({ encryptedSecretJson: createdData.encryptedSecretJson }));
    assert.equal(decrypted.accessToken, 'token-token-1234');
    // webhook key is url-safe and long enough to be unguessable
    assert.match(createdData.webhookKey, /^[A-Za-z0-9_-]{30,}$/);
    // DTO never carries secrets
    const serialized = JSON.stringify(dto);
    assert.doesNotMatch(serialized, /secret-secret/);
    assert.doesNotMatch(serialized, /token-token-1234/);
    assert.equal(dto.credentialLast4, '1234');
    // manage caller sees the webhook URL on the API public origin
    assert.ok(dto.webhookUrl!.startsWith('https://api.example.com/v1/crm/line/webhook/'));
    assert.equal(audit.entries[0].action, 'crm.channel.connect');
  });

  it('blocks a LINE channel already connected anywhere without leaking the owner', async () => {
    const repo = {
      findActiveChannelByLineChannelId: async () => channelRecord({ companyId: 'other-co' }),
      findCompanyChannelByLineChannelId: async () => null,
      createChannel: async () => { throw new Error('should not create'); },
    } as any;
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, okLine, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), {
        displayName: 'ร้าน', lineChannelId: '1234567890',
        channelSecret: 'secret-secret', accessToken: 'token-token-1234',
      }),
      (err: any) => {
        const message = String(err?.message ?? '');
        return message.includes('already connected') && !message.includes('other-co');
      },
    );
  });

  it('fails closed when LINE rejects the token', async () => {
    const badLine = {
      getBotInfo: async () => ({ ok: false, error: 'invalid_access_token' }),
      getTokenChannelId: async () => null,
    } as any;
    const repo = {
      findActiveChannelByLineChannelId: async () => null,
      findCompanyChannelByLineChannelId: async () => null,
      createChannel: async () => { throw new Error('should not create'); },
    } as any;
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, badLine, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), {
        displayName: 'ร้าน', lineChannelId: '1234567890',
        channelSecret: 'secret-secret', accessToken: 'token-token-1234',
      }),
      /invalid_access_token/,
    );
  });

  it('rejects a claimed channel id that does not match the access token', async () => {
    const mismatchLine = {
      getBotInfo: async () => ({ ok: true, botDisplayName: 'ร้านบอท' }),
      getTokenChannelId: async () => '9999999999',
    } as any;
    const repo = {
      findActiveChannelByLineChannelId: async () => { throw new Error('dedup must not run before credential checks'); },
      findCompanyChannelByLineChannelId: async () => null,
      createChannel: async () => { throw new Error('should not create'); },
    } as any;
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, mismatchLine, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), {
        displayName: 'ร้าน', lineChannelId: '1234567890',
        channelSecret: 'secret-secret', accessToken: 'token-token-1234',
      }),
      /does not match/,
    );
  });

  it('rejects a channel secret that LINE says is wrong for this channel', async () => {
    const wrongSecretLine = {
      getBotInfo: async () => ({ ok: true, botDisplayName: 'ร้านบอท' }),
      getTokenChannelId: async () => null,
      verifyChannelSecret: async () => false,
    } as any;
    const repo = {
      findActiveChannelByLineChannelId: async () => { throw new Error('dedup must not run before credential checks'); },
      findCompanyChannelByLineChannelId: async () => null,
      createChannel: async () => { throw new Error('should not create'); },
    } as any;
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, wrongSecretLine, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), {
        displayName: 'ร้าน', lineChannelId: '1234567890',
        channelSecret: 'wrong-secret-1234', accessToken: 'token-token-1234',
      }),
      /Channel Secret does not match/,
    );
  });

  it('reconnecting after disable revives the same row instead of hitting the unique constraint', async () => {
    const disabled = channelRecord({
      status: 'DISABLED', disabledAt: new Date(), disableReason: 'เปลี่ยน OA', webhookKey: 'whk-old',
    });
    let updatedData: any = null;
    const repo = {
      findActiveChannelByLineChannelId: async () => null, // DISABLED rows are excluded here
      findCompanyChannelByLineChannelId: async () => disabled,
      createChannel: async () => { throw new Error('must revive, not create'); },
      updateChannel: async (_id: string, data: any) => {
        updatedData = data;
        return channelRecord({ ...disabled, ...data, secretVersion: 2, status: 'CONNECTED', disabledAt: null, disableReason: null });
      },
    } as any;
    const audit = makeAudit();
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, okLine, audit, noopOutbox);

    const dto = await uc.execute(ctx(), {
      displayName: 'ร้าน (ใหม่)', lineChannelId: '1234567890',
      channelSecret: 'new-secret-secret', accessToken: 'new-token-5678',
    });

    assert.equal(dto.status, 'CONNECTED');
    assert.equal(updatedData.status, 'CONNECTED');
    assert.equal(updatedData.disabledAt, null);
    assert.notEqual(updatedData.webhookKey, 'whk-old'); // fresh webhook key on revive
    assert.equal(audit.entries[0].action, 'crm.channel.reconnect');
  });

  it('maps a create-race unique violation to the same generic already-connected error', async () => {
    const repo = {
      findActiveChannelByLineChannelId: async () => null,
      findCompanyChannelByLineChannelId: async () => null,
      createChannel: async () => {
        const err: any = new Error('unique violation');
        err.code = 'P2002';
        throw err;
      },
    } as any;
    const uc = new ConnectMessagingChannelUseCase(repo, secrets, okLine, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), {
        displayName: 'ร้าน', lineChannelId: '1234567890',
        channelSecret: 'secret-secret', accessToken: 'token-token-1234',
      }),
      /already connected/,
    );
  });

  it('denies without crm.channel.manage', async () => {
    const uc = new ConnectMessagingChannelUseCase({} as any, secrets, okLine, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.channel.read'] }), {
        displayName: 'ร้าน', lineChannelId: '1234567890',
        channelSecret: 'secret-secret', accessToken: 'token-token-1234',
      }),
      /Missing permission/,
    );
  });
});

describe('ListMessagingChannelsUseCase', () => {
  it('hides the webhook path from read-only callers', async () => {
    const repo = { listChannels: async () => [channelRecord()] } as any;
    const uc = new ListMessagingChannelsUseCase(repo, secrets);
    const [readOnly] = await uc.execute(ctx({ permissions: ['crm.channel.read'] }));
    assert.equal(readOnly.webhookPath, undefined);
    assert.equal(readOnly.webhookUrl, undefined);
    assert.equal(readOnly.autoReplyEnabled, undefined);
    assert.equal(readOnly.autoReplyDailyCap, undefined);
    assert.equal(readOnly.defaultBookingStaffUserId, undefined);
    assert.equal(readOnly.defaultBookingBranchId, undefined);
    assert.doesNotMatch(JSON.stringify(readOnly), /whk-abc/);
    const [manager] = await uc.execute(ctx());
    assert.ok(manager.webhookPath!.includes('whk-abc'));
    assert.equal(manager.autoReplyEnabled, false);
    assert.equal(manager.autoReplyDailyCap, 50);
  });
});

describe('UpdateMessagingChannelSettingsUseCase', () => {
  const input = {
    autoReplyEnabled: true,
    autoReplyDailyCap: 25,
    defaultBookingStaffUserId: 'staff-1',
    defaultBookingBranchId: 'branch-1',
  };

  it('requires crm.channel.manage in both the route gate and use case', async () => {
    const permissions = Reflect.getMetadata(
      REQUIRED_PERMISSIONS_KEY,
      MessagingChannelController.prototype.updateSettings,
    ) as string[] | undefined;
    assert.deepEqual(permissions, ['crm.channel.manage']);

    const uc = new UpdateMessagingChannelSettingsUseCase({} as any, secrets, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx({ permissions: ['crm.channel.read'] }), 'ch-1', input),
      /Missing permission/,
    );
  });

  it('rejects a negative or fractional daily cap before persistence', async () => {
    const repo = { findChannelById: async () => { throw new Error('must not query'); } } as any;
    const uc = new UpdateMessagingChannelSettingsUseCase(repo, secrets, makeAudit(), noopOutbox);
    for (const autoReplyDailyCap of [-1, 1.5]) {
      await assert.rejects(
        () => uc.execute(ctx(), 'ch-1', { ...input, autoReplyDailyCap }),
        /integer greater than or equal to 0/,
      );
    }
  });

  it('rejects a default staff user without an ACTIVE company membership', async () => {
    const repo = {
      findChannelById: async (companyId: string) => {
        assert.equal(companyId, 'co-1');
        return channelRecord();
      },
      hasActiveCompanyMember: async (companyId: string, userId: string) => {
        assert.deepEqual([companyId, userId], ['co-1', 'staff-other-company']);
        return false;
      },
    } as any;
    const uc = new UpdateMessagingChannelSettingsUseCase(repo, secrets, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), 'ch-1', { ...input, defaultBookingStaffUserId: 'staff-other-company' }),
      /active company member/,
    );
  });

  it('rejects a default branch outside the company', async () => {
    const repo = {
      findChannelById: async () => channelRecord(),
      hasCompanyBranch: async (companyId: string, branchId: string) => {
        assert.deepEqual([companyId, branchId], ['co-1', 'branch-other-company']);
        return false;
      },
    } as any;
    const uc = new UpdateMessagingChannelSettingsUseCase(repo, secrets, makeAudit(), noopOutbox);
    await assert.rejects(
      () => uc.execute(ctx(), 'ch-1', {
        ...input,
        defaultBookingStaffUserId: null,
        defaultBookingBranchId: 'branch-other-company',
      }),
      /belong to the company/,
    );
  });

  it('persists a tenant-scoped valid update and audits all four fields before/after', async () => {
    const before = channelRecord();
    let updatedData: any;
    const repo = {
      findChannelById: async (companyId: string, channelId: string) => {
        assert.deepEqual([companyId, channelId], ['co-1', 'ch-1']);
        return before;
      },
      hasActiveCompanyMember: async () => true,
      hasCompanyBranch: async () => true,
      hasActiveBookingStaffBranch: async () => true,
      updateChannel: async (channelId: string, data: any) => {
        assert.equal(channelId, 'ch-1');
        updatedData = data;
        return channelRecord({ ...data });
      },
    } as any;
    const audit = makeAudit();
    const outboxEntries: any[] = [];
    const outbox = { append: async (...args: any[]) => { outboxEntries.push(args); } } as any;
    const uc = new UpdateMessagingChannelSettingsUseCase(repo, secrets, audit, outbox);

    const result = await uc.execute(ctx(), 'ch-1', input);

    assert.deepEqual(updatedData, input);
    assert.equal(result.autoReplyEnabled, true);
    assert.equal(result.autoReplyDailyCap, 25);
    assert.equal(result.defaultBookingStaffUserId, 'staff-1');
    assert.equal(result.defaultBookingBranchId, 'branch-1');
    assert.equal(audit.entries[0].action, 'crm.channel.settings.update');
    assert.deepEqual(audit.entries[0].metadataJson.before, {
      autoReplyEnabled: false,
      autoReplyDailyCap: 50,
      defaultBookingStaffUserId: null,
      defaultBookingBranchId: null,
    });
    assert.deepEqual(audit.entries[0].metadataJson.after, input);
    assert.equal(outboxEntries[0][0], 'crm.channel.settings.updated');
  });

  it('accepts null defaults to clear them', async () => {
    let updatedData: any;
    const repo = {
      findChannelById: async () => channelRecord({
        defaultBookingStaffUserId: 'staff-1',
        defaultBookingBranchId: 'branch-1',
      }),
      updateChannel: async (_channelId: string, data: any) => {
        updatedData = data;
        return channelRecord({ ...data });
      },
    } as any;
    const uc = new UpdateMessagingChannelSettingsUseCase(repo, secrets, makeAudit(), noopOutbox);
    await uc.execute(ctx(), 'ch-1', {
      autoReplyEnabled: false,
      autoReplyDailyCap: 0,
      defaultBookingStaffUserId: null,
      defaultBookingBranchId: null,
    });
    assert.equal(updatedData.defaultBookingStaffUserId, null);
    assert.equal(updatedData.defaultBookingBranchId, null);
  });

  it('rejects a default booking pair when the staff cannot access the active branch', async () => {
    const repo = {
      findChannelById: async () => channelRecord(),
      hasActiveCompanyMember: async () => true,
      hasCompanyBranch: async () => true,
      hasActiveBookingStaffBranch: async () => false,
    } as any;
    const uc = new UpdateMessagingChannelSettingsUseCase(repo, secrets, makeAudit(), noopOutbox);

    await assert.rejects(
      () => uc.execute(ctx(), 'ch-1', input),
      /cannot access the selected active branch/,
    );
  });
});

describe('RevealMessagingChannelCredentialUseCase', () => {
  it('returns decrypted credentials and writes a CRITICAL audit entry', async () => {
    const repo = { findChannelById: async () => channelRecord() } as any;
    const audit = makeAudit();
    const uc = new RevealMessagingChannelCredentialUseCase(repo, secrets, audit);
    const revealed = await uc.execute(ctx(), 'ch-1');
    assert.equal(revealed.channelSecret, 'secret-secret');
    assert.equal(revealed.accessToken, 'token-token-1234');
    assert.equal(audit.entries[0].action, 'crm.channel.reveal_credential');
    assert.equal(audit.entries[0].riskLevel, 'CRITICAL');
    // audit metadata must not contain the secrets themselves
    assert.doesNotMatch(JSON.stringify(audit.entries[0]), /secret-secret|token-token-1234/);
  });

  it('does NOT return secrets when the audit write fails (no audit -> no reveal)', async () => {
    const repo = { findChannelById: async () => channelRecord() } as any;
    const failingAudit = { log: async () => { throw new Error('audit db down'); } } as any;
    const uc = new RevealMessagingChannelCredentialUseCase(repo, secrets, failingAudit);
    await assert.rejects(() => uc.execute(ctx(), 'ch-1'), /audit db down/);
  });
});

describe('TestMessagingChannelUseCase', () => {
  it('rejects testing a DISABLED channel so a failed test can never flip it to ERROR', async () => {
    const repo = {
      findChannelById: async () => channelRecord({ status: 'DISABLED' }),
      updateChannel: async () => { throw new Error('must not update a disabled channel'); },
    } as any;
    const badLine = {
      getBotInfo: async () => ({ ok: false, error: 'line_api_unreachable' }),
      getTokenChannelId: async () => null,
    } as any;
    const uc = new TestMessagingChannelUseCase(repo, secrets, badLine);
    await assert.rejects(() => uc.execute(ctx(), 'ch-1'), /disabled/i);
  });
});

describe('RotateMessagingChannelCredentialUseCase', () => {
  it('rejects a wrong secret and keeps the stored credential untouched', async () => {
    const wrongSecretLine = {
      getBotInfo: async () => ({ ok: true, botDisplayName: 'ร้านบอท' }),
      verifyChannelSecret: async (channelId: string) => {
        assert.equal(channelId, '1234567890'); // probes the channel on record, not caller input
        return false;
      },
    } as any;
    const repo = {
      findChannelById: async () => channelRecord(),
      updateChannel: async () => { throw new Error('must not persist a wrong secret'); },
    } as any;
    const uc = new RotateMessagingChannelCredentialUseCase(repo, secrets, wrongSecretLine, makeAudit());
    await assert.rejects(
      () => uc.execute(ctx(), 'ch-1', { channelSecret: 'wrong-secret-1234', accessToken: 'token-token-5678' }),
      /Channel Secret does not match/,
    );
  });
});

describe('DisableMessagingChannelUseCase', () => {
  it('requires a reason and marks the channel disabled', async () => {
    const updates: any[] = [];
    const repo = {
      findChannelById: async () => channelRecord(),
      updateChannel: async (_id: string, data: any) => { updates.push(data); return channelRecord({ ...data }); },
    } as any;
    const uc = new DisableMessagingChannelUseCase(repo, secrets, makeAudit(), noopOutbox);
    await assert.rejects(() => uc.execute(ctx(), 'ch-1', { reason: '  ' }), /reason/);
    const dto = await uc.execute(ctx(), 'ch-1', { reason: 'เปลี่ยนไปใช้ OA ใหม่' });
    assert.equal(updates[0].status, 'DISABLED');
    assert.equal(dto.status, 'DISABLED');
  });
});
