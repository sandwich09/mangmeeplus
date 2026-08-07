import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SetPartnerLineCredentialUseCase } from './set-partner-line-credential.use-case';
import { decryptCredential } from '../../domain/logic/credential-cipher.logic';

const ENCRYPTION_KEY = randomBytes(32);

function makeConfig() {
  return { credentialEncryptionKey: ENCRYPTION_KEY } as any;
}

function makeCmd(overrides: Partial<Parameters<SetPartnerLineCredentialUseCase['execute']>[0]> = {}) {
  return {
    companyId: 'co-1',
    credentialKind: 'LINE_MESSAGING_API' as const,
    channelId: 'ch-id-1',
    channelSecret: 'very-secret-value',
    accessToken: 'access-token-value',
    requestingAdminUserId: 'admin-1',
    requestId: 'req-1',
    ...overrides,
  };
}

function makePrisma(opts: { companyFound?: boolean; existingCredential?: boolean } = {}) {
  const found = opts.companyFound ?? true;
  const now = new Date();
  let upsertArgs: any = null;
  let auditArgs: any = null;

  const prisma = {
    upsertArgs: () => upsertArgs,
    auditArgs: () => auditArgs,
    client: {
      company: { findUnique: async () => found ? { id: 'co-1' } : null },
      companyIntegrationCredential: {
        findUnique: async () => opts.existingCredential ? { id: 'cred-1' } : null,
        upsert: async (args: any) => {
          upsertArgs = args;
          return { credentialKind: 'LINE_MESSAGING_API', health: 'UNKNOWN', lastValidatedAt: null, rotatedAt: now, createdAt: now, updatedAt: now };
        },
      },
      auditLog: { create: async (args: any) => { auditArgs = args; return {}; } },
      $transaction: async (fn: (tx: any) => Promise<any>) => fn({
        company: prisma.client.company,
        companyIntegrationCredential: prisma.client.companyIntegrationCredential,
        auditLog: prisma.client.auditLog,
      }),
    },
  } as any;

  return prisma;
}

describe('SetPartnerLineCredentialUseCase', () => {
  it('throws NotFoundException when company not found', async () => {
    const prisma = makePrisma({ companyFound: false });
    const uc = new SetPartnerLineCredentialUseCase(prisma, makeConfig());
    await assert.rejects(
      () => uc.execute(makeCmd()),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  it('response does NOT contain channelSecret, accessToken, or encryptedSecretJson', async () => {
    const prisma = makePrisma();
    const uc = new SetPartnerLineCredentialUseCase(prisma, makeConfig());
    const result = await uc.execute(makeCmd()) as any;
    assert.ok(!('channelSecret' in result), 'channelSecret must not be in response');
    assert.ok(!('accessToken' in result), 'accessToken must not be in response');
    assert.ok(!('channelId' in result), 'channelId must not be in response');
    assert.ok(!('encryptedSecretJson' in result), 'encryptedSecretJson must not be in response');
  });

  it('response contains expected metadata fields only', async () => {
    const prisma = makePrisma();
    const uc = new SetPartnerLineCredentialUseCase(prisma, makeConfig());
    const result = await uc.execute(makeCmd());
    assert.equal(result.kind, 'LINE_MESSAGING_API');
    assert.equal(result.health, 'UNKNOWN');
    assert.ok(typeof result.createdAt === 'string');
    assert.ok(typeof result.updatedAt === 'string');
  });

  it('audit metadataJson does NOT contain channelSecret or accessToken', async () => {
    const prisma = makePrisma();
    const uc = new SetPartnerLineCredentialUseCase(prisma, makeConfig());
    await uc.execute(makeCmd());
    const meta = prisma.auditArgs().data.metadataJson;
    assert.ok(!('channelSecret' in meta), 'channelSecret must not be in audit');
    assert.ok(!('accessToken' in meta), 'accessToken must not be in audit');
    assert.ok(!('channelId' in meta), 'channelId must not be in audit');
    assert.ok(!('encryptedSecretJson' in meta), 'encryptedSecretJson must not be in audit');
    assert.equal(meta.credentialKind, 'LINE_MESSAGING_API');
    assert.ok(['created', 'replaced'].includes(meta.action));
  });

  it('encrypts the secret — upsert data never contains plaintext channelSecret', async () => {
    const prisma = makePrisma();
    const uc = new SetPartnerLineCredentialUseCase(prisma, makeConfig());
    await uc.execute(makeCmd());
    const upsertData = prisma.upsertArgs().create;
    assert.ok(typeof upsertData.encryptedSecretJson === 'string');
    assert.ok(!upsertData.encryptedSecretJson.includes('very-secret-value'), 'plaintext must not appear in stored JSON');
  });

  it('encrypted value decrypts back to original secret payload', async () => {
    const prisma = makePrisma();
    const uc = new SetPartnerLineCredentialUseCase(prisma, makeConfig());
    await uc.execute(makeCmd());
    const encrypted = prisma.upsertArgs().create.encryptedSecretJson;
    const decrypted = JSON.parse(decryptCredential(encrypted, ENCRYPTION_KEY));
    assert.equal(decrypted.channelSecret, 'very-secret-value');
    assert.equal(decrypted.accessToken, 'access-token-value');
    assert.equal(decrypted.channelId, 'ch-id-1');
  });

  it('audit action is "created" for new credential, "replaced" for existing', async () => {
    const newPrisma = makePrisma({ existingCredential: false });
    const uc1 = new SetPartnerLineCredentialUseCase(newPrisma, makeConfig());
    await uc1.execute(makeCmd());
    assert.equal(newPrisma.auditArgs().data.metadataJson.action, 'created');

    const existPrisma = makePrisma({ existingCredential: true });
    const uc2 = new SetPartnerLineCredentialUseCase(existPrisma, makeConfig());
    await uc2.execute(makeCmd());
    assert.equal(existPrisma.auditArgs().data.metadataJson.action, 'replaced');
  });
});
