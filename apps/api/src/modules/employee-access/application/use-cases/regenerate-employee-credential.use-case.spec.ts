import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RegenerateEmployeeCredentialUseCase } from './regenerate-employee-credential.use-case';

const KEY = Buffer.from('a'.repeat(64), 'hex');
const CONFIG = { credentialEncryptionKey: KEY, lineMessagingChannelAccessToken: 'system-oa-token' } as any;
const PROFILE = { id: 'emp-1', companyId: 'company-1', userId: 'user-1', user: { id: 'user-1', username: 'staff.one' } };

const COMMAND = { companyId: 'company-1', employeeId: 'emp-1', requestingUserId: 'admin-1', requestId: 'req-1' };

function makePrisma(identity: { providerUserId: string } | null) {
  const state = { committed: false, auditLogs: [] as any[], identityLookupAfterCommit: false, revocations: [] as any[] };
  const prisma = {
    client: {
      employeeAccessProfile: { findFirst: async () => PROFILE },
      // Single-company employee: no membership anywhere else, so the reuse guard lets the reset through.
      companyMembership: { count: async () => 0 },
      externalIdentity: {
        findFirst: async () => {
          state.identityLookupAfterCommit = state.committed;
          return identity;
        },
      },
      $transaction: async (fn: any) => {
        const result = await fn({
          userCredential: { update: async () => ({}) },
          authSession: {
            updateMany: async (args: any) => {
              state.revocations.push(args);
              return { count: 2 };
            },
          },
          auditLog: { create: async ({ data }: any) => { state.auditLogs.push(data); } },
        });
        state.committed = true;
        return result;
      },
    },
  } as any;
  return { prisma, state };
}

function captureLinePushes(ok: boolean | 'reject' = true) {
  const pushes: Array<{ to: string; text: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body as string);
    pushes.push({ to: body.to, text: body.messages[0].text });
    if (ok === 'reject') throw new Error('network down');
    return { ok } as Response;
  }) as typeof fetch;
  return { pushes, restore: () => { globalThis.fetch = original; } };
}

describe('RegenerateEmployeeCredentialUseCase', () => {
  it('pushes the temporary password to the linked LINE identity after the transaction commits', async () => {
    const line = captureLinePushes();
    const { prisma, state } = makePrisma({ providerUserId: 'line-staff-1' });
    try {
      const handoff = await new RegenerateEmployeeCredentialUseCase(prisma, CONFIG).execute(COMMAND);

      assert.equal(handoff.lineNotified, true);
      assert.equal(state.identityLookupAfterCommit, true, 'LINE work must run after the transaction commits');
      assert.equal(line.pushes.length, 1);
      assert.equal(line.pushes[0]!.to, 'line-staff-1');
      assert.ok(line.pushes[0]!.text.includes(handoff.temporaryPassword));
      assert.deepEqual(state.revocations[0].where, { userId: 'user-1', status: 'ACTIVE' });
      assert.equal(state.revocations[0].data.status, 'REVOKED');
      assert.equal(state.auditLogs[0].metadataJson.revokedSessionCount, 2);
      // The password must never reach audit metadata.
      assert.equal(JSON.stringify(state.auditLogs).includes(handoff.temporaryPassword), false);
    } finally {
      line.restore();
    }
  });

  it('reports lineNotified=false and pushes nothing when the employee has no linked LINE identity', async () => {
    const line = captureLinePushes();
    const { prisma } = makePrisma(null);
    try {
      const handoff = await new RegenerateEmployeeCredentialUseCase(prisma, CONFIG).execute(COMMAND);
      assert.equal(handoff.lineNotified, false);
      assert.equal(line.pushes.length, 0);
      assert.ok(handoff.temporaryPassword.length > 0);
    } finally {
      line.restore();
    }
  });

  it('still succeeds when the LINE push fails', async () => {
    const line = captureLinePushes('reject');
    const { prisma } = makePrisma({ providerUserId: 'line-staff-1' });
    try {
      const handoff = await new RegenerateEmployeeCredentialUseCase(prisma, CONFIG).execute(COMMAND);
      assert.equal(handoff.lineNotified, false);
      assert.equal(handoff.username, 'staff.one');
    } finally {
      line.restore();
    }
  });
});
