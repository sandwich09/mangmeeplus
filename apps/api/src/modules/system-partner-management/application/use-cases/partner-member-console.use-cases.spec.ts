import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ListPartnerMembersUseCase } from './list-partner-members.use-case';
import { PartnerMemberLineUnlinkUseCase } from './partner-member-line-unlink.use-case';
import { PartnerMemberPasswordResetUseCase } from './partner-member-password-reset.use-case';
import { PartnerMemberPasswordRevealUseCase } from './partner-member-password-reveal.use-case';
import { SetPartnerMemberContactUseCase } from './set-partner-member-contact.use-case';
import { SetPartnerOwnerNameUseCase } from './set-partner-owner-name.use-case';
import { EXECUTIVE_ROLE_KEYS } from '@watchdog-bms/contracts';
import { PLATFORM_ROLE_KEYS, ROLE_GRANTS } from '../../../auth/permission-registry';
import { encryptCredential } from '../../domain/logic/credential-cipher.logic';
import { verifyPassword } from '../../../auth/domain/logic/password-credential.logic';

const KEY = Buffer.alloc(32, 7);
const config = { credentialEncryptionKey: KEY } as any;

function makePrisma(opts: {
  member?: boolean;
  identity?: boolean;
  credential?: { tempPasswordEncrypted?: string | null } | null;
  emailClash?: boolean;
} = {}) {
  const audits: any[] = [];
  const credentialUpdates: any[] = [];
  const identityUpdates: any[] = [];
  const userUpdates: any[] = [];
  const sessionRevokes: any[] = [];
  const contextDeletes: any[] = [];
  const handoffRevokes: any[] = [];
  const ops = {
    $executeRaw: async () => 1, $queryRaw: async () => [],
    passwordResetToken: { updateMany: async () => ({ count: 0 }) },
    companyMembership: {
      findFirst: async () =>
        opts.member === false ? null : { id: 'mem-1', user: { username: 'somchai.x' } },
      findMany: async () => [],
    },
    externalIdentity: {
      findFirst: async () => (opts.identity === false ? null : { id: 'identity-1', providerUserId: 'Uline-1', updatedAt: new Date(0) }),
      updateMany: async (args: any) => { identityUpdates.push(args); return { count: 1 }; },
    },
    // line-support-request-spec-th §2.5: the selected-company row goes with the identity.
    lineCompanyContext: {
      deleteMany: async (args: any) => { contextDeletes.push(args); return { count: 1 }; },
    },
    // Owner decision 2026-09-06: so does every unspent web deep link already sent to that chat.
    lineWebHandoffToken: {
      updateMany: async (args: any) => { handoffRevokes.push(args); return { count: 3 }; },
    },
    userCredential: {
      findUnique: async () =>
        opts.credential === null ? null : { id: 'cred-1', tempPasswordEncrypted: null, ...opts.credential },
      update: async (args: any) => { credentialUpdates.push(args); return {}; },
    },
    authSession: { updateMany: async (args: any) => { sessionRevokes.push(args); return { count: 1 }; } },
    auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    company: { findUnique: async () => ({ id: 'co-1' }) },
    user: {
      findFirst: async () => (opts.emailClash ? { id: 'other-user' } : null),
      findUnique: async () => ({ email: 'old@example.com', phoneNumber: null }),
      update: async (args: any) => { userUpdates.push(args); return {}; },
    },
  };
  const client = { ...ops, $transaction: async (arg: any) => (typeof arg === 'function' ? arg(ops) : Promise.all(arg)) };
  return { prisma: { client } as any, audits, credentialUpdates, identityUpdates, userUpdates, contextDeletes, handoffRevokes, sessionRevokes };
}

const cmd = { companyId: 'co-1', memberUserId: 'user-1', requestingAdminUserId: 'admin-1', requestId: 'req-1' };

describe('SetPartnerOwnerNameUseCase', () => {
  function fixture(options: { unavailable?: boolean; race?: boolean; auditFails?: boolean } = {}) {
    const state = { name: 'Old owner', audits: [] as any[], writes: [] as any[], reads: [] as any[] };
    const target = {
      id: 'user-1', isSystemProtected: false,
      memberships: {
        some: { companyId: 'co-1', roles: { some: { role: { key: 'OWNER' } } } },
        none: { roles: { some: { role: { key: { in: [...PLATFORM_ROLE_KEYS] } } } } },
      },
    };
    const tx = {
      user: {
        findFirst: async (args: any) => { state.reads.push(args); assert.deepEqual(args.where, target); return options.unavailable ? null : { displayName: state.name }; },
        updateMany: async (args: any) => {
          assert.deepEqual(args.where, { ...target, displayName: 'Old owner' });
          assert.deepEqual(Object.keys(args.data), ['displayName']);
          state.writes.push(args);
          if (options.race) return { count: 0 };
          state.name = args.data.displayName;
          return { count: 1 };
        },
      },
      auditLog: { create: async (args: any) => { if (options.auditFails) throw new Error('audit unavailable'); state.audits.push(args.data); } },
    };
    const prisma = { client: { $transaction: async (run: any) => {
      const before = state.name;
      try { return await run(tx); } catch (error) { state.name = before; throw error; }
    } } } as any;
    return { state, useCase: new SetPartnerOwnerNameUseCase(prisma) };
  }
  const rename = { ...cmd, displayName: '  New owner  ', expectedDisplayName: 'Old owner' };

  it('renames an owner without any employee or credential access and audits without name values', async () => {
    const { state, useCase } = fixture();
    assert.deepEqual(await useCase.execute(rename), { displayName: 'New owner' });
    assert.equal(state.name, 'New owner');
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].action, 'system.partner_member.display_name_update');
    assert.equal(state.audits[0].actorUserId, cmd.requestingAdminUserId);
    assert.equal(state.audits[0].targetId, cmd.memberUserId);
    assert.ok(!JSON.stringify(state.audits).includes('owner'));
  });

  it('rejects unavailable targets (wrong company, non-owner or protected/platform account) before writing', async () => {
    const { state, useCase } = fixture({ unavailable: true });
    await assert.rejects(() => useCase.execute(rename), NotFoundException);
    assert.equal(state.writes.length, 0);
  });

  it('rejects invalid names and missing snapshots before any database access', async () => {
    const { state, useCase } = fixture();
    for (const displayName of ['', '   ', 'a'.repeat(161), 'A\nB', 'A\u0000B', 'A\u202eB', null, 42]) {
      await assert.rejects(() => useCase.execute({ ...rename, displayName: displayName as any }), UnprocessableEntityException);
    }
    await assert.rejects(() => useCase.execute({ ...rename, expectedDisplayName: undefined as any }), UnprocessableEntityException);
    assert.equal(state.reads.length, 0);
  });

  it('accepts Thai names and the 160 UTF-16-unit boundary', async () => {
    for (const displayName of ['สมชาย ใจดี', 'ก', 'ก'.repeat(160)]) {
      const { useCase } = fixture();
      assert.deepEqual(await useCase.execute({ ...rename, displayName }), { displayName });
    }
  });

  it('does not mutate or audit an unchanged name', async () => {
    const { state, useCase } = fixture();
    await useCase.execute({ ...rename, displayName: ' Old owner ' });
    assert.equal(state.writes.length, 0);
    assert.equal(state.audits.length, 0);
  });

  it('rejects stale reads and a race at the final conditional write', async () => {
    const { state, useCase } = fixture();
    await assert.rejects(() => useCase.execute({ ...rename, expectedDisplayName: 'Stale' }), ConflictException);
    assert.equal(state.writes.length, 0);
    const raced = fixture({ race: true });
    await assert.rejects(() => raced.useCase.execute(rename), ConflictException);
    assert.equal(raced.state.audits.length, 0);
  });

  it('propagates audit failure through the transaction so the name is rolled back', async () => {
    const { state, useCase } = fixture({ auditFails: true });
    await assert.rejects(() => useCase.execute(rename), /audit unavailable/);
    assert.equal(state.name, 'Old owner');
  });
});

describe('PartnerMemberPasswordResetUseCase', () => {
  it('stores a hash + encrypted copy and returns the password once', async () => {
    const { prisma, audits, credentialUpdates, sessionRevokes } = makePrisma();
    const result = await new PartnerMemberPasswordResetUseCase(prisma, config).execute(cmd);

    assert.ok(result.temporaryPassword.length >= 10);
    const data = credentialUpdates[0].data;
    assert.ok(verifyPassword(result.temporaryPassword, data.passwordHash));
    assert.equal(data.status, 'TEMPORARY');
    assert.equal(data.mustChangePassword, true);
    assert.notEqual(data.tempPasswordEncrypted, result.temporaryPassword); // never plaintext at rest
    assert.equal(audits[0].action, 'system.partner_member.password.reset');
    assert.deepEqual(sessionRevokes[0].where, { userId: 'user-1', status: 'ACTIVE' });
    assert.equal(audits[0].metadataJson.revokedSessionCount, 1);
    assert.ok(!JSON.stringify(audits).includes(result.temporaryPassword));
  });

  it('404s when the user is not a member of the company', async () => {
    const { prisma } = makePrisma({ member: false });
    await assert.rejects(() => new PartnerMemberPasswordResetUseCase(prisma, config).execute(cmd), NotFoundException);
  });
});

describe('PartnerMemberPasswordRevealUseCase', () => {
  it('decrypts the stored temporary password and audits the reveal', async () => {
    const { prisma, audits } = makePrisma({ credential: { tempPasswordEncrypted: encryptCredential('tmpPass12345', KEY) } });
    const result = await new PartnerMemberPasswordRevealUseCase(prisma, config).execute(cmd);

    assert.equal(result.temporaryPassword, 'tmpPass12345');
    assert.equal(audits[0].action, 'system.partner_member.password.reveal');
    assert.equal(audits[0].riskLevel, 'CRITICAL');
    assert.ok(!JSON.stringify(audits).includes('tmpPass12345'));
  });

  it('404s when no encrypted copy is on record (user changed the password)', async () => {
    const { prisma, audits } = makePrisma({ credential: { tempPasswordEncrypted: null } });
    await assert.rejects(() => new PartnerMemberPasswordRevealUseCase(prisma, config).execute(cmd), NotFoundException);
    assert.equal(audits.length, 0);
  });

  it('404s cleanly when the blob cannot be decrypted with the current key', async () => {
    const { prisma } = makePrisma({ credential: { tempPasswordEncrypted: encryptCredential('x', Buffer.alloc(32, 9)) } });
    await assert.rejects(() => new PartnerMemberPasswordRevealUseCase(prisma, config).execute(cmd), NotFoundException);
  });
});

describe('PartnerMemberLineUnlinkUseCase', () => {
  it('unlinks the active LINE identity and audits with actor = admin', async () => {
    const { prisma, audits, identityUpdates, contextDeletes, handoffRevokes } = makePrisma();
    const result = await new PartnerMemberLineUnlinkUseCase(prisma).execute(cmd);

    assert.deepEqual(result, { unlinked: true });
    assert.equal(identityUpdates[0].data.status, 'UNLINKED');
    assert.equal(audits[0].action, 'system.partner_member.line_unlink');
    assert.equal(audits[0].actorUserId, 'admin-1');
    // §2.5, in the SAME transaction: a context row that outlives its identity names a shop this
    // LINE account has left, which is what sent a support notice to the wrong partner page.
    assert.deepEqual(contextDeletes, [{ where: { lineUserId: 'Uline-1' } }]);
    // Owner decision 2026-09-06, same transaction again: an admin-side unlink that left the chat's
    // unspent deep links alive gave the member a way back in for 15 more minutes. Keyed on BOTH
    // columns so a relink of this LINE account to another person cannot resurrect these.
    assert.deepEqual(handoffRevokes, [{
      where: { lineUserId: 'Uline-1', userId: 'user-1', status: 'PENDING' },
      data: { status: 'REVOKED' },
    }]);
    assert.equal(audits[0].metadataJson.handoffLinksRevoked, 3);
  });

  it('404s when the member has no active LINE identity', async () => {
    const { prisma } = makePrisma({ identity: false });
    await assert.rejects(() => new PartnerMemberLineUnlinkUseCase(prisma).execute(cmd), NotFoundException);
  });
});

describe('ListPartnerMembersUseCase', () => {
  it('maps hasTempPassword without leaking the encrypted blob', async () => {
    const { prisma } = makePrisma();
    prisma.client.companyMembership.findMany = async () => [
      {
        status: 'ACTIVE',
        roles: [{ role: { key: 'OWNER' } }],
        user: {
          id: 'user-1',
          displayName: 'Somchai',
          username: 'somchai.x',
          externalIdentities: [{ id: 'identity-1' }],
          credential: { status: 'TEMPORARY', mustChangePassword: true, expiresAt: new Date(), tempPasswordEncrypted: '{"v":1}' },
        },
      },
    ];
    const result = await new ListPartnerMembersUseCase(prisma).execute('co-1');

    assert.equal(result.items.length, 1);
    const item = result.items[0]!;
    assert.equal(item.lineLinked, true);
    assert.deepEqual(item.roles, ['OWNER']);
    assert.equal(item.credential?.hasTempPassword, true);
    assert.ok(!JSON.stringify(result).includes('"v":1'));
  });
});

describe('SetPartnerMemberContactUseCase', () => {
  it('normalizes and saves email + phone with a HIGH audit of booleans only', async () => {
    const { prisma, audits, userUpdates } = makePrisma();
    const result = await new SetPartnerMemberContactUseCase(prisma).execute({
      ...cmd, email: '  Somsri@Example.COM ', phoneNumber: ' 098-256-5628 ',
    });
    assert.deepEqual(result, { updated: true });
    assert.equal(userUpdates.length, 1);
    assert.deepEqual(userUpdates[0].data, { email: 'somsri@example.com', phoneNumber: '098-256-5628' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'system.partner_member.contact_update');
    assert.equal(audits[0].riskLevel, 'HIGH');
    assert.equal(audits[0].metadataJson.emailChanged, true);
    assert.equal(Object.values(audits[0].metadataJson).some((v) => typeof v === 'string' && v.includes('@')), false);
  });

  it('empty strings clear both fields', async () => {
    const { prisma, userUpdates } = makePrisma();
    await new SetPartnerMemberContactUseCase(prisma).execute({ ...cmd, email: '', phoneNumber: '' });
    assert.deepEqual(userUpdates[0].data, { email: null, phoneNumber: null });
  });

  it('rejects a member outside the company', async () => {
    const { prisma } = makePrisma({ member: false });
    await assert.rejects(
      () => new SetPartnerMemberContactUseCase(prisma).execute({ ...cmd, email: 'a@b.co' }),
      NotFoundException,
    );
  });

  it('rejects an email already used by another user', async () => {
    const { prisma } = makePrisma({ emailClash: true });
    await assert.rejects(
      () => new SetPartnerMemberContactUseCase(prisma).execute({ ...cmd, email: 'taken@example.com' }),
      ConflictException,
    );
  });

  it('rejects malformed email and phone, and a no-op command', async () => {
    const { prisma } = makePrisma();
    const uc = new SetPartnerMemberContactUseCase(prisma);
    await assert.rejects(() => uc.execute({ ...cmd, email: 'not-an-email' }), UnprocessableEntityException);
    await assert.rejects(() => uc.execute({ ...cmd, phoneNumber: 'abc' }), UnprocessableEntityException);
    await assert.rejects(() => uc.execute({ ...cmd }), UnprocessableEntityException);
  });
});

// E1 account commands live here because this platform-account spec is registered in API CI.
describe('ExecutiveUsersService (E1)', () => {
  const keys = EXECUTIVE_ROLE_KEYS;
  const context = { userId: 'admin', requestId: 'request-e1', companyId: 'seed-watchdog-system-company',
    roles: [], permissions: ['system.executive_user.manage'] } as any;
  const body = { username: 'report.reader', displayName: 'ผู้บริหาร', canExport: false, canSeeContacts: false };
  const errorCode = (code: string, status: number) => (error: any) => error.getStatus() === status && error.getResponse().code === code;
  async function fixture() {
    const { ExecutiveUsersService } = await import('../../../executive-business/application/executive-users.service');
    const writes: string[] = [];
    const state = { users: [] as any[], members: [] as any[], audits: [] as any[], sessions: [] as any[], auditFails: false, uniqueField: '' };
    const role = (key: string) => ({ id: key, key, scopeKey: 'system', companyId: null, isSystem: true, status: 'ACTIVE',
      permissions: (ROLE_GRANTS[key] ?? []).filter(key => key.startsWith('system.executive.')).map(key => ({ permission: { key } })) });
    const matches = (row: any, where: any): boolean => !where || Object.entries(where).every(([key, cond]: [string, any]) => {
      if (key === 'AND') return (Array.isArray(cond) ? cond : [cond]).every((c: any) => matches(row, c));
      if (key === 'OR') return cond.some((c: any) => matches(row, c));
      if (key === 'NOT') return !matches(row, cond);
      const value = row[key];
      if (cond === null || typeof cond !== 'object') return value === cond;
      if ('some' in cond || 'none' in cond) return (!cond.some || value.some((r: any) => matches(r, cond.some))) && (!cond.none || !value.some((r: any) => matches(r, cond.none)));
      if ('is' in cond) return value !== null && matches(value, cond.is);
      if ('in' in cond) return cond.in.includes(value);
      if ('equals' in cond) return typeof value === 'string' && value.toLowerCase() === cond.equals.toLowerCase();
      if ('not' in cond) return value !== cond.not;
      if ('contains' in cond) return typeof value === 'string' && value.toLowerCase().includes(cond.contains.toLowerCase());
      return matches(value, cond);
    });
    const memberRows = () => state.members.map((m) => ({ branchScopes: [], branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, company: { status: 'ACTIVE', planTerm: null }, ...m, user: { ...state.users.find((u) => u.id === m.userId), memberships: state.members.filter((r) => r.userId === m.userId) } }));
    const tx: any = {
      companyFeatureEntitlement: { findMany: async () => [] },
      role: { findMany: async ({ where }: any) => [...keys, 'SYSTEM_ADMIN'].map(role).filter((r) => matches(r, where)) },
      user: {
        findFirst: async ({ where }: any) => state.users.find((u) => matches({ ...u, memberships: memberRows().filter((m) => m.userId === u.id) }, where)) ?? null,
        create: async ({ data }: any) => {
          const field = state.uniqueField || ['username', 'email'].find((key) => data[key] && state.users.some((u) => u[key] === data[key]));
          if (field) throw Object.assign(new Error('unique'), { code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { fields: [`"${field}"`] } } } } });
          const user = { id: `user-${state.users.length}`, email: null, phoneNumber: null, credential: null, sessions: [], ...data };
          state.users.push(user); return user;
        },
      },
      userCredential: {
        create: async ({ data }: any) => { state.users.find((u) => u.id === data.userId).credential = data; },
        update: async ({ where, data }: any) => { writes.push('credential'); return Object.assign(state.users.find((u) => u.id === where.userId).credential, data); },
      },
      companyMembership: {
        create: async ({ data }: any) => { const row = { id: `member-${state.members.length}`, roles: [], ...data }; state.members.push(row); return row; },
        findFirst: async ({ where }: any) => memberRows().find((m) => matches(m, where)) ?? null,
        findMany: async ({ where }: any) => memberRows().filter((m) => matches(m, where)),
        update: async ({ where, data }: any) => { writes.push('membership'); return Object.assign(state.members.find((m) => m.id === where.id), data); },
      },
      membershipRole: {
        createMany: async ({ data }: any) => { writes.push('roles'); for (const r of data) { const m = state.members.find((m) => m.id === r.membershipId); if (!m.roles.some((r2: any) => r2.role.id === r.roleId)) m.roles.push({ role: role(r.roleId) }); } return { count: data.length }; },
        deleteMany: async ({ where }: any) => { writes.push('roles'); const m = state.members.find((m) => m.id === where.membershipId); m.roles = m.roles.filter((r: any) => !where.roleId.in.includes(r.role.id)); return { count: 1 }; },
      },
      authSession: { updateMany: async ({ where, data }: any) => { writes.push('sessions'); const rows = state.sessions.filter((s) => matches(s, where)); rows.forEach((s) => Object.assign(s, data)); return { count: rows.length }; } },
    };
    let serializationFailure = false;
    const prisma = { client: { ...tx, company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) }, $transaction: async (run: any, options: any) => {
      const before = structuredClone(state);
      try {
        const result = await run(tx);
        if (serializationFailure) { serializationFailure = false; throw Object.assign(new Error('serialization conflict'), { code: 'P2034' }); }
        assert.equal(options?.isolationLevel, 'Serializable');
        return result;
      } catch (error) { Object.assign(state, before); throw error; }
    } } } as any;
    const audit = { log: async (entry: any, client: any) => { assert.equal(client, tx); writes.push('audit'); if (state.auditFails) throw new Error('audit unavailable'); state.audits.push(entry); } } as any;
    return { state, writes, prisma, service: new ExecutiveUsersService(prisma, audit), failOnce: () => { serializationFailure = true; } };
  }
  it('creates a dedicated account with temporary credential, default-off add-ons and one safe transactional audit', async () => {
    const { state, service } = await fixture();
    const result = await service.create(context, { ...body, username: ' Report.Reader ', phoneNumber: ' 0812345678 ', email: ' REPORT@EXAMPLE.COM ' });
    assert.deepEqual(Object.keys(result).sort(), ['credential', 'user']);
    assert.deepEqual(Object.keys(result.user).sort(), ['canEditCompanyNote', 'canExport', 'canManageCompanyNote', 'canRead', 'canSeeContacts', 'displayName', 'email', 'lastWebEntryAt', 'phoneNumber', 'status', 'temporaryPasswordExpiresAt', 'userId', 'username']);
    assert.deepEqual(Object.keys(result.credential).sort(), ['expiresAt', 'temporaryPassword', 'userId', 'username']);
    assert.equal(result.user.username, 'report.reader'); assert.equal(result.user.email, 'report@example.com');
    assert.equal(result.user.status, 'PENDING_ACTIVATION'); assert.equal(result.user.lastWebEntryAt, null);
    assert.equal(result.user.temporaryPasswordExpiresAt, result.credential.expiresAt);
    assert.equal(state.members.length, 1); assert.equal(state.members[0].companyId, context.companyId);
    assert.deepEqual(state.members[0].roles.map((r: any) => r.role.key), [keys[0]]);
    const credential = state.users[0].credential;
    assert.equal(credential.status, 'TEMPORARY'); assert.equal(credential.mustChangePassword, true);
    assert.ok(verifyPassword(result.credential.temporaryPassword, credential.passwordHash));
    assert.ok(credential.expiresAt > new Date()); assert.equal(credential.tempPasswordEncrypted ?? null, null);
    assert.equal(state.audits.length, 1);
    const audit = state.audits[0];
    assert.deepEqual([audit.action, audit.actorUserId, audit.targetType, audit.targetId, audit.requestId, audit.companyId ?? null],
      ['executive.user.created', context.userId, 'User', result.user.userId, context.requestId, null]);
    assert.deepEqual(Object.keys(audit.metadataJson).sort(), ['from', 'reason', 'to']);
    for (const secret of [result.credential.temporaryPassword, credential.passwordHash, '0812345678', 'report@example.com', body.displayName]) assert.ok(!JSON.stringify(audit).includes(secret));
  });
  it('accepts the canonical note edit flag through create, change access and list, preserving the old alias', async () => {
    const { service, state } = await fixture();
    const created = await service.create(context, { ...body, canEditCompanyNote: true });
    assert.equal(created.user.canEditCompanyNote, true); assert.equal(created.user.canManageCompanyNote, true);
    assert.equal((await service.list(context, {})).items[0]!.canEditCompanyNote, true);
    const access = { canExport: false, canSeeContacts: false, reason: 'ติดตามบริษัท' };
    assert.equal((await service.setAccess(context, created.user.userId, { ...access, canEditCompanyNote: false })).canEditCompanyNote, false);
    assert.equal(state.audits.at(-1).metadataJson.to.canEditCompanyNote, false);
    await assert.rejects(service.setAccess(context, created.user.userId, { ...access, canEditCompanyNote: true, canManageCompanyNote: false }), errorCode('INVALID_INPUT', 400));
    for (const canEditCompanyNote of [null, 'true', 1]) await assert.rejects(service.create(context, { ...body, canEditCompanyNote } as any), errorCode('INVALID_INPUT', 400));
  });
  it('creates only the requested export/contact/company-note add-on roles', async () => {
    for (const canExport of [false, true]) for (const canSeeContacts of [false, true]) for (const canManageCompanyNote of [false, true]) {
      const { state, service } = await fixture();
      const result = await service.create(context, { ...body, canExport, canSeeContacts, canManageCompanyNote });
      assert.deepEqual(state.members[0].roles.map((r: any) => r.role.key), [keys[0], ...(canExport ? [keys[1]] : []), ...(canSeeContacts ? [keys[2]] : []), ...(canManageCompanyNote ? [keys[3]] : [])]);
      assert.equal(result.user.canExport, canExport); assert.equal(result.user.canSeeContacts, canSeeContacts); assert.equal(result.user.canManageCompanyNote, canManageCompanyNote);
    }
  });
  it('defaults company-note right off, grants explicitly, preserves omitted access, revokes explicitly and rejects non-booleans', async () => {
    const { service, state } = await fixture();
    const created = await service.create(context, body);
    assert.equal(created.user.canManageCompanyNote, false);
    const access = { canExport: false, canSeeContacts: false, reason: 'ช่วยติดตามบริษัท' };
    assert.equal((await service.setAccess(context, created.user.userId, { ...access, canManageCompanyNote: true })).canManageCompanyNote, true);
    assert.equal(state.audits.at(-1).metadataJson.to.canManageCompanyNote, true);
    assert.equal((await service.setAccess(context, created.user.userId, { ...access, canExport: true })).canManageCompanyNote, true);
    assert.equal((await service.setAccess(context, created.user.userId, { ...access, canManageCompanyNote: false })).canManageCompanyNote, false);
    for (const value of ['yes', null, 1]) await assert.rejects(service.setAccess(context, created.user.userId,
      { ...access, canManageCompanyNote: value } as any), errorCode('INVALID_INPUT', 400));
  });
  it('maps username/email conflicts, including database races, and never attaches an existing user', async () => {
    for (const field of ['username', 'email']) {
      const { state, service } = await fixture(); state.uniqueField = field;
      await assert.rejects(service.create(context, { ...body, email: 'a@example.com' }), errorCode('ACCOUNT_ALREADY_EXISTS', 409));
      assert.deepEqual([state.users.length, state.members.length, state.audits.length], [0, 0, 0]);
    }
    const { state, service } = await fixture();
    await service.create(context, body);
    await assert.rejects(service.create(context, body), errorCode('ACCOUNT_ALREADY_EXISTS', 409));
    assert.equal(state.users.length, 1);
  });
  it('validates account input before any write', async () => {
    for (const changed of [{ username: 'x' }, { displayName: ' ' }, { displayName: 'ก'.repeat(121) }, { email: 'bad' }, { email: 'a'.repeat(321) }, { phoneNumber: '1'.repeat(21) }, { canExport: 'yes' }, { canSeeContacts: null }]) {
      const { state, service } = await fixture();
      await assert.rejects(service.create(context, { ...body, ...changed } as any), errorCode('INVALID_INPUT', 400));
      assert.equal(state.users.length, 0);
    }
  });
  it('rejects non-string email input with the account validation envelope before any write', async () => {
    for (const email of [42, {}, []]) {
      const { state, writes, service } = await fixture();
      await assert.rejects(service.create(context, { ...body, email } as any), errorCode('INVALID_INPUT', 400));
      assert.equal(state.users.length, 0); assert.deepEqual(writes, []);
    }
  });
  it('lists and reads only executive accounts, computes four statuses, filters before pagination, and excludes admins', async () => {
    const { state, service } = await fixture();
    for (let i = 0; i < 6; i++) await service.create(context, { ...body, username: `reader.${i}` });
    state.users[1].credential.status = 'ACTIVE'; state.users[1].credential.expiresAt = null;
    state.users[1].sessions = [{ issuedAt: new Date('2026-10-02T01:00:00Z') }];
    state.members[2].status = 'SUSPENDED'; state.members[3].status = 'DISABLED'; state.users[4].status = 'DISABLED';
    state.members[5].roles.push({ role: { key: 'SYSTEM_ADMIN', scopeKey: 'system', isSystem: true, status: 'ACTIVE' } });
    const all = await service.list(context, {});
    assert.deepEqual(all.items.map((u: any) => u.status), ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REVOKED']);
    assert.deepEqual(all.pagination, { page: 1, pageSize: 20, total: 5, totalPages: 1 });
    assert.equal(all.items[1].lastWebEntryAt, '2026-10-02T01:00:00.000Z');
    assert.deepEqual(await service.detail(context, state.users[1].id), all.items[1]);
    const page = await service.list(context, { status: 'REVOKED', page: 2, pageSize: 1, q: 'reader' });
    assert.equal(page.items[0].userId, state.users[4].id); assert.equal(page.pagination.total, 2);
    await assert.rejects(service.detail(context, state.users[5].id), errorCode('ACCOUNT_NOT_FOUND', 404));
    await assert.rejects(service.detail(context, 'unknown'), errorCode('ACCOUNT_NOT_FOUND', 404));
  });
  it('suspends and reactivates the membership, revokes sessions, and retries without another side effect', async () => {
    const { state, service } = await fixture(); const result = await service.create(context, body);
    state.sessions.push({ userId: result.user.userId, status: 'ACTIVE' }, { userId: 'other', status: 'ACTIVE' });
    const suspended = await service.setStatus(context, result.user.userId, { status: 'SUSPENDED', reason: ' หยุดใช้ ' });
    assert.equal(suspended.status, 'SUSPENDED'); assert.equal(state.members[0].status, 'SUSPENDED');
    assert.deepEqual(state.sessions.map((s: any) => s.status), ['REVOKED', 'ACTIVE']);
    await service.setStatus(context, result.user.userId, { status: 'SUSPENDED', reason: 'หยุดใช้' });
    assert.equal(state.audits.length, 2);
    const active = await service.setStatus(context, result.user.userId, { status: 'ACTIVE', reason: 'กลับมาใช้' });
    assert.equal(active.status, 'PENDING_ACTIVATION'); assert.equal(state.members[0].status, 'ACTIVE');
    assert.equal(state.audits[1].metadataJson.reason, 'หยุดใช้');
    assert.equal(state.audits[2].action, 'executive.user.reactivated');
  });
  it('requires a reason for status, credential and access commands even on a retry', async () => {
    const { state, service } = await fixture(); const { user } = await service.create(context, body);
    for (const reason of ['', ' ', 'ก'.repeat(501)]) {
      await assert.rejects(service.setStatus(context, user.userId, { status: 'ACTIVE', reason }), errorCode('INVALID_INPUT', 400));
      await assert.rejects(service.resetCredential(context, user.userId, { reason }), errorCode('INVALID_INPUT', 400));
      await assert.rejects(service.setAccess(context, user.userId, { canExport: false, canSeeContacts: false, reason }), errorCode('INVALID_INPUT', 400));
    }
    assert.equal(state.audits.length, 1);
  });
  it('protects any system-admin target for all commands, including self, before executive lookup', async () => {
    const { state, service } = await fixture(); const { user } = await service.create(context, body);
    state.members[0].roles = [{ role: { key: 'SYSTEM_ADMIN', scopeKey: 'system', isSystem: true, status: 'ACTIVE' } }];
    const self = { ...context, userId: user.userId };
    await assert.rejects(service.setStatus(self, user.userId, { status: 'SUSPENDED', reason: 'เหตุผล' }), errorCode('ACCOUNT_PROTECTED', 422));
    await assert.rejects(service.resetCredential(self, user.userId, { reason: 'เหตุผล' }), errorCode('ACCOUNT_PROTECTED', 422));
    await assert.rejects(service.setAccess(self, user.userId, { canExport: true, canSeeContacts: true, reason: 'เหตุผล' }), errorCode('ACCOUNT_PROTECTED', 422));
    assert.equal(state.audits.length, 1); assert.equal(state.members[0].status, 'ACTIVE');
  });
  it('resets a credential once, revokes sessions and exposes no credential on subsequent reads', async () => {
    const { state, service } = await fixture(); const original = await service.create(context, body);
    state.sessions.push({ userId: original.user.userId, status: 'ACTIVE' });
    const reset = await service.resetCredential(context, original.user.userId, { reason: 'ลืมรหัสผ่าน' });
    assert.notEqual(reset.temporaryPassword, original.credential.temporaryPassword);
    assert.ok(verifyPassword(reset.temporaryPassword, state.users[0].credential.passwordHash));
    assert.equal(state.sessions[0].status, 'REVOKED'); assert.equal(state.audits[1].action, 'executive.user.credential_issued');
    assert.ok(!JSON.stringify(state.audits).includes(reset.temporaryPassword));
    assert.ok(!JSON.stringify(await service.detail(context, original.user.userId)).includes(reset.temporaryPassword));
  });
  it('adds and removes only add-on roles and returns effective access without another audit on retry', async () => {
    const { state, service, prisma } = await fixture(); const { user } = await service.create(context, body);
    const { PrismaPermissionResolverRepository } = await import('../../../access-control/infrastructure/prisma-permission-resolver.repository');
    const resolver = new PrismaPermissionResolverRepository(prisma);
    let view = await service.setAccess(context, user.userId, { canExport: true, canSeeContacts: true, reason: 'อนุญาต' });
    assert.equal(view.canExport, true); assert.equal(view.canSeeContacts, true);
    assert.ok((await resolver.resolveForUser({ userId: user.userId, companyId: context.companyId })).permissions.includes('system.executive.export'));
    view = await service.setAccess(context, user.userId, { canExport: false, canSeeContacts: false, reason: 'ยกเลิก' });
    assert.equal(view.canExport, false); assert.equal(view.canSeeContacts, false);
    const next = await resolver.resolveForUser({ userId: user.userId, companyId: context.companyId });
    assert.deepEqual(next.permissions, ['system.executive.read']);
    assert.deepEqual(state.members[0].roles.map((r: any) => r.role.key), [keys[0]]);
    await service.setAccess(context, user.userId, { canExport: false, canSeeContacts: false, reason: 'ยกเลิก' });
    assert.equal(state.audits.length, 3); assert.equal(state.audits[2].action, 'executive.user.access_changed');
  });
  it('loads a mixed roster with total statuses and expiry dates, including unusable credentials', async () => {
    const { state, service } = await fixture(); await service.create(context, body);
    const originalUser = state.users.pop(), originalMember = state.members.pop();
    const past = new Date(0), future = new Date('2099-01-01T00:00:00Z');
    const revoked = ['REVOKED', 'REVOKED', 'REVOKED'];
    const pending = ['PENDING_ACTIVATION', 'SUSPENDED', 'REVOKED'];
    const active = ['ACTIVE', 'SUSPENDED', 'REVOKED'];
    const cases = [
      { credential: null, statuses: revoked },
      { credential: { status: 'DISABLED', expiresAt: null }, statuses: revoked },
      ...[null, past, future].map((expiresAt) => ({ credential: { status: 'TEMPORARY', expiresAt }, statuses: pending })),
      { credential: { status: 'ACTIVE', expiresAt: past }, statuses: pending },
      ...[null, future].map((expiresAt) => ({ credential: { status: 'ACTIVE', expiresAt }, statuses: active })),
    ];
    const expected: { userId: string; status: string; temporaryPasswordExpiresAt: string | null }[] = [];
    for (const userStatus of ['ACTIVE', 'SUSPENDED', 'DISABLED']) {
      for (const [index, membershipStatus] of ['ACTIVE', 'SUSPENDED', 'DISABLED'].entries()) {
        for (const { credential, statuses } of cases) {
          const userId = `mixed-${expected.length}`;
          const status = userStatus === 'ACTIVE' ? statuses[index] : 'REVOKED';
          state.users.push({ ...originalUser, id: userId, status: userStatus, credential });
          state.members.push({ ...originalMember, id: userId, userId, status: membershipStatus });
          expected.push({ userId, status, temporaryPasswordExpiresAt: status === 'PENDING_ACTIVATION' ? credential?.expiresAt?.toISOString() ?? null : null });
        }
      }
    }
    const all = await service.list(context, { pageSize: 100 });
    assert.equal(all.pagination.total, expected.length);
    assert.deepEqual(all.items.map(({ userId, status, temporaryPasswordExpiresAt }) => ({ userId, status, temporaryPasswordExpiresAt })), expected);
    for (const item of all.items) assert.deepEqual(await service.detail(context, item.userId), item);
    const pendingPage = await service.list(context, { status: 'PENDING_ACTIVATION', pageSize: 1, page: 2 });
    assert.equal(pendingPage.pagination.total, 4);
    assert.equal(pendingPage.items[0].temporaryPasswordExpiresAt, past.toISOString());
  });
  for (const status of ['DRAFT', 'INVITED']) it(`excludes ${status} memberships from the roster, detail and all commands`, async () => {
    const { state, writes, service } = await fixture(); const { user } = await service.create(context, body);
    state.members[0].status = status;
    const visible = await service.create(context, { ...body, username: 'visible.reader' });
    state.sessions.push({ userId: user.userId, status: 'ACTIVE' });
    writes.length = 0; const before = structuredClone(state);
    assert.deepEqual((await service.list(context, {})).items.map((row) => row.userId), [visible.user.userId]);
    for (const run of [
      () => service.detail(context, user.userId),
      () => service.setStatus(context, user.userId, { status: 'ACTIVE', reason: 'เหตุผล' }),
      () => service.setStatus(context, user.userId, { status: 'SUSPENDED', reason: 'เหตุผล' }),
      () => service.resetCredential(context, user.userId, { reason: 'เหตุผล' }),
      () => service.setAccess(context, user.userId, { canExport: true, canSeeContacts: true, reason: 'เหตุผล' }),
    ]) await assert.rejects(run(), errorCode('ACCOUNT_NOT_FOUND', 404));
    assert.deepEqual(state, before); assert.deepEqual(writes, []);
  });
  for (const cause of ['disabled user', 'suspended user', 'disabled membership', 'missing credential', 'disabled credential']) {
    for (const command of ['reactivate', 'suspend', 'reset credential', 'change access', 'repeat access']) {
      it(`refuses ${command} for a revoked account (${cause}) without attempting any write`, async () => {
        const { state, writes, service } = await fixture(); const { user } = await service.create(context, body);
        if (cause === 'disabled user') state.users[0].status = 'DISABLED';
        if (cause === 'suspended user') state.users[0].status = 'SUSPENDED';
        if (cause === 'disabled membership') state.members[0].status = 'DISABLED';
        if (cause === 'missing credential') state.users[0].credential = null;
        if (cause === 'disabled credential') state.users[0].credential.status = 'DISABLED';
        state.sessions.push({ userId: user.userId, status: 'ACTIVE' });
        writes.length = 0; const before = structuredClone(state);
        const result = command === 'reset credential' ? service.resetCredential(context, user.userId, { reason: 'เหตุผล' })
          : command === 'change access' || command === 'repeat access'
            ? service.setAccess(context, user.userId, { canExport: command === 'change access', canSeeContacts: false, reason: 'เหตุผล' })
            : service.setStatus(context, user.userId, { status: command === 'reactivate' ? 'ACTIVE' : 'SUSPENDED', reason: 'เหตุผล' });
        await assert.rejects(result, (error: any) => {
          assert.equal(error.getStatus(), 409);
          assert.deepEqual(error.getResponse(), { code: 'ACCOUNT_REVOKED', message: 'บัญชีนี้ถูกปิดจากทางอื่นของระบบ หน้านี้เปิดคืนไม่ได้', requestId: context.requestId });
          return true;
        });
        assert.deepEqual(state, before); assert.deepEqual(writes, []);
      });
    }
  }
  it('reissues an expired credential and changes access while suspended before reopening', async () => {
    const { state, service } = await fixture(); const { user } = await service.create(context, body);
    state.users[0].credential.status = 'ACTIVE'; state.users[0].credential.expiresAt = new Date(0);
    const access = await service.setAccess(context, user.userId, { canExport: true, canSeeContacts: true, reason: 'อนุญาต' });
    assert.equal(access.status, 'PENDING_ACTIVATION'); assert.equal(access.canExport, true);
    await service.setStatus(context, user.userId, { status: 'SUSPENDED', reason: 'รหัสผ่านรั่วไหล' });
    const reset = await service.resetCredential(context, user.userId, { reason: 'ออกรหัสใหม่' });
    assert.ok(verifyPassword(reset.temporaryPassword, state.users[0].credential.passwordHash));
    assert.equal(state.members[0].status, 'SUSPENDED');
    assert.equal((await service.detail(context, user.userId)).temporaryPasswordExpiresAt, null);
    const suspendedAccess = await service.setAccess(context, user.userId, { canExport: false, canSeeContacts: false, reason: 'ยกเลิก' });
    assert.equal(suspendedAccess.status, 'SUSPENDED'); assert.equal(suspendedAccess.canExport, false);
    const reopened = await service.setStatus(context, user.userId, { status: 'ACTIVE', reason: 'กลับมาใช้' });
    assert.equal(reopened.status, 'PENDING_ACTIVATION'); assert.equal(reopened.temporaryPasswordExpiresAt, reset.expiresAt);
  });
  it('retries rolled-back serialization conflicts without duplicate commands or audit rows', async () => {
    const { state, service, failOnce } = await fixture();
    failOnce(); const { user } = await service.create(context, body);
    failOnce(); await service.setStatus(context, user.userId, { status: 'SUSPENDED', reason: 'เหตุผล' });
    failOnce(); await service.setAccess(context, user.userId, { canExport: true, canSeeContacts: false, reason: 'เหตุผล' });
    failOnce(); await service.resetCredential(context, user.userId, { reason: 'เหตุผล' });
    assert.equal(state.users.length, 1); assert.equal(state.members.length, 1); assert.equal(state.audits.length, 4);
  });
  it('reports target permissions from active grants rather than a role name', async () => {
    const { state, service } = await fixture(); const { user } = await service.create(context, { ...body, canExport: true, canSeeContacts: true });
    state.members[0].roles.find((r: any) => r.role.key === keys[1]).role.permissions = [];
    state.members[0].roles.find((r: any) => r.role.key === keys[2]).role.status = 'DISABLED';
    const view = await service.detail(context, user.userId);
    assert.equal(view.canRead, true); assert.equal(view.canExport, false); assert.equal(view.canSeeContacts, false);
  });
  it('rolls every command back if its transactional audit fails' , async () => {
    const { state, service } = await fixture(); state.auditFails = true;
    await assert.rejects(service.create(context, body), /audit unavailable/); assert.equal(state.users.length, 0);
    state.auditFails = false; const { user } = await service.create(context, body);
    state.sessions.push({ userId: user.userId, status: 'ACTIVE' }); state.auditFails = true;
    const before = structuredClone(state);
    for (const run of [
      () => service.setStatus(context, user.userId, { status: 'SUSPENDED', reason: 'เหตุผล' }),
      () => service.resetCredential(context, user.userId, { reason: 'เหตุผล' }),
      () => service.setAccess(context, user.userId, { canExport: true, canSeeContacts: true, reason: 'เหตุผล' }),
    ]) { await assert.rejects(run(), /audit unavailable/); assert.deepEqual(state, before); }
  });
});
