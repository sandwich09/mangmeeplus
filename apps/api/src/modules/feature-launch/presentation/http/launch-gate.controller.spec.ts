import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LaunchGateController } from './launch-gate.controller';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { IS_PUBLIC_ROUTE_KEY } from '../../../../common/security/public.decorator';
import { COMPANY_PERMISSION_KEYS, ROLE_GRANTS } from '../../../auth/permission-registry';
import 'reflect-metadata';

const HANDLERS = {
  command: LaunchGateController.prototype.command,
  health: LaunchGateController.prototype.health,
};

function makeContext(handler: (...args: any[]) => unknown, permissions?: string[]) {
  const request = permissions === undefined ? {} : { context: { userId: 'u-1', requestId: 'req-1', permissions } };
  return {
    getHandler: () => handler,
    getClass: () => LaunchGateController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

function makeCtrl(overrides: { gateCommand?: any; launchHealth?: any } = {}) {
  return new LaunchGateController(
    overrides.gateCommand ?? { execute: async () => ({ state: 'OPEN' }) } as any,
    overrides.launchHealth ?? { execute: async () => ({ gates: [], featureLifecycle: [], unmaterializedMatrixRows: [] }) } as any,
  );
}

/** Callers AC29 names explicitly. None of them can hold a `system.` permission. */
const REJECTED_CALLERS: Array<{ label: string; permissions: string[] }> = [
  { label: 'tenant OWNER holding every company permission', permissions: [...COMPANY_PERMISSION_KEYS] },
  { label: 'partner-company member', permissions: ROLE_GRANTS['ADMIN'] ?? [] },
  { label: 'AI-delegated actor context', permissions: ['ai.tool.invoke', 'line.ai.query', ...(ROLE_GRANTS['OWNER'] ?? [])] },
  { label: 'customer self-service context', permissions: [] },
  // A system admin that holds the read permission still cannot issue a command.
  { label: 'read-only launch-health viewer', permissions: ['system.launch_gate.read'] },
];

describe('LaunchGateController — authorization (spec:55, AC29)', () => {
  it('declares system-only permissions on both routes and is never public', () => {
    const reflector = new Reflector();
    assert.deepEqual(reflector.get(REQUIRED_PERMISSIONS_KEY, HANDLERS.command), ['system.launch_gate.manage']);
    assert.deepEqual(reflector.get(REQUIRED_PERMISSIONS_KEY, HANDLERS.health), ['system.launch_gate.read']);
    assert.equal(reflector.getAllAndOverride(IS_PUBLIC_ROUTE_KEY, [HANDLERS.command, LaunchGateController]), undefined);
    assert.equal(reflector.getAllAndOverride(IS_PUBLIC_ROUTE_KEY, [HANDLERS.health, LaunchGateController]), undefined);
  });

  it('keeps both permissions out of every company (tenant-grantable) permission key', () => {
    for (const key of ['system.launch_gate.manage', 'system.launch_gate.read']) {
      assert.ok(!COMPANY_PERMISSION_KEYS.includes(key), `${key} must never be grantable to a company role`);
    }
    for (const [role, grants] of Object.entries(ROLE_GRANTS)) {
      if (role === 'SYSTEM_ADMIN') continue;
      assert.ok(!grants.includes('system.launch_gate.manage'), `${role} must not hold system.launch_gate.manage`);
      assert.ok(!grants.includes('system.launch_gate.read'), `${role} must not hold system.launch_gate.read`);
    }
    assert.ok((ROLE_GRANTS['SYSTEM_ADMIN'] ?? []).includes('system.launch_gate.manage'));
    assert.ok((ROLE_GRANTS['SYSTEM_ADMIN'] ?? []).includes('system.launch_gate.read'));
  });

  for (const caller of REJECTED_CALLERS) {
    it(`rejects the ${caller.label} on the control-plane command`, () => {
      const guard = new DenyByDefaultGuard(new Reflector());
      assert.throws(() => guard.canActivate(makeContext(HANDLERS.command, caller.permissions)), ForbiddenException);
    });
  }

  it('rejects an unauthenticated caller on the health view', () => {
    const guard = new DenyByDefaultGuard(new Reflector());
    assert.throws(() => guard.canActivate(makeContext(HANDLERS.health, undefined)));
  });

  it('admits the platform authority', () => {
    const guard = new DenyByDefaultGuard(new Reflector());
    assert.equal(guard.canActivate(makeContext(HANDLERS.command, ROLE_GRANTS['SYSTEM_ADMIN'] ?? [])), true);
    assert.equal(guard.canActivate(makeContext(HANDLERS.health, ROLE_GRANTS['SYSTEM_ADMIN'] ?? [])), true);
  });
});

describe('LaunchGateController — request mapping', () => {
  it('passes the actor and falls back to the request id as the command key', async () => {
    let received: any;
    const ctrl = makeCtrl({ gateCommand: { execute: async (cmd: any) => { received = cmd; return {}; } } });
    await ctrl.command(
      {
        gateKey: 'inventory',
        routeKey: 'DEFAULT',
        action: 'OPEN',
        snapshot: { targetEnvironment: 'production', buildReleaseId: 'sha-1', expectedGeneration: 0, releaseApprovedByUserId: 'ro-1' },
      } as any,
      { context: { userId: 'admin-1', requestId: 'req-9' } } as any,
    );

    assert.equal(received.commandId, 'req-9');
    assert.equal(received.actorUserId, 'admin-1');
    assert.equal(received.snapshot.releaseApprovedByUserId, 'ro-1');
  });

  it('health() is read-only passthrough to the view', async () => {
    const view = await makeCtrl().health();
    assert.deepEqual(Object.keys(view), ['gates', 'featureLifecycle', 'unmaterializedMatrixRows']);
  });
});
