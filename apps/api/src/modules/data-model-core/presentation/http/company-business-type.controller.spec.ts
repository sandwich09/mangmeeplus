import { it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { CompanyIdentityController, PatchCompanyBusinessTypeBodyDto } from './company-identity.controller';

it('business type uses the existing manage permission and rejects a cross-company route before writing', async () => {
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CompanyIdentityController.prototype.patchBusinessType), ['company.legal_identity.manage']);
  const calls: unknown[] = [];
  const controller = new CompanyIdentityController({ patchBusinessType: async (...args: unknown[]) => { calls.push(args); } } as any);
  const ctx = { companyId: 'co-1' } as any;
  await assert.rejects(() => controller.patchBusinessType(ctx, 'co-2', { expectedVersion: 0, code: '56101' }), ForbiddenException);
  assert.equal(calls.length, 0);
  await controller.patchBusinessType(ctx, 'co-1', { expectedVersion: 0, code: '56101' });
  assert.equal(calls.length, 1);
});

it('validates the business type request shape before the use case validates the master', () => {
  for (const body of [{ code: '56101', expectedVersion: 0 }, { code: null, expectedVersion: 0 }, { code: 'OTHER', other: 'ทดสอบ', expectedVersion: 1 }]) {
    assert.equal(validateSync(plainToInstance(PatchCompanyBusinessTypeBodyDto, body)).length, 0);
  }
  for (const body of [{ expectedVersion: 0 }, { code: [], expectedVersion: 0 }, { code: '56101', expectedVersion: '0' }, { code: 'OTHER', other: {}, expectedVersion: 0 }]) {
    assert.ok(validateSync(plainToInstance(PatchCompanyBusinessTypeBodyDto, body)).length);
  }
});

it('legacy settings managers can read masked identity with the same tenant guard and no new write authority', async () => {
  assert.deepEqual(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, CompanyIdentityController.prototype.get), ['company.setup.read', 'company.setup.manage']);
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, CompanyIdentityController.prototype.patch), ['company.legal_identity.manage']);
  const calls: unknown[] = [];
  const controller = new CompanyIdentityController({ get: async (...args: unknown[]) => { calls.push(args); return { identity: { masked: true } }; } } as any);
  const ctx = { companyId: 'co-1', permissions: ['company.setup.manage'] } as any;
  await assert.rejects(() => controller.get(ctx, 'co-2'), ForbiddenException);
  assert.equal(calls.length, 0);
  assert.deepEqual(await controller.get(ctx, 'co-1'), { identity: { masked: true } });
});
