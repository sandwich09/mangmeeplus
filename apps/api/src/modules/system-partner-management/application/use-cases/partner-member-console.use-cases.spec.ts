import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ListPartnerMembersUseCase } from './list-partner-members.use-case';
import { PartnerMemberLineUnlinkUseCase } from './partner-member-line-unlink.use-case';
import { PartnerMemberPasswordResetUseCase } from './partner-member-password-reset.use-case';
import { PartnerMemberPasswordRevealUseCase } from './partner-member-password-reveal.use-case';
import { SetPartnerMemberContactUseCase } from './set-partner-member-contact.use-case';
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
  const contextDeletes: any[] = [];
  const handoffRevokes: any[] = [];
  const ops = {
    companyMembership: {
      findFirst: async () =>
        opts.member === false ? null : { id: 'mem-1', user: { username: 'somchai.x' } },
      findMany: async () => [],
    },
    externalIdentity: {
      findFirst: async () => (opts.identity === false ? null : { id: 'identity-1', providerUserId: 'Uline-1' }),
      update: async (args: any) => { identityUpdates.push(args); return {}; },
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
    auditLog: { create: async (args: any) => { audits.push(args.data); return {}; } },
    company: { findUnique: async () => ({ id: 'co-1' }) },
    user: {
      findFirst: async () => (opts.emailClash ? { id: 'other-user' } : null),
      findUnique: async () => ({ email: 'old@example.com', phoneNumber: null }),
      update: async (args: any) => { userUpdates.push(args); return {}; },
    },
  };
  const client = { ...ops, $transaction: async (arg: any) => (typeof arg === 'function' ? arg(ops) : Promise.all(arg)) };
  return { prisma: { client } as any, audits, credentialUpdates, identityUpdates, userUpdates, contextDeletes, handoffRevokes };
}

const cmd = { companyId: 'co-1', memberUserId: 'user-1', requestingAdminUserId: 'admin-1', requestId: 'req-1' };

describe('PartnerMemberPasswordResetUseCase', () => {
  it('stores a hash + encrypted copy and returns the password once', async () => {
    const { prisma, audits, credentialUpdates } = makePrisma();
    const result = await new PartnerMemberPasswordResetUseCase(prisma, config).execute(cmd);

    assert.ok(result.temporaryPassword.length >= 10);
    const data = credentialUpdates[0].data;
    assert.ok(verifyPassword(result.temporaryPassword, data.passwordHash));
    assert.equal(data.status, 'TEMPORARY');
    assert.equal(data.mustChangePassword, true);
    assert.notEqual(data.tempPasswordEncrypted, result.temporaryPassword); // never plaintext at rest
    assert.equal(audits[0].action, 'system.partner_member.password.reset');
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
    assert.equal(audits[0].metadataJson.handoffTokensRevoked, 3);
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
