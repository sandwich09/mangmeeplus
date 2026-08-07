import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';

import { CompanyIdentityUseCase } from './company-identity.use-case';

const ADDRESS = {
  line1: '99/1 ถนนสุขุมวิท',
  subdistrict: 'คลองเตย',
  district: 'คลองเตย',
  province: 'กรุงเทพมหานคร',
  postalCode: '10110',
};

type Row = Record<string, any>;

function makePrisma(seed: {
  company?: Row;
  revisions?: Row[];
  branches?: Row[];
  facts?: Row[];
  promptResolved?: boolean;
  vatState?: Row | null;
}) {
  const state = {
    company: {
      id: 'co-1',
      name: 'ร้านทดสอบ',
      registeredName: 'บริษัท ทดสอบ จำกัด',
      taxId: '0105556000001',
      addressJson: ADDRESS,
      timezone: 'Asia/Bangkok',
      legalIdentityVersion: 2,
      legalIdentityCaptureCompletedAt: null,
      lastLegalChangeEffectiveDate: null,
      legalIdentityAuthoritativeAt: null,
      legalIdentityAuthoritativeReason: null,
      legalIdentityAuthoritativeRef: null,
      tinExistsStatus: 'VERIFIED',
      tinExistsAt: new Date('2026-08-01T00:00:00Z'),
      vatDetailStatus: null,
      vatDetailAt: null,
      vatDetailSelectedBranchCode: null,
      verificationLastAttemptStatus: 'VERIFIED',
      verificationLastAttemptAt: new Date('2026-08-01T00:00:00Z'),
      ...seed.company,
    } as Row,
    revisions: seed.revisions ?? [],
    branches: seed.branches ?? [
      { id: 'b-ho', name: 'สำนักงานใหญ่', type: 'HEAD_OFFICE', status: 'ACTIVE', isVatEstablishment: true, taxBranchCode: '00000', addressJson: null },
    ],
    facts: seed.facts ?? [],
    profile: null as Row | null,
  };
  const writes: string[] = [];

  const tx: any = {
    company: {
      findUnique: async () => state.company,
      update: async ({ data }: any) => {
        writes.push('company.update');
        Object.assign(state.company, data);
        return state.company;
      },
      updateMany: async ({ where, data }: any) => {
        if (where.legalIdentityCaptureCompletedAt === null && state.company.legalIdentityCaptureCompletedAt !== null) {
          return { count: 0 };
        }
        writes.push('company.updateMany');
        Object.assign(state.company, data);
        return { count: 1 };
      },
    },
    companyLegalIdentityRevision: {
      findMany: async () => state.revisions,
      create: async ({ data }: any) => {
        writes.push('revision.create');
        state.revisions.push(data);
        return { id: `rev-${state.revisions.length}` };
      },
    },
    companyTaxProfile: {
      upsert: async ({ create, update }: any) => {
        writes.push('profile.upsert');
        state.profile = { ...(state.profile ?? create), ...update };
        return state.profile;
      },
    },
    branch: { findMany: async () => state.branches },
    companyVatRegistrationFact: { findMany: async () => state.facts },
    vatRegistrationPrompt: { findFirst: async () => (seed.promptResolved ? { id: 'p-1' } : null) },
    companyVatRegistrationState: { findUnique: async () => seed.vatState ?? { companyId: 'co-1', version: 1 } },
  };

  const client: any = { ...tx, $transaction: async (fn: (t: any) => Promise<any>) => fn(tx) };
  return { prisma: { client } as any, state, writes };
}

const audit = { log: async () => undefined } as any;

function ctx(permissions: string[]) {
  return { userId: 'u-1', requestId: 'req-1', companyId: 'co-1', permissions } as any;
}

const SETUP_ONLY = ['company.setup.read'];
const FULL = ['company.setup.read', 'company.legal_identity.read', 'company.vat_registration.read', 'company.branch.read'];

describe('CompanyIdentityUseCase.get', () => {
  // Absent, not null: "you cannot see this" and "this company cannot issue" are different
  // answers, and step 5 of the wizard renders them differently.
  it('omits the sections the caller cannot read', async () => {
    const { prisma } = makePrisma({});
    const response = await new CompanyIdentityUseCase(prisma, audit).get(ctx(SETUP_ONLY), 'co-1');

    assert.equal('vatRegistration' in response, false);
    assert.equal('branches' in response, false);
    assert.equal('vat' in response.readiness, false);
    assert.equal('branches' in response.readiness, false);
  });

  it('masks the identity under company.setup.read alone', async () => {
    const { prisma } = makePrisma({});
    const response = await new CompanyIdentityUseCase(prisma, audit).get(ctx(SETUP_ONLY), 'co-1');

    assert.deepEqual(response.identity, {
      masked: true,
      displayName: 'ร้านทดสอบ',
      registeredName: 'บริษัท ทดสอบ จำกัด',
      taxIdLast4: '••••0001',
      addressProvince: 'กรุงเทพมหานคร',
    });
  });

  it('returns the full identity with the legal read permission', async () => {
    const { prisma } = makePrisma({});
    const response = await new CompanyIdentityUseCase(prisma, audit).get(ctx(FULL), 'co-1');

    assert.equal(response.identity?.masked, false);
    assert.equal((response.identity as any).taxId, '0105556000001');
    assert.equal(response.vatRegistration?.status, 'UNKNOWN');
    assert.deepEqual(response.readiness.vat, { eligible: false, status: 'UNKNOWN' });
  });

  // The control block is what the wizard uses as its CAS token and to decide which change kinds
  // to offer, so it ships to everyone who can open the screen — and carries no identity value.
  it('always ships the control block without leaking latch details', async () => {
    const { prisma } = makePrisma({ company: { legalIdentityCaptureCompletedAt: new Date(), legalIdentityAuthoritativeAt: new Date() } });
    const response = await new CompanyIdentityUseCase(prisma, audit).get(ctx(SETUP_ONLY), 'co-1');

    assert.deepEqual(response.control, {
      legalIdentityVersion: 2,
      captureWindowOpen: false,
      authoritativeLatched: true,
      fieldLatched: { registeredName: false, addressJson: false },
    });
    assert.equal('legalIdentityAuthoritativeReason' in (response.identity as any), false);
  });

  it('does not leak the VAT prompt state through a readiness reason', async () => {
    const { prisma } = makePrisma({ promptResolved: false });
    const hidden = await new CompanyIdentityUseCase(prisma, audit).get(ctx(SETUP_ONLY), 'co-1');
    assert.deepEqual(hidden.readiness.identity?.reasons, []);

    const { prisma: prisma2 } = makePrisma({ promptResolved: false });
    const shown = await new CompanyIdentityUseCase(prisma2, audit).get(ctx(FULL), 'co-1');
    assert.deepEqual(shown.readiness.identity?.reasons, ['vat_status_unanswered']);
  });

  it('derives the per-field latch from the legal-change revisions', async () => {
    const { prisma } = makePrisma({
      revisions: [
        { legalIdentityVersion: 1, changeKind: 'INITIAL_CAPTURE', snapshotJson: { registeredName: 'ก', addressJson: ADDRESS } },
        { legalIdentityVersion: 2, changeKind: 'LEGAL_CHANGE', snapshotJson: { registeredName: 'ข', addressJson: ADDRESS } },
      ],
    });
    const response = await new CompanyIdentityUseCase(prisma, audit).get(ctx(FULL), 'co-1');
    assert.deepEqual(response.control.fieldLatched, { registeredName: true, addressJson: false });
  });
});

describe('CompanyIdentityUseCase.patch', () => {
  const capture = { expectedLegalIdentityVersion: 2, changeKind: 'INITIAL_CAPTURE' as const };

  it('writes the field, bumps the version, mirrors the profile and appends a revision', async () => {
    const { prisma, state, writes } = makePrisma({});
    const result = await new CompanyIdentityUseCase(prisma, audit).patch(ctx(FULL), 'co-1', {
      ...capture,
      taxId: '0-9940-00165-67-6',
    });

    assert.equal(result.legalIdentityVersion, 3);
    assert.equal(state.company.taxId, '0994000165676');
    assert.equal(state.profile?.taxId, '0994000165676');
    assert.ok(writes.includes('revision.create'));
    assert.equal(state.revisions.at(-1)?.changeKind, 'INITIAL_CAPTURE');
  });

  it('refuses a stale version before writing anything', async () => {
    const { prisma, writes } = makePrisma({});
    await assert.rejects(
      () => new CompanyIdentityUseCase(prisma, audit).patch(ctx(FULL), 'co-1', { ...capture, expectedLegalIdentityVersion: 1, registeredName: 'x' }),
      ConflictException,
    );
    assert.deepEqual(writes, []);
  });

  // Changing the number invalidates every verification of the old one — but not the record that
  // the company's identity was once established, which is permanent.
  it('clears verification on a tax id change and never clears the authoritative latch', async () => {
    const authoritativeAt = new Date('2026-07-01T00:00:00Z');
    const { prisma, state } = makePrisma({
      company: { legalIdentityCaptureCompletedAt: null, legalIdentityAuthoritativeAt: authoritativeAt },
    });
    await new CompanyIdentityUseCase(prisma, audit).patch(ctx(FULL), 'co-1', { ...capture, taxId: '0994000165676' });

    assert.equal(state.company.tinExistsStatus, null);
    assert.equal(state.company.verificationLastAttemptStatus, null);
    assert.equal(state.company.legalIdentityAuthoritativeAt, authoritativeAt);
  });

  it('rejects a change kind the state does not allow and names the ones it does', async () => {
    const { prisma } = makePrisma({ company: { legalIdentityCaptureCompletedAt: new Date(), legalIdentityAuthoritativeAt: new Date() } });
    await assert.rejects(
      () =>
        new CompanyIdentityUseCase(prisma, audit).patch(ctx(FULL), 'co-1', {
          expectedLegalIdentityVersion: 2,
          changeKind: 'CORRECTION',
          registeredName: 'ชื่อใหม่',
          correctionReason: 'TYPO',
          note: 'พิมพ์ผิด',
        }),
      (error: any) => {
        const body = error.getResponse();
        assert.equal(body.code, 'identity_change_kind_not_allowed');
        assert.deepEqual(body.details.allowedChangeKinds, ['LEGAL_CHANGE']);
        return true;
      },
    );
  });

  it('rejects a no-op and a malformed tax id and an unknown address key', async () => {
    const { prisma } = makePrisma({});
    const useCase = new CompanyIdentityUseCase(prisma, audit);
    await assert.rejects(() => useCase.patch(ctx(FULL), 'co-1', capture), UnprocessableEntityException);
    await assert.rejects(() => useCase.patch(ctx(FULL), 'co-1', { ...capture, taxId: '123' }), UnprocessableEntityException);
    await assert.rejects(
      () => useCase.patch(ctx(FULL), 'co-1', { ...capture, addressJson: { ...ADDRESS, village: 'x' } as any }),
      UnprocessableEntityException,
    );
  });

  it('records the legal date on a legal change', async () => {
    const { prisma, state } = makePrisma({ company: { legalIdentityCaptureCompletedAt: new Date() } });
    await new CompanyIdentityUseCase(prisma, audit).patch(ctx(FULL), 'co-1', {
      expectedLegalIdentityVersion: 2,
      changeKind: 'LEGAL_CHANGE',
      registeredName: 'บริษัท ทดสอบใหม่ จำกัด',
      effectiveFrom: '2026-08-01',
    });
    assert.equal((state.company.lastLegalChangeEffectiveDate as Date).toISOString(), '2026-08-01T00:00:00.000Z');
  });
});

describe('CompanyIdentityUseCase.completeCapture', () => {
  const readyBranches = [
    { id: 'b-ho', name: 'HO', type: 'HEAD_OFFICE', status: 'ACTIVE', isVatEstablishment: true, taxBranchCode: '00000', addressJson: null },
  ];

  it('closes the window once the identity is complete', async () => {
    const { prisma, state } = makePrisma({ branches: readyBranches, promptResolved: true });
    const result = await new CompanyIdentityUseCase(prisma, audit).completeCapture(ctx(FULL), 'co-1', 2);

    assert.deepEqual(result, { legalIdentityVersion: 2, captureWindowOpen: false });
    assert.ok(state.company.legalIdentityCaptureCompletedAt instanceof Date);
  });

  // A double-click on the last step of a wizard is not a conflict.
  it('is idempotent: closing an already closed window answers 200 with the same body', async () => {
    const { prisma, writes } = makePrisma({
      company: { legalIdentityCaptureCompletedAt: new Date('2026-08-01T00:00:00Z') },
      branches: readyBranches,
      promptResolved: true,
    });
    const result = await new CompanyIdentityUseCase(prisma, audit).completeCapture(ctx(FULL), 'co-1', 999);

    assert.deepEqual(result, { legalIdentityVersion: 2, captureWindowOpen: false });
    assert.deepEqual(writes, []);
  });

  // Closing over incomplete data strands the company: INITIAL_CAPTURE is refused forever after,
  // so the missing pieces could only ever be added as legal changes.
  it('refuses to close over an incomplete identity and says what is missing', async () => {
    const { prisma } = makePrisma({ company: { taxId: null }, branches: readyBranches, promptResolved: true });
    await assert.rejects(
      () => new CompanyIdentityUseCase(prisma, audit).completeCapture(ctx(FULL), 'co-1', 2),
      (error: any) => {
        const body = error.getResponse();
        assert.equal(body.code, 'company_tax_identity_incomplete');
        assert.ok(body.details.reasons.includes('tax_id_missing'));
        return true;
      },
    );
  });
});
