import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import {
  DATA_RIGHTS_DECISION_CATEGORIES,
  dataRightsAllowedDispositions,
  dataRightsCaseEvidenceRequirements,
  type DataRightsCaseType,
  type DataRightsDecisionCategory,
  type DataRightsDisposition,
} from '@watchdog-bms/contracts';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import {
  DATA_RIGHTS_MANAGE_PERMISSION,
  DataRightsService,
  type CreateDataRightsCaseCommand,
} from './data-rights.service';

function operator(userId: string): RequestContext {
  return {
    requestId: `req-${userId}`,
    authSubject: userId,
    userId,
    companyId: 'system-company',
    membershipId: `system-membership-${userId}`,
    roles: ['SYSTEM_ADMIN'],
    permissions: [DATA_RIGHTS_MANAGE_PERMISSION],
    scopes: {},
    authProvider: 'watchdog',
  };
}

const PDPA_KEY = Buffer.alloc(32, 0x2a);

function makeService(prisma: ReturnType<typeof makePrisma>, current = PDPA_KEY, previous: Buffer[] = []) {
  return new DataRightsService(prisma, {
    pdpaPseudonymizationKeyRing: { current, previous },
  } as any);
}

function makePrisma() {
  let sequence = 0;
  const state = {
    cases: [] as any[],
    decisions: [] as any[],
    evidence: [] as any[],
    actions: [] as any[],
    users: new Set(['user-1', 'user-2']),
    companies: new Set(['company-1']),
    memberships: [{ id: 'membership-1', companyId: 'company-1', userId: 'user-1' }],
    caseCreateError: null as unknown,
    listArgs: null as any,
    detailArgs: null as any,
  };
  const id = (prefix: string) => `${prefix}-${++sequence}`;
  const matches = (row: any, where: any): boolean => {
    if (!where) return true;
    if (where.AND && !(where.AND as any[]).every((item) => matches(row, item))) return false;
    if (where.OR && !(where.OR as any[]).some((item) => matches(row, item))) return false;
    return Object.entries(where)
      .filter(([key]) => key !== 'AND' && key !== 'OR')
      .every(([key, value]: [string, any]) => {
        if (value && typeof value === 'object' && !(value instanceof Date)) {
          if (value.in && !value.in.includes(row[key])) return false;
          if (value.notIn && value.notIn.includes(row[key])) return false;
          if (value.lt && !(row[key] < value.lt)) return false;
          return true;
        }
        return row[key] === value;
      });
  };
  const detail = (row: any) => {
    const { requesterContactHash: _restricted, ...safe } = row;
    return ({
    ...safe,
    decisions: state.decisions.filter((item) => item.caseId === row.id)
      .sort((a, b) => a.category.localeCompare(b.category) || b.revision - a.revision),
    evidence: state.evidence.filter((item) => item.caseId === row.id),
    actions: state.actions.filter((item) => item.caseId === row.id),
  });
  };

  const dataRightsCase = {
    findUnique: async (args: any) => {
      const row = args.where.id
        ? state.cases.find((item) => item.id === args.where.id)
        : state.cases.find((item) => item.requestKey === args.where.requestKey);
      if (!row) return null;
      if (args.select?.decisions) {
        state.detailArgs = args;
        return detail(row);
      }
      return { ...row };
    },
    findFirst: async (args: any) => state.cases.find((row) => matches(row, args.where)) ?? null,
    findMany: async (args: any) => {
      state.listArgs = args;
      let rows = state.cases.filter((row) => matches(row, args.where));
      rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
      if (args.cursor) rows = rows.slice(Math.max(0, rows.findIndex((row) => row.id === args.cursor.id) + 1));
      return rows.slice(0, args.take).map((row) => ({ ...row }));
    },
    create: async (args: any) => {
      if (state.caseCreateError) throw state.caseCreateError;
      const now = new Date();
      const row = {
        id: id('case'),
        status: 'RECEIVED',
        identityVerifiedAt: null,
        identityVerifiedByUserId: null,
        authorityVerifiedAt: null,
        authorityVerifiedByUserId: null,
        approvedAt: null,
        approvedByUserId: null,
        executionStartedAt: null,
        executionStartedByUserId: null,
        verificationStartedAt: null,
        verificationStartedByUserId: null,
        completedAt: null,
        completedByUserId: null,
        outcomeSummary: null,
        createdAt: now,
        updatedAt: now,
        ...args.data,
      };
      state.cases.push(row);
      return { id: row.id };
    },
    update: async (args: any) => {
      const row = state.cases.find((item) => item.id === args.where.id);
      Object.assign(row, args.data, { updatedAt: new Date() });
      return { ...row };
    },
  };
  const dataRightsCaseActionRecord = {
    findUnique: async (args: any) => state.actions.find((item) => item.commandId === args.where.commandId) ?? null,
    create: async (args: any) => {
      const row = { id: id('action'), createdAt: new Date(), ...args.data };
      state.actions.push(row);
      return row;
    },
  };
  const dataRightsDecisionRecord = {
    findFirst: async (args: any) => state.decisions
      .filter((item) => item.caseId === args.where.caseId && item.category === args.where.category)
      .sort((a, b) => b.revision - a.revision)[0] ?? null,
    findMany: async (args: any) => state.decisions
      .filter((item) => item.caseId === args.where.caseId)
      .sort((a, b) => b.revision - a.revision),
    create: async (args: any) => {
      const row = { id: id('decision'), recordedAt: new Date(), ...args.data };
      state.decisions.push(row);
      return row;
    },
  };
  const dataRightsEvidenceRecord = {
    findMany: async (args: any) => state.evidence.filter((item) => item.caseId === args.where.caseId),
    create: async (args: any) => {
      const row = { id: id('evidence'), recordedAt: new Date(), ...args.data };
      state.evidence.push(row);
      return row;
    },
  };
  const tx = {
    $queryRaw: async () => [],
    dataRightsCase,
    dataRightsCaseActionRecord,
    dataRightsDecisionRecord,
    dataRightsEvidenceRecord,
    user: { findUnique: async (args: any) => state.users.has(args.where.id) ? { id: args.where.id } : null },
    company: { findUnique: async (args: any) => state.companies.has(args.where.id) ? { id: args.where.id } : null },
    companyMembership: {
      findUnique: async (args: any) => state.memberships.find((item) => item.id === args.where.id) ?? null,
      findMany: async (args: any) => state.memberships
        .filter((item) => matches(item, args.where))
        .map((item) => ({ ...item })),
    },
  };
  return {
    state,
    client: {
      ...tx,
      $transaction: async (fn: (transaction: typeof tx) => Promise<unknown>) => fn(tx),
    },
  } as any;
}

const COMPANY_CASE: CreateDataRightsCaseCommand = {
  commandId: 'create-company-case',
  requestKey: 'DR-2026-0001',
  caseType: 'COMPANY_WORKSPACE_OFFBOARDING',
  requestSource: 'EMAIL',
  requesterContact: 'Owner@Example.com',
  companyId: 'company-1',
  dueAt: '2030-09-01T00:00:00.000Z',
};

async function reachReview(service: DataRightsService, creator = operator('admin-a')) {
  const created = await service.createCase(creator, COMPANY_CASE);
  await service.verifyIdentity(creator, created.caseId, {
    commandId: 'identity-1',
    method: 'VERIFIED_EMAIL_CHALLENGE',
    reference: 'evidence://identity/challenge-1',
  });
  await service.verifyAuthority(creator, created.caseId, {
    commandId: 'authority-1',
    method: 'COMPANY_AFFIDAVIT_REVIEWED',
    reference: 'approval://company/affidavit-1',
  });
  await service.beginRetentionReview(creator, created.caseId, 'review-1');
  return created.caseId;
}

async function recordAllDeleteDecisions(service: DataRightsService, caseId: string, ctx: RequestContext) {
  for (const category of DATA_RIGHTS_DECISION_CATEGORIES) {
    const allowed = dataRightsAllowedDispositions('COMPANY_WORKSPACE_OFFBOARDING', category);
    const disposition: DataRightsDisposition = allowed.includes('DELETE') ? 'DELETE' : allowed[0];
    await service.recordDecision(ctx, caseId, {
      commandId: `decision-${category.toLowerCase()}`,
      category,
      disposition,
      legalBasisCode: 'PDPA-33',
      rationale: `Delete ${category} after verified request.`,
    });
  }
}

async function recordRequiredEvidence(
  service: DataRightsService,
  prisma: ReturnType<typeof makePrisma>,
  caseId: string,
  ctx: RequestContext,
) {
  const latest = new Map<DataRightsDecisionCategory, DataRightsDisposition>();
  for (const decision of [...prisma.state.decisions]
    .filter((item: any) => item.caseId === caseId)
    .sort((a: any, b: any) => b.revision - a.revision)) {
    if (!latest.has(decision.category)) latest.set(decision.category, decision.disposition);
  }
  const caseType = prisma.state.cases.find((item: any) => item.id === caseId).caseType as DataRightsCaseType;
  for (const requirement of dataRightsCaseEvidenceRequirements(
    caseType,
    [...latest].map(([category, disposition]) => ({ category, disposition })),
  )) {
    await service.recordEvidence(ctx, caseId, {
      commandId: `evidence-${requirement.evidenceType.toLowerCase()}-${requirement.category.toLowerCase()}`,
      evidenceType: requirement.evidenceType,
      category: requirement.category,
      reference: `run://execution/${requirement.evidenceType.toLowerCase()}/${requirement.category.toLowerCase()}`,
      sha256: 'a'.repeat(64),
    });
  }
}

describe('DataRightsService', () => {
  it('enforces platform authority, hashes requester contact, returns safe fields, and replays create idempotently', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const tenantCtx = { ...operator('tenant-admin'), roles: ['OWNER'], permissions: [] };
    await assert.rejects(() => service.listCases(tenantCtx, {}), ForbiddenException);

    const first = await service.createCase(operator('admin-a'), COMPANY_CASE);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const replay = await service.createCase(operator('admin-a'), COMPANY_CASE);
    assert.equal(replay.replayed, true);
    assert.equal(prisma.state.cases.length, 1);
    assert.equal(prisma.state.actions.length, 1);
    assert.match(prisma.state.cases[0].requesterContactHash, /^[0-9a-f]{64}$/);
    const requesterKey = createHmac('sha256', PDPA_KEY)
      .update('watchdog-bms\0data-rights\0requester-contact\0pseudonymization-key\0v1')
      .digest();
    assert.equal(
      prisma.state.cases[0].requesterContactHash,
      createHmac('sha256', requesterKey).update('data-rights-requester-contact-v1\0owner@example.com').digest('hex'),
    );
    assert.equal(JSON.stringify(prisma.state.actions).includes('Owner@Example.com'), false);
    assert.equal('requesterContactHash' in first.case, false, 'detail must not return even the contact hash');
    const rotatedReplay = await makeService(prisma, Buffer.alloc(32, 0x3b), [PDPA_KEY])
      .createCase(operator('admin-a'), COMPANY_CASE);
    assert.equal(rotatedReplay.replayed, true, 'retained prior HMAC keys preserve command replay across rotation');

    await assert.rejects(
      () => service.createCase(operator('admin-a'), { ...COMPANY_CASE, requestSource: 'SUPPORT' }),
      ConflictException,
    );
    await assert.rejects(
      () => service.createCase(operator('admin-a'), {
        ...COMPANY_CASE, commandId: 'create-company-duplicate', requestKey: 'DR-2026-0002',
      }),
      (error: ConflictException) => {
        assert.equal((error.getResponse() as any).code, 'data_rights_active_target_conflict');
        return true;
      },
    );
    await service.close(operator('admin-a'), first.caseId, {
      commandId: 'cancel-company-case', outcome: 'CANCELLED', reason: 'Requester withdrew before execution.',
    });
    const replacement = await service.createCase(operator('admin-a'), {
      ...COMPANY_CASE, commandId: 'create-company-replacement', requestKey: 'DR-2026-0003',
    });
    assert.equal(replacement.case.status, 'RECEIVED', 'a terminal case does not block a reviewed replacement');
    await service.listCases(operator('admin-a'), {});
    assert.equal(prisma.state.listArgs.select.requesterContactHash, undefined);
    assert.equal(prisma.state.detailArgs.select.requesterContactHash, undefined);
  });

  it('requires identity and tenant authority evidence, and rejects token-bearing evidence references', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const ctx = operator('admin-a');
    const created = await service.createCase(ctx, COMPANY_CASE);

    await assert.rejects(
      () => service.recordEvidence(ctx, created.caseId, {
        commandId: 'preseed-execution-proof',
        evidenceType: 'DATABASE_EXECUTION',
        category: 'TENANT_OPERATIONAL_DATA',
        reference: 'run://offboarding/not-executed-yet',
        sha256: 'f'.repeat(64),
      }),
      ConflictException,
    );

    await assert.rejects(
      () => service.verifyIdentity(ctx, created.caseId, {
        commandId: 'identity-bad',
        method: 'VERIFIED_EMAIL_CHALLENGE',
        reference: 'https://objects.example/file?X-Amz-Signature=secret',
      }),
      UnprocessableEntityException,
    );
    await service.verifyIdentity(ctx, created.caseId, {
      commandId: 'identity-good', method: 'VERIFIED_EMAIL_CHALLENGE', reference: 'evidence://identity/challenge-1',
    });
    await assert.rejects(() => service.beginRetentionReview(ctx, created.caseId, 'review-too-early'), UnprocessableEntityException);
    await service.verifyAuthority(ctx, created.caseId, {
      commandId: 'authority-good', method: 'SIGNED_AUTHORIZATION_REVIEWED', reference: 'approval://authority/review-1',
    });
    const reviewed = await service.beginRetentionReview(ctx, created.caseId, 'review-good');
    assert.equal(reviewed.case.status, 'RETENTION_REVIEW');
    assert.deepEqual(prisma.state.evidence.map((item: any) => item.evidenceType), [
      'IDENTITY_VERIFICATION', 'AUTHORITY_VERIFICATION',
    ]);
  });

  it('appends decision revisions and refuses approval until every category has a current decision', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const ctx = operator('admin-a');
    const caseId = await reachReview(service, ctx);

    const first = {
      commandId: 'decision-account-v1',
      category: 'AI_OCR_DATA' as DataRightsDecisionCategory,
      disposition: 'RETAIN' as const,
      legalBasisCode: 'CLAIM-LIMITATION',
      rationale: 'Restrict the minimum identity evidence for an active legal claim.',
      retentionUntil: '2031-01-01T00:00:00.000Z',
      accessRestriction: 'Privacy coordinator and counsel only.',
    };
    await service.recordDecision(ctx, caseId, first);
    await service.recordDecision(ctx, caseId, { ...first, commandId: 'decision-account-v2', disposition: 'DELETE', retentionUntil: undefined, accessRestriction: undefined });
    const replay = await service.recordDecision(ctx, caseId, { ...first, commandId: 'decision-account-v2', disposition: 'DELETE', retentionUntil: undefined, accessRestriction: undefined });
    assert.equal(replay.replayed, true);
    assert.deepEqual(prisma.state.decisions.map((item: any) => item.revision), [1, 2]);

    await assert.rejects(
      () => service.approve(operator('admin-b'), caseId, 'approve-incomplete'),
      (error: UnprocessableEntityException) => {
        assert.equal((error.getResponse() as any).code, 'data_rights_decisions_incomplete');
        return true;
      },
    );
  });

  it('enforces two-person company control and required execution/completion evidence', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const adminA = operator('admin-a');
    const adminB = operator('admin-b');
    const caseId = await reachReview(service, adminA);
    await recordAllDeleteDecisions(service, caseId, adminA);

    await assert.rejects(() => service.approve(adminA, caseId, 'approve-self'), ForbiddenException);
    await service.approve(adminB, caseId, 'approve-b');
    await assert.rejects(() => service.startExecution(adminB, caseId, 'execute-by-approver'), ForbiddenException);
    await service.startExecution(adminA, caseId, 'execute-a');
    await assert.rejects(() => service.startVerification(adminB, caseId, 'verify-missing-evidence'), UnprocessableEntityException);
    await assert.rejects(
      () => service.recordEvidence(adminA, caseId, {
        commandId: 'bare-database-evidence',
        evidenceType: 'DATABASE_EXECUTION',
        category: 'AI_OCR_DATA',
        reference: 'run://offboarding/database-without-hash',
      }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      () => service.recordEvidence(adminA, caseId, {
        commandId: 'wrong-object-category',
        evidenceType: 'OBJECT_STORAGE_INVENTORY',
        category: 'BACKUPS',
        reference: 'run://offboarding/object-inventory-wrong-category',
        sha256: 'e'.repeat(64),
      }),
      UnprocessableEntityException,
    );

    await recordRequiredEvidence(service, prisma, caseId, adminA);
    await assert.rejects(() => service.startVerification(adminA, caseId, 'verify-by-executor'), ForbiddenException);
    await service.startVerification(adminB, caseId, 'verify-b');
    await assert.rejects(
      () => service.complete(adminB, caseId, { commandId: 'complete-before-independent', outcome: 'COMPLETED', outcomeSummary: 'Done.' }),
      UnprocessableEntityException,
    );
    await service.recordEvidence(adminB, caseId, {
      commandId: 'evidence-independent',
      evidenceType: 'INDEPENDENT_VERIFICATION',
      reference: 'evidence://verification/final-1',
      sha256: 'b'.repeat(64),
    });
    const completed = await service.complete(adminB, caseId, {
      commandId: 'complete-b', outcome: 'COMPLETED', outcomeSummary: 'Approved scope completed; no retained categories.',
    });
    assert.equal(completed.case.status, 'COMPLETED');
    assert.equal(completed.case.completedByUserId, 'admin-b');
  });

  it('enforces user-erasure segregation and requires COMPLETED_WITH_EXCEPTION for retained data', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const creator = operator('admin-a');
    const verifier = operator('admin-b');
    const created = await service.createCase(creator, {
      commandId: 'create-user-case', requestKey: 'DR-USER-1', caseType: 'USER_ACCOUNT_ERASURE',
      requestSource: 'IN_APP', targetUserId: 'user-1', dueAt: '2030-09-01T00:00:00.000Z',
    });
    await service.verifyIdentity(creator, created.caseId, {
      commandId: 'user-identity', method: 'AUTHENTICATED_SESSION', reference: 'evidence://session/verified-1',
    });
    await service.beginRetentionReview(creator, created.caseId, 'user-review');
    for (const category of DATA_RIGHTS_DECISION_CATEGORIES) {
      const retained = category === 'AUDIT_SECURITY_LOGS';
      const allowed = dataRightsAllowedDispositions('USER_ACCOUNT_ERASURE', category);
      const disposition: DataRightsDisposition = retained ? 'RESTRICT' : allowed.includes('DELETE') ? 'DELETE' : 'NOT_APPLICABLE';
      await service.recordDecision(creator, created.caseId, {
        commandId: `user-decision-${category.toLowerCase()}`,
        category,
        disposition,
        legalBasisCode: retained ? 'SECURITY-CLAIM' : 'PDPA-33',
        rationale: retained ? 'Restrict security evidence until the claim period ends.' : `Delete ${category}.`,
        ...(retained ? {
          retentionUntil: '2031-01-01T00:00:00.000Z', accessRestriction: 'Security and counsel only.',
        } : {}),
      });
    }
    await assert.rejects(() => service.approve(creator, created.caseId, 'user-approve-self'), ForbiddenException);
    await service.approve(verifier, created.caseId, 'user-approve');
    await assert.rejects(
      () => service.startExecution(verifier, created.caseId, 'user-execute-by-approver'),
      ForbiddenException,
    );
    await service.startExecution(creator, created.caseId, 'user-execute');
    await recordRequiredEvidence(service, prisma, created.caseId, creator);
    await assert.rejects(
      () => service.startVerification(creator, created.caseId, 'user-verify-by-executor'),
      ForbiddenException,
    );
    await service.startVerification(verifier, created.caseId, 'user-verify');
    await assert.rejects(
      () => service.recordEvidence(creator, created.caseId, {
        commandId: 'user-independent-by-executor', evidenceType: 'INDEPENDENT_VERIFICATION',
        reference: 'evidence://verification/user-self', sha256: 'c'.repeat(64),
      }),
      ForbiddenException,
    );
    await service.recordEvidence(verifier, created.caseId, {
      commandId: 'user-independent', evidenceType: 'INDEPENDENT_VERIFICATION', reference: 'evidence://verification/user-final',
      sha256: 'd'.repeat(64),
    });
    await assert.rejects(
      () => service.complete(verifier, created.caseId, {
        commandId: 'user-wrong-complete', outcome: 'COMPLETED', outcomeSummary: 'Incorrectly claims no exception.',
      }),
      UnprocessableEntityException,
    );
    await assert.rejects(
      () => service.complete(creator, created.caseId, {
        commandId: 'user-complete-by-executor', outcome: 'COMPLETED_WITH_EXCEPTION',
        outcomeSummary: 'The executor must not verify their own work.',
      }),
      ForbiddenException,
    );
    const completed = await service.complete(verifier, created.caseId, {
      commandId: 'user-complete-exception',
      outcome: 'COMPLETED_WITH_EXCEPTION',
      outcomeSummary: 'Operational deletion completed; restricted security evidence remains until the recorded date.',
    });
    assert.equal(completed.case.status, 'COMPLETED_WITH_EXCEPTION');
  });

  it('rejects dispositions outside the case matrix and expired retention decisions before persistence', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const ctx = operator('admin-a');
    const caseId = await reachReview(service, ctx);

    await assert.rejects(
      () => service.recordDecision(ctx, caseId, {
        commandId: 'matrix-invalid',
        category: 'ACCOUNT_IDENTITY',
        disposition: 'DELETE',
        legalBasisCode: 'PDPA-33',
        rationale: 'This company case must not erase the global account.',
      }),
      (error: UnprocessableEntityException) => {
        assert.equal((error.getResponse() as any).code, 'data_rights_disposition_out_of_scope');
        return true;
      },
    );
    await assert.rejects(
      () => service.recordDecision(ctx, caseId, {
        commandId: 'retention-expired',
        category: 'AI_OCR_DATA',
        disposition: 'RESTRICT',
        legalBasisCode: 'CLAIM-LIMITATION',
        rationale: 'An expired restriction cannot authorize execution.',
        retentionUntil: '2020-01-01T00:00:00.000Z',
        accessRestriction: 'Counsel only.',
      }),
      UnprocessableEntityException,
    );
    assert.equal(prisma.state.decisions.length, 0);
  });

  it('rechecks retention dates when execution starts instead of relying on stale approval', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const adminA = operator('admin-a');
    const caseId = await reachReview(service, adminA);
    await recordAllDeleteDecisions(service, caseId, adminA);
    await service.recordDecision(adminA, caseId, {
      commandId: 'decision-ai-restricted',
      category: 'AI_OCR_DATA',
      disposition: 'RESTRICT',
      legalBasisCode: 'CLAIM-LIMITATION',
      rationale: 'Restrict the evidence through the current legal review period.',
      retentionUntil: '2031-01-01T00:00:00.000Z',
      accessRestriction: 'Privacy coordinator and counsel only.',
    });
    await service.approve(operator('admin-b'), caseId, 'approve-retention');
    const latest = prisma.state.decisions
      .filter((item: any) => item.caseId === caseId && item.category === 'AI_OCR_DATA')
      .sort((a: any, b: any) => b.revision - a.revision)[0];
    latest.retentionUntil = new Date('2020-01-01T00:00:00.000Z');
    await assert.rejects(
      () => service.startExecution(adminA, caseId, 'execute-stale-retention'),
      (error: UnprocessableEntityException) => {
        assert.equal((error.getResponse() as any).code, 'data_rights_retention_review_expired');
        return true;
      },
    );
    latest.retentionUntil = new Date('2031-01-01T00:00:00.000Z');
    const executing = await service.startExecution(adminA, caseId, 'execute-current-retention');
    assert.equal(executing.case.status, 'EXECUTING');
  });

  it('enforces membership-exit segregation and baseline proof when every decision is NOT_APPLICABLE', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const creator = operator('admin-a');
    const verifier = operator('admin-b');
    const created = await service.createCase(creator, {
      commandId: 'create-membership-na',
      requestKey: 'DR-MEMBERSHIP-NA',
      caseType: 'MEMBERSHIP_EXIT',
      requestSource: 'SUPPORT',
      targetUserId: 'user-1',
      companyId: 'company-1',
      membershipId: 'membership-1',
      dueAt: '2030-09-01T00:00:00.000Z',
    });
    await service.verifyIdentity(creator, created.caseId, {
      commandId: 'membership-identity',
      method: 'COMPANY_ADMIN_ATTESTATION',
      reference: 'evidence://membership/identity',
    });
    await service.verifyAuthority(creator, created.caseId, {
      commandId: 'membership-authority',
      method: 'CURRENT_OWNER_MEMBERSHIP',
      reference: 'approval://membership/authority',
    });
    await service.beginRetentionReview(creator, created.caseId, 'membership-review');
    for (const category of DATA_RIGHTS_DECISION_CATEGORIES) {
      await service.recordDecision(creator, created.caseId, {
        commandId: `membership-na-${category.toLowerCase()}`,
        category,
        disposition: 'NOT_APPLICABLE',
        legalBasisCode: 'SCOPE-ABSENCE',
        rationale: `No ${category} record is changed by this membership exit.`,
      });
    }
    await assert.rejects(
      () => service.approve(creator, created.caseId, 'membership-approve-self'),
      ForbiddenException,
    );
    await service.approve(verifier, created.caseId, 'membership-approve');
    await assert.rejects(
      () => service.startExecution(verifier, created.caseId, 'membership-execute-by-approver'),
      ForbiddenException,
    );
    await service.startExecution(creator, created.caseId, 'membership-execute');
    prisma.state.evidence.push({
      id: 'evidence-bare',
      caseId: created.caseId,
      evidenceType: 'ACCESS_REVOCATION',
      category: 'MEMBERSHIPS_ACCESS',
      reference: 'run://membership/bare-reference',
      sha256: null,
      recordedByUserId: creator.userId,
      recordedAt: new Date(),
    });
    await assert.rejects(
      () => service.startVerification(verifier, created.caseId, 'membership-verify-bare'),
      (error: UnprocessableEntityException) => {
        const response = error.getResponse() as any;
        assert.equal(response.code, 'data_rights_execution_evidence_incomplete');
        assert.deepEqual(response.missingEvidence, [{
          evidenceType: 'ACCESS_REVOCATION', category: 'MEMBERSHIPS_ACCESS',
        }]);
        return true;
      },
    );
    await service.recordEvidence(creator, created.caseId, {
      commandId: 'membership-access-proof',
      evidenceType: 'ACCESS_REVOCATION',
      category: 'MEMBERSHIPS_ACCESS',
      reference: 'run://membership/access-revocation',
      sha256: 'c'.repeat(64),
    });
    await assert.rejects(
      () => service.startVerification(creator, created.caseId, 'membership-verify-by-executor'),
      ForbiddenException,
    );
    const verifying = await service.startVerification(verifier, created.caseId, 'membership-verify');
    assert.equal(verifying.case.status, 'VERIFICATION');
    await assert.rejects(
      () => service.recordEvidence(creator, created.caseId, {
        commandId: 'membership-independent-by-executor',
        evidenceType: 'INDEPENDENT_VERIFICATION',
        reference: 'evidence://verification/membership-self',
        sha256: 'd'.repeat(64),
      }),
      ForbiddenException,
    );
    await service.recordEvidence(verifier, created.caseId, {
      commandId: 'membership-independent',
      evidenceType: 'INDEPENDENT_VERIFICATION',
      reference: 'evidence://verification/membership-final',
      sha256: 'e'.repeat(64),
    });
    await assert.rejects(
      () => service.complete(creator, created.caseId, {
        commandId: 'membership-complete-by-executor',
        outcome: 'COMPLETED',
        outcomeSummary: 'The executor must not verify their own work.',
      }),
      ForbiddenException,
    );
    const completed = await service.complete(verifier, created.caseId, {
      commandId: 'membership-complete',
      outcome: 'COMPLETED',
      outcomeSummary: 'Membership exit and independent verification completed.',
    });
    assert.equal(completed.case.status, 'COMPLETED');
  });

  it('closes an operationally blocked case without claiming completion and links a safe follow-up', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const adminA = operator('admin-a');
    const adminB = operator('admin-b');
    const caseId = await reachReview(service, adminA);
    await recordAllDeleteDecisions(service, caseId, adminA);
    await service.approve(adminB, caseId, 'blocked-approve');
    await service.startExecution(adminA, caseId, 'blocked-execute');
    const blocked = await service.close(adminB, caseId, {
      commandId: 'blocked-close',
      outcome: 'BLOCKED',
      reason: 'Processor confirmation could not be obtained; no completion claim is made.',
    });
    assert.equal(blocked.case.status, 'BLOCKED');
    assert.equal(blocked.case.completedAt, null);
    assert.equal(blocked.case.completedByUserId, null);

    await assert.rejects(
      () => service.createCase(adminA, {
        commandId: 'blocked-wrong-follow-up',
        requestKey: 'DR-BLOCKED-WRONG',
        caseType: 'USER_ACCOUNT_ERASURE',
        requestSource: 'SUPPORT',
        targetUserId: 'user-2',
        priorCaseReference: `case://${caseId}`,
        dueAt: '2030-10-01T00:00:00.000Z',
      }),
      (error: UnprocessableEntityException) => {
        assert.equal((error.getResponse() as any).code, 'data_rights_prior_case_invalid');
        return true;
      },
    );
    const followUp = await service.createCase(adminA, {
      ...COMPANY_CASE,
      commandId: 'blocked-follow-up',
      requestKey: 'DR-BLOCKED-FOLLOW-UP',
      priorCaseReference: `case://${caseId}`,
    });
    assert.equal(followUp.case.status, 'RECEIVED');
    const createdAction = prisma.state.actions.find((item: any) => item.commandId === 'blocked-follow-up');
    assert.equal(createdAction.metadataJson.priorCaseReference, `case://${caseId}`);
  });

  it('rejects overlapping active user, membership, and company scopes and maps database races to a stable 409', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const ctx = operator('admin-a');
    const userCase = await service.createCase(ctx, {
      commandId: 'scope-user',
      requestKey: 'DR-SCOPE-USER',
      caseType: 'USER_ACCOUNT_ERASURE',
      requestSource: 'IN_APP',
      targetUserId: 'user-1',
      dueAt: '2030-09-01T00:00:00.000Z',
    });
    for (const input of [
      {
        commandId: 'scope-membership', requestKey: 'DR-SCOPE-MEMBERSHIP', caseType: 'MEMBERSHIP_EXIT' as const,
        requestSource: 'SUPPORT' as const, targetUserId: 'user-1', companyId: 'company-1', membershipId: 'membership-1',
        dueAt: '2030-09-01T00:00:00.000Z',
      },
      {
        ...COMPANY_CASE, commandId: 'scope-company', requestKey: 'DR-SCOPE-COMPANY', requesterContact: undefined,
      },
    ]) {
      await assert.rejects(
        () => service.createCase(ctx, input),
        (error: ConflictException) => {
          assert.equal((error.getResponse() as any).code, 'data_rights_active_target_conflict');
          assert.equal((error.getResponse() as any).activeCaseId, userCase.caseId);
          return true;
        },
      );
    }

    const racePrisma = makePrisma();
    racePrisma.state.caseCreateError = Object.assign(new Error('unique violation'), { code: 'P2002' });
    await assert.rejects(
      () => makeService(racePrisma).createCase(ctx, {
        commandId: 'scope-race', requestKey: 'DR-SCOPE-RACE', caseType: 'USER_ACCOUNT_ERASURE',
        requestSource: 'IN_APP', targetUserId: 'user-2', dueAt: '2030-09-01T00:00:00.000Z',
      }),
      (error: ConflictException) => {
        assert.equal((error.getResponse() as any).code, 'data_rights_active_target_conflict');
        return true;
      },
    );
  });

  it('filters due work on the server while keeping BLOCKED requests open and unresolved', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    const ctx = operator('admin-a');
    const blocked = await service.createCase(ctx, {
      commandId: 'due-blocked', requestKey: 'DR-DUE-BLOCKED', caseType: 'USER_ACCOUNT_ERASURE',
      requestSource: 'SUPPORT', targetUserId: 'user-1', dueAt: '2030-01-01T00:00:00.000Z',
    });
    Object.assign(prisma.state.cases.find((item: any) => item.id === blocked.caseId), {
      status: 'BLOCKED', dueAt: new Date('2020-01-01T00:00:00.000Z'), outcomeSummary: 'Follow-up required.',
    });
    const resolved = await service.createCase(ctx, {
      commandId: 'due-resolved', requestKey: 'DR-DUE-RESOLVED', caseType: 'USER_ACCOUNT_ERASURE',
      requestSource: 'SUPPORT', targetUserId: 'user-2', dueAt: '2030-01-01T00:00:00.000Z',
    });
    Object.assign(prisma.state.cases.find((item: any) => item.id === resolved.caseId), {
      status: 'COMPLETED', dueAt: new Date('2020-01-01T00:00:00.000Z'), outcomeSummary: 'Resolved.',
    });

    const open = await service.listCases(ctx, { dueFilter: 'OPEN' });
    assert.deepEqual(open.items.map((item: any) => item.id), [blocked.caseId]);
    const overdue = await service.listCases(ctx, { dueFilter: 'OVERDUE' });
    assert.deepEqual(overdue.items.map((item: any) => item.id), [blocked.caseId]);
    const resolvedOnly = await service.listCases(ctx, { dueFilter: 'RESOLVED' });
    assert.deepEqual(resolvedOnly.items.map((item: any) => item.id), [resolved.caseId]);
  });
});
