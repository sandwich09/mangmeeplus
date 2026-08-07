import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SetSharedLineCredentialUseCase } from './set-shared-line-credential.use-case';
import { decryptCredential } from '../../domain/logic/credential-cipher.logic';

const TEST_KEY = Buffer.from('a'.repeat(64), 'hex');

function makeUseCase(overrides: Partial<{ existing: boolean }> = {}) {
  let stored: Record<string, any> = {};
  let auditLog: any = null;

  const prisma = {
    client: {
      platformLineCredential: {
        findUnique: async () => (overrides.existing ? { id: 'cred-1' } : null),
        upsert: async (args: any) => {
          const row = args.create ?? args.update;
          stored = { ...row, credentialKind: args.where.credentialKind, health: 'UNKNOWN', lastValidatedAt: null, rotatedAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
          return { credentialKind: stored.credentialKind, health: stored.health, lastValidatedAt: stored.lastValidatedAt, rotatedAt: stored.rotatedAt, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
        },
      },
      auditLog: {
        create: async (args: any) => { auditLog = args.data; },
      },
      $transaction: async (fn: any) => {
        const tx = {
          platformLineCredential: prisma.client.platformLineCredential,
          auditLog: prisma.client.auditLog,
        };
        return fn(tx);
      },
    },
  } as any;

  const config = { credentialEncryptionKey: TEST_KEY } as any;
  const useCase = new SetSharedLineCredentialUseCase(prisma, config);

  return { useCase, getStored: () => stored, getAuditLog: () => auditLog };
}

describe('SetSharedLineCredentialUseCase', () => {
  it('response has no secret fields', async () => {
    const { useCase } = makeUseCase();
    const result = await useCase.execute({
      credentialKind: 'LINE_MESSAGING_API',
      channelId: 'ch-id',
      channelSecret: 'ch-secret',
      requestingAdminUserId: 'admin-1',
      requestId: 'req-1',
    });
    const keys = Object.keys(result);
    for (const forbidden of ['channelId', 'channelSecret', 'accessToken', 'encryptedSecretJson']) {
      assert.ok(!keys.includes(forbidden), `Response must not include "${forbidden}"`);
    }
    assert.equal(result.kind, 'LINE_MESSAGING_API');
    assert.equal(result.health, 'UNKNOWN');
  });

  it('audit log has no secret fields', async () => {
    const { useCase, getAuditLog } = makeUseCase();
    await useCase.execute({
      credentialKind: 'LINE_LOGIN',
      channelId: 'ch-id',
      channelSecret: 'ch-secret',
      requestingAdminUserId: 'admin-1',
      requestId: 'req-1',
    });
    const log = getAuditLog();
    const logStr = JSON.stringify(log);
    assert.ok(!logStr.includes('ch-secret'), 'Audit log must not contain secret');
    assert.ok(!logStr.includes('ch-id'), 'Audit log must not contain channelId');
    assert.equal(log.metadataJson.action, 'created');
    assert.equal(log.action, 'system.shared_line_credential.upsert');
  });

  it('audit action is "replaced" when credential already exists', async () => {
    const { useCase, getAuditLog } = makeUseCase({ existing: true });
    await useCase.execute({
      credentialKind: 'LINE_LIFF',
      channelId: 'ch-id',
      channelSecret: 'ch-secret',
      requestingAdminUserId: 'admin-1',
      requestId: 'req-2',
    });
    assert.equal(getAuditLog().metadataJson.action, 'replaced');
  });

  it('encrypted value decrypts back correctly', async () => {
    const { useCase, getStored } = makeUseCase();
    await useCase.execute({
      credentialKind: 'LINE_MESSAGING_API',
      channelId: 'the-channel',
      channelSecret: 'super-secret',
      accessToken: 'token-abc',
      requestingAdminUserId: 'admin-1',
      requestId: 'req-3',
    });
    const stored = getStored();
    const decrypted = JSON.parse(decryptCredential(stored.encryptedSecretJson, TEST_KEY));
    assert.equal(decrypted.channelId, 'the-channel');
    assert.equal(decrypted.channelSecret, 'super-secret');
    assert.equal(decrypted.accessToken, 'token-abc');
  });
});
