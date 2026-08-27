import 'reflect-metadata';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { EmployeeController } from './employee.controller';

it('binds draft deletion to the existing disable permission and forwards only trusted request context', async () => {
  const handler = EmployeeController.prototype.deleteDraft;
  assert.equal(Reflect.getMetadata(PATH_METADATA, handler), ':employeeId/draft');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.DELETE);
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, handler), 204);
  assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), ['access.employee.disable']);
  const seen: unknown[] = [];
  const controller = new EmployeeController(...[
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { execute: async (command: unknown) => { seen.push(command); } },
  ] as unknown as ConstructorParameters<typeof EmployeeController>);
  await controller.deleteDraft({ companyId: 'trusted-company', userId: 'actor', permissions: ['access.employee.disable'], requestId: 'req' } as any, 'employee');
  assert.deepEqual(seen, [{ companyId: 'trusted-company', employeeId: 'employee', requestingUserId: 'actor', requesterPermissions: ['access.employee.disable'], requestId: 'req' }]);
});
