import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PlatformAccessService } from './platform-access.service';

function config(targetEnvironment: 'local' | 'uat' | 'production', servingMode?: 'live' | 'maintenance_only') {
  return { deploymentIdentity: { targetEnvironment, buildReleaseId: 'build-1' }, productionServingMode: servingMode } as any;
}

function service(options: {
  target?: 'local' | 'uat' | 'production';
  mode?: 'live' | 'maintenance_only';
  row?: any;
  readError?: boolean;
} = {}) {
  const writes: any[] = [];
  const audits: any[] = [];
  const row = options.row ?? null;
  const tx = {
    platformAccessControl: {
      upsert: async (args: any) => {
        writes.push(args);
        return args.create;
      },
    },
  };
  const prisma = {
    client: {
      platformAccessControl: {
        findUnique: async () => {
          if (options.readError) throw new Error('table unavailable');
          return row;
        },
      },
      $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
    },
  } as any;
  const audit = { log: async (entry: any, client: any) => audits.push({ entry, client }) } as any;
  return {
    instance: new PlatformAccessService(
      prisma,
      config(options.target ?? 'production', options.mode),
      audit,
    ),
    writes,
    audits,
    tx,
  };
}

describe('PlatformAccessService', () => {
  it('forces production maintenance closed even when the stored request says OPEN', async () => {
    const { instance } = service({
      mode: 'maintenance_only',
      row: {
        state: 'OPEN',
        updatedAt: new Date('2026-08-10T12:00:00.000Z'),
        updatedBySystemAdminUserId: 'admin-1',
        reason: 'requested',
      },
    });
    const status = await instance.getStatus();
    assert.equal(status.requestedState, 'OPEN');
    assert.equal(status.effectiveState, 'CLOSED');
    assert.equal(status.canOpen, false);
  });

  it('defaults production closed and non-production open when no row exists', async () => {
    assert.equal((await service({ mode: 'live' }).instance.getStatus()).effectiveState, 'CLOSED');
    assert.equal((await service({ target: 'uat' }).instance.getStatus()).effectiveState, 'OPEN');
  });

  it('fails closed and refuses opening when the control table cannot be read', async () => {
    const { instance } = service({ mode: 'live', readError: true });
    const status = await instance.getStatus();
    assert.equal(status.effectiveState, 'CLOSED');
    assert.equal(status.canOpen, false);
    await assert.rejects(
      () => instance.setState({ state: 'OPEN', actorUserId: 'admin-1', requestId: 'req-1' }),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('writes the switch and CRITICAL audit atomically in a verified live release', async () => {
    const result = service({ mode: 'live' });
    await result.instance.setState({ state: 'OPEN', reason: ' pilot ready ', actorUserId: 'admin-1', requestId: 'req-1' });
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].create.state, 'OPEN');
    assert.equal(result.writes[0].create.reason, 'pilot ready');
    assert.equal(result.audits.length, 1);
    assert.equal(result.audits[0].client, result.tx);
    assert.equal(result.audits[0].entry.riskLevel, 'CRITICAL');
    assert.equal(result.audits[0].entry.metadataJson.to, 'OPEN');
  });
});
