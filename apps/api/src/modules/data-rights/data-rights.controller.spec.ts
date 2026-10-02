import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PERMISSIONS_KEY } from '../../common/security/permissions.decorator';
import { IS_PUBLIC_ROUTE_KEY } from '../../common/security/public.decorator';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../common/pipes/validation-pipe.options';
import {
  CloseCaseDto,
  CompleteCaseDto,
  CreateCaseDto,
  DataRightsController,
  ListCasesQueryDto,
  RecordEvidenceDto,
  SameActorStepDto,
  VerifyIdentityDto,
} from './data-rights.controller';
import { DATA_RIGHTS_MANAGE_PERMISSION } from './data-rights.service';
import 'reflect-metadata';

describe('DataRightsController', () => {
  it('keeps every route behind the one CRITICAL system permission and exposes no public override', () => {
    const reflector = new Reflector();
    assert.deepEqual(reflector.get(REQUIRED_PERMISSIONS_KEY, DataRightsController), [DATA_RIGHTS_MANAGE_PERMISSION]);
    assert.equal(reflector.get(IS_PUBLIC_ROUTE_KEY, DataRightsController), undefined);
    assert.equal(Reflect.getMetadata('path', DataRightsController), 'system/data-rights');
  });

  it('passes authenticated context and command bodies to the service unchanged', async () => {
    let received: any;
    const service = {
      createCase: async (ctx: any, body: any) => { received = { ctx, body }; return { caseId: 'case-1' }; },
    };
    const controller = new DataRightsController(service as any);
    const context = { userId: 'admin-1', requestId: 'req-1', roles: ['SYSTEM_ADMIN'], permissions: [DATA_RIGHTS_MANAGE_PERMISSION] };
    const body = {
      commandId: 'cmd-1', requestKey: 'DR-1', caseType: 'USER_ACCOUNT_ERASURE', requestSource: 'IN_APP',
      targetUserId: 'user-1', dueAt: '2030-01-01T00:00:00.000Z',
    };
    const result = await controller.create(body as any, { context } as any) as any;
    assert.equal(result.caseId, 'case-1');
    assert.equal(received.ctx, context);
    assert.equal(received.body, body);
  });

  it('rejects URL/token references and requires a hash on operational evidence DTOs', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const validate = (value: Record<string, unknown>, metatype: new () => object) =>
      pipe.transform(value, { type: 'body', metatype }) as Promise<unknown>;
    await assert.rejects(() => validate({
      commandId: 'identity-1', method: 'AUTHENTICATED_SESSION',
      reference: 'https://objects.example/file?token=secret',
    }, VerifyIdentityDto), BadRequestException);
    await assert.rejects(() => validate({
      commandId: 'evidence-1', evidenceType: 'DATABASE_EXECUTION', reference: 'run://job/1',
    }, RecordEvidenceDto), BadRequestException);
    const valid = await validate({
      commandId: 'evidence-1', evidenceType: 'DATABASE_EXECUTION', category: 'ACCOUNT_IDENTITY',
      reference: 'run://job/1', sha256: 'a'.repeat(64),
    }, RecordEvidenceDto) as Record<string, unknown>;
    assert.equal(valid.reference, 'run://job/1');
  });

  it('accepts BLOCKED remediation, prior case links, and server-side due filters with strict shapes', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const validate = (value: Record<string, unknown>, metatype: new () => object) =>
      pipe.transform(value, { type: 'body', metatype }) as Promise<unknown>;
    const created = await validate({
      commandId: 'follow-up-1', requestKey: 'DR-FOLLOW-UP-1', caseType: 'COMPANY_WORKSPACE_OFFBOARDING',
      requestSource: 'SUPPORT', companyId: 'company-1', dueAt: '2030-01-01T00:00:00.000Z',
      priorCaseReference: 'case://case-previous',
    }, CreateCaseDto) as Record<string, unknown>;
    assert.equal(created.priorCaseReference, 'case://case-previous');
    await assert.rejects(() => validate({
      commandId: 'follow-up-2', requestKey: 'DR-FOLLOW-UP-2', caseType: 'COMPANY_WORKSPACE_OFFBOARDING',
      requestSource: 'SUPPORT', companyId: 'company-1', dueAt: '2030-01-01T00:00:00.000Z',
      priorCaseReference: 'case://case-previous?token=secret',
    }, CreateCaseDto), BadRequestException);
    const blocked = await validate({
      commandId: 'blocked-1', outcome: 'BLOCKED', reason: 'A processor refused the request.',
    }, CloseCaseDto) as Record<string, unknown>;
    assert.equal(blocked.outcome, 'BLOCKED');
    const query = await validate({ dueFilter: 'OVERDUE', pageSize: '25' }, ListCasesQueryDto) as Record<string, unknown>;
    assert.equal(query.dueFilter, 'OVERDUE');
    assert.equal(query.pageSize, 25);
    await assert.rejects(() => validate({ dueFilter: 'TERMINAL' }, ListCasesQueryDto), BadRequestException);
  });

  it('carries the single-admin reason of the five same-person steps to the service, and nothing unknown', async () => {
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const validate = (value: Record<string, unknown>, metatype: new () => object) =>
      pipe.transform(value, { type: 'body', metatype }) as Promise<any>;
    const reason = 'ระบบมีผู้ดูแลระบบเพียงคนเดียว จึงทำขั้นตอนนี้ด้วยตนเอง';
    const calls: any[] = [];
    const record = (name: string) => async (...args: any[]) => { calls.push([name, ...args.slice(1)]); return { caseId: 'case-1' }; };
    const controller = new DataRightsController({
      approve: record('approve'), startExecution: record('startExecution'), startVerification: record('startVerification'),
      recordEvidence: record('recordEvidence'), complete: record('complete'),
    } as any);
    const req = { context: { userId: 'admin-1' } } as any;

    const step = await validate({ commandId: 'step-1', singleAdminReason: reason }, SameActorStepDto);
    await controller.approve('case-1', step, req);
    await controller.startExecution('case-1', step, req);
    await controller.startVerification('case-1', await validate({ commandId: 'step-2' }, SameActorStepDto), req);
    const evidence = await validate({
      commandId: 'evidence-1', evidenceType: 'INDEPENDENT_VERIFICATION', reference: 'evidence://verification/1',
      sha256: 'a'.repeat(64), singleAdminReason: reason,
    }, RecordEvidenceDto);
    await controller.recordEvidence('case-1', evidence, req);
    const completion = await validate({
      commandId: 'complete-1', outcome: 'COMPLETED', outcomeSummary: 'Recorded.', singleAdminReason: reason,
    }, CompleteCaseDto);
    await controller.complete('case-1', completion, req);

    assert.deepEqual(calls.slice(0, 3), [
      ['approve', 'case-1', 'step-1', reason],
      ['startExecution', 'case-1', 'step-1', reason],
      ['startVerification', 'case-1', 'step-2', undefined],
    ]);
    assert.equal(calls[3][2].singleAdminReason, reason);
    assert.equal(calls[4][2].singleAdminReason, reason);
    await assert.rejects(() => validate({ commandId: 'step-3', singleAdminReason: 'ก'.repeat(1_001) }, SameActorStepDto), BadRequestException);
    await assert.rejects(() => validate({ commandId: 'step-4', singleAdmin: true }, SameActorStepDto), BadRequestException);
  });
});
