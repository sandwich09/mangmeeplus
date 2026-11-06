import 'reflect-metadata';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_ROUTE_KEY } from '../../../common/security/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../../../common/security/permissions.decorator';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../../common/pipes/validation-pipe.options';
import { SalesAgentActiveGuard } from '../../sales-console/application/sales-context';
import { DemoAuthController, OpenDemoDto, SalesDemoLinksController } from './sales-demo.controller';

it('pins the mint permission, active-sales guard, public exchange and success HTTP codes', () => {
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, SalesDemoLinksController.prototype.mint), ['sales.demo_link.create']);
  assert.ok(Reflect.getMetadata(GUARDS_METADATA, SalesDemoLinksController).includes(SalesAgentActiveGuard));
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, SalesDemoLinksController.prototype.mint), 201);
  assert.equal(Reflect.getMetadata(IS_PUBLIC_ROUTE_KEY, DemoAuthController.prototype.open), true);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, DemoAuthController.prototype.open), 200);
});

it('accepts only an empty mint body and a bounded string exchange token', async () => {
  const controller = new SalesDemoLinksController({ mint: async () => ({ url: 'url', expiresAt: 'date' }) } as any);
  assert.deepEqual(await controller.mint({}, { context: {} } as any), { url: 'url', expiresAt: 'date' });
  assert.throws(() => controller.mint({ companyId: 'forged' } as any, {} as any), BadRequestException);
  const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
  const metadata = { type: 'body' as const, metatype: OpenDemoDto };
  await pipe.transform({ token: 'raw-token' }, metadata);
  for (const body of [{}, { token: '' }, { token: 123 }, { token: 'x'.repeat(129) }, { token: 'raw', companyId: 'forged' }]) {
    await assert.rejects(pipe.transform(body, metadata), BadRequestException);
  }
});
