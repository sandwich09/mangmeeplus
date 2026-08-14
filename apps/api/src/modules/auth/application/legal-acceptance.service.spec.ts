import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  CURRENT_LEGAL_DOCUMENTS,
  LEGAL_ACCEPTANCE_STATEMENT_VERSION,
  legalAcceptanceStatements,
  type AcceptLegalDocumentsInput,
} from '@watchdog-bms/contracts';
import {
  LegalAcceptanceService,
  legalDisplayChallenge,
  legalReleaseScopeRef,
} from './legal-acceptance.service';

const ACTOR = {
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  authProvider: 'watchdog',
  sessionTokenId: 'session-1',
  requestId: 'request-1',
  userAgent: 'test-browser',
};
const INPUT: AcceptLegalDocumentsInput = {
  termsVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
  privacyVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
  statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
  termsAccepted: true,
  privacyAcknowledged: true,
  deletionAcknowledged: true,
  locale: 'th',
  displayChallenge: legalDisplayChallenge({
    userId: 'user-1',
    companyId: 'company-1',
    membershipId: 'membership-1',
    companyName: 'บริษัท ทดสอบ จำกัด',
    capacity: 'AUTHORIZED_REPRESENTATIVE',
    locale: 'th',
  }),
};

function membership(roles = ['STAFF']) {
  return {
    id: ACTOR.membershipId,
    companyId: ACTOR.companyId,
    company: { name: 'บริษัท ทดสอบ จำกัด' },
    roles: roles.map((key) => ({ role: { key } })),
  };
}

function acceptedRows(
  at = new Date('2026-08-09T12:00:00.000Z'),
  capacity: 'AUTHORIZED_REPRESENTATIVE' | 'INVITED_MEMBER' | 'SYSTEM_OPERATOR' = 'AUTHORIZED_REPRESENTATIVE',
) {
  const statements = legalAcceptanceStatements('th');
  const common = {
    batchId: 'batch-1',
    statementVersion: LEGAL_ACCEPTANCE_STATEMENT_VERSION,
    acceptedByUserId: ACTOR.userId,
    companyId: ACTOR.companyId,
    membershipId: ACTOR.membershipId,
    actorCapacity: capacity,
    locale: 'th',
    displayChallenge: legalDisplayChallenge({
      ...ACTOR,
      companyName: 'บริษัท ทดสอบ จำกัด',
      capacity,
      locale: 'th',
    }),
    acceptedAt: at,
  };
  const termsStatement = statements.terms;
  const privacyStatement = `${statements.privacy}\n${statements.deletion}`;
  return [
    {
      ...common,
      documentType: 'TERMS_OF_USE', action: 'ACCEPTED',
      documentVersion: CURRENT_LEGAL_DOCUMENTS.terms.version,
      artifactUrl: CURRENT_LEGAL_DOCUMENTS.terms.href,
      releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
      statementText: termsStatement,
      statementSha256: createHash('sha256').update(termsStatement, 'utf8').digest('hex'),
    },
    {
      ...common,
      documentType: 'PRIVACY_NOTICE', action: 'ACKNOWLEDGED',
      documentVersion: CURRENT_LEGAL_DOCUMENTS.privacy.version,
      artifactUrl: CURRENT_LEGAL_DOCUMENTS.privacy.href,
      releaseFingerprintSha256: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
      statementText: privacyStatement,
      statementSha256: createHash('sha256').update(privacyStatement, 'utf8').digest('hex'),
    },
  ];
}

describe('LegalAcceptanceService', () => {
  it('exempts SYSTEM_ADMIN without reading or fabricating acceptance evidence', async () => {
    let recordReads = 0;
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['SYSTEM_ADMIN']) },
        legalDocumentActionRecord: { findMany: async () => { recordReads += 1; return []; } },
      },
    } as any;
    const status = await new LegalAcceptanceService(prisma, { log: async () => undefined } as any).getStatus(ACTOR);
    assert.equal(status.required, false);
    assert.equal(status.acceptedAt, null);
    assert.equal(status.capacity, 'SYSTEM_OPERATOR');
    assert.equal(recordReads, 0);
  });

  it('derives company, capacity, and localized statements on the server', async () => {
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => [] },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    const status = await service.getStatus(ACTOR);

    assert.equal(status.required, true);
    assert.equal(status.companyName, 'บริษัท ทดสอบ จำกัด');
    assert.equal(status.capacity, 'AUTHORIZED_REPRESENTATIVE');
    assert.match(status.statements.th.deletion, /ขั้นตอนการขอลบบัญชีและข้อมูลส่วนบุคคล/);
    assert.match(status.statements.en.terms, /I accept/);
    assert.match(status.displayChallenges.th, /^[a-f0-9]{64}$/);
    assert.notEqual(status.displayChallenges.th, status.displayChallenges.en);
    assert.equal(status.terms.href, '/legal/releases/v3/terms-th.html');
    assert.equal(status.privacy.href, '/legal/releases/v3/privacy-th.html');
    assert.match(status.terms.artifactSha256, /^[a-f0-9]{64}$/);
    assert.match(status.privacy.artifactSha256, /^[a-f0-9]{64}$/);
  });

  it('fails closed when the two current evidence rows do not form one coherent batch', async () => {
    const rows = acceptedRows();
    rows[1] = { ...rows[1]!, batchId: 'different-batch' };
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => rows },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    const status = await service.getStatus(ACTOR);

    assert.equal(status.required, true);
    assert.equal(status.acceptedAt, null);
  });

  it('fails closed when evidence points at a mutable URL instead of the hashed release artifact', async () => {
    const rows: any[] = acceptedRows();
    rows[0] = { ...rows[0]!, artifactUrl: '/terms' };
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => rows },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    const status = await service.getStatus(ACTOR);

    assert.equal(status.required, true);
    assert.equal(status.acceptedAt, null);
  });

  it('keeps the same legal content accepted after a statement-only deployment', async () => {
    const rows: any[] = acceptedRows();
    for (const row of rows) {
      row.statementVersion = 'v1';
      row.displayChallenge = 'legacy-display-challenge';
      row.statementText = `legacy statement\n${row.statementText}`;
      row.statementSha256 = createHash('sha256').update(row.statementText, 'utf8').digest('hex');
    }
    let recordWhere: any;
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: {
          findMany: async (args: any) => { recordWhere = args.where; return rows; },
        },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    const status = await service.getStatus(ACTOR);

    assert.equal(status.required, false);
    assert.equal(status.acceptedAt, '2026-08-09T12:00:00.000Z');
    assert.equal(recordWhere.acceptedByUserId, ACTOR.userId);
    assert.equal(recordWhere.scopeRef, undefined);
    assert.equal(recordWhere.statementVersion, undefined);
  });

  it('keeps the same hashes accepted across an internal release-id and URL change', async () => {
    const rows: any[] = acceptedRows();
    for (const row of rows) {
      row.documentVersion = 'v99';
      row.artifactUrl = row.documentType === 'TERMS_OF_USE'
        ? '/legal/releases/v99/terms-th.html'
        : '/legal/releases/v99/privacy-th.html';
    }
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => rows },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    assert.equal((await service.getStatus(ACTOR)).required, false);
  });

  it('requires acceptance when either immutable document hash changes', async () => {
    const rows: any[] = acceptedRows();
    rows[0] = { ...rows[0]!, releaseFingerprintSha256: 'f'.repeat(64) };
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => rows },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    assert.equal((await service.getStatus(ACTOR)).required, true);
  });

  it('writes exactly two append-only evidence rows and two secondary audits atomically', async () => {
    const creates: any[] = [];
    const audits: any[] = [];
    const tx = {
      legalDocumentActionRecord: {
        findMany: async () => [],
        count: async () => 0,
        create: async (args: any) => {
          creates.push(args.data);
          return { id: `legal-${creates.length}`, ...args.data };
        },
      },
    };
    const prisma = {
      client: {
        userCredential: { findUnique: async () => ({ mustChangePassword: false }) },
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => [] },
        $transaction: async (callback: (client: any) => unknown) => callback(tx),
      },
    } as any;
    const audit = { log: async (entry: any, client: any) => audits.push({ entry, client }) } as any;
    const service = new LegalAcceptanceService(prisma, audit);

    const result = await service.accept(ACTOR, INPUT);

    assert.equal(creates.length, 2);
    assert.equal(audits.length, 2);
    assert.ok(audits.every((item) => item.client === tx));
    assert.equal(creates[0].batchId, creates[1].batchId);
    assert.equal(creates[0].acceptedAt, creates[1].acceptedAt);
    assert.equal(creates[0].actorCapacity, 'AUTHORIZED_REPRESENTATIVE');
    assert.equal(creates[0].surface, 'FIRST_ACCEPTANCE');
    assert.equal(creates[0].displayChallenge, INPUT.displayChallenge);
    assert.equal(creates[1].displayChallenge, INPUT.displayChallenge);
    assert.deepEqual(creates[0].rolesJson, ['OWNER']);
    // The deletion procedure has no document type of its own, so its acknowledgment must be
    // legible on the privacy notice row rather than lost between the two evidence rows.
    assert.equal(creates[0].statementText, legalAcceptanceStatements('th').terms);
    assert.match(creates[1].statementText, /ขั้นตอนการขอลบบัญชีและข้อมูลส่วนบุคคล/);
    assert.equal(
      creates[0].statementSha256,
      createHash('sha256').update(creates[0].statementText, 'utf8').digest('hex'),
    );
    assert.equal(creates[0].artifactUrl, CURRENT_LEGAL_DOCUMENTS.terms.href);
    assert.equal(creates[1].artifactUrl, CURRENT_LEGAL_DOCUMENTS.privacy.href);
    assert.equal(creates[0].releaseFingerprintSha256, CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256);
    assert.equal(creates[1].releaseFingerprintSha256, CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256);
    assert.equal(result.termsVersion, CURRENT_LEGAL_DOCUMENTS.terms.version);
  });

  it('labels a later document release as MATERIAL_UPDATE using user history', async () => {
    const creates: any[] = [];
    let countWhere: any;
    const tx = {
      legalDocumentActionRecord: {
        findMany: async () => [],
        count: async (args: any) => { countWhere = args.where; return 2; },
        create: async (args: any) => {
          creates.push(args.data);
          return { id: `legal-${creates.length}`, ...args.data };
        },
      },
    };
    const prisma = {
      client: {
        userCredential: { findUnique: async () => ({ mustChangePassword: false }) },
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => [] },
        $transaction: async (callback: (client: any) => unknown) => callback(tx),
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    await service.accept(ACTOR, INPUT);

    assert.deepEqual(countWhere, { acceptedByUserId: ACTOR.userId });
    assert.equal(creates[0].surface, 'MATERIAL_UPDATE');
    assert.equal(creates[1].surface, 'MATERIAL_UPDATE');
  });

  it('rejects a stale client release with 409 before opening a transaction', async () => {
    let transactionCalls = 0;
    const prisma = {
      client: {
        userCredential: { findUnique: async () => ({ mustChangePassword: false }) },
        $transaction: async () => { transactionCalls += 1; },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    await assert.rejects(
      () => service.accept(ACTOR, { ...INPUT, termsVersion: '2020-01-01.1' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.getStatus(), 409);
        assert.equal((error.getResponse() as any).code, 'legal_document_version_stale');
        return true;
      },
    );
    assert.equal(transactionCalls, 0);
  });

  it('rejects English acceptance until separately versioned English artifacts exist', async () => {
    const prisma = {
      client: { userCredential: { findUnique: async () => ({ mustChangePassword: false }) } },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    await assert.rejects(
      () => service.accept(ACTOR, { ...INPUT, locale: 'en' }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal((error.getResponse() as any).code, 'legal_acceptance_locale_unavailable');
        return true;
      },
    );
  });

  it('rejects a stale display challenge after reloading current membership context', async () => {
    let transactionCalls = 0;
    const prisma = {
      client: {
        userCredential: { findUnique: async () => ({ mustChangePassword: false }) },
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => [] },
        $transaction: async () => { transactionCalls += 1; },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    await assert.rejects(
      () => service.accept(ACTOR, { ...INPUT, displayChallenge: '0'.repeat(64) }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.equal(error.getStatus(), 409);
        const response = error.getResponse() as any;
        assert.equal(response.code, 'legal_acceptance_challenge_stale');
        assert.match(response.current.displayChallenges.th, /^[a-f0-9]{64}$/);
        return true;
      },
    );
    assert.equal(transactionCalls, 0);
  });

  it('requires the temporary password to be changed before acceptance', async () => {
    const prisma = {
      client: { userCredential: { findUnique: async () => ({ mustChangePassword: true }) } },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    await assert.rejects(
      () => service.accept(ACTOR, INPUT),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'password_change_required');
        return true;
      },
    );
  });

  it('returns an existing current pair idempotently without appending more evidence', async () => {
    let createCalls = 0;
    let auditCalls = 0;
    const rows: any[] = acceptedRows();
    for (const row of rows) {
      row.statementVersion = 'v1';
      row.displayChallenge = 'legacy-display-challenge';
    }
    const tx = {
      legalDocumentActionRecord: {
        findMany: async () => rows,
        count: async () => 1,
        create: async () => { createCalls += 1; },
      },
    };
    const prisma = {
      client: {
        userCredential: { findUnique: async () => ({ mustChangePassword: false }) },
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => rows },
        $transaction: async (callback: (client: any) => unknown) => callback(tx),
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => { auditCalls += 1; } } as any);

    const result = await service.accept(ACTOR, INPUT);

    assert.equal(result.acceptedAt, '2026-08-09T12:00:00.000Z');
    assert.equal(createCalls, 0);
    assert.equal(auditCalls, 0);
  });

  it('keeps current evidence after an invited member becomes an owner', async () => {
    const rows = acceptedRows(new Date('2026-08-09T12:00:00.000Z'), 'INVITED_MEMBER');
    let currentRoles = ['STAFF'];
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(currentRoles) },
        legalDocumentActionRecord: {
          findMany: async (args: any) => args.where.acceptedByUserId === ACTOR.userId ? rows : [],
        },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    assert.equal(await service.isRequired(ACTOR), false);
    currentRoles = ['OWNER'];
    assert.equal(await service.isRequired(ACTOR), false);
  });

  it('keeps current evidence when the same user enters another company', async () => {
    const rows = acceptedRows(new Date('2026-08-09T12:00:00.000Z'), 'INVITED_MEMBER');
    const otherActor = { ...ACTOR, companyId: 'company-2', membershipId: 'membership-2' };
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => ({
          id: otherActor.membershipId,
          companyId: otherActor.companyId,
          company: { name: 'บริษัทที่สอง จำกัด' },
          roles: [{ role: { key: 'MANAGER' } }],
        }) },
        legalDocumentActionRecord: {
          findMany: async (args: any) => args.where.acceptedByUserId === ACTOR.userId ? rows : [],
        },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    assert.equal(await service.isRequired(otherActor), false);
  });

  it('keys new acceptance writes only by user and immutable document hashes', () => {
    const base = legalReleaseScopeRef(ACTOR.userId);
    const release = {
      termsFingerprint: CURRENT_LEGAL_DOCUMENTS.terms.artifactSha256,
      privacyFingerprint: CURRENT_LEGAL_DOCUMENTS.privacy.artifactSha256,
    };
    assert.equal(base, legalReleaseScopeRef(ACTOR.userId, release));
    assert.notEqual(base, legalReleaseScopeRef(ACTOR.userId, {
      ...release, termsFingerprint: 'e'.repeat(64),
    }));
    assert.notEqual(base, legalReleaseScopeRef(ACTOR.userId, {
      ...release, privacyFingerprint: 'f'.repeat(64),
    }));
    assert.notEqual(base, legalReleaseScopeRef('another-user'));
  });

  it('uses the latest coherent pair when legacy retries produced more than two matching rows', async () => {
    const older: any[] = acceptedRows(new Date('2026-08-09T12:00:00.000Z'));
    const newer: any[] = acceptedRows(new Date('2026-08-15T02:00:00.000Z'));
    for (const row of newer) row.batchId = 'batch-2';
    const prisma = {
      client: {
        companyMembership: { findFirst: async () => membership(['OWNER']) },
        legalDocumentActionRecord: { findMany: async () => [...older, ...newer] },
      },
    } as any;
    const service = new LegalAcceptanceService(prisma, { log: async () => undefined } as any);

    const status = await service.getStatus(ACTOR);

    assert.equal(status.required, false);
    assert.equal(status.acceptedAt, '2026-08-15T02:00:00.000Z');
  });
});
