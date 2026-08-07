import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  ListCrmMessageTemplatesUseCase,
  CreateCrmMessageTemplateUseCase,
  UpdateCrmMessageTemplateUseCase,
  ApproveCrmMessageTemplateForAiUseCase,
  ArchiveCrmMessageTemplateUseCase,
} from './crm-template.use-case';
import type { RequestContext } from '@watchdog-bms/contracts';

const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'sub-1',
  userId: 'user-1',
  companyId: 'co-1',
  membershipId: 'mem-1',
  roles: ['ADMIN'],
  permissions: ['crm.template.read', 'crm.template.manage'],
  scopes: {},
  authProvider: 'dev',
};

const template = {
  id: 'tpl-1',
  companyId: 'co-1',
  title: 'ทักทาย',
  bodyText: 'สวัสดีค่ะ มีอะไรให้ช่วยไหมคะ',
  category: null,
  status: 'ACTIVE' as const,
  version: 1,
  aiApprovedVersion: null,
  aiApprovedAt: null,
  aiApprovedByUserId: null,
  createdByUserId: 'user-1',
  updatedByUserId: null,
  createdAt: new Date('2026-07-06T00:00:00Z'),
  updatedAt: new Date('2026-07-06T00:00:00Z'),
};

const audit = { log: mock.fn(async () => {}) };

function makeRepo(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    listTemplates: mock.fn(async (_c: string, status: string) => (status === 'ACTIVE' ? [template] : [])),
    findTemplateById: mock.fn(async () => template),
    findActiveTemplateByTitle: mock.fn(async () => null),
    createTemplate: mock.fn(async (input: any) => ({ ...template, ...input, id: 'tpl-new' })),
    updateTemplate: mock.fn(async (_c: string, id: string, data: any) => ({ ...template, id, ...data })),
    approveTemplateVersionForAi: mock.fn(async (_c: string, id: string, version: number, userId: string) => ({
      ...template,
      id,
      version,
      aiApprovedVersion: version,
      aiApprovedAt: new Date('2026-07-28T00:00:00Z'),
      aiApprovedByUserId: userId,
    })),
    ...overrides,
  };
}

describe('ListCrmMessageTemplatesUseCase', () => {
  it('lists active templates for crm.template.read', async () => {
    const uc = new ListCrmMessageTemplatesUseCase(makeRepo() as any);
    const result = await uc.execute(ctx);
    assert.equal(result.length, 1);
    assert.equal(result[0].title, 'ทักทาย');
    assert.equal(result[0].createdAt, '2026-07-06T00:00:00.000Z');
  });

  it('refuses without crm.template.read', async () => {
    const uc = new ListCrmMessageTemplatesUseCase(makeRepo() as any);
    await assert.rejects(() => uc.execute({ ...ctx, permissions: [] }), ForbiddenException);
  });
});

describe('CreateCrmMessageTemplateUseCase', () => {
  it('creates with trimmed title/body', async () => {
    const repo = makeRepo();
    const uc = new CreateCrmMessageTemplateUseCase(repo as any, audit as any);
    const result = await uc.execute(ctx, { title: '  ปิดการขาย  ', bodyText: '  ขอบคุณที่อุดหนุนค่ะ  ' });
    assert.equal(result.title, 'ปิดการขาย');
    assert.equal(result.bodyText, 'ขอบคุณที่อุดหนุนค่ะ');
  });

  it('refuses reply-only users (crm.template.read without manage)', async () => {
    const uc = new CreateCrmMessageTemplateUseCase(makeRepo() as any, audit as any);
    await assert.rejects(
      () => uc.execute({ ...ctx, permissions: ['crm.template.read'] }, { title: 'x', bodyText: 'y' }),
      ForbiddenException,
    );
  });

  it('rejects duplicate active titles with 409', async () => {
    const repo = makeRepo({ findActiveTemplateByTitle: mock.fn(async () => template) });
    const uc = new CreateCrmMessageTemplateUseCase(repo as any, audit as any);
    await assert.rejects(() => uc.execute(ctx, { title: 'ทักทาย', bodyText: 'ซ้ำ' }), ConflictException);
  });

  it('rejects empty title/body', async () => {
    const uc = new CreateCrmMessageTemplateUseCase(makeRepo() as any, audit as any);
    await assert.rejects(() => uc.execute(ctx, { title: '   ', bodyText: 'y' }), BadRequestException);
    await assert.rejects(() => uc.execute(ctx, { title: 'x', bodyText: '' }), BadRequestException);
  });
});

describe('UpdateCrmMessageTemplateUseCase', () => {
  it('updates body and records updater', async () => {
    const repo = makeRepo();
    const uc = new UpdateCrmMessageTemplateUseCase(repo as any, audit as any);
    await uc.execute(ctx, 'tpl-1', { bodyText: 'ข้อความใหม่' });
    const call = (repo.updateTemplate as any).mock.calls[0].arguments;
    assert.equal(call[1], 'tpl-1');
    assert.equal(call[2].bodyText, 'ข้อความใหม่');
    assert.equal(call[2].updatedByUserId, 'user-1');
    assert.equal(call[2].version, 2);
    assert.equal(call[2].aiApprovedVersion, null);
  });

  it('404s on unknown template and blocks editing archived ones', async () => {
    const uc404 = new UpdateCrmMessageTemplateUseCase(makeRepo({ findTemplateById: mock.fn(async () => null) }) as any, audit as any);
    await assert.rejects(() => uc404.execute(ctx, 'missing', { bodyText: 'x' }), NotFoundException);

    const ucArchived = new UpdateCrmMessageTemplateUseCase(
      makeRepo({ findTemplateById: mock.fn(async () => ({ ...template, status: 'ARCHIVED' })) }) as any,
      audit as any,
    );
    await assert.rejects(() => ucArchived.execute(ctx, 'tpl-1', { bodyText: 'x' }), BadRequestException);
  });

  it('rejects renaming onto another active title', async () => {
    const repo = makeRepo({ findActiveTemplateByTitle: mock.fn(async () => ({ ...template, id: 'other' })) });
    const uc = new UpdateCrmMessageTemplateUseCase(repo as any, audit as any);
    await assert.rejects(() => uc.execute(ctx, 'tpl-1', { title: 'ชื่อชนกัน' }), ConflictException);
  });
});

describe('ApproveCrmMessageTemplateForAiUseCase', () => {
  it('approves exactly the reviewed current version and exposes that state', async () => {
    const repo = makeRepo();
    const uc = new ApproveCrmMessageTemplateForAiUseCase(repo as any, audit as any);
    const result = await uc.execute(ctx, 'tpl-1');

    assert.equal(result.aiApproved, true);
    assert.equal(result.aiApprovedVersion, 1);
    assert.equal((repo.approveTemplateVersionForAi as any).mock.calls[0].arguments[2], 1);
  });

  it('rejects archived templates and stale concurrent reviews', async () => {
    const archived = new ApproveCrmMessageTemplateForAiUseCase(
      makeRepo({ findTemplateById: mock.fn(async () => ({ ...template, status: 'ARCHIVED' })) }) as any,
      audit as any,
    );
    await assert.rejects(() => archived.execute(ctx, 'tpl-1'), BadRequestException);

    const stale = new ApproveCrmMessageTemplateForAiUseCase(
      makeRepo({ approveTemplateVersionForAi: mock.fn(async () => null) }) as any,
      audit as any,
    );
    await assert.rejects(() => stale.execute(ctx, 'tpl-1'), ConflictException);
  });
});

describe('ArchiveCrmMessageTemplateUseCase', () => {
  it('archives an active template', async () => {
    const repo = makeRepo();
    const uc = new ArchiveCrmMessageTemplateUseCase(repo as any, audit as any);
    const result = await uc.execute(ctx, 'tpl-1');
    assert.equal(result.status, 'ARCHIVED');
    assert.equal((repo.updateTemplate as any).mock.calls[0].arguments[2].status, 'ARCHIVED');
  });

  it('is idempotent on already-archived templates', async () => {
    const repo = makeRepo({ findTemplateById: mock.fn(async () => ({ ...template, status: 'ARCHIVED' })) });
    const uc = new ArchiveCrmMessageTemplateUseCase(repo as any, audit as any);
    const result = await uc.execute(ctx, 'tpl-1');
    assert.equal(result.status, 'ARCHIVED');
    assert.equal((repo.updateTemplate as any).mock.calls.length, 0);
  });
});
