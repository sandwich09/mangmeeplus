import { REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS } from '@watchdog-bms/contracts';
import { ReimbursementController } from '../../presentation/http/reimbursement.controller';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import { WORKFLOW_TEMPLATE_CATALOG, WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG } from '../../../workflow/domain/workflow-template-catalog';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import {
  CreateReimbursementDraftUseCase,
  ListReimbursementSourcesUseCase,
  CancelReimbursementUseCase,
  WithdrawReimbursementCancellationUseCase,
  ResumeReimbursementUseCase,
  GetReimbursementDetailUseCase,
  ListReimbursementsUseCase,
  ReopenRejectedReimbursementUseCase,
  UpdateReimbursementDraftUseCase,
  SubmitReimbursementUseCase,
  ReimbursementInternalNotesUseCase,
  reimbursementPeriodKey, hubSummary,
} from './reimbursement-request.use-case';
import { ExportReimbursementEvidenceUseCase, FinanceReviewReimbursementUseCase, ListFinanceQueueUseCase, RecordReimbursementPaymentUseCase } from './reimbursement-finance.use-case';
import { PrismaReimbursementRepository, hubBucketOfStatus, hubBucketWhere, hubSearchWhere } from '../../infrastructure/prisma-reimbursement.repository';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import { ReimbursementProjectionReconcilerService } from '../services/reimbursement-projection-reconciler.service';
import {
  isExpenseVoidReason, REIMBURSEMENT_DESK_LABELS, REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS, REIMBURSEMENT_SYSTEM_WAIT_LABEL, reimbursementHubBucket,
  reimbursementPayoutAnswerNotice, reimbursementPayoutCorrectionReasons, reimbursementPayoutRoundApproverNote, reimbursementPayoutRoundDid,
  reimbursementPayoutRoundGivenNote, reimbursementPayoutRoundStatus,
} from '@watchdog-bms/contracts';
import { reimbursementPayoutAnsweredForRequesterNotice } from '@watchdog-bms/contracts';
import { GetReimbursementAiSummaryUseCase, GetReimbursementApprovalBacklogUseCase } from './reimbursement-summary.use-case';
import { toRequestSummary } from '../dto/reimbursement.mapper';
import { PrismaPermissionResolverRepository } from '../../../access-control/infrastructure/prisma-permission-resolver.repository';
import { RevealClaimPayoutUseCase } from './reimbursement-payout-reveal.use-case';
import { claimSignatureAckHash, claimSnapshotFields, computeSnapshotHash } from '../../domain/logic/reimbursement.logic';
import { hasPayoutSnapshot, legacyPayoutConfirmToken, payoutAttestationError, sealPayoutDestination } from '../../domain/logic/payout-destination.logic';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { PLATFORM_ROLE_KEYS, ROLE_GRANTS } from '../../../auth/permission-registry';
import { compileRole } from '../../../employee-access/domain/logic/capability.logic';
import { roleKeyFromName } from '../../../employee-access/application/use-cases/create-role.use-case';
import { filterPermissionsByEntitlement } from '../../../employee-access/domain/logic/feature-gate.logic';
import {
  approverModeForRole,
  buildReimbursementApproverRoleOptions,
  GetReimbursementPolicyUseCase,
  ListReimbursementApproverOptionsUseCase,
  UpdateReimbursementPolicyUseCase,
  type ApproverRoleCandidate,
} from './reimbursement-policy.use-case';
import { PLATFORM_TENANT_ID } from '../../../sales-console/application/sales-context';
import { parseReimbursementPolicySnapshot } from '../../domain/reimbursement.constants';
import { MemberPayoutAccountUseCase } from './reimbursement-payout.use-case';
import { fakePayoutTables } from '../../infrastructure/reimbursement-payout.fixture';
import { ConfirmExpenseUseCase, VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import {
  applyDraftPayoutChange, deleteMemberPayoutAccount, draftPayoutAfterReopen, freezePayoutAtSubmit, readClaimPayout, readClaimPayoutSecret,
  readDraftDefaultPayout, readLegacyPayoutDefault, readMemberPayoutAccount, readMemberPayoutSecret, readSubmitPayoutPlan, writeMemberPayoutAccount,
} from '../../infrastructure/reimbursement-payout';
import { attestClaimPayout, confirmPaymentPayout, readClaimPayoutVersions } from '../../infrastructure/reimbursement-payout';
import { freezePayoutCorrection, payoutCorrectionKeptDestination, readPaymentPayoutDestinations } from '../../infrastructure/reimbursement-payout';
import { paymentTurnUserIds, payoutCorrectionFacts, payoutCorrectionRoundStart, payoutCorrectionSourceStep } from '../../domain/logic/reimbursement.logic';
import { payoutDefaultToken, payoutSubmitToken } from '../../domain/logic/payout-destination.logic';
import { ApproveReimbursementUseCase, RejectReimbursementUseCase } from './reimbursement-approval.use-case';
import { RequestPayoutCorrectionUseCase, SubmitPayoutCorrectionUseCase } from './reimbursement-payout-correction.use-case';

// Lane C: one claim, many lines. The header total, category and date are a
// server-side rollup of the lines — a client never sends them.

const noopAudit = { log: async () => undefined } as any;

describe('saved payout accounts API', () => {
  const bank = { payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '0123456789', holderType: 'SELF' as const };
  function savedWorld() {
    const tables = fakePayoutTables();
    const audits: any[] = [];
    const notices: any[] = [];
    let failAudit: boolean | string = false;
    const recordAudit = async (entry: any) => {
      if (failAudit === true || failAudit === entry.action) throw new Error('audit unavailable');
      audits.push(entry);
    };
    const audit = {
      log: recordAudit,
      logOrThrow: recordAudit,
    };
    const repo = new PrismaReimbursementRepository({ client: tables.client } as any, {} as any);
    const useCase = payoutUseCase(repo, audit, notices);
    return { tables, audits, notices, repo, useCase, failAudit: (action?: string) => { failAudit = action ?? true; } };
  }
  const refusal = (status: number, code: string) => (error: any) => error.getStatus?.() === status && error.message === code;

  it('lists only own masked accounts oldest first, with the limit, and deletes an owned row', async () => {
    const w = savedWorld();
    assert.deepEqual(await w.useCase.listSavedOwn(ctx()), { accounts: [], limit: 20 });
    const first = await w.useCase.addSavedOwn(ctx(), { ...bank, label: ' บัญชีส่วนตัว ' });
    const second = await w.useCase.addSavedOwn(ctx(), { ...bank, accountNumber: '0000001234', holderType: 'THIRD_PARTY', holderNote: ' คู่สมรสของผู้เบิก ' });
    await w.useCase.addSavedOwn(ctx({ userId: 'other' }), bank);
    const list = await w.useCase.listSavedOwn(ctx());
    assert.deepEqual(list.accounts.map((row) => row.id), [first.id, second.id]);
    assert.deepEqual([first.label, second.holderNote, first.accountLast4], ['บัญชีส่วนตัว', 'คู่สมรสของผู้เบิก', '6789']);
    assert.doesNotMatch(JSON.stringify(list), /accountNumber|fingerprint|0123456789|0000001234/);
    await w.useCase.deleteSavedOwn(ctx(), first.id);
    assert.deepEqual((await w.useCase.listSavedOwn(ctx())).accounts.map((row) => row.id), [second.id]);
  });

  it('refuses invalid account, holder type, holder note and label with stable codes', async () => {
    const w = savedWorld();
    for (const [patch, code] of [
      [{ accountNumber: '12345' }, 'payout_destination_invalid'],
      [{ holderType: 'OTHER' }, 'payout_holder_type_invalid'],
      [{ holderType: 'THIRD_PARTY' }, 'payout_holder_note_invalid'],
      [{ holderNote: 'คู่สมรส' }, 'payout_holder_note_invalid'],
      [{ holderType: 'THIRD_PARTY', holderNote: 'เลขบัญชี 0123456789' }, 'payout_holder_note_invalid'],
      [{ label: 'ก'.repeat(41) }, 'payout_saved_account_label_invalid'],
      [{ label: '081 234 5678' }, 'payout_saved_account_label_invalid'],
    ] as const) await assert.rejects(() => w.useCase.addSavedOwn(ctx(), { ...bank, ...patch } as any), refusal(400, code));
    assert.equal(w.audits.length, 0);
  });

  it('refuses the default, duplicate accounts regardless of holder, and a 21st account', async () => {
    const w = savedWorld();
    await w.useCase.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER', ...bank });
    await assert.rejects(() => w.useCase.addSavedOwn(ctx(), bank), refusal(409, 'payout_saved_account_is_default'));
    await w.useCase.deleteOwn(ctx());
    await w.useCase.addSavedOwn(ctx(), bank);
    await assert.rejects(() => w.useCase.addSavedOwn(ctx(), { ...bank, holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก' }), refusal(409, 'payout_saved_account_duplicate'));
    for (let index = 1; index < 20; index++) await w.useCase.addSavedOwn(ctx(), { ...bank, accountNumber: `000000${String(index).padStart(4, '0')}` });
    await assert.rejects(() => w.useCase.addSavedOwn(ctx(), { ...bank, accountNumber: '9999999999' }), refusal(409, 'payout_saved_account_limit'));
    assert.equal((await w.useCase.listSavedOwn(ctx())).accounts.length, 20);
  });

  it('refuses every command without own-create permission and hides another member or tenant id', async () => {
    const w = savedWorld();
    const account = await w.useCase.addSavedOwn(ctx(), bank);
    const commands = (viewer: any, id = account.id) => [
      () => w.useCase.listSavedOwn(viewer), () => w.useCase.addSavedOwn(viewer, bank),
      () => w.useCase.deleteSavedOwn(viewer, id), () => w.useCase.revealSavedOwn(viewer, id), () => w.useCase.makeSavedDefaultOwn(viewer, id),
    ];
    for (const run of commands(ctx({ permissions: ['access.employee.update'], roles: ['MANAGER'] }))) await assert.rejects(run, (error: any) => error.getStatus?.() === 403);
    for (const viewer of [ctx({ userId: 'manager', roles: ['MANAGER'], permissions: ['reimbursement.create', 'access.employee.update'] }), ctx({ companyId: 'other-company' })]) {
      assert.deepEqual((await w.useCase.listSavedOwn(viewer)).accounts, []);
      for (const id of [account.id, 'does-not-exist']) for (const run of commands(viewer, id).slice(2)) await assert.rejects(run, refusal(404, 'payout_saved_account_not_found'));
    }
  });

  it('audits reveal before opening the number, and audits mutations without number, note or label', async () => {
    const w = savedWorld();
    const saved = await w.useCase.addSavedOwn(ctx(), { ...bank, holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก', label: 'บัญชีครอบครัว' });
    assert.deepEqual(await w.useCase.revealSavedOwn(ctx(), saved.id), { accountNumber: '0123456789' });
    await w.useCase.deleteSavedOwn(ctx(), saved.id);
    assert.deepEqual(w.audits.map((row) => row.action), ['reimbursement.payout_saved_account.add', 'reimbursement.payout_saved_account.reveal', 'reimbursement.payout_saved_account.delete']);
    for (const row of w.audits) {
      assert.equal(row.actorUserId, 'staff-1');
      assert.deepEqual(row.metadataJson, { payoutKind: bank.payoutKind, bankName: bank.bankName, accountLast4: '6789', holderType: 'THIRD_PARTY' });
      assert.doesNotMatch(JSON.stringify(row), /0123456789|คู่สมรส|บัญชีครอบครัว|accountNumber|holderNote|label/);
    }
    const next = await w.useCase.addSavedOwn(ctx(), bank);
    w.tables.savedAccounts.find((row) => row.id === next.id)!.accountNumberEncrypted = 'unreadable';
    w.failAudit();
    await assert.rejects(() => w.useCase.revealSavedOwn(ctx(), next.id), /audit unavailable/);
  });

  it('swaps sealed accounts through the default write with version and both audits, without a notice', async () => {
    const w = savedWorld();
    await w.useCase.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER', ...bank });
    const old = { ...w.tables.accounts[0] };
    const saved = await w.useCase.addSavedOwn(ctx(), { ...bank, accountNumber: '0000001234', label: 'บัญชีสำรอง' });
    const secret = await w.repo.findSavedPayoutAccountForCopy('co-1', 'staff-1', saved.id);
    w.audits.length = 0;
    const response = await w.useCase.makeSavedDefaultOwn(ctx(), saved.id);
    assert.equal(response.account?.accountLast4, '1234');
    assert.equal(w.tables.accounts[0].version, 2);
    assert.equal(w.tables.accounts[0].accountNumberEncrypted, secret!.accountNumberEncrypted);
    const remaining = (await w.useCase.listSavedOwn(ctx())).accounts;
    assert.deepEqual(remaining.map((row) => [row.accountLast4, row.holderType, row.label]), [['6789', 'SELF', undefined]]);
    assert.equal((await w.repo.findSavedPayoutAccountForCopy('co-1', 'staff-1', remaining[0]!.id))!.accountNumberEncrypted, old.accountNumberEncrypted);
    assert.deepEqual(w.audits.map((row) => row.action), ['reimbursement.payout_account.set', 'reimbursement.payout_saved_account.make_default']);
    assert.equal(w.notices.length, 0);
    assert.doesNotMatch(JSON.stringify(w.audits), /0123456789|0000001234|บัญชีสำรอง|accountNumberEncrypted/);
  });

  it('rejects third-party promotion and rolls the whole swap back if its audit fails', async () => {
    const w = savedWorld();
    const third = await w.useCase.addSavedOwn(ctx(), { ...bank, holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก' });
    await assert.rejects(() => w.useCase.makeSavedDefaultOwn(ctx(), third.id), refusal(409, 'payout_default_must_be_own'));
    await w.useCase.setOwn(ctx(), { payoutMethod: 'CASH' });
    const self = await w.useCase.addSavedOwn(ctx(), { ...bank, accountNumber: '0000001234' });
    w.failAudit('reimbursement.payout_saved_account.make_default');
    await assert.rejects(() => w.useCase.makeSavedDefaultOwn(ctx(), self.id), /audit unavailable/);
    assert.equal(w.tables.accounts[0].payoutMethod, 'CASH');
    assert.equal((await w.useCase.listSavedOwn(ctx())).accounts.length, 2);
  });

  it('does not save cash or absent defaults and does not duplicate an already-saved old default', async () => {
    for (const previous of ['CASH', 'ABSENT', 'DUPLICATE'] as const) {
      const w = savedWorld();
      if (previous === 'CASH') await w.useCase.setOwn(ctx(), { payoutMethod: 'CASH' });
      if (previous === 'DUPLICATE') { await w.useCase.addSavedOwn(ctx(), bank); await w.useCase.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER', ...bank }); }
      const account = await w.useCase.addSavedOwn(ctx(), { ...bank, accountNumber: '0000001234' });
      await w.useCase.makeSavedDefaultOwn(ctx(), account.id);
      assert.equal((await w.useCase.listSavedOwn(ctx())).accounts.length, previous === 'DUPLICATE' ? 1 : 0);
    }
  });
});
const noopOutbox = { append: async () => undefined } as any;
const readyApproverRoutes = {
  resolveNamedSubmissionRoute: async () => null,
  resolveSubmissionRoute: async ({ roleKey }: any) => ({
    responsibilityRole: roleKey, effectiveTaskRole: roleKey,
    recipientUserIds: ['approver-1'], ownerRecipientUserIds: ['owner-1'], ownerFallbackUsed: false,
  }),
} as any;
const noopProjections = { execute: async () => undefined } as any;

function submitUseCase(repo: any, audit: any, outbox: any, evidence: any) {
  return new SubmitReimbursementUseCase(repo, audit, outbox, evidence, readyApproverRoutes, noopProjections);
}

describe('reimbursementPeriodKey', () => {
  it('rolls the month at Bangkok midnight rather than UTC midnight', () => {
    assert.equal(reimbursementPeriodKey(new Date('2026-07-31T16:59:59.999Z')), '2026-07');
    assert.equal(reimbursementPeriodKey(new Date('2026-07-31T17:00:00.000Z')), '2026-08');
  });
});

describe('ReimbursementInternalNotesUseCase', () => {
  it('keeps notes company-scoped and lets only the author or owner edit and delete', async () => {
    const now = new Date('2026-09-25T00:00:00.000Z');
    const notes: any[] = [];
    const auditRows: any[] = [];
    let claimStatus = 'DRAFT';
    const repo = {
      findRequestById: async (companyId: string) => companyId === 'co-1'
        ? { id: 'claim-1', companyId, branchId: 'branch-1', requesterUserId: 'staff-1', status: claimStatus } : null,
      createInternalNote: async (_companyId: string, _requestId: string, authorUserId: string, body: string) => {
        const note = { id: 'note-1', authorUserId, body, createdAt: now, updatedAt: now }; notes.push(note); return note;
      },
      findInternalNote: async (_companyId: string, _requestId: string, noteId: string) => notes.find(note => note.id === noteId) ?? null,
      updateInternalNote: async (_companyId: string, _requestId: string, noteId: string, body: string) => { notes.find(note => note.id === noteId).body = body; },
      deleteInternalNote: async (_companyId: string, _requestId: string, noteId: string) => { notes.splice(notes.findIndex(note => note.id === noteId), 1); },
      getUserDisplayNames: async () => ({ 'staff-1': 'ผู้เบิก' }),
    } as any;
    const useCase = new ReimbursementInternalNotesUseCase(repo, { log: async (entry: any) => { auditRows.push(entry); } } as any);
    const author = ctx({ scopes: { branchIds: ['branch-1'] } });
    claimStatus = 'PAID';
    const created = await useCase.create(author, 'claim-1', '  ตรวจเอกสารแล้ว  ');
    assert.equal(created.body, 'ตรวจเอกสารแล้ว');
    await assert.rejects(() => useCase.create(author, 'claim-1', '   '), /internal_note_body_invalid/);
    await assert.rejects(() => useCase.create(ctx({ companyId: 'co-2' }), 'claim-1', 'x'), /not found/i);
    await assert.rejects(() => useCase.create(ctx({ scopes: { branchIds: ['branch-2'] } }), 'claim-1', 'x'), /branch/i);
    await assert.rejects(() => useCase.update(ctx({ userId: 'other', permissions: ['reimbursement.read'] }), 'claim-1', 'note-1', 'changed'), /Cannot edit/);
    await useCase.update(ctx({ userId: 'owner', roles: ['OWNER'], permissions: ['reimbursement.read'] }), 'claim-1', 'note-1', '  checked  ');
    assert.equal(notes[0].body, 'checked');
    await assert.rejects(() => useCase.delete(ctx({ userId: 'other', permissions: ['reimbursement.read'] }), 'claim-1', 'note-1'), /Cannot delete/);
    await useCase.delete(author, 'claim-1', 'note-1');
    assert.equal(notes.length, 0);
    assert.deepEqual(auditRows.map(row => row.action), ['reimbursement.internal_note.create', 'reimbursement.internal_note.update', 'reimbursement.internal_note.delete']);
    assert.ok(auditRows.every(row => !JSON.stringify(row.metadataJson).includes('checked')));
  });
});

function ctx(overrides: Partial<any> = {}) {
  return {
    requestId: 'req-1', authSubject: 's', userId: 'staff-1', companyId: 'co-1',
    membershipId: 'm', roles: ['STAFF'],
    permissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.submit', 'reimbursement.read_own'],
    scopes: {}, authProvider: 'dev', ...overrides,
  } as any;
}

function inputLine(overrides: Partial<any> = {}): any {
  return {
    lineNo: 1, incurredDate: '2026-01-05T00:00:00.000Z', description: 'แท็กซี่ไปหาลูกค้า',
    categoryKey: 'travel', categoryLabel: 'เดินทาง', amount: '100.00', ...overrides,
  };
}

function evidenceService() {
  const attachment = { id: 'att-1', companyId: 'co-1', branchId: 'branch-1', originalFileName: 'receipt.pdf', status: 'ACTIVE', uploadedByUserId: 'staff-1' };
  return new ReimbursementEvidenceService(
    {
      findById: async ({ id }: any) => ({ ...attachment, id }),
      findManyByIds: async ({ ids }: any) => ids.map((id: string) => ({ ...attachment, id })),
      isReimbursementPaymentSlip: async () => false,
    } as any,
    { findById: async (_c: string, id: string) => ({ id, companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'staff-1' }) } as any,
  );
}

type RepoOptions = {
  policy?: Record<string, unknown> | null;
  claimedElsewhere?: { lineNo: number; attachmentId?: string; linkedExpenseId?: string; requestNo?: string }[];
  duplicateCandidates?: any[];
  status?: string;
  submitError?: Error;
  documentNumberReused?: boolean;
  supersededDuplicateCandidateCount?: number;
  supersededApprovalStepCount?: number;
  /** Expense projections a cancellation has to void before the claim may close. */
  claimProjections?: Array<{ id: string; sourceReimbursementLineId: string; status?: string }>;
  /** What the expense void would refuse right now, as the repository reads it before and during a cancellation. */
  cancellationBlocker?: () => { code: string; periodKey?: string } | null;
  /** Payout: by default the fixture claim asks for cash, so a test about something else needs no account; this leaves it with no choice. */
  noDefaultPayout?: boolean;
  /** Payout: members an employee-data editor can look up (`findPayoutMember`). */
  /** Payout: users whose OWNER / ADMIN key comes from a role the company made (a custom role named "Admin"), not from the system role. */
  companyRoleUsers?: string[];
  payoutMembers?: Record<string, { displayName: string; membershipStatus?: string; hasEmployeeProfile: boolean; allBranches: boolean; branchIds: string[]; managesPeople: boolean }>;
};

/** Captures the outbox rows a two-phase repository method writes inside its transaction. */
function fakeTx(rows: any[]) {
  return { outboxEvent: { createMany: async ({ data }: any) => { rows.push(...data); return { count: data.length }; } } };
}

function fakeRepo(options: RepoOptions = {}) {
  let request: any = null;
  // The payout tables are in memory, but every read and write below is the production function.
  const payoutTables = fakePayoutTables();
  const payoutDb = payoutTables.client;
  const projections = (options.claimProjections ?? []).map((projection) => ({ status: 'CONFIRMED', ...projection }));
  const calls = {
    claimQueries: [] as any[], duplicates: [] as any[], audits: [] as any[], outbox: [] as any[],
    approvalSteps: [] as any[], voided: [] as string[], projections: [] as any[],
  };
  const repo = {
    assertReimbursementRequester: async (_company: string, _branch: string, userId: string) => ({ userId, displayName: 'Somchai' }),
    resolveSourceLines: async (_company: string, _user: string, _branch: string, _currency: string, lines: any[]) => lines.map(line => ({ ...line, ...(line.linkedExpenseId ? { sourceExpenseSnapshot: { schemaVersion: 1, expenseId: line.linkedExpenseId } } : {}) })),
    resolveCreateBranchId: async () => 'branch-1',
    findPolicy: async () => options.policy ?? null,
    assertPaymentRecordInput: async () => undefined,
    paymentNoticeFacts: async () => ({ paymentDuplicateBlock: 'NONE', duplicateReasons: [] }),
    // The claim detail's gate, which every decision endpoint asks first: who on the waiting step can still act.
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
    getUserDisplayName: async () => 'Somchai',
    // Lane D: the detail path resolves approver/reviewer/payer names in one batch.
    getUserDisplayNames: async () => ({}),
    // Lane F: the detail path also lists uploaded scans of the signed claim form.
    listSignedClaimFormCopies: async () => [],
    // Payout Phase 0: the detail of a claim waiting for payment names who can record it.
    listPaymentRecorderNames: async () => [],
    createRequest: async (data: any, payout?: any) => {
      request = {
        id: 'rb-1', status: options.status ?? 'DRAFT', requesterUserId: data.requesterUserId,
        paymentTotalAmount: '0.0000', outstandingAmount: data.amount, duplicateStatus: 'NOT_CHECKED',
        financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', postingStatus: 'not_required',
        createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...data,
        lines: data.lines.map((line: any, index: number) => ({ ...line, id: `rbl-${index + 1}`, companyId: data.companyId, reimbursementRequestId: 'rb-1' })),
      };
      if (!options.noDefaultPayout && !payout) request.payoutMethod = 'CASH';
      if (payout) {
        Object.assign(request, await applyDraftPayoutChange(payoutDb, request, payout, true));
      }
      return request;
    },
    updateDraftRequest: async (companyId: string, id: string, expectedUpdatedAt: Date, data: any, lines?: any[], payout?: any) => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      if (payout) {
        Object.assign(request, await applyDraftPayoutChange(payoutDb, request, payout));
      }
      Object.assign(request, data, { updatedAt: new Date(request.updatedAt.getTime() + 1) });
      if (lines) request.lines = lines.map((line: any, index: number) => ({
        ...line, id: `rbl-${index + 1}`, companyId, reimbursementRequestId: id,
      }));
      return request;
    },
    findRequestById: async (companyId: string, id: string, withRelations?: boolean) => request?.companyId !== companyId || request?.id !== id
      ? null : withRelations ? { ...request, approvalSteps: [], payments: [], duplicateCandidates: [] } : request,
    updateRequest: async (_companyId: string, _id: string, data: any) => { Object.assign(request, data); return request; },
    reopenRejectedRequest: async (_companyId: string, _id: string, expectedUpdatedAt: Date, actorUserId: string, expectedStatus = 'REJECTED') => {
      assert.equal(expectedUpdatedAt, request.updatedAt);
      // Mirrors the repository: a withdraw needs the current step still undecided, and cancels it.
      const current = calls.approvalSteps.find((step) => step.id === request.currentApprovalStepId);
      if (request.status !== expectedStatus || (expectedStatus === 'PENDING_APPROVAL' && current?.status)) {
        throw new Error('reimbursement_changed');
      }
      if (expectedStatus === 'PENDING_APPROVAL') Object.assign(current ?? {}, { status: 'CANCELLED', invalidatedReason: 'withdrawn_by_requester' });
      Object.assign(request, await draftPayoutAfterReopen(payoutDb, request), {
        status: 'DRAFT', rejectedAt: null, rejectionReason: null, approvalSnapshotHash: null, approvalPolicySnapshotJson: null,
        currentApprovalStepId: null, updatedByUserId: actorUserId, updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      return request;
    },
    // Cancellation is two-phase since d1d3b23e: the intent commits first, every claim expense
    // projection is voided outside the transaction, and only a claim with no live projection may
    // close. Both fakes keep the repository's guards so the spec still proves that order.
    listClaimProjections: async () => projections,
    findCancellationCertificates: async () => [],
    // Only a record still to be voided can stand in the way, as in the repository.
    findCancellationBlocker: async () => (projections.some((projection) => projection.status !== 'VOIDED') ? options.cancellationBlocker?.() ?? null : null),
    // The fence each void runs first: no void for a cancellation that was withdrawn.
    assertCancellationPending: async () => {
      if (!request.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_intent_changed');
    },
    beginCancellationAtomic: async (data: any) => {
      assert.equal(data.expectedStatus, request.status);
      assert.equal(data.expectedUpdatedAt, request.updatedAt);
      if (request.cancellationPendingAt) {
        // The repository's rule: the reason on record stays, unless the void refuses it.
        if (request.cancellationPendingReason === data.reason) return { request, resumed: true };
        if (isExpenseVoidReason(request.cancellationPendingReason)) throw new ConflictException('reimbursement_cancellation_already_pending');
        const previous = request.cancellationPendingReason;
        Object.assign(request, { cancellationPendingReason: data.reason, updatedAt: new Date(request.updatedAt.getTime() + 1) });
        await data.onReasonCorrected?.(fakeTx(calls.outbox), previous);
        return { request, resumed: true };
      }
      if (request.paymentStatus === 'PAID' || request.paymentStatus === 'PARTIALLY_PAID') {
        throw new Error('reimbursement_cancellation_has_payment');
      }
      Object.assign(request, {
        cancellationPendingAt: data.startedAt,
        cancellationPendingByUserId: data.actorUserId,
        cancellationPendingReason: data.reason,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onIntentPersisted(fakeTx(calls.outbox));
      return { request, resumed: false };
    },
    completeCancellationAtomic: async (data: any) => {
      if (request.status === 'CANCELLED') return request;
      if (!request.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_intent_changed');
      if (projections.some((projection) => projection.status !== 'VOIDED')) {
        throw new Error('reimbursement_cancellation_projection_live');
      }
      Object.assign(request, {
        status: 'CANCELLED',
        cancelledAt: data.completedAt,
        rejectionReason: request.cancellationPendingReason,
        paymentStatus: 'NOT_PAYABLE',
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onCancelledPersisted(fakeTx(calls.outbox));
      return request;
    },
    withdrawCancellationAtomic: async (data: any) => {
      if (!request.cancellationPendingAt) throw new ConflictException('reimbursement_cancellation_not_pending');
      if (projections.some((projection) => projection.status === 'VOIDED')) throw new ConflictException('reimbursement_cancellation_partly_done');
      const withdrawn = { startedByUserId: request.cancellationPendingByUserId, startedAt: request.cancellationPendingAt, reason: request.cancellationPendingReason };
      Object.assign(request, {
        cancellationPendingAt: undefined, cancellationPendingByUserId: undefined, cancellationPendingReason: undefined,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await data.onWithdrawnPersisted(fakeTx(calls.outbox), withdrawn);
      return request;
    },
    findLinesClaimedElsewhere: async (companyId: string, excludeId: string, attachmentIds: string[], expenseIds: string[]) => {
      calls.claimQueries.push({ companyId, excludeId, attachmentIds, expenseIds });
      return options.claimedElsewhere ?? [];
    },
    findReceiptChecksums: async () => ({}),
    findDuplicateCandidates: async () => options.duplicateCandidates ?? [],
    recordBlockedSubmitDuplicates: async (data: any) => { calls.duplicates.push(...data.candidates); request.duplicateStatus = 'POSSIBLE_DUPLICATE'; await data.onPersisted(fakeTx(calls.outbox)); },
    createDuplicateCandidate: async (data: any) => { calls.duplicates.push(data); },
    createApprovalStep: async () => ({ id: 'step-1' }),
    submitDraftAtomic: async ({ expectedUpdatedAt, request: data, duplicateCandidates, approvalStep, payout, onSubmittedPersisted }: any) => {
      if (options.submitError) throw options.submitError;
      assert.equal(expectedUpdatedAt, request.updatedAt);
      // Like the repository transaction: the payout is decided, checked against what was shown and
      // frozen first, by the production function, and the claim's hash is made from its columns.
      const frozen = payout ? await freezePayoutAtSubmit(payoutDb, { ...request }, payout) : undefined;
      const snapshotHash = frozen ? payout.snapshotHash(frozen.columns) : approvalStep?.requestSnapshotHash;
      const step = approvalStep ? {
        id: `step-${calls.approvalSteps.length + 1}`, ...approvalStep, requestSnapshotHash: snapshotHash,
        assignedApproverUserIds: approvalStep.assignedApproverUserIdsJson,
      } : undefined;
      if (step) calls.approvalSteps.push(step);
      calls.duplicates.push(...duplicateCandidates);
      const documentNumber = { id: 'num-1', documentNumber: 'RB-202601-000001' };
      Object.assign(request, data, frozen && { ...frozen.columns, approvalSnapshotHash: snapshotHash }, {
        requestNo: documentNumber.documentNumber,
        currentApprovalStepId: step?.id ?? null,
        updatedAt: new Date(request.updatedAt.getTime() + 1),
      });
      await onSubmittedPersisted(fakeTx(calls.outbox), {
        step, documentNumber, documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
        payout: frozen,
      });
      return {
        step,
        documentNumber,
        documentNumberReused: options.documentNumberReused ?? false,
        supersededDuplicateCandidateCount: options.supersededDuplicateCandidateCount ?? 0,
        supersededApprovalStepCount: options.supersededApprovalStepCount ?? 0,
      };
    },
    completePolicyProjectionAtomic: async (data: any) => {
      Object.assign(request, {
        status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID',
        postingStatus: 'pending', currentApprovalStepId: null, currentApproverUserId: null,
      });
      await data.onReadyPersisted(fakeTx(calls.outbox));
      return request;
    },
    // ---- Payout: thin wrappers, like the repository's own ----
    findMemberPayoutAccount: (companyId: string, userId: string) => readMemberPayoutAccount(payoutDb, companyId, userId),
    findMemberPayoutSecret: (companyId: string, userId: string) => readMemberPayoutSecret(payoutDb, companyId, userId),
    setMemberPayoutAccount: async (data: any, onPersisted: any) => {
      const change = await writeMemberPayoutAccount(payoutDb, data);
      await onPersisted(fakeTx(calls.outbox), change);
      return change.after;
    },
    removeMemberPayoutAccount: async (companyId: string, userId: string, onPersisted: any) => {
      const before = await deleteMemberPayoutAccount(payoutDb, companyId, userId);
      if (before) await onPersisted(fakeTx(calls.outbox), before);
      return !!before;
    },
    // An OWNER or ADMIN key in the fixture is the system role, unless a case names the user as holding a company role with that key.
    holdsSystemOwnerOrAdminRole: async (_companyId: string, userId: string) => !(options.companyRoleUsers ?? []).includes(userId),
    // A member of the fixture is ACTIVE unless a case says otherwise.
    findPayoutMember: async (_companyId: string, userId: string) => (options.payoutMembers?.[userId] ? { membershipStatus: 'ACTIVE', ...options.payoutMembers[userId] } : null),
    findClaimPayout: (claim: any) => readClaimPayout(payoutDb, claim),
    findClaimPayoutHolderType: async (claim: any) => (await payoutDb.reimbursementPayoutDestination.findFirst({ where: { companyId: claim.companyId, reimbursementRequestId: claim.id, version: claim.payoutDestinationVersion }, select: { holderType: true } }))?.holderType,
    listClaimPayoutVersions: (claim: any) => readClaimPayoutVersions(payoutDb, claim),
    findDraftDefaultPayout: (claim: any) => readDraftDefaultPayout(payoutDb, claim),
    // What the detail shows whoever may pay a claim that froze no account (payout spec §15).
    findLegacyPayoutDefault: (claim: any) => readLegacyPayoutDefault(payoutDb, claim),
    findClaimPayoutSecret: (companyId: string, requestId: string, version: number) => readClaimPayoutSecret(payoutDb, companyId, requestId, version),
    planSubmitPayout: (claim: any) => readSubmitPayoutPlan(payoutDb, claim),
  } as any;
  // Voiding a projection is what makes it safe to close the claim, so the fake really flips it.
  const voidExpense = {
    executeForReimbursement: async (_ctx: any, expenseId: string) => {
      calls.voided.push(expenseId);
      const projection = projections.find((row) => row.id === expenseId);
      if (projection) projection.status = 'VOIDED';
    },
  } as any;
  return { repo, calls, voidExpense, projections, payoutTables, get request() { return request; } };
}

/** The real payout use case over the fake repository; its key never leaves this process. */
const PAYOUT_KEY = Buffer.alloc(32, 7);
function payoutUseCase(repo: any, audit: any = noopAudit, notifications: any[] = []) {
  return new MemberPayoutAccountUseCase(
    repo, audit, { credentialEncryptionKey: PAYOUT_KEY } as any,
    { executeInTransaction: async (input: any) => { notifications.push(input); } } as any,
  );
}

function useCases(state: { repo: any; calls?: { audits: any[] } }) {
  const evidence = evidenceService();
  const audit = state.calls
    ? { log: async (data: any) => { state.calls!.audits.push(data); } } as any
    : noopAudit;
  const payouts = payoutUseCase(state.repo, audit);
  return {
    payouts,
    create: new CreateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    update: new UpdateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    submit: new SubmitReimbursementUseCase(
      state.repo, audit, noopOutbox, evidence, readyApproverRoutes,
      { execute: async (...args: any[]) => { (state.calls as any)?.projections?.push(args); } } as any,
    ),
  };
}

describe('preparing reimbursement for another member', () => {
  it('requires finance authority and keeps the selected recipient separate from the preparer', async () => {
    const state = fakeRepo();
    const cases = useCases(state);
    const input = { reason: 'prepare for employee', requesterUserId: 'staff-1', lines: [inputLine({ attachmentId: 'att-1' })] };
    await assert.rejects(cases.create.execute(ctx({ userId: 'other-staff' }), input), /Cannot prepare a reimbursement for another member/);
    assert.equal(state.request, null);
    const created = await cases.create.execute(ctx({ userId: 'finance-1', permissions: ['reimbursement.create', 'reimbursement.finance_review'] }), input);
    assert.equal(created.requesterUserId, 'staff-1');
    const saved = await state.repo.findRequestById('co-1', created.id);
    assert.equal(saved.createdByUserId, 'finance-1');
  });
});

describe('every company role own reimbursement journey', () => {
  const roles = { ...ROLE_GRANTS, CUSTOM_READONLY: compileRole({ entitledFeatureKeys: null }).permissionKeys };
  // PLATFORM_ROLE_KEYS, not just SYSTEM_ADMIN: the มั่งมี sales roles are members of the platform
  // tenant and hold no business permission at all (S29), so "every company role can file its own
  // reimbursement" is not a rule about them.
  for (const [role, permissions] of Object.entries(roles).filter(([key]) => !PLATFORM_ROLE_KEYS.includes(key))) {
    it(`${role} creates, attaches evidence, updates and submits its own draft`, async () => {
      const state = fakeRepo();
      const cases = useCases(state);
      const caller = ctx({ roles: [role], permissions });
      assert.ok(permissions.includes('attachment.create'));
      assert.ok(permissions.includes('company.branch.read'));
      const created = await cases.create.execute(caller, { reason: 'เดินทาง', branchId: 'branch-1', lines: [inputLine()] } as any);
      assert.equal(created.requesterUserId, caller.userId);
      await cases.update.execute(caller, created.id, { lines: [inputLine({ attachmentId: 'att-1' })] });
      const submitted = await cases.submit.execute(caller, created.id);
      assert.equal(submitted.status, 'PENDING_APPROVAL');
      assert.equal(state.request.submittedByUserId, caller.userId);
      assert.equal(state.calls.approvalSteps[0].assignedApproverUserIds.includes(caller.userId), false);
    });
  }

  it('keeps custom self service own-only, branch scoped and feature gated at create and submit', async () => {
    const state = fakeRepo();
    const cases = useCases(state);
    const own = ctx({ roles: ['CUSTOM_READONLY'], permissions: roles.CUSTOM_READONLY, scopes: { branchIds: ['branch-1'] } });
    const created = await cases.create.execute(own, { branchId: 'branch-1', reason: 'เดินทาง', lines: [inputLine({ attachmentId: 'att-1' })] } as any);
    const other = { ...own, userId: 'other-user' };
    await assert.rejects(() => cases.update.execute(other, created.id, { reason: 'not mine' }), /Cannot update/);
    await assert.rejects(() => cases.submit.execute(other, created.id), /Only the requester/);
    await assert.rejects(() => cases.submit.execute({ ...own, companyId: 'co-2' }, created.id), /not found/);
    await assert.rejects(() => cases.submit.execute({ ...own, scopes: { branchIds: ['branch-2'] } }, created.id), /branch/i);
    const off = { ...own, permissions: filterPermissionsByEntitlement(own.permissions, new Set()) };
    await assert.rejects(() => cases.create.execute(off, { reason: 'เดินทาง', lines: [inputLine()] } as any), /Missing permission/);
    await assert.rejects(() => cases.submit.execute(off, created.id), /Missing permission/);
    assert.equal(state.request.status, 'DRAFT');
    assert.equal(state.calls.approvalSteps.length, 0);
  });
});

describe('CreateReimbursementDraftUseCase (multi-line)', () => {
  it('FIX-R1 replays a lost create answer without creating or validating the draft again', async () => {
    const state = fakeRepo();
    const create = useCases(state).create;
    const input = { reason: 'เดินทาง', lines: [inputLine()] } as any;
    const first = await create.execute(ctx(), input, 'same-create');
    assert.ok(first.id.length <= 64);
    state.repo.resolveSourceLines = async () => { throw new Error('source changed after creation'); };
    const replay = await create.execute(ctx(), input, 'same-create');
    assert.equal(replay.id, first.id);
    assert.equal(state.calls.audits.length, 1);
  });

  it('FIX-R1 create keys are scoped to the shop and actor and retain branch permission checks', async () => {
    const ids: string[] = [];
    for (const context of [ctx(), ctx({ userId: 'another' }), ctx({ companyId: 'another-company' })]) {
      const state = fakeRepo();
      ids.push((await useCases(state).create.execute(context, { reason: 'เดินทาง', lines: [inputLine()] } as any, 'same-create')).id);
    }
    assert.equal(new Set(ids).size, 3);
    const state = fakeRepo();
    const create = useCases(state).create;
    await create.execute(ctx(), { reason: 'เดินทาง', lines: [inputLine()] } as any, 'same-create');
    await assert.rejects(() => create.execute(ctx({ permissions: [] }), { reason: 'เดินทาง', lines: [inputLine()] } as any, 'same-create'), ForbiddenException);
    await assert.rejects(() => create.execute(ctx({ scopes: { branchIds: ['another-branch'] } }), { branchId: 'branch-1', reason: 'เดินทาง', lines: [inputLine()] } as any, 'same-create'), ForbiddenException);
    await assert.rejects(() => create.execute(ctx({ scopes: { branchIds: ['another-branch'] } }), { reason: 'เดินทาง', lines: [inputLine()] } as any, 'same-create'), ForbiddenException);
  });
  it('rejects future dates at create/update/submit without mutation and accepts correction at Bangkok midnight', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-31T17:00:00.000Z') });
    const state = fakeRepo();
    const cases = useCases(state);
    const future = inputLine({ incurredDate: '2027-01-02', attachmentId: 'att-1' });
    await assert.rejects(() => cases.create.execute(ctx(), { reason: 'r', lines: [future] } as any), /line_incurred_date_in_future:1/);
    assert.equal(state.request, null);
    assert.equal(state.calls.audits.length, 0);

    const today = inputLine({ incurredDate: '2027-01-01', attachmentId: 'att-1' });
    const created = await cases.create.execute(ctx(), { reason: 'r', lines: [today] } as any);
    const beforeUpdate = structuredClone(state.request);
    await assert.rejects(() => cases.update.execute(ctx(), created.id, { lines: [future] }), /line_incurred_date_in_future:1/);
    assert.deepEqual(state.request, beforeUpdate);

    // A pre-fix persisted future draft cannot bypass validation by sending an empty submit body.
    state.request!.lines[0].incurredDate = new Date('2027-01-02T00:00:00Z');
    const beforeSubmit = structuredClone(state.request);
    await assert.rejects(() => cases.submit.execute(ctx(), created.id), /line_incurred_date_in_future:1/);
    assert.deepEqual(state.request, beforeSubmit);
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.duplicates.length, 0);
    assert.equal(state.calls.outbox.length, 0);
    assert.equal(state.calls.projections.length, 0);

    await cases.update.execute(ctx(), created.id, { lines: [today] });
    const submitted = await cases.submit.execute(ctx(), created.id);
    assert.equal(submitted.status, 'PENDING_APPROVAL');
    assert.equal(state.request!.lines[0].incurredDate.toISOString(), '2027-01-01T00:00:00.000Z');
  });
  it('rolls the header up from the lines instead of trusting the client', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'ไปพบลูกค้า 2 วัน',
      lines: [
        inputLine({ lineNo: 1, amount: '100.50', incurredDate: '2026-01-05T00:00:00.000Z' }),
        inputLine({ lineNo: 2, amount: '249.50', incurredDate: '2026-01-03T00:00:00.000Z', description: 'ที่พัก', categoryKey: 'accommodation', categoryLabel: 'ที่พัก' }),
      ],
    } as any);

    assert.equal(created.amount, '350.0000');
    assert.equal(created.lineCount, 2);
    // Mixed categories: line 1's key, and a label naming the row count.
    assert.equal(created.categoryKey, 'travel');
    assert.equal(created.categoryLabelSnapshot, 'หลายหมวด (2 รายการ)');
    // Earliest line date wins for the header.
    assert.equal(created.incurredDate, '2026-01-03T00:00:00.000Z');
    assert.equal(state.request.outstandingAmount, '350.0000');
  });

  it('keeps the single-category label when every line shares a category', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'เดินทาง',
      lines: [inputLine({ lineNo: 1, amount: '10' }), inputLine({ lineNo: 2, amount: '20' })],
    } as any);
    assert.equal(created.categoryLabelSnapshot, 'เดินทาง');
    assert.equal(created.amount, '30.0000');
  });

  it('normalizes line money to satang before storing the line and header', async () => {
    const state = fakeRepo();
    const created = await useCases(state).create.execute(ctx(), {
      reason: 'ปัดเศษตามเอกสาร',
      lines: [inputLine({ amount: '10.0050' })],
    } as any);
    assert.equal(created.amount, '10.0100');
    assert.equal(state.request.lines[0].amount, '10.0100');
  });

  it('rejects a value that rounds to zero or exceeds Decimal(18,4)', async () => {
    for (const [amount, code] of [
      ['0.0049', 'line_amount_must_be_positive'],
      ['99999999999999.9999', 'amount_exceeds_limit'],
    ]) {
      const state = fakeRepo();
      await assert.rejects(
        () => useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount })] } as any),
        new RegExp(code),
      );
    }
  });

  it('rejects a claim with no lines', async () => {
    const state = fakeRepo();
    await assert.rejects(
      () => useCases(state).create.execute(ctx(), { reason: 'r', lines: [] } as any),
      /lines_required/,
    );
  });

  it('rejects a claim whose lines exceed the 50-row cap', async () => {
    const state = fakeRepo();
    const lines = Array.from({ length: 51 }, (_v, i) => inputLine({ lineNo: i + 1 }));
    await assert.rejects(
      () => useCases(state).create.execute(ctx(), { reason: 'r', lines } as any),
      /too_many_lines/,
    );
  });

  it('rejects a claim without the create permission', async () => {
    const state = fakeRepo();
    await assert.rejects(
      () => useCases(state).create.execute(ctx({ permissions: [] }), { reason: 'r', lines: [inputLine()] } as any),
      /permission/i,
    );
  });
});

describe('UpdateReimbursementDraftUseCase (multi-line)', () => {
  it('replaces the lines wholesale and recomputes the rollup', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount: '100' }), inputLine({ lineNo: 2, amount: '100' })] } as any);
    const updated = await uc.update.execute(ctx(), 'rb-1', { lines: [inputLine({ amount: '75.25' })] } as any);

    assert.equal(updated.amount, '75.2500');
    assert.equal(state.request.lines.length, 1);
    assert.equal(state.request.outstandingAmount, '75.2500');
  });

  it('rejects an update that empties the lines', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    await assert.rejects(() => uc.update.execute(ctx(), 'rb-1', { lines: [] } as any), /lines_required/);
  });

  it('leaves the lines untouched when the body omits them', async () => {
    const state = fakeRepo();
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine({ amount: '42' })] } as any);
    const updated = await uc.update.execute(ctx(), 'rb-1', { title: 'ใบเบิกเดือนมกราคม' } as any);
    assert.equal(updated.amount, '42.0000');
    assert.equal(state.request.lines.length, 1);
  });
});

describe('claim certificate cancellation (A7)', () => {
  const day = new Date('2026-09-12T00:00:00Z');
  const requester = (permissions: string[] = []) => ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own', ...permissions] });
  const permission = (kind: 'SYSTEM' | 'EXTERNAL') => kind === 'SYSTEM' ? 'wht.certificate.correct' : 'wht.external_certificate.link';
  async function world(kind?: 'SYSTEM' | 'EXTERNAL', number: string | null = 'WT-1') {
    const state = fakeRepo({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    await useCases(state).create.execute(ctx(), { reason: 'ข้อมูลผิด', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'READY_FOR_PAYMENT', branchId: 'branch-1', requestNo: 'RB-1' });
    const expense: any = Object.assign(state.projections[0], { companyId: ctx().companyId, expenseNumber: 'EXP-1', branchId: 'branch-1',
      sourceReimbursementRequestId: 'rb-1', createdByUserId: 'staff-1', expenseDate: day, createdAt: day, updatedAt: day,
      currency: 'THB', postingStatus: 'not_required', vatAmount: '0', whtAmount: '3', vendorEntityKindSnapshot: 'JURISTIC',
      grandTotalAmount: '100', netPayableAmount: '97', paidAmount: '0', outstandingAmount: '97', paymentStatus: 'UNPAID', lines: [] });
    const handoffs: any[] = [], certificates: any[] = [], periods: any[] = [], events: any[] = [], history: any[] = [], notices: any[] = [], audits: any[] = [];
    const addCertificate = () => {
      handoffs.push({ id: 'handoff-1', companyId: ctx().companyId, sourcePaymentType: 'expense.record', sourcePaymentId: 'exp-1',
        status: kind === 'EXTERNAL' ? 'EXTERNAL_LINKED' : 'SYSTEM_ISSUED', certificateId: kind === 'EXTERNAL' ? null : 'cert-1', certificateRound: 0,
        externalCertificateNumber: number, externalIssuedDate: day, externalEvidenceRef: 'file-1', linkNote: 'บันทึกเดิม', linkedAt: day, linkedByUserId: 'issuer-1' });
      if (kind !== 'EXTERNAL') certificates.push({ id: 'cert-1', companyId: ctx().companyId, status: 'ISSUED', certificateNumber: number, issuedAt: day, issuedByUserId: 'issuer-1', taxEventIdsJson: [] });
    };
    if (kind) addCertificate();
    const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: any) => {
      if (key === 'OR') return value.some((part: any) => matches(row, part));
      if (value instanceof Date) return row[key]?.getTime() === value.getTime();
      if (value && typeof value === 'object') {
        if ('in' in value) return value.in.includes(row[key]);
        if ('not' in value) return row[key] != value.not;
        if ('array_contains' in value) return value.array_contains.every((id: string) => row[key]?.includes(id));
      }
      return value == null ? row[key] == null : row[key] === value;
    });
    const table = (rows: () => any[]) => ({
      findFirst: async ({ where }: any) => { const row = rows().find(row => matches(row, where)); return row ? { ...row } : null; },
      findFirstOrThrow: async ({ where }: any) => { const row = rows().find(row => matches(row, where)); assert.ok(row); return { ...row }; },
      findUnique: async ({ where }: any) => rows().find(row => matches(row, where.companyId_periodKey ?? where)) ?? null,
      findMany: async ({ where }: any) => rows().filter(row => matches(row, where)),
      count: async ({ where }: any) => rows().filter(row => matches(row, where)).length,
      updateMany: async ({ where, data }: any) => { const found = rows().filter(row => matches(row, where)); for (const row of found) for (const [key, value] of Object.entries(data)) row[key] = (value as any)?.increment ? (row[key] ?? 0) + (value as any).increment : value; return { count: found.length }; },
      update: async ({ where, data }: any) => { const row = rows().find(row => matches(row, where)); assert.ok(row); Object.assign(row, data); return row; },
      create: async ({ data }: any) => { rows().push(data); return data; },
    });
    const client: any = {
      reimbursementRequest: table(() => [state.request]), reimbursementPayment: table(() => []), reimbursementApprovalStep: table(() => []),
      expenseRecord: table(() => [expense]), expensePayment: table(() => []), journalEntry: table(() => []),
      whtCertificateHandoff: table(() => handoffs), whtCertificate: table(() => certificates), whtCertificateHistory: table(() => history),
      taxPeriod: table(() => periods.map(p => ({ ...p, whtFilings: p.whtFilings ?? [] }))), whtFilingLine: table(() => []), taxEvent: table(() => events), accountingPeriod: table(() => []),
      expenseSubstituteReceiptEvidence: table(() => []), attachmentLink: table(() => []), reimbursementLine: table(() => []),
      auditLog: table(() => audits), documentNumber: table(() => []), outboxEvent: fakeTx(state.calls.outbox).outboxEvent,
      companyMembership: { findFirst: async ({ where }: any) => ({ user: { displayName: where.userId === 'staff-1' ? 'สมชาย' : 'คนดำเนินการต่อ' } }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
      $executeRaw: async () => 0,
      $queryRaw: async () => [{ pending: state.request.cancellationPendingAt, attested: state.request.cancellationCertificateAttestedAt }],
      $transaction: async (work: any) => work(client),
    };
    // Prisma supplies the selected relation even when it is empty. The two queries
    // distinguish frozen source lines from legacy periods with no preserved paper.
    client.taxPeriod.findMany = async ({ where, select }: any) => periods.filter(period => {
      if (where.whtFilings) return (period.whtFilings ?? []).some((paper: any) => paper.status === 'FILED' && paper.lines?.some((line: any) => line.sourceType === 'expense.record' && line.sourceId === 'exp-1'));
      return ['FILED', 'PAID', 'CLOSED'].includes(period.status) && period.periodKey === '2026-09';
    }).map(period => ({ formType: period.formType, periodKey: period.periodKey, ...(select.status && { status: period.status }),
      ...(select.whtFilings && { whtFilings: (period.whtFilings ?? []).filter((paper: any) => paper.status === 'FILED' && (paper.lines?.length || paper.rowsCertain)).map((paper: any) => ({ id: paper.id })) }) }));
    const repo = new PrismaReimbursementRepository({ client } as any, {} as any);
    for (const method of ['findCancellationCertificates', 'findCancellationBlocker', 'beginCancellationAtomic', 'completeCancellationAtomic', 'withdrawCancellationAtomic', 'assertCancellationPending', 'listClaimProjections']) {
      (state.repo as any)[method] = (...args: any[]) => (repo as any)[method](...args);
    }
    state.repo.listInternalNotes = async () => [];
    const expenseRepo = new PrismaExpenseRepository({ client } as any);
    const voids = new VoidExpenseUseCase(expenseRepo, noopAudit, noopOutbox, {} as any, {} as any, {} as any, { execute: async (notice: any) => { notices.push(notice); } } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, voids);
    const finish = () => {
      state.repo.listPendingProjectionIntents = async () => [];
      state.repo.listPendingCancellationIntents = async () => [{ request: { ...state.request }, actorUserId: state.request.cancellationPendingByUserId, reason: state.request.cancellationPendingReason }];
      return new ReimbursementProjectionReconcilerService(state.repo, {} as any, noopAudit, voids, { client } as any, {} as any).execute();
    };
    return { state, expense, handoffs, certificates, periods, events, history, notices, client, repo, voids, cancel, finish, addCertificate,
      detail: (viewer: any) => new GetReimbursementDetailUseCase(state.repo, evidenceService()).execute(viewer, 'rb-1'),
      withdraw: new WithdrawReimbursementCancellationUseCase(state.repo, noopAudit) };
  }
  for (const legacy of [false, true]) it(`cancels a certificate-free claim in a ${legacy ? 'legacy filed month' : 'filed paper'}`, async () => {
    const h = await world();
    h.periods.push({ companyId: ctx().companyId, formType: 'PND53', periodKey: '2026-09', status: 'FILED', whtFilings: legacy ? [] : [{ id: 'paper' }] });
    await h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด');
    assert.equal(h.expense.status, 'VOIDED'); assert.equal(h.state.request.status, 'CANCELLED');
  });
  const detailBlockers = [
    { code: 'tax_period_locked', periodKey: '2026-09', formType: 'PND53', certificateKind: 'SYSTEM' },
    { code: 'tax_period_locked', periodKey: '2026-09', formType: 'PND53', certificateKind: 'EXTERNAL' },
    { code: 'certificate_issued' },
    { code: 'accounting_period_locked', periodKey: '2026-09' },
    { code: 'tax_period_locked', periodKey: '2026-09', formType: 'PP30' },
    { code: 'posting_unresolved' },
    { code: 'expense_not_voidable' },
    { code: 'wht_certificate_on_expense', certificateNumber: 'WT-1' },
  ] as const;
  for (const blocker of detailBlockers) it(`detail reports the command's ${blocker.code}${'certificateKind' in blocker ? ` ${blocker.certificateKind}` : 'formType' in blocker ? ` ${blocker.formType}` : ''} refusal before intent (A7d)`, async () => {
    const h = await world('SYSTEM');
    h.state.repo.findCancellationBlocker = async () => blocker;
    const detail = await h.detail(requester()) as any;
    await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด', true), (error: any) => {
      const response = error.getResponse();
      assert.ok(response.code);
      assert.match(response.message, /[ก-๙]/u); assert.match(response.message, /กรุณา|ให้|ก่อน|แจ้ง|ใช้/u);
      assert.deepEqual(detail.certificateCancelBlocker, { code: response.code, message: response.message }); return true;
    });
    assert.equal(detail.certificateCancelAllowed, false);
    assert.equal(h.state.request.cancellationPendingAt, undefined); assert.equal(h.history.length, 0);
  });
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    for (const number of ['WT-1', null]) it(`detail reports the command's ${kind} permission sentence (${number ?? 'no number'}) (A7d)`, async () => {
      const h = await world(kind, number);
      const detail = await h.detail(requester()) as any;
      await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด', true), (error: any) => {
        const response = error.getResponse();
        assert.equal(response.code, 'reimbursement_cancellation_certificate_permission_missing');
        assert.deepEqual(detail.certificateCancelBlocker, { code: 'certificate_permission_missing', message: response.message }); return true;
      });
      assert.equal(detail.certificateCancelAllowed, false);
    });
    it(`detail omits the blocker when this viewer may cancel its ${kind} certificate (A7d)`, async () => {
      const h = await world(kind);
      const detail = await h.detail(requester([permission(kind)])) as any;
      assert.equal(detail.certificateCancelAllowed, true); assert.equal(Object.hasOwn(detail, 'certificateCancelBlocker'), false);
    });
  }
  for (const blocked of [false, true]) it(`detail omits the certificate blocker for a viewer who cannot cancel the claim (structural: ${blocked}) (A7d)`, async () => {
    const h = await world('SYSTEM');
    if (blocked) h.state.repo.findCancellationBlocker = async () => ({ code: 'posting_unresolved' });
    const detail = await h.detail(ctx({ permissions: ['reimbursement.read_own'] })) as any;
    assert.equal(detail.certificateCancelAllowed, false); assert.equal(Object.hasOwn(detail, 'certificateCancelBlocker'), false);
  });
  it('detail omits permission blockers on stored attestation, but still reports structural blockers (A7d)', async () => {
    const h = await world('SYSTEM'); h.state.request.cancellationCertificateAttestedAt = day;
    const allowed = await h.detail(requester()) as any;
    assert.equal(allowed.certificateCancelAllowed, true); assert.equal(Object.hasOwn(allowed, 'certificateCancelBlocker'), false);
    h.state.repo.findCancellationBlocker = async () => ({ code: 'posting_unresolved' });
    const blocked = await h.detail(requester()) as any;
    assert.equal(blocked.certificateCancelAllowed, false);
    await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด', true), (error: any) => {
      const response = error.getResponse();
      assert.deepEqual(blocked.certificateCancelBlocker, { code: response.code, message: response.message }); return true;
    });
  });
  it('detail omits certificate blockers for a claim with no certificates (A7d)', async () => {
    const h = await world(); h.state.repo.findCancellationBlocker = async () => ({ code: 'posting_unresolved' });
    const detail = await h.detail(requester()) as any;
    assert.deepEqual(detail.certificates, []); assert.equal(detail.certificateCancelAllowed, false);
    assert.equal(Object.hasOwn(detail, 'certificateCancelBlocker'), false);
  });
  for (const kind of ['SYSTEM', 'EXTERNAL'] as const) {
    for (const status of ['FILED', 'PAID', 'CLOSED']) it(`keeps the tax-workspace certificate refusal for ${kind} in ${status}, not the former withholding lock`, async () => {
      const h = await world(kind);
      h.periods.push({ companyId: ctx().companyId, formType: 'PND53', periodKey: '2026-09', status });
      h.events.push({ id: 'event-1', companyId: ctx().companyId, sourceType: 'expense.record', sourceId: 'exp-1', status: 'ACTIVE' });
      h.certificates.push({ id: 'tax-cert', companyId: ctx().companyId, status: 'ISSUED', taxEventIdsJson: ['event-1'] });
      await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด'), (error: any) => {
        assert.equal(error.getResponse().code, 'reimbursement_cancellation_certificate_issued'); assert.equal(error.getResponse().message, REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS.taxWorkspaceCertificate); return true;
      });
      assert.equal(h.state.request.cancellationPendingAt, undefined); assert.equal(h.history.length, 0);
    });
    for (const legacy of [false, true]) it(`cancels ${kind} on a ${legacy ? 'legacy month' : 'filed paper'} with permission and attestation, preserving filed rows`, async () => {
      const h = await world(kind);
      const paper = { id: 'filed-paper', status: 'FILED', lines: [{ sourceType: 'expense.record', sourceId: 'exp-1' }] };
      h.periods.push({ companyId: ctx().companyId, formType: 'PND53', periodKey: '2026-09', status: 'FILED', whtFilings: legacy ? [] : [paper] });
      h.client.whtFilingLine = { findMany: async () => legacy ? [] : paper.lines };
      const frozen = JSON.stringify(paper);
      const { filedWithholdingPaymentPeriods } = await import('../../../tax/application/services/filed-withholding-payment');
      assert.deepEqual(await filedWithholdingPaymentPeriods(h.client, ctx().companyId, 'expense.record', 'exp-1', { formType: 'PND53', periodKey: '2026-09' }), [{ formType: 'PND53', periodKey: '2026-09' }]);
      await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด', true), (error: any) => error.getResponse().code === 'reimbursement_cancellation_certificate_permission_missing');
      await assert.rejects(h.cancel.execute(requester([permission(kind)]), 'rb-1', 'ข้อมูลผิด'), (error: any) => {
        assert.equal(error.getResponse().message, 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนยกเลิกใบเบิก'); return true;
      });
      await h.cancel.execute(requester([permission(kind)]), 'rb-1', 'ข้อมูลผิด', true);
      assert.equal(h.expense.status, 'VOIDED'); assert.equal(h.handoffs[0].status, 'CANCELLED');
      assert.equal(h.history.length, 1); assert.equal(h.history[0].taxFilingAttested, true);
      assert.equal(JSON.stringify(paper), frozen);
    });
    for (const number of ['WT-1', null]) it(`refuses missing ${kind} permission before attestation (${number ?? 'no number'})`, async () => {
      const h = await world(kind, number);
      await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด'), (error: any) => {
        assert.equal(error.getResponse().code, 'reimbursement_cancellation_certificate_permission_missing');
        assert.equal(error.getResponse().message, `ใบเบิกนี้มีรายจ่ายที่${kind === 'SYSTEM' ? 'ออกหนังสือรับรอง 50 ทวิแล้ว' : 'บันทึกไว้ว่าออกหนังสือรับรอง 50 ทวินอกระบบแล้ว'}${number ? ` (เลขที่ ${number})` : ''} การยกเลิกใบเบิกจะยกเลิก${kind === 'SYSTEM' ? 'หนังสือรับรองด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรอง 50 ทวิ' : 'การบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ'} ให้ฝ่ายการเงินหรือผู้ที่มีสิทธิ์นั้นเป็นผู้ยกเลิกใบเบิกนี้`);
        return true;
      });
      assert.equal(h.state.request.cancellationPendingAt, undefined);
    });
    it(`requires explicit ${kind} attestation before intent`, async () => {
      for (const taxFilingAttested of [false, undefined]) {
        const h = await world(kind);
        await assert.rejects((h.cancel as any).execute(requester([permission(kind)]), 'rb-1', 'ข้อมูลผิด', taxFilingAttested), (error: any) => {
          assert.equal(error.getResponse().code, 'reimbursement_cancellation_certificate_attestation_required'); assert.equal(error.getResponse().message, 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนยกเลิกใบเบิก'); return true;
        });
        assert.equal(h.state.request.cancellationPendingAt, undefined);
      }
    });
    it(`cancels claim, expense and ${kind} with one history and issuer notice`, async () => {
      const h = await world(kind);
      const before = (await h.detail(requester())) as any;
      assert.deepEqual(before.certificates, [{ expenseNumber: 'EXP-1', kind, number: 'WT-1' }]); assert.equal(before.certificateCancelAllowed, false);
      assert.equal((await h.detail(requester([permission(kind)])) as any).certificateCancelAllowed, true);
      // The page saw WT-1; another session replaces the standing certificate before cancellation.
      if (kind === 'SYSTEM') {
        h.certificates[0].status = 'VOIDED';
        h.certificates.push({ ...h.certificates[0], id: 'cert-2', certificateNumber: 'WT-2', status: 'ISSUED' });
        h.handoffs[0].certificateId = 'cert-2';
      } else h.handoffs[0].externalCertificateNumber = 'WT-2';
      const cancelled = await (h.cancel as any).execute(requester([permission(kind)]), 'rb-1', 'ข้อมูลผิด', true);
      assert.equal(cancelled.status, 'CANCELLED');
      assert.deepEqual(cancelled.cancelledCertificates, [{ expenseId: 'exp-1', kind, number: 'WT-2' }]);
      assert.equal(h.history[0].certificateNumber, 'WT-2');
      assert.ok(h.notices[0].title.includes('WT-2'));
      assert.equal(h.expense.status, 'VOIDED'); assert.equal(h.handoffs[0].status, 'CANCELLED');
      if (kind === 'SYSTEM') assert.equal(h.certificates[0].status, 'VOIDED');
      assert.equal(h.history.length, 1); assert.equal(h.history[0].eventType, kind === 'SYSTEM' ? 'CANCELLED_SOURCE_VOIDED' : 'EXTERNAL_RECORD_REMOVED');
      assert.equal(h.history[0].reason, 'ข้อมูลผิด'); assert.equal(h.history[0].taxFilingAttested, true);
      assert.equal(h.notices.length, 1); assert.deepEqual(h.notices[0].recipientUserIds, ['issuer-1']); assert.match(h.notices[0].body, /^สมชาย /u);
      assert.equal(h.state.request.cancellationCertificateAttestedAt, null);
    });
    it(`stores ${kind} authority for a system continuation with no permissions and clears it on completion`, async () => {
      const h = await world(kind); const execute = h.voids.executeForReimbursement.bind(h.voids);
      h.voids.executeForReimbursement = async () => { throw new Error('interrupted'); };
      await assert.rejects((h.cancel as any).execute(requester([permission(kind)]), 'rb-1', 'ข้อมูลผิด', true), /interrupted/);
      assert.ok(h.state.request.cancellationCertificateAttestedAt instanceof Date);
      h.voids.executeForReimbursement = execute;
      assert.deepEqual(await h.finish(), { completed: ['rb-1'], failed: [], blocked: [] });
      assert.equal(h.state.request.status, 'CANCELLED'); assert.equal(h.state.request.cancellationCertificateAttestedAt, null);
      assert.equal(h.history.length, 1); assert.equal(h.history[0].actorUserId, 'staff-1'); assert.equal(h.notices.length, 1); assert.match(h.notices[0].body, /^สมชาย /u);
    });
  }
  for (const own of [undefined, 'SYSTEM'] as const) for (const via of ['certificate', 'handoff'] as const) {
  it(`refuses tax-workspace ${via} before permission or attestation, with own certificate ${own ?? 'absent'}`, async () => {
    const h = await world(own);
    h.events.push({ id: 'event-1', companyId: ctx().companyId, sourceType: 'expense.record', sourceId: 'exp-1', status: 'ACTIVE' });
    if (via === 'certificate') h.certificates.push({ id: 'tax-cert', companyId: ctx().companyId, status: 'ISSUED', taxEventIdsJson: ['event-1'] });
    else h.handoffs.push({ id: 'tax-handoff', companyId: ctx().companyId, sourcePaymentType: 'other', sourcePaymentId: 'other', status: 'EXTERNAL_LINKED', taxEventIdsJson: ['event-1'] });
    await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด'), (error: any) => {
      assert.equal(error.getResponse().code, 'reimbursement_cancellation_certificate_issued');
      assert.equal(error.getResponse().message, 'ใบเบิกนี้มีรายจ่ายที่มีหนังสือรับรอง 50 ทวิที่ออกจากหน้าภาษี จึงยกเลิกใบเบิกจากหน้านี้ไม่ได้ แจ้งทีมงานมั่งมีเพื่อช่วยตรวจสอบ'); return true;
    });
    assert.equal(h.state.request.cancellationPendingAt, undefined);
  });
  }
  it('checks stored certificate authority inside the expense transaction fence', async () => {
    const h = await world('SYSTEM');
    h.state.request.cancellationPendingAt = new Date();
    await assert.rejects(h.repo.assertCancellationPending(h.client, ctx().companyId, 'rb-1', true), /reimbursement_cancellation_intent_changed/);
    h.state.request.cancellationCertificateAttestedAt = new Date();
    await h.repo.assertCancellationPending(h.client, ctx().companyId, 'rb-1', true);
    h.state.request.cancellationPendingAt = null;
    await assert.rejects(h.repo.assertCancellationPending(h.client, ctx().companyId, 'rb-1', true), /reimbursement_cancellation_intent_changed/);
  });
  it('clears stored certificate authority when an unstarted void is withdrawn', async () => {
    const h = await world('SYSTEM'); h.voids.executeForReimbursement = async () => { throw new Error('interrupted'); };
    await assert.rejects((h.cancel as any).execute(requester([permission('SYSTEM')]), 'rb-1', 'ข้อมูลผิด', true), /interrupted/);
    assert.ok(h.state.request.cancellationCertificateAttestedAt);
    await h.withdraw.execute(requester(), 'rb-1');
    assert.equal(h.state.request.cancellationCertificateAttestedAt, null); assert.equal(h.state.request.cancellationPendingAt, null);
    assert.equal(h.expense.status, 'CONFIRMED'); assert.equal(h.history.length, 0);
  });
  it('lets another canceller continue on stored authority without certificate permissions and names the starter', async () => {
    const h = await world('SYSTEM'); const execute = h.voids.executeForReimbursement.bind(h.voids);
    h.voids.executeForReimbursement = async () => { throw new Error('interrupted'); };
    await assert.rejects(h.cancel.execute(requester([permission('SYSTEM')]), 'rb-1', 'ข้อมูลผิด', true), /interrupted/);
    h.voids.executeForReimbursement = execute;
    const other = ctx({ userId: 'finance-2', permissions: ['reimbursement.read', 'reimbursement.finance_review'] });
    assert.equal((await h.detail(other) as any).certificateCancelAllowed, true);
    assert.equal((await h.cancel.execute(other, 'rb-1')).status, 'CANCELLED');
    assert.equal(h.history[0].actorUserId, 'finance-2'); assert.equal(h.notices.length, 1); assert.match(h.notices[0].body, /^สมชาย /u);
  });
  it('leaves a late certificate unfinished and requires a person to authorise it before system continuation', async () => {
    const h = await world(); const begin = h.state.repo.beginCancellationAtomic;
    h.state.repo.beginCancellationAtomic = async (input: any) => { const result = await begin(input); h.addCertificate(); return result; };
    await assert.rejects(h.cancel.execute(requester(), 'rb-1', 'ข้อมูลผิด'));
    assert.ok(h.state.request.cancellationPendingAt); assert.equal(h.state.request.cancellationCertificateAttestedAt, null);
    assert.equal((await h.detail(requester()) as any).pendingCancellation.blocker.code, 'certificate_attestation_required');
    assert.deepEqual(await h.finish(), { completed: [], failed: [], blocked: ['rb-1'] });
    assert.equal(h.history.length, 0);
    h.state.repo.beginCancellationAtomic = begin;
    assert.equal((await (h.cancel as any).execute(requester([permission('SYSTEM')]), 'rb-1', undefined, true)).status, 'CANCELLED');
    assert.equal(h.history.length, 1); assert.equal(h.notices.length, 1);
  });
});

describe('CancelReimbursementUseCase', () => {
  it('deletes only a never-sent draft for its requester or a preparer, with its transactional audit', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const tx = {};
    const audits: any[] = [];
    let deleted = 0;
    (state.repo as any).deleteNeverSentDraftAtomic = async (data: any) => { await data.onDeleted(tx); deleted++; };
    const cancel = new CancelReimbursementUseCase(state.repo, { log: async (entry: any, transaction: any) => { assert.equal(transaction, tx); audits.push(entry); } } as any, state.voidExpense);
    await cancel.deleteDraft(ctx({ permissions: ['reimbursement.read_own'] }), 'rb-1');
    await cancel.deleteDraft(ctx({ userId: 'finance', permissions: ['reimbursement.read', 'reimbursement.finance_review'] }), 'rb-1');
    assert.equal(deleted, 2);
    assert.deepEqual(audits.map(row => row.action), ['reimbursement.request.delete_draft', 'reimbursement.request.delete_draft']);
    await assert.rejects(cancel.deleteDraft(ctx({ userId: 'other', permissions: ['reimbursement.read', 'reimbursement.create'] }), 'rb-1'), ForbiddenException);
    for (const patch of [{ requestNo: 'RB-1' }, { submittedAt: new Date() }, { approvalSteps: [{ id: 'old-step' }] }, { status: 'PENDING_APPROVAL' }]) {
      const original = { ...state.request };
      if ('approvalSteps' in patch) state.repo.findRequestById = async () => state.request;
      Object.assign(state.request, patch);
      await assert.rejects(cancel.deleteDraft(ctx(), 'rb-1'), /reimbursement_draft_changed/);
      Object.keys(patch).forEach(key => { state.request[key] = original[key]; });
    }
    assert.equal(deleted, 2);
  });

  it('recognises expense_changed_retry as a claim cancellation race and keeps its intent pending', async () => {
    const state = fakeRepo({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const voidExpense = { executeForReimbursement: async () => { throw new ConflictException({ code: 'expense_changed_retry', message: 'กรุณาลองใหม่' }); } } as any;
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, voidExpense);
    await assert.rejects(cancel.execute(ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว'),
      (error: any) => error instanceof ConflictException && error.message === 'reimbursement_cancellation_in_progress');
    assert.notEqual(state.request.status, 'CANCELLED');
    assert.ok(state.request.cancellationPendingAt);
    assert.deepEqual(state.calls.voided, []);
  });
  it('passes the observed status and version to the atomic cancellation transition', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว');
    assert.equal(result.status, 'CANCELLED');
    assert.equal(state.request.rejectionReason, 'ไม่ใช้แล้ว');
    assert.equal(state.request.paymentStatus, 'NOT_PAYABLE');
    // Both phases are durable: intent first, cancellation only after the projections are gone.
    assert.deepEqual(state.calls.outbox.map((row: any) => row.eventType), [
      'reimbursement.cancellation_started', 'reimbursement.cancelled',
    ]);
  });

  it('voids every claim expense projection before the claim closes', async () => {
    const state = fakeRepo({ claimProjections: [
      { id: 'exp-1', sourceReimbursementLineId: 'rbl-1' },
      { id: 'exp-2', sourceReimbursementLineId: 'rbl-2' },
    ] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว');
    assert.equal(result.status, 'CANCELLED');
    assert.deepEqual(state.calls.voided, ['exp-1', 'exp-2']);
  });

  it('allows an authorized finance reviewer to cancel a non-owned request', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
    const result = await cancel.execute(ctx({ userId: 'finance-1', permissions: ['reimbursement.read', 'reimbursement.finance_review'] }), 'rb-1', 'ยกเลิกหลังกลับรายการจ่าย');
    assert.equal(result.status, 'CANCELLED');
    assert.equal(state.request.rejectionReason, 'ยกเลิกหลังกลับรายการจ่าย');
  });

  it('refuses to close the claim when a projection survives the void', async () => {
    const state = fakeRepo({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    // A void that silently no-ops must not let an expense outlive its cancelled claim.
    const brokenVoid = { executeForReimbursement: async () => undefined } as any;
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, brokenVoid);
    await assert.rejects(
      () => cancel.execute(ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] }), 'rb-1', 'ไม่ใช้แล้ว'),
      /reimbursement_cancellation_projection_live/,
    );
    assert.notEqual(state.request.status, 'CANCELLED');
    assert.ok(state.request.cancellationPendingAt, 'the intent stays pending so a retry can finish it');
  });

  // Audit B3. Before: a reason of one or two characters was taken, the intent was committed, and the
  // first expense void then refused the reason. Nothing could finish or replace that cancellation.
  it('refuses a reason the expense void would refuse, before any intent is written', async () => {
    const state = fakeRepo({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    // The real void: its reason rule is the one a cancellation has to satisfy. Nothing else of it is reached.
    const realVoid = new VoidExpenseUseCase({} as any, noopAudit, noopOutbox, {} as any, {} as any, {} as any);
    const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, realVoid);
    const requester = ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] });

    for (const reason of ['ก', 'ab', '  x  ']) {
      await assert.rejects(() => cancel.execute(requester, 'rb-1', reason), (error: any) => {
        assert.equal(error.getStatus?.(), 400, reason);
        assert.match(error.message, /cancellation_reason_too_short/);
        return true;
      });
    }
    assert.equal(state.request.cancellationPendingAt, undefined, 'no intent was written');
    assert.equal(state.request.status, 'DRAFT');
    assert.deepEqual(state.calls.outbox, []);

    // The shortest reason the void takes cancels the claim, and no reason at all still takes the default one.
    assert.equal((await new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense).execute(requester, 'rb-1', 'abc')).status, 'CANCELLED');
    const blank = fakeRepo();
    await useCases(blank).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    assert.equal((await new CancelReimbursementUseCase(blank.repo, noopAudit, realVoid).execute(requester, 'rb-1', '   ')).status, 'CANCELLED');
    assert.equal(blank.request.rejectionReason, 'ยกเลิกคำขอเบิกค่าใช้จ่าย');
  });
});

// Owner rule 2026-10-01 (payout spec §25.1 I2), for the two stuck states of audit B3 and B4: what LINE says a
// claim waits for and the desk the web prints for it come from the same rows, and name the same party.
describe('a claim the system holds reads the same on LINE and on the web', () => {
  const NOW = new Date('2026-10-01T03:00:00.000Z');
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, companyId: 'co-1', branchId: 'b1', requestNo: `RB-${id}`, requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย',
    reason: 'แท็กซี่', categoryKey: 'travel', amount: '100.0000', outstandingAmount: '100.0000', paymentTotalAmount: '0.0000', currency: 'THB',
    incurredDate: NOW, status: 'PENDING_APPROVAL', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required', submittedAt: new Date('2026-09-29T03:00:00.000Z'),
    createdAt: new Date('2026-09-29T02:00:00.000Z'), updatedAt: NOW, ...overrides,
  }) as any;
  const pendingStep = (requestId: string) => ({ id: `step-${requestId}`, companyId: 'co-1', reimbursementRequestId: requestId, sequenceNo: 1,
    status: 'PENDING', assignedApproverUserIds: ['mgr-1'], approverRoleSnapshot: 'MANAGER' }) as any;
  const cancelling = { cancellationPendingAt: NOW, cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ซื้อซ้ำกับใบก่อน' };

  it('says รอระบบปรับสถานะ on LINE exactly where the web desk is the system, and counts neither as waiting for approval', async () => {
    const rows = [
      row('waiting'),                                                          // an ordinary claim waiting for สมศรี
      row('decided'),                                                          // approved, the system has not moved it on (B4)
      row('cancel-at-approval', cancelling),                                   // being cancelled while it waited for สมศรี (B3)
      row('cancel-at-payment', { ...cancelling, status: 'READY_FOR_PAYMENT', approvedAt: NOW }),
      row('cancel-at-finance', { ...cancelling, status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING', approvedAt: NOW }),
      row('paying', { status: 'READY_FOR_PAYMENT', approvedAt: NOW }),         // an ordinary claim waiting for payment
      row('no-approval-needed', { status: 'APPROVED', approvedAt: NOW }),      // nobody had to approve it; the system has not moved it on (B4)
    ];
    const steps = [pendingStep('waiting'), pendingStep('cancel-at-approval')];
    const repo = {
      findPolicy: async () => null,
      listRequests: async () => rows,
      findPendingApprovalSteps: async (_companyId: string, ids: string[]) => steps.filter((step) => ids.includes(step.reimbursementRequestId)),
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      getUserDisplayNames: async () => ({ 'mgr-1': 'สมศรี' }),
    } as any;

    const backlog = await new GetReimbursementApprovalBacklogUseCase(repo, noopAudit).execute(ctx({ permissions: ['reimbursement.read'] }), {}, NOW);
    const lineSays: Record<string, string> = Object.fromEntries(backlog.items.map((item) => [item.id, item.waitingOn]));
    // The web's row for the same claim, as the hub list builds it: the claim with its pending steps.
    const webDesk: Record<string, { kind: string; names?: string[] } | undefined> = Object.fromEntries(rows.map((claim) => [claim.id,
      toRequestSummary({ ...claim, approvalSteps: steps.filter((step) => step.reimbursementRequestId === claim.id) }, { approverNames: { 'mgr-1': 'สมศรี' } }).currentDesk]));

    for (const claim of rows) {
      assert.equal(lineSays[claim.id] === REIMBURSEMENT_SYSTEM_WAIT_LABEL, webDesk[claim.id]?.kind === 'SYSTEM', claim.id);
    }
    assert.deepEqual(lineSays, {
      waiting: 'สมศรี', decided: REIMBURSEMENT_SYSTEM_WAIT_LABEL, 'cancel-at-approval': REIMBURSEMENT_SYSTEM_WAIT_LABEL,
      'cancel-at-payment': REIMBURSEMENT_SYSTEM_WAIT_LABEL, 'cancel-at-finance': REIMBURSEMENT_SYSTEM_WAIT_LABEL, paying: REIMBURSEMENT_DESK_LABELS.PAYMENT,
      // Whoever may record the payment is who carries it on (ดำเนินการต่อ), so both name the payment desk.
      'no-approval-needed': REIMBURSEMENT_DESK_LABELS.PAYMENT,
    });
    assert.deepEqual(webDesk, {
      waiting: { kind: 'APPROVER', names: ['สมศรี'] }, decided: { kind: 'SYSTEM' }, 'cancel-at-approval': { kind: 'SYSTEM' },
      'cancel-at-payment': { kind: 'SYSTEM' }, 'cancel-at-finance': { kind: 'SYSTEM' }, paying: { kind: 'PAYMENT' },
      'no-approval-needed': { kind: 'PAYMENT' },
    });
    // LINE's wording for the group is unchanged, and a claim the system holds is not "waiting for approval".
    assert.equal(REIMBURSEMENT_SYSTEM_WAIT_LABEL, 'รอระบบปรับสถานะ');
    assert.deepEqual(backlog.desks.find((desk) => desk.kind === 'status_pending'), {
      kind: 'status_pending', label: 'รอระบบปรับสถานะ', count: 4, totalsByCurrency: [{ currency: 'THB', amount: '400.00' }],
      oldestSubmittedOn: '2026-09-29', longestWaitDays: 2,
    });
    assert.deepEqual([backlog.total, backlog.awaitingApprovalCount, backlog.byApprover.map((group) => [group.name, group.count])], [7, 1, [['สมศรี', 1]]]);
    // The new desk moves no claim between the hub's buckets: a row on it sits where its status puts it, which is
    // where the cards counted it (the cards count by status).
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID'] as const) {
      for (const financeReviewStatus of ['NOT_REQUIRED', 'PENDING', 'APPROVED_FOR_PAYMENT']) {
        assert.equal(reimbursementHubBucket({ status, financeReviewStatus, currentDesk: { kind: 'SYSTEM' } }), hubBucketOfStatus(status, financeReviewStatus),
          `${status}/${financeReviewStatus}`);
      }
    }
  });
});

// Payout spec §14.7, §17.3: a claim sent back to have its payout account corrected is PENDING_APPROVAL
// with no step open. Read by its steps alone that is "decided, waiting for the system"; it is with its
// requester, and LINE and the web say so in the same words.
describe('a claim whose payout account is being corrected reads the same on LINE and on the web', () => {
  const NOW = new Date('2026-10-01T03:00:00.000Z'); // 10:00 on 1 October in Bangkok
  const row = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, companyId: 'co-1', branchId: 'b1', requestNo: `RB-${id}`, requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย',
    reason: 'แท็กซี่', categoryKey: 'travel', amount: '100.0000', outstandingAmount: '100.0000', paymentTotalAmount: '0.0000', currency: 'THB',
    incurredDate: NOW, status: 'PENDING_APPROVAL', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'posted', submittedAt: new Date('2026-09-20T03:00:00.000Z'),
    createdAt: new Date('2026-09-20T02:00:00.000Z'), updatedAt: NOW, ...overrides,
  }) as any;
  const pendingStep = (requestId: string) => ({ id: `step-${requestId}`, companyId: 'co-1', reimbursementRequestId: requestId, sequenceNo: 1,
    status: 'PENDING', assignedApproverUserIds: ['mgr-1'], approverRoleSnapshot: 'MANAGER' }) as any;
  // What a claim holds: an account of its own (the method and the fingerprint its submit froze), cash, or neither.
  const ACCOUNT_HELD = { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: 'f'.repeat(64) };
  const CASH_HELD = { payoutMethod: 'CASH', payoutFingerprint: 'cash' };
  const sentBack = {
    payoutCorrectionRequestedAt: new Date('2026-09-30T03:00:00.000Z'), payoutCorrectionRequestedByUserId: 'payer-1', payoutCorrectionReasonCode: 'ACCOUNT_NUMBER_WRONG', ...ACCOUNT_HELD,
  };
  const rows = [
    row('sent-back', sentBack),                                                                   // phase A: with its requester
    row('new-account', { ...sentBack, payoutCorrectionSubmittedAt: new Date('2026-10-01T02:00:00.000Z') }), // phase B: waiting for สมศรี again
    row('waiting', { submittedAt: new Date('2026-09-29T03:00:00.000Z') }),                        // an ordinary claim waiting for สมศรี
    row('sent-back-cancelling', { ...sentBack, cancellationPendingAt: NOW, cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ซื้อซ้ำกับใบก่อน' }),
  ];
  const steps = [pendingStep('new-account'), pendingStep('waiting')];
  const repo = {
    listRequests: async () => rows,
    findPolicy: async () => ({ ...NO_APPROVAL_POLICY, slaHours: 48 }),
    findPendingApprovalSteps: async (_companyId: string, ids: string[]) => steps.filter((step) => ids.includes(step.reimbursementRequestId)),
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
    getUserDisplayNames: async () => ({ 'mgr-1': 'สมศรี' }),
  } as any;
  const reader = ctx({ permissions: ['reimbursement.read'] });



  it('says รอผู้เบิกแก้บัญชีรับเงิน on LINE where the web desk is the requester, and counts the claim for no approver', async () => {
    const backlog = await new GetReimbursementApprovalBacklogUseCase(repo, noopAudit).execute(reader, {}, NOW);
    const webDesk = Object.fromEntries(rows.map((claim) => [claim.id,
      toRequestSummary({ ...claim, approvalSteps: steps.filter((step) => step.reimbursementRequestId === claim.id) }, { approverNames: { 'mgr-1': 'สมศรี' } }).currentDesk]));
    assert.deepEqual(webDesk, {
      'sent-back': { kind: 'REQUESTER' }, 'new-account': { kind: 'APPROVER', names: ['สมศรี'] }, waiting: { kind: 'APPROVER', names: ['สมศรี'] },
      'sent-back-cancelling': { kind: 'SYSTEM' },
    });
    // Every claim, with the day its wait counts from: the send-back, the new account, or the day it was sent.
    const byId = Object.fromEntries(backlog.items.map((item) => [item.id, item]));
    assert.deepEqual(byId['sent-back'], {
      id: 'sent-back', documentNumber: 'RB-sent-back', requesterName: 'สมชาย', amount: '100.00', currency: 'THB',
      waitingOn: 'รอผู้เบิกแก้บัญชีรับเงิน', submittedOn: '2026-09-20', sentBackOn: '2026-09-30', waitDays: 1,
    });
    assert.deepEqual(byId['new-account'], {
      id: 'new-account', documentNumber: 'RB-new-account', requesterName: 'สมชาย', amount: '100.00', currency: 'THB',
      waitingOn: 'สมศรี', submittedOn: '2026-09-20', resubmittedOn: '2026-10-01', waitDays: 0,
    });
    assert.deepEqual([byId['waiting']!.waitingOn, byId['waiting']!.waitDays, byId['sent-back-cancelling']!.waitingOn], ['สมศรี', 2, REIMBURSEMENT_SYSTEM_WAIT_LABEL]);

    // Its own desk, in the words of the claim page's badge, with what happens next. Not "waiting for the system".
    assert.deepEqual(backlog.desks, [
      { kind: 'status_pending', label: 'รอระบบปรับสถานะ', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }], oldestSubmittedOn: '2026-09-20', longestWaitDays: 11 },
      {
        kind: 'requester_correction', label: 'รอผู้เบิกแก้บัญชีรับเงิน', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }],
        oldestSentBackOn: '2026-09-30', longestWaitDays: 1,
        note: 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
      },
    ]);
    // สมศรี has two claims to approve; the corrected account has waited for her since this morning, not for eleven days.
    assert.deepEqual(backlog.byApprover, [{ name: 'สมศรี', count: 2, totalsByCurrency: [{ currency: 'THB', amount: '200.00' }], oldestSubmittedOn: '2026-09-29', longestWaitDays: 2 }]);
    assert.deepEqual([backlog.total, backlog.awaitingApprovalCount], [4, 2]);
    // Nothing of an account, and no code word, in what the assistant is handed.
    assert.doesNotMatch(JSON.stringify(backlog), /ACCOUNT_NUMBER_WRONG|payer-1|AWAITING_|accountLast4|bankName|fingerprint/);
  });

  // Payout spec §17.3. The desk of a claim that waits for its requester is named for what THAT claim holds. One row
  // used to say "รอผู้เบิกแก้บัญชีรับเงิน" of every such claim: of one with no account to correct, and of one that asked for cash.
  it('lists claims that wait for their requester under one row per label: an account to correct, one to add, the method to choose again', async () => {
    const on = (day: string, reasonCode: string) => ({
      payoutCorrectionRequestedAt: new Date(`2026-09-${day}T03:00:00.000Z`), payoutCorrectionRequestedByUserId: 'payer-1', payoutCorrectionReasonCode: reasonCode,
    });
    const waiting = [
      row('c-1', { ...on('29', 'CASH_NOT_PAYABLE'), ...CASH_HELD, outstandingAmount: '250.0000' }),
      row('n-1', { ...on('27', 'NO_ACCOUNT_ON_CLAIM'), outstandingAmount: '40.0000' }),
      row('a-1', { ...on('30', 'ACCOUNT_NUMBER_WRONG'), ...ACCOUNT_HELD }),
      // Sent before claims carried a destination: the method its draft once chose is no account of its own.
      row('n-2', { ...on('25', 'NO_ACCOUNT_ON_CLAIM'), payoutMethod: 'BANK_TRANSFER', outstandingAmount: '60.0000' }),
      // Answered with cash: it waits for สมศรี, and is in none of these rows.
      row('answered', { ...on('28', 'CASH_NOT_PAYABLE'), ...CASH_HELD, payoutCorrectionSubmittedAt: new Date('2026-10-01T02:00:00.000Z') }),
    ];
    const backlog = await new GetReimbursementApprovalBacklogUseCase(
      { ...repo, listRequests: async () => waiting, findPendingApprovalSteps: async () => [pendingStep('answered')] }, noopAudit,
    ).execute(reader, {}, NOW);

    // Each row is whole in itself: a label true of every claim it counts, its own figures and its own sentence.
    assert.deepEqual(backlog.desks, [
      {
        kind: 'requester_correction', label: 'รอผู้เบิกแก้บัญชีรับเงิน', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }],
        oldestSentBackOn: '2026-09-30', longestWaitDays: 1,
        note: 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
      },
      {
        kind: 'requester_correction', label: 'รอผู้เบิกเพิ่มบัญชีรับเงิน', count: 2, totalsByCurrency: [{ currency: 'THB', amount: '100.00' }],
        oldestSentBackOn: '2026-09-25', longestWaitDays: 6,
        note: 'ใบเบิกถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ผู้เบิกเพิ่มได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
      },
      {
        kind: 'requester_correction', label: 'รอผู้เบิกเลือกวิธีรับเงินคืน', count: 1, totalsByCurrency: [{ currency: 'THB', amount: '250.00' }],
        oldestSentBackOn: '2026-09-29', longestWaitDays: 2,
        note: 'ใบเบิกถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ผู้เบิกเลือกได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
      },
    ]);
    // Each claim waits on the label of its own row; the one that was answered waits for its approver.
    assert.deepEqual(backlog.items.map((item) => [item.id, item.waitingOn, item.sentBackOn ?? item.resubmittedOn, item.waitDays]), [
      ['n-2', 'รอผู้เบิกเพิ่มบัญชีรับเงิน', '2026-09-25', 6], ['n-1', 'รอผู้เบิกเพิ่มบัญชีรับเงิน', '2026-09-27', 4],
      ['c-1', 'รอผู้เบิกเลือกวิธีรับเงินคืน', '2026-09-29', 2], ['a-1', 'รอผู้เบิกแก้บัญชีรับเงิน', '2026-09-30', 1],
      ['answered', 'สมศรี', '2026-10-01', 0],
    ]);
    // The rows add up to the claims that are with their requester, and none of those is counted for an approver.
    assert.deepEqual([backlog.total, backlog.awaitingApprovalCount, backlog.desks.reduce((sum, desk) => sum + desk.count, 0), backlog.byApprover.map((group) => [group.name, group.count])],
      [5, 1, 4, [['สมศรี', 1]]]);
    // Where each claim stands, and nothing of an account, a reason or who sent it back.
    assert.doesNotMatch(JSON.stringify(backlog), /payout|account|ffff|CASH|NO_ACCOUNT|payer-1|AWAITING_|fingerprint/i);
  });

  it('counts it as waiting for approval in the assistant summary only once the account is given, and as late only by that wait', async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    // Each was first sent two weeks ago and sent back eighty hours ago; the company's deadline is 48 hours.
    const round = (id: string, overrides: Record<string, unknown> = {}) => row(id, { submittedAt: hoursAgo(14 * 24), payoutCorrectionRequestedAt: hoursAgo(80), ...overrides });
    const withRequester = round('with-requester');
    const givenToday = round('given-today', { payoutCorrectionSubmittedAt: hoursAgo(3) });
    const givenThreeDaysAgo = round('given-three-days-ago', { payoutCorrectionSubmittedAt: hoursAgo(72) });
    const summary = async (claims: any[]) => {
      const answer = await new GetReimbursementAiSummaryUseCase({ ...repo, listRequests: async () => claims }, noopAudit).execute(reader);
      return [answer.pendingApprovalCount, answer.overdueApprovalCount];
    };
    assert.deepEqual(await summary([withRequester]), [0, 0], 'with its requester: no approver waits, none is late');
    assert.deepEqual(await summary([givenToday]), [1, 0], 'the approver has had it for three hours, not two weeks');
    assert.deepEqual(await summary([givenThreeDaysAgo]), [1, 1]);
    assert.deepEqual(await summary([withRequester, givenToday, givenThreeDaysAgo]), [2, 1]);
    // An ordinary claim is counted from the day it was sent, as before.
    assert.deepEqual(await summary([row('ordinary', { submittedAt: hoursAgo(14 * 24) })]), [1, 1]);
  });
});

// A list or queue row carried nothing about a pending cancellation, so the hub offered what the API
// refuses on such a claim: "บันทึกจ่าย" and "อนุมัติจ่าย" in the finance queue, "ส่งอนุมัติ" on a draft row.
describe('a list or queue row says when its claim is being cancelled', () => {
  const NOW = new Date('2026-10-01T03:00:00.000Z');
  const row = (status: string, overrides: Record<string, unknown> = {}) => ({
    id: `rb-${status}`, companyId: 'co-1', branchId: 'b1', requestNo: `RB-${status}`, requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'สมชาย',
    reason: 'แท็กซี่', categoryKey: 'travel', amount: '100.0000', outstandingAmount: '100.0000', paymentTotalAmount: '0.0000', currency: 'THB',
    incurredDate: NOW, status, financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH',
    receiptRequirementStatus: 'ATTACHED', postingStatus: 'not_required', createdAt: NOW, updatedAt: NOW, ...overrides,
  }) as any;
  const cancelling = { cancellationPendingAt: NOW, cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ซื้อซ้ำกับใบก่อน' };

  it('carries cancellationPending on every row of a claim on its way to being cancelled, and on no other', () => {
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT']) {
      assert.equal(toRequestSummary(row(status, cancelling)).cancellationPending, true, status);
      assert.equal('cancellationPending' in toRequestSummary(row(status)), false, `${status}, not being cancelled`);
    }
    // A cancelled claim keeps the intent it was cancelled with; it is not pending any more.
    for (const status of ['CANCELLED', 'VOIDED']) assert.equal('cancellationPending' in toRequestSummary(row(status, cancelling)), false, status);
  });

  it('keeps such a claim in the finance queue, where whoever may finish or withdraw the cancellation works, and marks it', async () => {
    const rows = [row('READY_FOR_PAYMENT', { id: 'paying' }), row('READY_FOR_PAYMENT', { id: 'cancel-at-payment', ...cancelling }),
      row('FINANCE_REVIEW', { id: 'cancel-at-finance', financeReviewStatus: 'PENDING', ...cancelling })];
    const queue = await new ListFinanceQueueUseCase({ listRequests: async () => rows, findPolicy: async () => null } as any)
      .execute(ctx({ userId: 'fin-1', permissions: ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.payment.record'] }));

    assert.deepEqual(queue.map((item) => [item.id, item.cancellationPending ?? false, item.currentDesk?.kind]), [
      ['paying', false, 'PAYMENT'], ['cancel-at-payment', true, 'SYSTEM'], ['cancel-at-finance', true, 'SYSTEM'],
    ]);
  });

  // Tool dry-run 2026-10-02: with one claim being cancelled the backlog said 6 waiting for approval and the
  // summary said 7. Approval and payment are refused meanwhile, so such a claim waits for no approver and no payer.
  it('counts a claim being cancelled in none of the assistant summary\'s four figures, where the backlog puts it on the system\'s desk', async () => {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    const claims = [
      row('PENDING_APPROVAL', { id: 'waiting', submittedAt: hoursAgo(72) }),
      row('PENDING_APPROVAL', { id: 'cancel-at-approval', submittedAt: hoursAgo(72), ...cancelling }),
      row('READY_FOR_PAYMENT', { id: 'paying', outstandingAmount: '250.0000' }),
      row('READY_FOR_PAYMENT', { id: 'cancel-at-payment', ...cancelling }),
      row('FINANCE_REVIEW', { id: 'cancel-at-finance', financeReviewStatus: 'PENDING', ...cancelling }),
    ];
    const step = { id: 'step-1', companyId: 'co-1', reimbursementRequestId: 'waiting', sequenceNo: 1, status: 'PENDING', assignedApproverUserIds: ['mgr-1'], approverRoleSnapshot: 'MANAGER' };
    const repo = {
      listRequests: async (where: { statuses?: string[] }) => claims.filter((claim) => !where.statuses || where.statuses.includes(claim.status)),
      findPolicy: async () => ({ ...NO_APPROVAL_POLICY, slaHours: 48 }),
      findPendingApprovalSteps: async (_companyId: string, ids: string[]) => [step, { ...step, id: 'step-2', reimbursementRequestId: 'cancel-at-approval' }]
        .filter((entry) => ids.includes(entry.reimbursementRequestId)),
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      getUserDisplayNames: async () => ({ 'mgr-1': 'สมศรี' }),
    } as any;
    const reader = ctx({ permissions: ['reimbursement.read'] });


    const summary = await new GetReimbursementAiSummaryUseCase(repo, noopAudit).execute(reader);
    // One claim waits for its approver (and is late), one for its payment: the three being cancelled are in no figure.
    assert.deepEqual([summary.pendingApprovalCount, summary.overdueApprovalCount, summary.unpaidApprovedCount, summary.totalUnpaidAmount], [1, 1, 1, '250.0000']);
    const backlog = await new GetReimbursementApprovalBacklogUseCase(repo, noopAudit).execute(reader);
    assert.equal(backlog.awaitingApprovalCount, summary.pendingApprovalCount, 'the two tools count the same claims as waiting for approval');
    assert.deepEqual(backlog.desks.find((desk) => desk.kind === 'status_pending')?.count, 3);
  });
});

// Audit B3, the rest of it: whatever stops a cancellation after its intent is committed, the claim
// must say so and stay finishable. Invariant: no claim is left with a cancellation that cannot complete.
describe('a cancellation that was started stays visible and can always be finished (audit B3)', () => {
  const PERIOD = '2026-09';
  const startedAt = new Date('2026-10-01T02:00:00.000Z');
  const requester = () => ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] });
  const finance = () => ctx({ userId: 'fin-1', roles: ['FINANCE'], permissions: ['reimbursement.read', 'reimbursement.finance_review'] });
  const bystander = () => ctx({ userId: 'reader-1', permissions: ['reimbursement.read'] });

  /**
   * A claim waiting for payment with two confirmed expense records, and the two things of the expense
   * module a cancellation meets: what the void would refuse (asked up front) and the void itself. Both
   * read the same `world`, as the repository's preflight and the real void read the same rows.
   */
  async function claimWorld() {
    const world = { periodLocked: false, lockAfterVoids: Infinity };
    const state = fakeRepo({
      claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }, { id: 'exp-2', sourceReimbursementLineId: 'rbl-2' }],
      cancellationBlocker: () => (world.periodLocked ? { code: 'accounting_period_locked', periodKey: PERIOD } : null),
    });
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'READY_FOR_PAYMENT', requestNo: 'RB-202610-000001', branchId: 'branch-1', paymentStatus: 'UNPAID' });
    Object.assign(state.repo, {
      listInternalNotes: async () => [],
      getUserDisplayNames: async () => ({ 'staff-1': 'สมชาย', 'fin-1': 'วราภรณ์' }),
    });
    const audits: any[] = [];
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    // The real void's rules for what these cases are about: the reason, the fence, a closed period.
    const voidExpense = {
      executeForReimbursement: async (_ctx: any, expenseId: string, reason: string, authority: any) => {
        if (!isExpenseVoidReason(reason)) throw new BadRequestException('Void reason must be at least 3 characters');
        await authority.beforeVoid?.({});
        const projection = state.projections.find((row) => row.id === expenseId)!;
        if (projection.status === 'VOIDED') return;
        if (world.periodLocked) throw new ConflictException({ code: 'accounting_period_locked', message: `Accounting period ${PERIOD} is not open; reopen it before voiding.` });
        projection.status = 'VOIDED';
        state.calls.voided.push(expenseId);
        if (state.calls.voided.length >= world.lockAfterVoids) world.periodLocked = true;
      },
    } as any;
    return {
      world, state, audits,
      cancel: new CancelReimbursementUseCase(state.repo, audit, voidExpense),
      withdraw: new WithdrawReimbursementCancellationUseCase(state.repo, audit),
      detail: (viewer: any) => new GetReimbursementDetailUseCase(state.repo, evidenceService()).execute(viewer, 'rb-1'),
      /** A cancellation as production left it: the intent committed, nothing after it. */
      strand: (reason: string) => Object.assign(state.request, {
        cancellationPendingAt: startedAt, cancellationPendingByUserId: 'staff-1', cancellationPendingReason: reason,
      }),
      events: () => state.calls.outbox.map((row: any) => row.eventType),
    };
  }

  it('lets the requester cancel a not-approved claim directly with the existing reason and right', async () => {
    const claim = await claimWorld();
    Object.assign(claim.state.request, { status: 'REJECTED' });
    assert.equal((await claim.detail(requester())).viewerCanCancel, true);
    await assert.rejects(() => claim.cancel.execute(bystander(), 'rb-1', 'ไม่ต้องเบิกแล้ว'), ForbiddenException);
    await assert.rejects(() => claim.cancel.execute(requester(), 'rb-1', 'ก'), /cancellation_reason_too_short/);
    const done = await claim.cancel.execute(requester(), 'rb-1', 'ไม่ต้องเบิกแล้ว');
    assert.equal(done.status, 'CANCELLED');
    assert.equal(claim.audits.filter(entry => entry.action === 'reimbursement.request.cancel').length, 1);
  });

  it('a claim stranded by a short reason says who started it and why, and anyone who may cancel finishes it with a corrected reason', async () => {
    const claim = await claimWorld();
    claim.strand('ก');

    // Before: no response carried the pending cancellation at all.
    assert.deepEqual((await claim.detail(requester())).pendingCancellation, {
      startedAt: startedAt.toISOString(), startedByUserId: 'staff-1', startedByName: 'สมชาย', reason: 'ก',
      blocker: { code: 'reason_too_short' }, canResume: true, canWithdraw: true,
    });
    // Finance may cancel any claim, so it may finish this one; a reader may do neither.
    assert.deepEqual([(await claim.detail(finance())).pendingCancellation?.canResume, (await claim.detail(finance())).pendingCancellation?.canWithdraw], [true, true]);
    assert.deepEqual([(await claim.detail(bystander())).pendingCancellation?.canResume, (await claim.detail(bystander())).pendingCancellation?.canWithdraw], [false, false]);

    // The stored reason is what blocks it: the same reason, another short one and no reason are refused, and nothing is voided.
    for (const again of ['ก', 'ab', undefined]) {
      await assert.rejects(() => claim.cancel.execute(requester(), 'rb-1', again), /cancellation_reason_too_short/, String(again));
    }
    assert.deepEqual([claim.state.calls.voided, claim.state.request.status, claim.state.request.cancellationPendingReason], [[], 'READY_FOR_PAYMENT', 'ก']);

    // Before: a different reason was refused (already pending), and so was anyone but the person who started it.
    const done = await claim.cancel.execute(finance(), 'rb-1', 'ซื้อซ้ำกับใบก่อน');
    assert.equal(done.status, 'CANCELLED');
    assert.deepEqual(claim.state.calls.voided, ['exp-1', 'exp-2']);
    assert.equal(claim.state.request.rejectionReason, 'ซื้อซ้ำกับใบก่อน');
    assert.deepEqual(claim.audits.map((entry) => entry.action), [
      'reimbursement.request.cancellation_reason_corrected', 'reimbursement.request.cancellation_retry', 'reimbursement.request.cancel',
    ]);
    assert.deepEqual(claim.audits[0].metadataJson, { previousReason: 'ก', reason: 'ซื้อซ้ำกับใบก่อน', startedByUserId: 'staff-1' });
    assert.deepEqual([claim.audits[2].actorUserId, claim.audits[2].metadataJson.startedByUserId], ['fin-1', 'staff-1']);
    assert.equal((await claim.detail(requester())).pendingCancellation, undefined, 'a cancelled claim has nothing pending');
  });

  it('refuses to start a cancellation when an expense record sits in a closed period, before anything is written', async () => {
    const claim = await claimWorld();
    claim.world.periodLocked = true;

    // Before: the intent was committed first, the void then refused, and the claim sat half cancelled with no word of it.
    await assert.rejects(() => claim.cancel.execute(requester(), 'rb-1', 'ซื้อซ้ำกับใบก่อน'), (error: any) => {
      assert.equal(error.getStatus?.(), 409);
      assert.equal(error.getResponse().code, `reimbursement_cancellation_accounting_period_locked:${PERIOD}`);
      assert.match(error.getResponse().message, /ยกเลิกใบเบิก/);
      return true;
    });
    assert.equal(claim.state.request.cancellationPendingAt, undefined, 'no intent');
    assert.deepEqual([claim.state.calls.voided, claim.events(), claim.audits], [[], [], []]);
    assert.equal((await claim.detail(requester())).pendingCancellation, undefined);

    // Once the period is reopened, the same request cancels the claim.
    claim.world.periodLocked = false;
    assert.equal((await claim.cancel.execute(requester(), 'rb-1', 'ซื้อซ้ำกับใบก่อน')).status, 'CANCELLED');
    assert.deepEqual(claim.events(), ['reimbursement.cancellation_started', 'reimbursement.cancelled']);
  });

  it('a period closed after the cancellation started is shown with what stands in the way, and the cancellation finishes once it is reopened', async () => {
    const claim = await claimWorld();
    // What a check before the intent cannot know: the period is closed between the first void and the second.
    claim.world.lockAfterVoids = 1;
    await assert.rejects(() => claim.cancel.execute(requester(), 'rb-1', 'ซื้อซ้ำกับใบก่อน'), /Accounting period 2026-09 is not open/);
    assert.deepEqual(claim.state.projections.map((row) => row.status), ['VOIDED', 'CONFIRMED']);

    // Visible, with the reason it has not completed. One record is voided, so it can only go forward.
    const shown = (await claim.detail(finance())).pendingCancellation!;
    assert.deepEqual([shown.blocker, shown.reason, shown.startedByName, shown.canResume, shown.canWithdraw],
      [{ code: 'accounting_period_locked', periodKey: PERIOD }, 'ซื้อซ้ำกับใบก่อน', 'สมชาย', true, false]);
    await assert.rejects(() => claim.withdraw.execute(requester(), 'rb-1'), /reimbursement_cancellation_partly_done/);
    // Continuing while it is still closed is refused up front: the second record is not touched again.
    await assert.rejects(() => claim.cancel.execute(finance(), 'rb-1'), (error: any) => error.getResponse().code === `reimbursement_cancellation_accounting_period_locked:${PERIOD}`);
    assert.deepEqual(claim.state.calls.voided, ['exp-1']);

    // Reopened: anyone who may cancel continues it, with no reason to give, and it completes under the reason it was started with.
    claim.world.periodLocked = false;
    assert.equal((await claim.detail(finance())).pendingCancellation?.blocker, undefined);
    assert.equal((await claim.cancel.execute(finance(), 'rb-1')).status, 'CANCELLED');
    assert.deepEqual(claim.state.calls.voided, ['exp-1', 'exp-2']);
    assert.equal(claim.state.request.rejectionReason, 'ซื้อซ้ำกับใบก่อน');
    // A reason of its own is not taken for a cancellation whose reason is on record and valid.
    assert.deepEqual(claim.events(), ['reimbursement.cancellation_started', 'reimbursement.cancelled']);
  });

  it('keeps the reason a cancellation was started with: a retry that names another one is refused', async () => {
    const claim = await claimWorld();
    claim.strand('ซื้อซ้ำกับใบก่อน');
    await assert.rejects(() => claim.cancel.execute(finance(), 'rb-1', 'เหตุผลอื่น'), (error: any) => error.getStatus?.() === 409 && /reimbursement_cancellation_already_pending/.test(error.message));
    assert.deepEqual([claim.state.calls.voided, claim.state.request.cancellationPendingReason], [[], 'ซื้อซ้ำกับใบก่อน']);
    // The same reason, or none, continues it.
    assert.equal((await claim.cancel.execute(finance(), 'rb-1', 'ซื้อซ้ำกับใบก่อน')).status, 'CANCELLED');
  });

  it('lets whoever may cancel the claim withdraw the cancellation while nothing was voided, and the claim goes on as before', async () => {
    const claim = await claimWorld();
    claim.strand('ก');

    // Not for a reader, and not for a finance reviewer of another branch.
    await assert.rejects(() => claim.withdraw.execute(bystander(), 'rb-1'), ForbiddenException);
    const otherBranch = ctx({ userId: 'fin-2', permissions: ['reimbursement.finance_review'], scopes: { branchIds: ['branch-2'] } });
    await assert.rejects(() => claim.withdraw.execute(otherBranch, 'rb-1'), /branch/i);
    assert.deepEqual([(await claim.detail(otherBranch).catch(() => null))?.pendingCancellation?.canWithdraw, claim.state.request.cancellationPendingReason], [undefined, 'ก']);
    const back = await claim.withdraw.execute(finance(), 'rb-1');

    assert.equal(back.status, 'READY_FOR_PAYMENT');
    assert.deepEqual([claim.state.request.cancellationPendingAt, claim.state.request.cancellationPendingByUserId, claim.state.request.cancellationPendingReason],
      [undefined, undefined, undefined]);
    assert.deepEqual(claim.state.projections.map((row) => row.status), ['CONFIRMED', 'CONFIRMED'], 'nothing was voided');
    assert.equal((await claim.detail(requester())).pendingCancellation, undefined);
    assert.deepEqual(claim.audits.map((entry) => [entry.action, entry.actorUserId, entry.metadataJson.startedByUserId, entry.metadataJson.reason]),
      [['reimbursement.request.cancellation_withdrawn', 'fin-1', 'staff-1', 'ก']]);
    // Nothing is pending any more, so there is nothing to withdraw; the claim can be cancelled afresh.
    await assert.rejects(() => claim.withdraw.execute(finance(), 'rb-1'), /reimbursement_cancellation_not_pending/);
    assert.equal((await claim.cancel.execute(requester(), 'rb-1', 'เปลี่ยนใจ')).status, 'CANCELLED');
  });

  // Payout spec §25.1 I3, both directions: the two buttons the detail offers a viewer are exactly the two calls
  // the API takes from that viewer. Checked viewer by viewer against the endpoints themselves.
  it('offers ดำเนินการยกเลิกต่อ and ถอนการยกเลิก to exactly the viewers the cancel and withdraw calls accept', async () => {
    const viewers: Array<[string, any]> = [
      ['the requester', requester()],
      ['the requester without the cancel right', ctx({ permissions: ['reimbursement.read_own'] })],
      ['a finance reviewer', finance()],
      ['a finance reviewer of another branch', ctx({ userId: 'fin-2', permissions: ['reimbursement.read', 'reimbursement.finance_review'], scopes: { branchIds: ['branch-2'] } })],
      ['a reader', bystander()],
      ['an approver who may also pay', ctx({ userId: 'boss-1', roles: ['MANAGER'], permissions: ['reimbursement.read', 'reimbursement.approve', 'reimbursement.payment.record'] })],
    ];
    const refusedForWho = (error: unknown) => error instanceof ForbiddenException;
    for (const [name, viewer] of viewers) {
      // Asked of the detail first; a viewer who cannot read the claim is offered nothing.
      const reading = await claimWorld();
      reading.strand('ซื้อซ้ำกับใบก่อน');
      const offered = await reading.detail(viewer).then((detail) => detail.pendingCancellation, () => undefined);
      // Then each call, on a claim of its own, as that viewer.
      const continuing = await claimWorld();
      continuing.strand('ซื้อซ้ำกับใบก่อน');
      const continued = await continuing.cancel.execute(viewer, 'rb-1').then(() => true, (error) => { if (refusedForWho(error)) return false; throw error; });
      const withdrawing = await claimWorld();
      withdrawing.strand('ซื้อซ้ำกับใบก่อน');
      const withdrawn = await withdrawing.withdraw.execute(viewer, 'rb-1').then(() => true, (error) => { if (refusedForWho(error)) return false; throw error; });

      assert.deepEqual([offered?.canResume ?? false, offered?.canWithdraw ?? false], [continued, withdrawn], name);
    }
  });

  it('never voids for a cancellation that was withdrawn while it was being continued', async () => {
    const claim = await claimWorld();
    claim.strand('ซื้อซ้ำกับใบก่อน');
    // The withdrawal lands between the continue reading the claim and its first void.
    const begin = claim.state.repo.beginCancellationAtomic;
    claim.state.repo.beginCancellationAtomic = async (data: any) => {
      const intent = await begin(data);
      await claim.withdraw.execute(finance(), 'rb-1');
      return intent;
    };

    await assert.rejects(() => claim.cancel.execute(requester(), 'rb-1'), /reimbursement_cancellation_intent_changed/);

    assert.deepEqual(claim.state.calls.voided, [], 'the fence stopped the void');
    assert.deepEqual([claim.state.request.status, claim.state.request.cancellationPendingAt], ['READY_FOR_PAYMENT', undefined]);
  });

  it('cancels once when ดำเนินการยกเลิกต่อ is pressed twice at the same moment', async () => {
    const claim = await claimWorld();
    claim.strand('ซื้อซ้ำกับใบก่อน');

    const results = await Promise.all([claim.cancel.execute(requester(), 'rb-1'), claim.cancel.execute(finance(), 'rb-1')]);

    assert.deepEqual(results.map((result) => result.status), ['CANCELLED', 'CANCELLED']);
    assert.deepEqual(claim.state.calls.voided, ['exp-1', 'exp-2'], 'each expense record voided once');
    assert.deepEqual(claim.events(), ['reimbursement.cancelled'], 'one cancelled event');
    assert.equal(claim.audits.filter((entry) => entry.action === 'reimbursement.request.cancel').length, 1);
  });
});

// Audit B4: a decision that is on record and has not been carried out must be visible, and whoever
// the page offers "ดำเนินการต่อ" to must be taken by the call. Carrying the claim on is the
// reconciler's work (its own spec, and real PostgreSQL in the repository race spec); these cases are
// about what the detail says and about who.
describe('a decided claim that has not moved on is visible and can be carried on (audit B4)', () => {
  const decidedAt = new Date('2026-10-01T02:00:00.000Z');
  const NO_APPROVAL_POLICY = {
    schemaVersion: 1, policyId: 'pol-1', policyVersion: 'v1', approvalRequiredFromAmount: '1000.00', requiresApproval: false, route: null,
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false, duplicatePolicy: 'BLOCK_PAYMENT', financeReviewRequired: false,
  };
  const requester = () => ctx({ permissions: ['reimbursement.read_own', 'reimbursement.cancel_own'] });
  const approver = (overrides: Partial<any> = {}) => ctx({ userId: 'mgr-1', roles: ['MANAGER'], permissions: ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'], ...overrides });
  const payer = (overrides: Partial<any> = {}) => ctx({ userId: 'pay-1', roles: ['FINANCE'], permissions: ['reimbursement.read', 'reimbursement.payment.record'], ...overrides });

  type Kind = 'approved' | 'no-approval-needed' | 'waiting-for-approver';

  /** One claim over the fake repository; `repair` stands in for the reconciler carrying it on. */
  async function claimWorld(kind: Kind, options: { repair?: () => Promise<boolean>; frozenOnStep?: string[] } = {}) {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const step = {
      id: 'step-1', companyId: 'co-1', reimbursementRequestId: 'rb-1', sequenceNo: 1, approverRoleSnapshot: 'MANAGER', assignedAt: decidedAt,
      ...(options.frozenOnStep && { assignedApproverUserIds: options.frozenOnStep }),
      ...(kind === 'approved' ? { status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt } : { status: 'PENDING' }),
    };
    Object.assign(state.request, { requestNo: 'RB-202610-000001', branchId: 'branch-1', submittedAt: decidedAt, submittedByUserId: 'staff-1' },
      kind === 'no-approval-needed'
        ? { status: 'APPROVED', approvedAt: decidedAt, currentApprovalStepId: null, approvalPolicySnapshotJson: NO_APPROVAL_POLICY }
        : { status: 'PENDING_APPROVAL', currentApprovalStepId: 'step-1' });
    const world = { expenseRecordsConfirmed: false, repairs: 0 };
    Object.assign(state.repo, {
      findRequestById: async () => ({ ...state.request, approvalSteps: kind === 'no-approval-needed' ? [] : [step], payments: [], duplicateCandidates: [] }),
      findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
      // Whoever decided the claim's step had a part in it: the claim is theirs to read with the related-read right.
      isUserRelatedToRequest: async (_companyId: string, _requestId: string, userId: string) => 'decisionByUserId' in step && step.decisionByUserId === userId,
      areClaimProjectionsReady: async () => world.expenseRecordsConfirmed,
      listInternalNotes: async () => [],
      getUserDisplayNames: async () => ({ 'staff-1': 'สมชาย', 'mgr-1': 'สมศรี' }),
    });
    const audits: any[] = [];
    const audit = { log: async (entry: any) => { audits.push(entry); } } as any;
    const reconciler = { repair: async () => {
      world.repairs += 1;
      if (options.repair) return options.repair();
      if (state.request.status === 'READY_FOR_PAYMENT') return false;
      Object.assign(state.request, { status: 'READY_FOR_PAYMENT', currentApprovalStepId: null, paymentStatus: 'UNPAID' });
      return true;
    } } as any;
    return {
      state, world, audits,
      resume: new ResumeReimbursementUseCase(state.repo, audit, reconciler, evidenceService()),
      detail: (viewer: any) => new GetReimbursementDetailUseCase(state.repo, evidenceService()).execute(viewer, 'rb-1'),
    };
  }

  it('says on the detail that the claim waits for the system, and offers no decision a second time', async () => {
    const approved = await claimWorld('approved');
    const seenByApprover = await approved.detail(approver());
    assert.deepEqual(seenByApprover.awaitingSystem, { kind: 'APPROVAL', canResume: true });
    assert.deepEqual(seenByApprover.currentDesk, { kind: 'SYSTEM' });
    assert.deepEqual(seenByApprover.approvalActions, { canApprove: false, canReject: false }, 'the decision is made; nobody is asked for it again');
    assert.deepEqual((await approved.detail(requester())).awaitingSystem, { kind: 'APPROVAL', canResume: false });

    // Nobody had to approve it: it waits for the system only while it cannot be paid, and it waits at the payment desk.
    const noApproval = await claimWorld('no-approval-needed');
    const seenByPayer = await noApproval.detail(payer());
    assert.deepEqual(seenByPayer.awaitingSystem, { kind: 'NO_APPROVAL_NEEDED', canResume: true });
    assert.equal(seenByPayer.currentDesk?.kind, 'PAYMENT');
    noApproval.world.expenseRecordsConfirmed = true;
    assert.equal((await noApproval.detail(payer())).awaitingSystem, undefined, 'payable: the page offers the payment itself');

    assert.equal((await (await claimWorld('waiting-for-approver')).detail(approver())).awaitingSystem, undefined);
  });

  // The server's own flags (the page no longer has to hide what the detail offers).
  it('offers no approval on the detail of a claim being cancelled, to its approver or to an assignee who can still open it', async () => {
    const cancelling = { cancellationPendingAt: decidedAt, cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ซื้อซ้ำกับใบก่อน' };
    const claim = await claimWorld('waiting-for-approver', { frozenOnStep: ['mgr-1'] });
    const assigneeWithNoRights = approver({ roles: ['STAFF'], permissions: [] });
    // Waiting for its approver: both hold the step and are offered the decision.
    for (const viewer of [approver(), assigneeWithNoRights]) {
      assert.deepEqual((await claim.detail(viewer)).approvalActions, { canApprove: true, canReject: true });
    }

    Object.assign(claim.state.request, cancelling);

    for (const viewer of [approver(), assigneeWithNoRights]) {
      const detail = await claim.detail(viewer);
      assert.deepEqual(detail.approvalActions, { canApprove: false, canReject: false });
      assert.equal(detail.pendingCancellation?.startedByUserId, 'staff-1', 'and they can still read why');
    }
    // Someone with no right and no place on the step still cannot open it.
    await assert.rejects(() => claim.detail(ctx({ userId: 'stranger-1', permissions: [] })), ForbiddenException);
  });

  it('says only that it is being cancelled when a cancellation was started on it: the cancellation comes first', async () => {
    const claim = await claimWorld('approved');
    Object.assign(claim.state.request, { cancellationPendingAt: decidedAt, cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ซื้อซ้ำกับใบก่อน' });

    const detail = await claim.detail(approver());

    assert.equal(detail.awaitingSystem, undefined);
    assert.equal(detail.pendingCancellation?.startedByUserId, 'staff-1');
    // And the call does nothing for it either: nothing waits for the system but the cancellation.
    assert.equal((await claim.resume.execute(approver(), 'rb-1')).status, 'PENDING_APPROVAL');
    assert.equal(claim.world.repairs, 0);
  });

  // Both directions: "ดำเนินการต่อ" is offered to a viewer exactly when the call takes that viewer.
  it('offers ดำเนินการต่อ to exactly the viewers the resume call accepts', async () => {
    const viewers: Array<[string, any]> = [
      ['the approver who decided', approver()],
      ['the approver who decided, restricted to another branch', approver({ scopes: { branchIds: ['branch-2'] } })],
      ['the approver who decided, whose approve right is gone', approver({ permissions: ['reimbursement.read'] })],
      ['another approver', approver({ userId: 'mgr-2' })],
      ['the requester', requester()],
      ['whoever may record the payment', payer()],
      ['a payer of another branch', payer({ scopes: { branchIds: ['branch-2'] } })],
      ['an approver who may also pay', approver({ userId: 'boss-1', permissions: ['reimbursement.read', 'reimbursement.approve', 'reimbursement.payment.record'] })],
      ['a reader', ctx({ userId: 'reader-1', permissions: ['reimbursement.read'] })],
    ];
    const offeredTo: Record<string, string[]> = { approved: [], 'no-approval-needed': [] };
    for (const kind of ['approved', 'no-approval-needed'] as const) {
      for (const [name, viewer] of viewers) {
        // Asked of the detail first; a viewer who cannot read the claim is offered nothing.
        const offered = await (await claimWorld(kind)).detail(viewer).then((detail) => detail.awaitingSystem?.canResume ?? false, () => false);
        // Then the call, on a claim of its own, as that viewer.
        const pressing = await claimWorld(kind);
        const accepted = await pressing.resume.execute(viewer, 'rb-1').then(() => true, (error) => { if (error instanceof ForbiddenException) return false; throw error; });
        assert.equal(offered, accepted, `${kind}: ${name}`);
        assert.equal(pressing.world.repairs, accepted ? 1 : 0, `${kind}: ${name}`);
        if (offered) offeredTo[kind]!.push(name);
      }
    }
    assert.deepEqual(offeredTo, {
      approved: ['the approver who decided'],
      'no-approval-needed': ['whoever may record the payment', 'an approver who may also pay'],
    });
  });

  it('keeps ดำเนินการต่อ with an approver frozen onto the step after their approve right is gone, as approving itself does', async () => {
    // Demoted since: no approve right left, and the right every member keeps to read a claim they had a part in.
    const frozen = approver({ permissions: ['reimbursement.read_related'] });
    const claim = await claimWorld('approved', { frozenOnStep: ['mgr-1'] });

    assert.equal((await claim.detail(frozen)).awaitingSystem?.canResume, true, 'offered on the page they can still open');
    assert.equal((await claim.resume.execute(frozen, 'rb-1')).status, 'READY_FOR_PAYMENT');
    assert.equal(claim.world.repairs, 1);

    // The same person on a role-routed step, with no place on it and no approve right, is refused.
    const roleRouted = await claimWorld('approved');
    await assert.rejects(() => roleRouted.resume.execute(frozen, 'rb-1'), /reimbursement_resume_not_allowed/);
    assert.equal(roleRouted.world.repairs, 0);

    // With no way left to open the claim, the call answers what the claim detail answers them (final review
    // item 18): the page never offered it to them, and the scheduled run carries the decision out.
    const noRights = approver({ permissions: [] });
    const unreadable = await claimWorld('approved', { frozenOnStep: ['mgr-1'] });
    await assert.rejects(() => unreadable.detail(noRights), /Cannot read this reimbursement/);
    await assert.rejects(() => unreadable.resume.execute(noRights, 'rb-1'), /Cannot read this reimbursement/);
    assert.equal(unreadable.world.repairs, 0);
  });

  it('carries the decision out once, decides nothing again, and records who asked', async () => {
    const claim = await claimWorld('approved');
    // The fake repository has no approval, attestation or payment method at all: a call into any of them would throw.

    const carried = await claim.resume.execute(approver(), 'rb-1');

    assert.equal(carried.status, 'READY_FOR_PAYMENT');
    assert.deepEqual(claim.audits.map((entry) => [entry.action, entry.actorUserId, entry.metadataJson.waitingFor]), [['reimbursement.projection.resume', 'mgr-1', 'APPROVAL']]);

    // Pressed again, or pressed after the scheduled run got there first: the claim as it stands, and nothing more.
    assert.equal((await claim.resume.execute(approver(), 'rb-1')).status, 'READY_FOR_PAYMENT');
    assert.equal(claim.world.repairs, 1, 'nothing waits, so nothing is carried out a second time');
    assert.equal(claim.audits.length, 1);
    await assert.rejects(() => claim.resume.execute(ctx({ userId: 'stranger-1', permissions: [] }), 'rb-1'), ForbiddenException,
      'a claim that no longer waits is shown only to someone who may read it');
  });

  it('says what stopped it and records nothing when the claim is no longer what was approved', async () => {
    const claim = await claimWorld('approved', { repair: async () => { throw new ConflictException('stale_approval_snapshot'); } });

    await assert.rejects(() => claim.resume.execute(approver(), 'rb-1'), /stale_approval_snapshot/);

    assert.equal(claim.state.request.status, 'PENDING_APPROVAL');
    assert.deepEqual(claim.audits, []);
  });

  it('records nothing when the scheduled run carried the claim on first', async () => {
    const claim = await claimWorld('approved', { repair: async () => false });
    await claim.resume.execute(approver(), 'rb-1');
    assert.deepEqual(claim.audits, []);
  });
});

describe('ReopenRejectedReimbursementUseCase', () => {
  it('reopens a rejected claim as a draft and clears the request-level rejection fields', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: 'ยอดไม่ตรงกับใบเสร็จ', requestNo: 'RB-202601-000001' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    const result = await reopen.execute(ctx(), 'rb-1');
    assert.equal(result.status, 'DRAFT');
    assert.equal(state.request.rejectionReason, null);
    assert.equal(state.request.rejectedAt, null);
    // The document number survives the reopen so resubmission reuses it.
    assert.equal(state.request.requestNo, 'RB-202601-000001');
  });

  it('refuses reopen for non-requesters without finance review and for non-rejected claims', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    await assert.rejects(() => reopen.execute(ctx(), 'rb-1'), /Cannot reopen from status DRAFT/);
    Object.assign(state.request, { status: 'REJECTED' });
    // Someone else who can open the claim is told they may not reopen it; someone who cannot open it is told only that.
    await assert.rejects(
      () => reopen.execute(ctx({ userId: 'someone-else', permissions: ['reimbursement.read', 'reimbursement.update_own_draft'] }), 'rb-1'),
      /Cannot reopen this reimbursement/,
    );
    await assert.rejects(
      () => reopen.execute(ctx({ userId: 'someone-else', permissions: ['reimbursement.update_own_draft'] }), 'rb-1'),
      /Cannot read this reimbursement/,
    );
  });

  // Spec §6 step 2: "แก้ไข (เปิดกลับเป็นร่าง)" while the claim waits for approval.
  it('lets the requester withdraw a claim nobody has decided, under the same number, and audits it', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'PENDING_APPROVAL', requestNo: 'RB-202601-000001' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, { log: async (entry: any) => { state.calls.audits.push(entry); } } as any);

    const result = await reopen.execute(ctx(), 'rb-1');

    assert.equal(result.status, 'DRAFT');
    assert.equal(state.request.requestNo, 'RB-202601-000001');
    const audit = state.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.withdraw');
    assert.deepEqual(audit?.metadataJson, { requestNo: 'RB-202601-000001', previousStatus: 'PENDING_APPROVAL' });
  });

  it('refuses a withdraw after a decision, and from anyone but the requester — finance included', async () => {
    const state = fakeRepo();
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()] } as any);
    Object.assign(state.request, { status: 'PENDING_APPROVAL', currentApprovalStepId: 'step-1' });
    const reopen = new ReopenRejectedReimbursementUseCase(state.repo, noopAudit);
    const finance = ctx({ userId: 'fin-1', permissions: ['reimbursement.read', 'reimbursement.update_own_draft', 'reimbursement.finance_review'] });

    await assert.rejects(() => reopen.execute(finance, 'rb-1'), /Cannot reopen this reimbursement/);
    state.calls.approvalSteps.push({ id: 'step-1', status: 'APPROVED' });
    await assert.rejects(() => reopen.execute(ctx(), 'rb-1'), /reimbursement_changed/);
    assert.equal(state.request.status, 'PENDING_APPROVAL');
    // Finance's wider reach still reopens a refusal, as before.
    Object.assign(state.request, { status: 'REJECTED' });
    assert.equal((await reopen.execute(finance, 'rb-1')).status, 'DRAFT');
  });

  it('builds a fresh route when the withdrawn claim is sent again', async () => {
    const policy = {
      id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), currency: 'THB', approvalRequiredFromAmount: '1.00',
      approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
      financeReviewRequired: false, status: 'ACTIVE', requireReceipt: false, allowMissingReceiptWithReason: false,
    } as any;
    const state = fakeRepo({ policy });
    const routeInputs: any[] = [];
    const routes = {
      resolveNamedSubmissionRoute: async () => null,
      // Self-approval off leaves the requester off their own route; on, they are on it.
      resolveSubmissionRoute: async (input: any) => {
        routeInputs.push(input);
        return {
          responsibilityRole: input.roleKey, effectiveTaskRole: input.roleKey,
          recipientUserIds: input.allowSelfApproval ? [input.requesterUserId] : ['owner-1'],
          ownerRecipientUserIds: ['owner-1'], ownerFallbackUsed: !input.allowSelfApproval,
        };
      },
    } as any;
    const submit = new SubmitReimbursementUseCase(state.repo, noopAudit, noopOutbox, evidenceService(), routes, noopProjections);
    await useCases(state).create.execute(ctx(), { reason: 'r', lines: [inputLine()], missingReceiptReason: 'ใบเสร็จหาย' } as any);
    await submit.execute(ctx(), 'rb-1');

    await new ReopenRejectedReimbursementUseCase(state.repo, noopAudit).execute(ctx(), 'rb-1');
    policy.allowSelfApproval = true;
    await submit.execute(ctx(), 'rb-1');

    assert.equal(routeInputs.length, 2, 'the route is resolved again, not carried over');
    assert.equal(routeInputs[1].allowSelfApproval, true);
    assert.deepEqual(state.calls.approvalSteps.map((step) => [step.id, step.status ?? 'PENDING', step.assignedApproverUserIdsJson]), [
      ['step-1', 'CANCELLED', ['owner-1']],
      ['step-2', 'PENDING', ['staff-1']],
    ]);
    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.equal(state.request.currentApprovalStepId, 'step-2');
    assert.equal(state.request.approvalPolicySnapshotJson.allowSelfApproval, true);
  });
});

describe('SubmitReimbursementUseCase (multi-line)', () => {
  // Policy rows always carry these columns; the fakes mirror that.
  const basePolicy = {
    id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    currency: 'THB', approvalRequiredFromAmount: '1.00', approverMode: 'MANAGER_ROLE',
    defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
    financeReviewRequired: true, status: 'ACTIVE',
  };
  const requireReceipt = { ...basePolicy, requireReceipt: true, allowMissingReceiptWithReason: true } as any;
  const noReceiptNeeded = { ...basePolicy, requireReceipt: false, allowMissingReceiptWithReason: false } as any;
  // A reason is supplied where the case is about another gate; the policy matrix below tests when it is required.
  const withReason = { missingReceiptReason: 'ใบเสร็จหาย' };

  async function draftWith(state: any, lines: any[], extra: Record<string, unknown> = {}) {
    await useCases(state).create.execute(ctx(), { reason: 'r', lines, ...extra } as any);
  }

  it('freezes exact approver recipients on a human approval step', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '1.00' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.deepEqual(state.calls.approvalSteps[0]?.assignedApproverUserIdsJson, ['approver-1']);
    // An ordinary route adds no solo flag, so its snapshot keeps the shape it always had.
    assert.equal('soloSelfApprovalAtSubmission' in state.request.approvalPolicySnapshotJson.route, false);
  });

  it('freezes a solo route on the step, the policy snapshot and the submit audit (owner order 2026-09-21)', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    const soloRoutes = {
      resolveNamedSubmissionRoute: async () => null,
      resolveSubmissionRoute: async ({ roleKey, requesterUserId }: any) => ({
        responsibilityRole: roleKey, effectiveTaskRole: roleKey, recipientUserIds: [requesterUserId],
        ownerRecipientUserIds: [], ownerFallbackUsed: false, soloSelfApproval: true,
      }),
    } as any;
    const audit = { log: async (entry: any) => { state.calls.audits.push(entry); } } as any;
    await draftWith(state, [inputLine()], withReason);
    await new SubmitReimbursementUseCase(state.repo, audit, noopOutbox, evidenceService(), soloRoutes, noopProjections).execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'PENDING_APPROVAL');
    assert.deepEqual(state.calls.approvalSteps[0]?.assignedApproverUserIdsJson, ['staff-1']);
    // Frozen with the route, so every later reader parses the same reason.
    assert.equal(parseReimbursementPolicySnapshot(state.request.approvalPolicySnapshotJson)?.route?.soloSelfApprovalAtSubmission, true);
    const submitAudit = state.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.submit');
    assert.equal(submitAudit.metadataJson.soloSelfApproval, true);
  });

  it('skips human approval below threshold and enters finance review when configured', async () => {
    const state = fakeRepo({ policy: { ...noReceiptNeeded, approvalRequiredFromAmount: '100.00' } });
    await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'FINANCE_REVIEW');
    assert.equal(state.request.financeReviewStatus, 'PENDING');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.approval_not_required'));
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.finance_review_requested'));
    // The finance desk is told from `finance_review_requested`, and nobody is asked to approve from
    // `request_submitted`: both workflow rules decide on the status these two events carry.
    for (const eventType of ['reimbursement.finance_review_requested', 'reimbursement.request_submitted']) {
      const data = state.calls.outbox.find((event: any) => event.eventType === eventType).payloadJson.data;
      assert.equal(data.status, 'FINANCE_REVIEW', eventType);
      assert.ok(data.requestNo && data.requesterUserId && data.amount && data.currency, eventType);
    }
  });

  it('reaches ready-for-payment through POLICY projection below threshold when finance is off', async () => {
    const state = fakeRepo({ policy: {
      ...noReceiptNeeded, approvalRequiredFromAmount: '100.00', financeReviewRequired: false,
    } });
    await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.status, 'READY_FOR_PAYMENT');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.projections[0]?.[2]?.kind, 'POLICY');
    assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.ready_for_payment'));
  });

  it('D2: no-approval submission states the ready transaction duplicate block', async (t) => {
    for (const block of ['CONFIRMED', 'UNRESOLVED', 'NONE']) await t.test(block, async () => {
      const state = fakeRepo({ policy: { ...noReceiptNeeded, approvalRequiredFromAmount: '100.00', financeReviewRequired: false } });
      state.repo.paymentNoticeFacts = async (tx: any) => { assert.ok(tx.outboxEvent); return { paymentDuplicateBlock: block, duplicateReasons: [] }; };
      await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
      await useCases(state).submit.execute(ctx(), 'rb-1');
      const ready = state.calls.outbox.filter((event: any) => event.eventType === 'reimbursement.ready_for_payment');
      assert.equal(ready.length, block === 'CONFIRMED' ? 0 : 1);
      if (ready[0]) assert.equal(ready[0].payloadJson.data.paymentDuplicateBlock, block);
      assert.ok(state.calls.outbox.some((event: any) => event.eventType === 'reimbursement.approved'));
    });
  });

  // Owner rule 2026-10-01: a claim nobody had to approve has no approver of its own to hand the
  // payment to, so its ready-to-pay event names the people who would have approved it.
  it('names the would-be approvers on the ready-to-pay event of a claim that needed no approval', async () => {
    const submitBelowThreshold = async () => {
      const state = fakeRepo({ policy: { ...noReceiptNeeded, approvalRequiredFromAmount: '100.00', financeReviewRequired: false } });
      await draftWith(state, [inputLine({ amount: '99.99' })], withReason);
      await useCases(state).submit.execute(ctx(), 'rb-1');
      return state;
    };
    const readyData = (state: any) => state.calls.outbox.find((event: any) => event.eventType === 'reimbursement.ready_for_payment').payloadJson.data;

    const asked: any[] = [];
    readyApproverRoutes.resolveWouldBeApproverUserIds = async (...args: any[]) => { asked.push(args); return ['approver-1', 'approver-2']; };
    try {
      const state = await submitBelowThreshold();
      assert.deepEqual(readyData(state).approverRecipientUserIds, ['approver-1', 'approver-2']);
      assert.equal(readyData(state).decision, 'BELOW_APPROVAL_THRESHOLD');
      assert.equal(asked[0][0], 'co-1');
      assert.equal(asked[0][2].requesterUserId, 'staff-1');

      // Best effort: failing to name them never fails the submission, and the event simply names nobody.
      readyApproverRoutes.resolveWouldBeApproverUserIds = async () => { throw new Error('lookup failed'); };
      const unresolved = await submitBelowThreshold();
      assert.equal(unresolved.request.status, 'READY_FOR_PAYMENT');
      assert.equal(readyData(unresolved).approverRecipientUserIds, undefined);
    } finally {
      delete readyApproverRoutes.resolveWouldBeApproverUserIds;
    }
  });

  it('blocks INACTIVE policy before submit mutation', async () => {
    const state = fakeRepo({ policy: { ...noReceiptNeeded, status: 'INACTIVE' } });
    await draftWith(state, [inputLine()], withReason);

    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /reimbursement_policy_inactive/);
    assert.equal(state.request.status, 'DRAFT');
    assert.equal(state.calls.approvalSteps.length, 0);
    assert.equal(state.calls.outbox.length, 0);
  });

  it('freezes the outstanding amount to the line rollup', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine({ amount: '120' }), inputLine({ lineNo: 2, amount: '80' })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.amount, '200.0000');
    assert.equal(state.request.outstandingAmount, '200.0000');
    assert.equal(detail.lines.length, 2);
  });

  it('clears the prior finance correction decision when the corrected draft is resubmitted', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine()], withReason);
    Object.assign(state.request, {
      financeReviewStatus: 'NEEDS_INFO',
      financeReviewedByUserId: 'finance-1',
      financeReviewedAt: new Date('2026-01-02T00:00:00.000Z'),
      financeReviewNote: 'แก้ยอด',
      approvedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(state.request.financeReviewStatus, 'NOT_REQUIRED');
    assert.equal(state.request.financeReviewedByUserId, null);
    assert.equal(state.request.financeReviewedAt, null);
    assert.equal(state.request.financeReviewNote, null);
    assert.equal(state.request.approvedAt, null);
  });

  it('emits document-number audits only after the atomic submit succeeds', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    const uc = useCases(state);
    await uc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    state.calls.audits.length = 0;
    await uc.submit.execute(ctx(), 'rb-1');
    assert.deepEqual(
      state.calls.audits
        .map((entry: any) => entry.action)
        .filter((action: string) => action.startsWith('document.number.')),
      ['document.number.reserve', 'document.number.commit'],
    );

    const failed = fakeRepo({ policy: noReceiptNeeded, submitError: new Error('transaction_failed') });
    const failedUc = useCases(failed);
    await failedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    failed.calls.audits.length = 0;
    await assert.rejects(() => failedUc.submit.execute(ctx(), 'rb-1'), /transaction_failed/);
    assert.equal(failed.calls.audits.some((entry: any) => entry.action.startsWith('document.number.')), false);

    const reused = fakeRepo({ policy: noReceiptNeeded, documentNumberReused: true });
    const reusedUc = useCases(reused);
    await reusedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    reused.calls.audits.length = 0;
    await reusedUc.submit.execute(ctx(), 'rb-1');
    assert.equal(reused.calls.audits.some((entry: any) => entry.action.startsWith('document.number.')), false);

    const healed = fakeRepo({
      policy: noReceiptNeeded,
      documentNumberReused: true,
      supersededDuplicateCandidateCount: 2,
      supersededApprovalStepCount: 1,
    });
    const healedUc = useCases(healed);
    await healedUc.create.execute(ctx(), { reason: 'r', lines: [inputLine()], ...withReason } as any);
    healed.calls.audits.length = 0;
    await healedUc.submit.execute(ctx(), 'rb-1');
    const submitAudit = healed.calls.audits.find((entry: any) => entry.action === 'reimbursement.request.submit');
    assert.deepEqual(submitAudit.metadataJson.legacyRecovery, {
      documentNumberReused: true,
      supersededDuplicateCandidateCount: 2,
      supersededApprovalStepCount: 1,
    });
  });

  it('blocks submit when one line of several has no receipt', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2 })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /missing_receipt/);
  });

  for (const requireReceipt of [false, true]) for (const allowMissingReceiptWithReason of [false, true]) {
    for (const hasReceipt of [false, true]) it(`receipt policy ${requireReceipt}/${allowMissingReceiptWithReason}, receipt=${hasReceipt}`, async () => {
      const state = fakeRepo({ policy: { ...basePolicy, requireReceipt, allowMissingReceiptWithReason } });
      await draftWith(state, [inputLine(hasReceipt ? { attachmentId: 'att-1' } : {})]);
      const submit = () => useCases(state).submit.execute(ctx(), 'rb-1');
      if (!hasReceipt && (requireReceipt || allowMissingReceiptWithReason)) {
        await assert.rejects(submit, allowMissingReceiptWithReason ? /missing_receipt_reason_required/ : /missing_receipt/);
        if (allowMissingReceiptWithReason) {
          await useCases(state).update.execute(ctx(), 'rb-1', { missingReceiptReason: 'ร้านไม่ออกใบเสร็จ' });
          await submit();
        }
      } else {
        await submit();
        assert.equal(state.request.receiptRequirementStatus, hasReceipt ? 'ATTACHED' : 'WAIVED_BY_POLICY');
      }
    });
  }

  it('submits the same receipt-less claim once the reason is filled in', async () => {
    const state = fakeRepo({ policy: noReceiptNeeded });
    await draftWith(state, [inputLine(), inputLine({ lineNo: 2 })], withReason);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.status, 'PENDING_APPROVAL');
    assert.equal(detail.receiptRequirementStatus, 'WAIVED_BY_POLICY');
    assert.equal(detail.missingReceiptReason, 'ใบเสร็จหาย');
  });

  it('accepts a claim-level reason covering several missing receipts', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine(), inputLine({ lineNo: 2 })], { missingReceiptReason: 'ใบเสร็จหาย' });
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.receiptRequirementStatus, 'MISSING_WITH_REASON');
  });

  it('marks the claim ATTACHED when every line is evidenced by receipt or linked expense', async () => {
    const state = fakeRepo({ policy: requireReceipt });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2, linkedExpenseId: 'exp-1' })]);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');
    assert.equal(detail.receiptRequirementStatus, 'ATTACHED');
  });

  it('rejects an expense already claimed by another live claim', async () => {
    const state = fakeRepo({ claimedElsewhere: [{ lineNo: 1, linkedExpenseId: 'exp-1', requestNo: 'RB-202601-000009' }] });
    await draftWith(state, [inputLine({ linkedExpenseId: 'exp-1' })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /expense_already_claimed/);
  });

  it('rejects an attachment already claimed by another live claim', async () => {
    const state = fakeRepo({ claimedElsewhere: [{ lineNo: 2, attachmentId: 'att-1', requestNo: 'RB-202601-000009' }] });
    await draftWith(state, [inputLine({ attachmentId: 'att-1' })]);
    await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), /attachment_already_claimed/);
  });

  it('asks only about this claim\'s evidence, excluding itself', async () => {
    const state = fakeRepo();
    await draftWith(state, [inputLine({ attachmentId: 'att-1' }), inputLine({ lineNo: 2, linkedExpenseId: 'exp-2' })]);
    await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.deepEqual(state.calls.claimQueries, [{
      companyId: 'co-1', excludeId: 'rb-1', attachmentIds: ['att-1'], expenseIds: ['exp-2'],
    }]);
  });

  for (const duplicatePolicy of ['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT']) {
    it(`cross-requester checksum match under ${duplicatePolicy}`, async () => {
      const state = fakeRepo({ policy: { ...requireReceipt, duplicatePolicy }, duplicateCandidates: [{
        id: 'rb-secret', requestNo: 'RB-SECRET', requesterUserId: 'other-person', amount: '999', currency: 'THB',
        incurredDate: new Date('2026-02-01'), categoryKey: 'other', reason: 'private',
        lines: [{ lineNo: 1, attachmentId: 'other-file', attachmentChecksum: 'same' }],
      }] });
      (state.repo as any).findReceiptChecksums = async () => ({ 'my-file': 'same' });
      await draftWith(state, [inputLine({ attachmentId: 'my-file' })]);
      if (duplicatePolicy === 'BLOCK_SUBMIT') {
        await assert.rejects(() => useCases(state).submit.execute(ctx(), 'rb-1'), (error: any) => error.getResponse().code === 'duplicate_unresolved');
        assert.equal(state.request.status, 'DRAFT');
        assert.equal(state.calls.duplicates.length, 1, 'blocked draft keeps its detected candidate');
      } else {
        await useCases(state).submit.execute(ctx(), 'rb-1');
        assert.equal(state.calls.duplicates.length, 1);
        assert.equal(state.calls.duplicates[0].candidateType, 'ATTACHMENT_CHECKSUM');
        assert.equal(state.calls.duplicates[0].reason, 'ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น');
        assert.ok(!JSON.stringify(state.calls.outbox).includes('RB-SECRET'));
      }
    });
  }

  it('records a duplicate candidate naming the line that shares a receipt', async () => {
    const state = fakeRepo({
      duplicateCandidates: [{
        id: 'rb-9', requestNo: 'RB-202601-000009', requesterUserId: 'staff-1', amount: '100.0000', currency: 'THB',
        incurredDate: new Date('2026-01-05T00:00:00.000Z'), categoryKey: 'travel', reason: 'r',
        lines: [{ lineNo: 1, attachmentId: 'att-1' }],
      }],
    });
    await draftWith(state, [inputLine({ attachmentId: 'att-2' }), inputLine({ lineNo: 2, attachmentId: 'att-1' })]);
    const detail = await useCases(state).submit.execute(ctx(), 'rb-1');

    assert.equal(detail.duplicateStatus, 'POSSIBLE_DUPLICATE');
    assert.equal(state.calls.duplicates.length, 1);
    assert.equal(state.calls.duplicates[0].candidateType, 'ATTACHMENT_CHECKSUM');
    assert.equal(state.calls.duplicates[0].candidateAttachmentId, 'att-1');
    assert.equal(state.calls.duplicates[0].reason, 'ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น');
  });
});

// Spec §18.3 and the owner's consistency rule 2026-10-01: `paymentDesk` names exactly the members the API accepts a
// payment from on that claim — the resolver's permission, entitlement cut and branch scope, nothing looser.
describe('claim detail paymentDesk', () => {
  const PAY = 'reimbursement.payment.record';
  const day = new Date('2026-10-01T03:00:00.000Z');
  const waiting = (overrides: Record<string, unknown> = {}) => ({
    id: 'rb-1', companyId: 'co-1', branchId: 'b1', requestNo: 'RB-202610-000001', requesterUserId: 'staff-1',
    requesterDisplayNameSnapshot: 'ผู้เบิก', createdByUserId: 'staff-1', reason: 'แท็กซี่', categoryKey: 'travel', amount: '500.0000',
    currency: 'THB', incurredDate: day, status: 'READY_FOR_PAYMENT', financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'UNPAID',
    duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED', postingStatus: 'pending', paymentTotalAmount: '0.0000',
    outstandingAmount: '500.0000', createdAt: day, updatedAt: day, lines: [], approvalSteps: [], payments: [], duplicateCandidates: [],
    claimSignatures: [], ...overrides,
  }) as any;
  const detailEvidence = { getAttachmentFileName: async () => undefined, getAttachmentFileNames: async () => ({}) } as any;

  type Member = {
    userId: string; displayName: string; permissions: string[]; roleStatus?: string; status?: string; userStatus?: string;
    branchScopeMode?: string; defaultBranchId?: string; branchIds?: string[];
  };
  /** One company in memory, read by the repository (who is listed) and by the permission resolver (who may pay). */
  function company(members: Member[], entitlements: Array<{ featureKey: string; enabled: boolean }> = []) {
    const rows = members.map((member) => ({
      id: `m-${member.userId}`, companyId: 'co-1', userId: member.userId, status: member.status ?? 'ACTIVE',
      branchScopeMode: member.branchScopeMode ?? 'ALL_BRANCHES', defaultBranchId: member.defaultBranchId ?? null,
      branchScopes: (member.branchIds ?? []).map((branchId) => ({ branchId })),
      user: { status: member.userStatus ?? 'ACTIVE', displayName: member.displayName },
      company: { status: 'ACTIVE' },
      roles: [{ role: { key: `ROLE_${member.userId}`, status: member.roleStatus ?? 'ACTIVE',
        permissions: member.permissions.map((key) => ({ permission: { key } })) } }],
    }));
    return { client: {
      company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
      companyMembership: {
        // The repository's own where clause, applied as written.
        findMany: async ({ where }: any) => rows.filter((row) => row.companyId === where.companyId && row.status === where.status
          && row.user.status === where.user.status
          && row.roles.some(({ role }) => role.status === where.roles.some.role.status
            && role.permissions.some(({ permission }) => permission.key === where.roles.some.role.permissions.some.permission.key))),
        findFirst: async ({ where }: any) => rows.find((row) => row.userId === where.userId && row.companyId === where.companyId
          && row.status === where.status) ?? null,
      },
      // b1 and b2 are open; b-closed is an archived branch.
      branch: { findMany: async ({ where }: any) => ['b1', 'b2'].filter((id) => !where.id || where.id.in.includes(id)).map((id) => ({ id })) },
      companyFeatureEntitlement: { findMany: async () => entitlements },
    } } as any;
  }
  const listed = (prisma: any, branchId: string) => new PrismaReimbursementRepository(prisma, {} as any).listPaymentRecorderNames('co-1', branchId);
  /** The API's own answer: resolve the member as every request does, then record the payment as them. `paid`, or why not. */
  async function pays(prisma: any, userId: string, claimState: Record<string, unknown>): Promise<string> {
    const claim = waiting(claimState);
    const repo = {
      findRequestById: async () => claim, findPolicy: async () => null, assertClaimPaymentReady: async () => undefined,
      assertPaymentRecordInput: async () => undefined,
      listOpenDuplicateCandidates: async () => [], getUserDisplayNames: async () => ({}), listSignedClaimFormCopies: async () => [],
      recordPaymentAtomic: async (data: any) => ({ created: true, payment: { id: 'pay-1', ...data, status: 'RECORDED', postingStatus: 'pending' },
        request: { ...claim, status: 'PAID', paymentStatus: 'PAID' } }),
    } as any;
    const useCase = new RecordReimbursementPaymentUseCase(repo, noopAudit,
      { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-202610-000001' }) } as any, { execute: async () => undefined } as any, detailEvidence);
    try {
      const access = await new PrismaPermissionResolverRepository(prisma).resolveForUser({ userId, companyId: 'co-1' });
      const paid = await useCase.execute(ctx({ userId, ...access }), claim.id, { paidAmount: '500.0000', paymentMethod: 'CASH', paidAt: day.toISOString() });
      return paid.status === 'PAID' ? 'paid' : `status ${paid.status}`;
    } catch (error) {
      // Refused for want of the right or the branch scope, or because the claim itself takes no payment.
      if (error instanceof ForbiddenException || error instanceof UnprocessableEntityException) return error.message;
      throw error;
    }
  }
  /** What the claim page is told: the detail's `paymentDesk`, read through the real repository; null when it carries none. */
  async function desk(prisma: any, claimState: Record<string, unknown>): Promise<{ names: string[]; moreCount: number } | null> {
    const names = new PrismaReimbursementRepository(prisma, {} as any);
    const repo = {
      findRequestById: async () => waiting(claimState), findPolicy: async () => null, findActiveApproverUserIds: async () => new Set(),
      getUserDisplayNames: async () => ({}), listSignedClaimFormCopies: async () => [], listInternalNotes: async () => [],
      listPaymentRecorderNames: (companyId: string, branchId: string, turnUserIds: string[]) => names.listPaymentRecorderNames(companyId, branchId, turnUserIds),
      listClaimPayoutVersions: async () => [],
      findCancellationCertificates: async () => [], findCancellationBlocker: async () => null,
    } as any;
    const detail = await new GetReimbursementDetailUseCase(repo, detailEvidence).execute(ctx({ permissions: ['reimbursement.read'] }), 'rb-1');
    return detail.paymentDesk ?? null;
  }

  const approverRole = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
  const members: Member[] = [
    { userId: 'owner', displayName: 'เจ้าของ', permissions: [...approverRole, PAY] },
    { userId: 'b1-selected', displayName: 'สมศรี', permissions: [PAY], branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b1'] },
    { userId: 'b1-default', displayName: 'วิชัย', permissions: [PAY], branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'b1' },
    { userId: 'b2-selected', displayName: 'มานี', permissions: [PAY], branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b2'] },
    { userId: 'b2-default', displayName: 'ปิติ', permissions: [PAY], branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'b2' },
    // An approver role saved before the pay right was added: approves, cannot pay.
    { userId: 'approver-only', displayName: 'ชูใจ', permissions: approverRole },
    { userId: 'disabled-role', displayName: 'วีระ', permissions: [PAY], roleStatus: 'DISABLED' },
    { userId: 'suspended', displayName: 'ปรีชา', permissions: [PAY], status: 'SUSPENDED' },
    // Every branch this member covers is archived: the resolver refuses them outright.
    { userId: 'closed-branch', displayName: 'สุดา', permissions: [PAY], branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['b-closed'] },
  ];
  const nameOf = Object.fromEntries(members.map((member) => [member.userId, member.displayName]));

  it('lists a member exactly when the API accepts their payment: listed can pay, unlisted is refused', async () => {
    const expected: Array<[string, string[]]> = [
      ['b1', ['เจ้าของ', 'วิชัย', 'สมศรี']],
      ['b2', ['เจ้าของ', 'ปิติ', 'มานี']],
      ['b-closed', ['เจ้าของ']],
    ];
    // The runoff rule keeps the pay right while the feature is switched off: the list and the API follow it together.
    for (const entitlements of [[], [{ featureKey: 'reimbursement', enabled: false }]]) {
      const prisma = company(members, entitlements);
      for (const [branchId, names] of expected) {
        assert.deepEqual(await listed(prisma, branchId), names, `claim branch ${branchId}`);
        // Approved and still being routed to payment waits at the same desk, and the API takes its payment too.
        for (const status of ['READY_FOR_PAYMENT', 'APPROVED']) {
          // The page is told the first two of them by name, and how many more there are.
          assert.deepEqual(await desk(prisma, { branchId, status }), { names: names.slice(0, 2), moreCount: Math.max(names.length - 2, 0) }, `${status} claim of branch ${branchId}`);
          for (const member of members) {
            assert.equal(await pays(prisma, member.userId, { branchId, status }) === 'paid', names.includes(nameOf[member.userId]!),
              `${member.userId} on a ${status} claim of branch ${branchId}`);
          }
        }
      }
    }
    // A disabled user cannot sign in, so the resolver is never asked: not listed.
    assert.deepEqual(await listed(company([{ userId: 'left', displayName: 'ลาออก', permissions: [PAY], userStatus: 'DISABLED' }]), 'b1'), []);
  });

  // Before: a part-paid claim and a claim with no branch (legacy rows) named every holder of the pay right, and the
  // endpoint refused each of them. Nobody is named now, so the page falls back to "ผู้มีสิทธิ์บันทึกจ่าย".
  it('names nobody on a claim the payment endpoint refuses for everyone', async () => {
    const prisma = company(members);
    const refused: Array<[Record<string, unknown>, RegExp]> = [
      [{ branchId: 'b1', status: 'PARTIALLY_PAID', paymentStatus: 'PARTIALLY_PAID', outstandingAmount: '200.0000' }, /invalid_status_transition/],
      [{ branchId: null }, /กรุณาเลือกสาขาของรายการก่อนบันทึก/],
      [{ branchId: undefined }, /กรุณาเลือกสาขาของรายการก่อนบันทึก/],
    ];
    for (const [claimState, reason] of refused) {
      assert.equal(await desk(prisma, claimState), null, JSON.stringify(claimState));
      for (const member of members) assert.notEqual(await pays(prisma, member.userId, claimState), 'paid', `${member.userId} ${JSON.stringify(claimState)}`);
      // The owner holds the right and every branch: only the claim's own state stops them.
      assert.match(await pays(prisma, 'owner', claimState), reason);
    }
  });

  // Owner rule 2026-10-01: the person whose turn it is comes first. The ready-to-pay notice went to the finance
  // reviewer who passed the claim, else to its approver; the page names that person first, when they can pay.
  it('names whoever\'s turn it is first among the people who can pay, then the others by name', async () => {
    const prisma = company(members);
    const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
    const approvedBy = (userId: string, decidedAt = at(4)) => ({ submittedAt: at(3), approvedAt: decidedAt,
      approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: userId, decidedAt, assignedAt: at(3) }] });
    const names = async (claimState: Record<string, unknown>) => (await desk(prisma, { branchId: 'b1', ...claimState }))!;

    // Nobody approved (a claim below the threshold): by name, as before.
    assert.deepEqual(await names({}), { names: ['เจ้าของ', 'วิชัย'], moreCount: 1 });
    // The approver can pay: first, whatever their name sorts as.
    assert.deepEqual(await names(approvedBy('b1-selected')), { names: ['สมศรี', 'เจ้าของ'], moreCount: 1 });
    assert.deepEqual(await names(approvedBy('b1-default')), { names: ['วิชัย', 'เจ้าของ'], moreCount: 1 });
    assert.deepEqual(await names(approvedBy('owner')), { names: ['เจ้าของ', 'วิชัย'], moreCount: 1 });
    // The approver cannot pay (no right, or another branch): not named at all, and nobody jumps the queue.
    assert.deepEqual(await names(approvedBy('approver-only')), { names: ['เจ้าของ', 'วิชัย'], moreCount: 1 });
    assert.deepEqual(await names(approvedBy('b2-selected')), { names: ['เจ้าของ', 'วิชัย'], moreCount: 1 });
    // With a finance step: the finance reviewer who passed the claim, then its approver.
    const reviewed = { financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: 'b1-default', financeReviewedAt: at(5) };
    assert.deepEqual(await names({ ...approvedBy('b1-selected'), ...reviewed }), { names: ['วิชัย', 'สมศรี'], moreCount: 1 });
    // A finance reviewer with no pay right leaves the approver first.
    assert.deepEqual(await names({ ...approvedBy('b1-selected'), ...reviewed, financeReviewedByUserId: 'approver-only' }), { names: ['สมศรี', 'เจ้าของ'], moreCount: 1 });
    // A review that did not pass the claim gives nobody a turn.
    assert.deepEqual(await names({ ...approvedBy('b1-selected'), ...reviewed, financeReviewStatus: 'NOT_REQUIRED' }), { names: ['สมศรี', 'เจ้าของ'], moreCount: 1 });
    // The approver is the one rule of contracts: an approval from before the claim was last sent, or one no longer in force, is history.
    assert.deepEqual(await names({ ...approvedBy('b1-selected', at(2)) }), { names: ['เจ้าของ', 'วิชัย'], moreCount: 1 });
    assert.deepEqual(await names({ submittedAt: at(3), approvalSteps: [{ id: 's1', sequenceNo: 1, status: 'APPROVED', decisionByUserId: 'b1-selected', decidedAt: at(4), assignedAt: at(3), invalidatedAt: at(5) }] }),
      { names: ['เจ้าของ', 'วิชัย'], moreCount: 1 });
    // The whole list is still exactly the people the API takes the payment from: only its order changed.
    const turnFirst = await new PrismaReimbursementRepository(prisma, {} as any).listPaymentRecorderNames('co-1', 'b1', ['b1-default', 'b1-selected', 'approver-only']);
    assert.deepEqual(turnFirst, ['วิชัย', 'สมศรี', 'เจ้าของ']);
    assert.deepEqual([...turnFirst].sort((a, b) => a.localeCompare(b, 'th')), await listed(prisma, 'b1'));
  });

  it('adds at most two names and the rest as a count, only while the claim waits for payment', async () => {
    const payers = ['กมล', 'ขวัญ', 'จิตรา', 'ชาติ', 'ณัฐ', 'ดวงใจ', 'ธนา'];
    const asked: Array<[string, unknown]> = [];
    const repoFor = (claim: any, names: string[]) => ({
      findRequestById: async () => claim, findPolicy: async () => null, findActiveApproverUserIds: async () => new Set(),
      getUserDisplayNames: async () => ({}), listSignedClaimFormCopies: async () => [], listInternalNotes: async () => [],
      listPaymentRecorderNames: async (companyId: string, branchId: unknown) => { asked.push([companyId, branchId]); return names; },
      listClaimPayoutVersions: async () => [],
      findCancellationCertificates: async () => [], findCancellationBlocker: async () => null,
      // Payout Phase 1: a draft's detail also reads the account it would be sent with. This requester has set none.
      findDraftDefaultPayout: async () => undefined, planSubmitPayout: async () => ({ error: 'payout_method_required' }),
    }) as any;
    const read = (claim: any, names: string[]) => new GetReimbursementDetailUseCase(repoFor(claim, names), detailEvidence)
      .execute(ctx({ permissions: ['reimbursement.read'] }), 'rb-1');

    assert.deepEqual((await read(waiting(), payers)).paymentDesk, { names: ['กมล', 'ขวัญ'], moreCount: 5 });
    assert.deepEqual(asked, [['co-1', 'b1']], 'the payers of the claim\'s own branch');
    assert.deepEqual((await read(waiting(), ['กมล', 'ขวัญ'])).paymentDesk, { names: ['กมล', 'ขวัญ'], moreCount: 0 });
    assert.deepEqual((await read(waiting(), ['กมล'])).paymentDesk, { names: ['กมล'], moreCount: 0 });
    // Nobody can pay: an empty list, which the page reports as such.
    assert.deepEqual((await read(waiting(), [])).paymentDesk, { names: [], moreCount: 0 });
    // Approved and still being routed to payment waits at the same desk.
    assert.deepEqual((await read(waiting({ status: 'APPROVED' }), ['กมล'])).paymentDesk, { names: ['กมล'], moreCount: 0 });
    // Any other desk, a finished claim, and a claim nobody can pay (part paid, or with no branch): no list, and no extra read.
    asked.length = 0;
    for (const overrides of [{ status: 'DRAFT' }, { status: 'PENDING_APPROVAL' }, { status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' },
      { status: 'APPROVED', financeReviewStatus: 'PENDING' }, { status: 'PAID', paymentStatus: 'PAID' }, { status: 'CANCELLED' },
      { status: 'PARTIALLY_PAID', paymentStatus: 'PARTIALLY_PAID' }, { branchId: null }, { branchId: undefined }]) {
      const detail = await read(waiting(overrides), payers);
      assert.equal('paymentDesk' in detail, false, JSON.stringify(overrides));
      // The part-paid and the branchless claim still wait at the payment desk: the page prints its pool label.
      if (!('status' in overrides) || overrides.status === 'PARTIALLY_PAID') assert.deepEqual(detail.currentDesk, { kind: 'PAYMENT' });
    }
    assert.deepEqual(asked, []);
  });
});

// Review follow-up 2026-10-01 (spec §18.1, acceptance I1). The list pages in the database, and the hub's counts are
// read with the list's own predicate: a card's number is the rows its filter shows over every page, and the
// buckets add up to ทั้งหมด.
describe('list paging and hub buckets', () => {
  const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'VOIDED'];
  const FINANCE = ['NOT_REQUIRED', 'PENDING', 'NEEDS_INFO', 'APPROVED_FOR_PAYMENT', 'BLOCKED'];
  const BUCKETS = ['draft', 'correction', 'review', 'payment', 'duplicate_blocked', 'paid', 'closed'] as const;
  const at = (second: number) => new Date(Date.UTC(2026, 8, 1, 0, 0, second));
  /** One claim for every status pair the database can hold, twice over for the live ones, so no two buckets are the same size. */
  const claims = STATUSES.flatMap((status, s) => FINANCE.flatMap((financeReviewStatus, f) =>
    Array.from({ length: status === 'READY_FOR_PAYMENT' || status === 'DRAFT' ? 2 : 1 }, (_, copy) => ({
      id: `rb-${status}-${financeReviewStatus}-${copy}`, companyId: 'co-1', branchId: 'b1', requesterUserId: copy ? 'staff-2' : 'staff-1',
      requesterDisplayNameSnapshot: 'ผู้เบิก', reason: 'แท็กซี่', categoryKey: 'travel', amount: `${(s + 1) * 10 + f}.5000`, currency: 'THB',
      incurredDate: at(0), status, financeReviewStatus, paymentStatus: 'UNPAID', duplicateStatus: 'NO_MATCH',
      receiptRequirementStatus: f % 2 ? 'REQUIRED' : 'ATTACHED', postingStatus: 'pending', paymentTotalAmount: '0.0000',
      outstandingAmount: '0.0000', createdByUserId: 'staff-1', createdAt: at(s * 10 + f * 2 + copy), updatedAt: at(0),
    }))));

  /** The claims table in memory, answering the repository's own `where`, order, OFFSET and LIMIT, and its GROUP BY. */
  function database(rows: any[] = claims) {
    const reads: Array<{ skip?: number; take?: number }> = [];
    const factReads: any[] = [];
    const matches = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([field, want]: [string, any]) => {
      if (want === undefined) return true;
      if (field === 'AND') return want.every((part: any) => matches(row, part));
      if (field === 'OR') return want.some((part: any) => matches(row, part));
      if (field === 'NOT') return !matches(row, want);
      if (want && typeof want === 'object' && 'not' in want) return (row[field] ?? null) !== want.not;
      // The search's `contains` (case-insensitive, as PostgreSQL's ILIKE) and its amount, which the column compares as a number.
      if (want !== null && typeof want === 'object' && 'contains' in want) {
        assert.equal(want.mode, 'insensitive');
        return typeof row[field] === 'string' && row[field].toLowerCase().includes(want.contains.toLowerCase());
      }
      if (field === 'amount') return Number(row[field]) === Number(want);
      if (want !== null && typeof want === 'object') return want.in ? want.in.includes(row[field]) : !want.notIn.includes(row[field]);
      return (row[field] ?? null) === want;
    });
    const client = {
      reimbursementRequest: {
        findMany: async ({ where, skip, take, select, orderBy }: any) => {
          if (!select) reads.push({ skip, take });
          else factReads.push({ where, select });
          const found = rows.filter((row) => matches(row, where))
            .sort((a, b) => {
              for (const entry of orderBy ?? []) {
                const [key, direction] = Object.entries(entry)[0]!;
                const left = a[key] instanceof Date ? a[key].getTime() : a[key];
                const right = b[key] instanceof Date ? b[key].getTime() : b[key];
                if (left !== right) return (left < right ? -1 : 1) * (direction === 'asc' ? 1 : -1);
              }
              return 0;
            });
          return found.slice(skip ?? 0, take === undefined ? undefined : (skip ?? 0) + take).map((row) => ({ ...row,
            _count: { lines: 1, duplicateCandidates: (row.duplicateCandidates ?? []).filter((candidate: any) => candidate.status === 'OPEN').length } }));
        },
        groupBy: async ({ by, where }: any) => {
          const groups = new Map<string, any>();
          for (const row of rows.filter((candidate) => matches(candidate, where))) {
            const key = by.map((field: string) => row[field]).join('|');
            const group = groups.get(key) ?? { ...Object.fromEntries(by.map((field: string) => [field, row[field]])), _count: { _all: 0 }, _sum: { amount: 0 } };
            group._count._all += 1;
            group._sum.amount += Number(row.amount);
            groups.set(key, group);
          }
          return [...groups.values()];
        },
      },
      attachmentLink: { findMany: async () => [] },
      reimbursementPolicy: { findMany: async () => [] },
      reimbursementApprovalStep: { findMany: async () => [] },
      companyMembership: { findMany: async () => [] },
    };
    return { reads, factReads, list: new ListReimbursementsUseCase(new PrismaReimbursementRepository({ client } as any, {} as any)) };
  }
  const reader = ctx({ permissions: ['reimbursement.read'] });
  it('CLAIM-LIST dates sort the whole scoped set before pagination with stable ties', async () => {
    const fixtures = ['c', 'b', 'a'].map(id => ({ ...claims[0], id, incurredDate: new Date(id === 'b' ? '2026-10-02' : '2026-10-01'), createdAt: at(0) }));
    const { list } = database(fixtures);
    for (const [order, ids] of [['newest', ['b', 'c', 'a']], ['oldest', ['a', 'c', 'b']]] as const) {
      const first = await list.execute(reader, { order, pageSize: 2 });
      const second = await list.execute(reader, { order, pageSize: 2, page: 2 });
      assert.deepEqual([...first.items, ...second.items].map(row => row.id), ids);
      assert.equal(first.total, 3);
      assert.deepEqual(first.hub, second.hub);
    }
    assert.deepEqual((await list.execute(reader, { pageSize: 3 })).items.map(row => row.id), ['b', 'c', 'a']);
  });
  it('keeps every not-approved claim out of cancelled, and scopes sent-back corrections to requester or preparer', async () => {
    const row = (id: string, extra: object) => ({ ...claims[0], id, ...extra });
    const fixtures = [row('rejected', { status: 'REJECTED' }), row('finance-return', { status: 'DRAFT', financeReviewStatus: 'NEEDS_INFO' }),
      row('account-return', { status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: at(1), payoutCorrectionSubmittedAt: null }),
      row('other', { status: 'REJECTED', requesterUserId: 'other', createdByUserId: 'other' }),
      row('cancelled', { status: 'CANCELLED' }), row('resubmitted', { status: 'PENDING_APPROVAL', payoutCorrectionRequestedAt: at(1), payoutCorrectionSubmittedAt: at(2) })];
    const { list } = database(fixtures);
    const all = await list.execute(reader, { pageSize: 100 });
    assert.equal((all.hub.counts as any).correction, 4);
    const page = await list.execute(reader, { bucket: 'correction' as any });
    assert.deepEqual(page.items.map(row => row.id).sort(), ['account-return', 'finance-return', 'other', 'rejected']);
    assert.ok(page.items.every(row => reimbursementHubBucket(row) === 'correction'));
    assert.equal((await list.execute(reader, { bucket: 'closed' })).total, 1);
  });



  it('Round 4: LINE summary excludes duplicate blockers and backlog keeps them under their own desk', async () => {
    const snapshot = (duplicatePolicy: string) => ({ schemaVersion: 1, policyId: 'pol', policyVersion: 'v1',
      approvalRequiredFromAmount: '1.00', requiresApproval: false, route: null, allowSelfApproval: false,
      requireReceipt: false, allowMissingReceiptWithReason: false, financeReviewRequired: false, duplicatePolicy });
    const row = (id: string, duplicatePolicy: string, extra: object = {}) => ({ ...claims[0], id, status: 'READY_FOR_PAYMENT',
      financeReviewStatus: 'NOT_REQUIRED', outstandingAmount: '100.0000', approvalPolicySnapshotJson: snapshot(duplicatePolicy), ...extra });
    const fixtures = [row('payable', 'BLOCK_PAYMENT'), row('warn-open', 'WARN', { duplicateCandidates: [{ status: 'OPEN', candidateType: 'ATTACHMENT_CHECKSUM' }] }),
      ...['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT'].map((policy) => row(`confirmed-${policy}`, policy, { confirmedDuplicateExpenseCount: 1 })),
      row('block-open', 'BLOCK_PAYMENT', { duplicateCandidates: [{ status: 'OPEN', candidateType: 'ATTACHMENT_CHECKSUM' }] }),
      row('block-own', 'BLOCK_PAYMENT', { possibleDuplicateExpenseCount: 1 }),
      row('block-confirmation', 'BLOCK_PAYMENT', { duplicateConfirmationPendingCount: 1 })];
    const reads: any[] = [];
    const repo = { listRequests: async (where: any) => { reads.push(where); return fixtures; }, findPolicy: async () => null,
      findPendingApprovalSteps: async () => [], getUserDisplayNames: async () => ({}) } as any;
    const summary = await new GetReimbursementAiSummaryUseCase(repo, noopAudit).execute(reader);
    assert.deepEqual([summary.unpaidApprovedCount, summary.totalUnpaidAmount, (summary as any).duplicateBlockedCount], [2, '200.0000', 6]);
    const backlog = await new GetReimbursementApprovalBacklogUseCase(repo, noopAudit).execute(reader);
    assert.equal(backlog.total, 8);
    assert.equal(backlog.desks.find((desk) => desk.kind === 'payment')?.count, 2);
    const blocked = backlog.desks.filter((desk) => (desk.kind as string) === 'duplicate_blocked');
    assert.equal(blocked.reduce((sum, desk) => sum + desk.count, 0), 6);
    assert.ok(blocked.every((desk) => desk.label === 'ติดรายการซ้ำ'));
    assert.equal(backlog.items.filter((item) => item.waitingOn === 'ติดรายการซ้ำ').length, 6);
    assert.ok(reads.every((where) => where.withDuplicateCandidates === true));
    fixtures.splice(2);
    const clear = await new GetReimbursementAiSummaryUseCase(repo, noopAudit).execute(reader);
    assert.equal((clear as any).duplicateBlockedCount, 0);
    for (const status of ['FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID']) {
      fixtures.splice(0, fixtures.length, row('blocked-at-stage', 'WARN', { status, confirmedDuplicateExpenseCount: 1 }));
      const blocked = await new GetReimbursementAiSummaryUseCase(repo, noopAudit).execute(reader);
      assert.deepEqual([blocked.unpaidApprovedCount, blocked.totalUnpaidAmount, blocked.duplicateBlockedCount], [0, '0.0000', 1], status);
    }
    for (const status of ['APPROVED', 'PAID', 'CANCELLED']) {
      fixtures.splice(0, fixtures.length, row('outside-old-figure', 'WARN', { status, confirmedDuplicateExpenseCount: 1 }));
      const unchanged = await new GetReimbursementAiSummaryUseCase(repo, noopAudit).execute(reader);
      assert.deepEqual([unchanged.unpaidApprovedCount, unchanged.duplicateBlockedCount], [0, 0], status);
    }
  });

  it('Round 4: splits payable and duplicate-blocked claims by frozen policy, with scoped search and matching row buckets', async () => {
    const snapshot = (duplicatePolicy: string) => ({ schemaVersion: 1, policyId: 'pol', policyVersion: 'v1',
      approvalRequiredFromAmount: '1.00', requiresApproval: false, route: null, allowSelfApproval: false,
      requireReceipt: false, allowMissingReceiptWithReason: false, financeReviewRequired: false, duplicatePolicy });
    const row = (id: string, duplicatePolicy: string, extra: object = {}) => ({ ...claims[0], id, status: 'READY_FOR_PAYMENT',
      financeReviewStatus: 'NOT_REQUIRED', reason: 'ทดสอบจำนวน', approvalPolicySnapshotJson: snapshot(duplicatePolicy), ...extra });
    const open = { status: 'OPEN', candidateType: 'ATTACHMENT_CHECKSUM' };
    const confirmed = { duplicateStatus: 'CONFIRMED_DUPLICATE', status: 'CONFIRMED' };
    const fixtures = [row('payable', 'BLOCK_PAYMENT'), row('warn-open', 'WARN', { duplicateCandidates: [open] }),
      ...['WARN', 'BLOCK_SUBMIT', 'BLOCK_PAYMENT'].map((policy) => row(`confirmed-${policy}`, policy, { sourceExpenses: [confirmed] })),
      row('block-open', 'BLOCK_PAYMENT', { duplicateCandidates: [open] }),
      row('block-own', 'BLOCK_PAYMENT', { sourceExpenses: [{ duplicateStatus: 'POSSIBLE_DUPLICATE', status: 'READY_FOR_CONFIRMATION' }] }),
      row('block-confirmation', 'BLOCK_PAYMENT', { sourceExpenses: [{ duplicateStatus: 'OVERRIDDEN', status: 'READY_FOR_CONFIRMATION' }] }),
      row('outside-search', 'BLOCK_PAYMENT', { reason: 'อีกเรื่อง', sourceExpenses: [confirmed] }),
      row('outside-scope', 'BLOCK_PAYMENT', { requesterUserId: 'staff-2', sourceExpenses: [confirmed] }),
      { ...claims[0], id: 'draft', reason: 'ทดสอบจำนวน' }];
    const { list, factReads } = database(fixtures);
    const own = ctx({ permissions: ['reimbursement.read_own'], userId: 'staff-1' });
    const all = await list.execute(own, { search: 'ทดสอบจำนวน', pageSize: 100 });
    assert.deepEqual(all.hub.counts, { all: 9, draft: 1, correction: 0, review: 0, payment: 2, duplicate_blocked: 6, paid: 0, closed: 0 });
    assert.equal(Object.entries(all.hub.counts).filter(([key]) => key !== 'all').reduce((sum, [, count]) => sum + count, 0), 9);
    for (const bucket of ['payment', 'duplicate_blocked'] as const) {
      const page = await list.execute(own, { search: 'ทดสอบจำนวน', bucket: bucket as any, pageSize: 100 });
      assert.equal(page.items.length, all.hub.counts[bucket as keyof typeof all.hub.counts]);
      assert.equal(page.total, page.items.length);
      if (bucket === 'payment') assert.deepEqual(all.hub.metrics?.pendingPayment, {
        count: page.items.length, amount: page.items.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(4),
      });
      for (const item of page.items) {
        assert.equal(reimbursementHubBucket(item), bucket, item.id);
        assert.equal((item as any).hasDuplicateBlocker, bucket === 'duplicate_blocked', item.id);
      }
      if (bucket === 'payment') assert.deepEqual(page.items.map((item) => item.id).sort(), ['payable', 'warn-open']);
    }
    assert.equal(factReads.length, 3, 'one facts read per hub request, including a filtered page');
    assert.ok(factReads.every(({ select }) => Object.keys(select).sort().join(',') === '_count,amount,approvalPolicySnapshotJson,id,sourceExpenses'));
  });
  it('3,000 seeded hub payment cards equal every row of their scoped, searched filter', async () => {
    let seed = 12345;
    const random = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return Math.floor(seed / 0x100000000 * limit);
    };
    for (let sample = 0; sample < 3000; sample++) {
      const fixtures = Array.from({ length: 1 + random(20) }, (_, index) => ({
        ...claims[0], id: `seed-${sample}-${index}`, amount: ((1 + random(10000000)) / 100).toFixed(2),
        status: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOIDED', 'DRAFT'][random(6)],
        reason: random(2) ? 'ค่าเดินทาง' : 'ค่าของ', requesterUserId: random(3) ? 'staff-1' : 'staff-2',
        financeReviewStatus: 'NOT_REQUIRED', sourceExpenses: random(2) ? [] : [{ duplicateStatus: 'CONFIRMED_DUPLICATE', status: 'CONFIRMED' }],
      }));
      const { list } = database(fixtures);
      const filter = { scope: 'own' as const, search: sample % 2 ? 'ค่าเดินทาง' : undefined, pageSize: 100 };
      const page = await list.execute(ctx({ permissions: ['reimbursement.read_own'], userId: 'staff-1' }), { ...filter, bucket: 'payment' });
      const cents = page.items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
      assert.deepEqual(page.hub.metrics?.pendingPayment, { count: page.items.length, amount: (cents / 100).toFixed(4) }, String(sample));
      assert.equal(page.hub.counts.payment, page.items.length, String(sample));
      const all = fixtures.filter(row => row.requesterUserId === 'staff-1' && (!filter.search || row.reason === filter.search));
      assert.equal(page.hub.counts.all, all.length, String(sample));
      assert.equal(page.hub.totalAmount, (all.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) / 100).toFixed(4), String(sample));
    }
  });

  /** Every page of one list, the way a client walks it. */
  async function walk(list: ListReimbursementsUseCase, filter: Record<string, unknown>, pageSize: number) {
    const pages: any[] = [];
    for (let page = 1; ; page += 1) {
      const answer = await list.execute(reader, { ...filter, page, pageSize });
      pages.push(answer);
      if (answer.items.length < answer.pageSize || page * answer.pageSize >= answer.total) return pages;
    }
  }

  it('reads one page from the database with OFFSET and LIMIT, and answers the real total', async () => {
    const { list, reads } = database();
    const first = await list.execute(reader, { page: 1, pageSize: 7 });
    const third = await list.execute(reader, { page: 3, pageSize: 7 });
    // Before: every call read the whole scope (no skip, no take) and sliced it in memory.
    assert.deepEqual(reads, [{ skip: 0, take: 7 }, { skip: 14, take: 7 }]);
    assert.deepEqual([first.items.length, first.total, first.page, first.pageSize], [7, claims.length, 1, 7]);
    assert.equal(third.items.length, 7);
    // Newest first, with the id as the tie-break: the pages are slices of one stable order.
    const order = [...claims].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1)).map((row) => row.id);
    assert.deepEqual(first.items.map((item) => item.id), order.slice(0, 7));
    assert.deepEqual(third.items.map((item) => item.id), order.slice(14, 21));
    // The page size is capped at 100 and defaults to 20; a page number that is no number is page 1.
    assert.equal((await list.execute(reader, { pageSize: 500 })).pageSize, 100);
    assert.equal((await list.execute(reader, {})).items.length, 20);
    for (const page of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, 1.9]) {
      assert.deepEqual((await list.execute(reader, { page, pageSize: 7 })).items.map((item) => item.id), order.slice(0, 7), String(page));
    }
    assert.deepEqual(reads.slice(-1), [{ skip: 0, take: 7 }]);
    // Past the end: an empty page with the same total, not an error.
    const beyond = await list.execute(reader, { page: 99, pageSize: 7 });
    assert.deepEqual([beyond.items.length, beyond.total], [0, claims.length]);
  });

  // Payout Phase 1 on the paged list. The hub decides from the row whether "ส่งอนุมัติ" may be sent from the row
  // (cash the draft itself chose) or opens the claim page, so the paged row has to say how the claim is paid
  // back, and nothing more of the account.
  it('says on a paged row how the claim is paid back: a draft\'s own choice, a sent claim\'s snapshot, nothing for a legacy claim', async () => {
    const row = (id: string, extra: Record<string, unknown>) => ({ ...claims[0]!, id, status: 'DRAFT', ...extra });
    const fingerprint = 'f'.repeat(64);
    const { list } = database([
      row('rb-cash', { payoutMethod: 'CASH' }),
      row('rb-follows-default', { payoutMethod: null }),
      row('rb-own-account', { payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1 }),
      row('rb-sent', { status: 'PENDING_APPROVAL', payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: fingerprint }),
      row('rb-sent-cash', { status: 'READY_FOR_PAYMENT', payoutMethod: 'CASH', payoutFingerprint: 'cash' }),
      // Sent by a build from before the account existed: whatever its draft chose, it has no snapshot.
      row('rb-legacy', { status: 'PENDING_APPROVAL', payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: null }),
    ]);
    const page = await list.execute(reader, { pageSize: 100 });
    assert.deepEqual(Object.fromEntries(page.items.map((item) => [item.id, item.payoutMethod ?? null])), {
      'rb-cash': 'CASH', 'rb-follows-default': null, 'rb-own-account': 'BANK_TRANSFER', 'rb-sent': 'BANK_TRANSFER', 'rb-sent-cash': 'CASH', 'rb-legacy': null,
    });
    assert.doesNotMatch(JSON.stringify(page), new RegExp(`${fingerprint}|payoutFingerprint|payoutDestinationVersion`));
    // The same rows through a bucket filter: the draft chip of the hub.
    const drafts = await list.execute(reader, { bucket: 'draft', pageSize: 100 });
    assert.deepEqual(drafts.items.map((item) => [item.id, item.payoutMethod ?? null]).sort(), [['rb-cash', 'CASH'], ['rb-follows-default', null], ['rb-own-account', 'BANK_TRANSFER']]);
  });

  it('counts each bucket as the rows its filter returns over every page, and the buckets add up to ทั้งหมด', async () => {
    const { list } = database();
    const all = await walk(list, {}, 7);
    const hub = all[0].hub;
    assert.equal(all.flatMap((answer) => answer.items).length, claims.length);
    assert.equal(hub.counts.all, claims.length);
    assert.equal(all[0].total, hub.counts.all);
    assert.equal(BUCKETS.reduce((sum, bucket) => sum + hub.counts[bucket], 0), hub.counts.all);
    assert.equal(new Set(BUCKETS.map((bucket) => hub.counts[bucket])).size, BUCKETS.length, 'six different sizes, so a swapped bucket cannot pass');

    const seen: string[] = [];
    for (const bucket of BUCKETS) {
      const pages = await walk(list, { bucket }, 7);
      const items = pages.flatMap((answer) => answer.items);
      // The card's number is the list's total and the rows of all its pages.
      assert.equal(items.length, hub.counts[bucket], bucket);
      for (const answer of pages) {
        assert.equal(answer.total, hub.counts[bucket], bucket);
        // The cards count the whole scope whatever bucket or page was asked for.
        assert.deepEqual(answer.hub, hub, bucket);
      }
      // Every row belongs there by the rule its own "อยู่ที่ …" desk follows.
      for (const item of items) assert.equal(reimbursementHubBucket(item), bucket, item.id);
      seen.push(...items.map((item) => item.id));
    }
    // No claim in two buckets, none in no bucket.
    assert.deepEqual([...seen].sort(), claims.map((row) => row.id).sort());
    // What the cards add up besides the counts: the claimed amounts, and the drafts that still owe a receipt.
    assert.equal(Number(hub.totalAmount), claims.reduce((sum, row) => sum + Number(row.amount), 0));
    assert.equal(hub.blockedDraftCount, claims.filter((row) => row.status === 'DRAFT' && row.receiptRequirementStatus === 'REQUIRED').length);
    assert.ok(hub.blockedDraftCount > 0);
  });

  it('places every status pair by its desk, in one bucket, with the same answer for the count and for the filter', () => {
    const expected: Record<string, string> = {
      DRAFT: 'draft', PENDING_APPROVAL: 'review', FINANCE_REVIEW: 'review', READY_FOR_PAYMENT: 'payment', PARTIALLY_PAID: 'payment',
      PAID: 'paid', REJECTED: 'correction', CANCELLED: 'closed', VOIDED: 'closed',
    };
    for (const status of STATUSES) {
      for (const financeReviewStatus of FINANCE) {
        // Approved and still being routed on: to finance review while that is pending, otherwise to payment.
        const bucket = status === 'APPROVED' ? (financeReviewStatus === 'PENDING' ? 'review' : 'payment') : expected[status];
        assert.equal(hubBucketOfStatus(status as any, financeReviewStatus), bucket, `${status} ${financeReviewStatus}`);
        // The filter is the count's rule asked of every pair: a pair is in a bucket's query exactly when it is counted there.
        for (const candidate of BUCKETS) {
          const inQuery = (hubBucketWhere(candidate).OR as any[]).some((part) => part.status === status && part.financeReviewStatus.in.includes(financeReviewStatus));
          assert.equal(inQuery, candidate === bucket, `${status} ${financeReviewStatus} in ${candidate}`);
        }
      }
    }
    // An unknown bucket matches nothing instead of everything.
    assert.deepEqual(hubBucketWhere('archived'), { OR: [] });
  });

  it('keeps the counts inside the caller\'s scope', async () => {
    const { list } = database();
    // Own claims only: the cards count what this person may see, never the company.
    const own = await list.execute(ctx({ userId: 'staff-2', permissions: ['reimbursement.read_own'] }), { pageSize: 100 });
    const mine = claims.filter((row) => row.requesterUserId === 'staff-2');
    assert.ok(mine.length > 0 && mine.length < claims.length);
    assert.deepEqual([own.total, own.hub.counts.all, own.items.length], [mine.length, mine.length, mine.length]);
    assert.deepEqual(own.hub.counts, { all: mine.length, draft: 4, correction: 1, review: 0, payment: 5, duplicate_blocked: 0, paid: 0, closed: 0 });
    // An empty scope: zeros everywhere, and a total amount that is still a number.
    const empty = await database([]).list.execute(reader, {});
    assert.deepEqual(empty.hub, { counts: { all: 0, draft: 0, correction: 0, review: 0, payment: 0, duplicate_blocked: 0, paid: 0, closed: 0 }, totalAmount: '0.0000', blockedDraftCount: 0, metrics: { pendingApproval: { count: 0, amount: '0.0000' }, pendingPayment: { count: 0, amount: '0.0000' } } });
    assert.deepEqual([empty.items.length, empty.total], [0, 0]);
  });

  // Review 2026-10-01 (acceptance I1 with a search). The hub searched in the browser, so a search loaded every page of
  // its filter: 30 calls for 3,000 claims, each with its own GROUP BY. The search now goes to the list, and the counts
  // are of the same searched list.
  describe('search', () => {
    const people = ['สมชาย ใจดี', 'สมศรี มีสุข', 'Wichai K.'];
    const reasons = ['ค่าแท็กซี่ไปพบลูกค้า', 'ค่าที่พักต่างจังหวัด', 'Parking fee'];
    const categories = ['เดินทาง', 'ที่พัก', null];
    /** The same claims, each with a number, a requester name, a reason and a category a person could type. */
    const named = claims.map((claim, index) => ({
      ...claim, requestNo: claim.status === 'DRAFT' ? null : `RB-202609-${String(index).padStart(5, '0')}`,
      requesterDisplayNameSnapshot: people[index % 3], reason: reasons[index % 4 % 3], categoryLabelSnapshot: categories[index % 5 % 3],
    }));
    /** What a person expects a word to find, written without the query's own predicate. */
    const has = (claim: any, word: string) => [claim.requestNo, claim.requesterDisplayNameSnapshot, claim.reason, claim.categoryLabelSnapshot]
      .some((text) => typeof text === 'string' && text.toLowerCase().includes(word.toLowerCase())) || Number(claim.amount) === Number(word.replace(/,/g, ''));
    const found = (search: string) => named.filter((claim) => search.trim().split(/\s+/).every((word) => has(claim, word)));

    it('counts each bucket as the rows its filter returns over every page, for the claims the search found', async () => {
      const { list } = database(named);
      const whole = (await list.execute(reader, {})).hub;
      for (const search of ['สมศรี', 'rb-202609', 'ที่พัก', 'parking', '21.5', 'สมชาย แท็กซี่', '  สมศรี   ที่พัก  ', 'ไม่มีใบไหนตรง']) {
        const expected = found(search);
        const all = await walk(list, { search }, 7);
        const hub = all[0].hub;
        assert.deepEqual(all.flatMap((answer) => answer.items.map((item: any) => item.id)).sort(), expected.map((claim) => claim.id).sort(), search);
        assert.deepEqual([all[0].total, hub.counts.all], [expected.length, expected.length], search);
        assert.equal(BUCKETS.reduce((sum, bucket) => sum + hub.counts[bucket], 0), hub.counts.all, search);
        assert.equal(Number(hub.totalAmount), expected.reduce((sum, claim) => sum + Number(claim.amount), 0), search);
        for (const bucket of BUCKETS) {
          const pages = await walk(list, { search, bucket }, 7);
          const items = pages.flatMap((answer) => answer.items);
          // The number on the card is the rows its filter returns, with the search as without it.
          assert.equal(items.length, hub.counts[bucket], `${search} ${bucket}`);
          for (const answer of pages) assert.deepEqual([answer.total, answer.hub], [hub.counts[bucket], hub], `${search} ${bucket}`);
          for (const item of items) assert.equal(reimbursementHubBucket(item), bucket, item.id);
        }
      }
      // The searches above are real ones: each finds some claims and not all of them, and one finds none.
      assert.deepEqual(['สมศรี', '21.5', 'สมชาย แท็กซี่', 'ไม่มีใบไหนตรง'].map((search) => found(search).length > 0), [true, true, true, false]);
      assert.ok(found('สมศรี').length < named.length && found('สมชาย แท็กซี่').length < found('สมชาย').length);
      // No search, or a blank one, is the whole scope as before.
      for (const search of [undefined, '', '   ']) assert.deepEqual((await list.execute(reader, { search })).hub, whole, JSON.stringify(search));
    });

    it('keeps the search inside the caller\'s scope', async () => {
      const { list } = database(named);
      const own = ctx({ userId: 'staff-2', permissions: ['reimbursement.read_own'] });
      const mine = found('สมศรี').filter((claim) => claim.requesterUserId === 'staff-2');
      assert.ok(mine.length > 0 && mine.length < found('สมศรี').length);
      const answer = await list.execute(own, { search: 'สมศรี', pageSize: 100 });
      assert.deepEqual([answer.items.map((item) => item.id).sort(), answer.total, answer.hub.counts.all], [mine.map((claim) => claim.id).sort(), mine.length, mine.length]);
    });

    it('reads a search as words: trimmed, cut at 100 characters, five words at most, and a number also as an amount', () => {
      const words = (search: string) => (hubSearchWhere(search).AND as any[]).map((part) => part.OR.map((field: any) => Object.entries(field)[0]));
      assert.deepEqual(words('  สมศรี '), [[
        ['requestNo', { contains: 'สมศรี', mode: 'insensitive' }], ['requesterDisplayNameSnapshot', { contains: 'สมศรี', mode: 'insensitive' }],
        ['reason', { contains: 'สมศรี', mode: 'insensitive' }], ['categoryLabelSnapshot', { contains: 'สมศรี', mode: 'insensitive' }],
      ]]);
      // A number is looked for in the text columns too (a claim number), and as the claim's amount, thousands separator or not.
      assert.deepEqual(words('1,500.50')[0]!.at(-1), ['amount', '1500.50']);
      assert.equal(words('1500')[0]!.length, 5);
      for (const notAnAmount of ['1.2.3', '-5', '1e3', '12345678901234', 'RB-1']) assert.equal(words(notAnAmount)[0]!.length, 4, notAnAmount);
      assert.equal(words('a b c d e f g').length, 5);
      assert.deepEqual(hubSearchWhere('   '), { AND: [] });
    });

    it('hands the database one trimmed search of at most 100 characters, and none for a blank one', async () => {
      const asked: any[] = [];
      const repo = { listRequestPage: async (where: any) => { asked.push(where.search); return { rows: [], groups: [] }; }, findPolicy: async () => null,
        findPendingApprovalSteps: async () => [], getUserDisplayNames: async () => ({}) };
      const list = new ListReimbursementsUseCase(repo as any);
      for (const search of ['  แท็กซี่  ', 'ก'.repeat(150), '', '   ', undefined]) await list.execute(reader, { search });
      assert.deepEqual(asked, ['แท็กซี่', 'ก'.repeat(100), undefined, undefined, undefined]);
    });
  });

  // Review 2026-10-01: `bucket` went from the query string to the counts unread.
  it('refuses a bucket it does not have with 400, before reading anything', async () => {
    const { list, reads } = database();
    // Before: `all` answered no rows under the whole scope's total, `constructor` answered a total that is a function
    // (dropped from the JSON), and any other name an empty list that said nothing was wrong.
    for (const bucket of ['all', 'constructor', 'toString', '__proto__', 'archived', 'DRAFT', ' draft', '']) {
      await assert.rejects(() => list.execute(reader, { bucket: bucket as any }),
        (error: any) => error.getStatus() === 400 && error.message === 'reimbursement_list_bucket_invalid', JSON.stringify(bucket));
    }
    assert.deepEqual(reads, []);
    // Every bucket the hub has is taken, and so is no bucket at all; the total is always a number.
    for (const bucket of [...BUCKETS, undefined]) {
      const answer = await list.execute(reader, { bucket, pageSize: 1 });
      assert.equal(typeof answer.total, 'number', String(bucket));
      assert.equal(answer.total, answer.hub.counts[bucket ?? 'all'], String(bucket));
    }
    // A caller with no read right is refused for that, whatever bucket it names.
    await assert.rejects(() => list.execute(ctx({ permissions: [] }), { bucket: 'constructor' as any }), (error: any) => error.getStatus() === 403);
  });

  // The hub names its third tab by the company's finance step (payout spec §18.5). The policy endpoint asks for a
  // policy right, which an accountant does not hold, so the tab read "คิวการเงิน" in a company with no finance step.
  it('tells whoever lists claims whether the company has the finance-review step now, and nothing else of its policy', async () => {
    const policyRecord = (financeReviewRequired: boolean) => ({
      id: 'pol-1', companyId: 'co-1', currency: 'THB', approvalThresholdAmount: '5000.00', approvalRequiredFromAmount: '5000.00',
      approverMode: 'CUSTOM_ROLE', defaultApproverRole: 'SECRET_ROLE', defaultApproverRoles: ['SECRET_ROLE'], allowSelfApproval: true,
      requireReceipt: true, allowMissingReceiptWithReason: false, duplicatePolicy: 'WARN', financeReviewRequired, slaHours: 48, status: 'ACTIVE',
      createdByUserId: 'owner-1', createdAt: at(0), updatedAt: at(0),
    });
    const listWith = (policy: unknown) => new ListReimbursementsUseCase({
      listRequestPage: async () => ({ rows: [], groups: [] }), findPolicy: async () => policy,
      findPendingApprovalSteps: async () => [], getUserDisplayNames: async () => ({}),
    } as any);
    // An accountant: reads claims and reviews them for finance, and holds no right to the policy.
    const accountant = ctx({ roles: ['ACCOUNTANT'], permissions: ['reimbursement.read', 'reimbursement.finance_review', 'reimbursement.export'] });
    // No policy saved yet: the company default, which has no finance step.
    for (const [policy, expected] of [[policyRecord(true), true], [policyRecord(false), false], [null, false]] as const) {
      const answer = await listWith(policy).execute(accountant, { pageSize: 1 });
      assert.equal(answer.financeReviewRequired, expected);
      assert.deepEqual(Object.keys(answer).sort(), ['financeReviewRequired', 'hub', 'items', 'page', 'pageSize', 'total']);
      assert.doesNotMatch(JSON.stringify(answer), /SECRET_ROLE|5000|48|pol-1/);
    }
    // A requester lists their own claims only, and is told the same.
    assert.equal((await listWith(policyRecord(true)).execute(ctx({ permissions: ['reimbursement.read_own'] }), { scope: 'own' })).financeReviewRequired, true);
  });
});

const approverPermissions = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
const approverBranches = [{ id: 'b1', name: 'สำนักงานใหญ่' }, { id: 'b2', name: 'สาขาสอง' }];
const approverHolder = (branchIds: string[]): ApproverRoleCandidate['holders'][number] => ({
  branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: null, branchIds,
});
const approverRole = (
  overrides: Partial<ApproverRoleCandidate> & Pick<ApproverRoleCandidate, 'key' | 'name'>,
): ApproverRoleCandidate => ({
  status: 'ACTIVE', permissionKeys: approverPermissions, holders: [], ...overrides,
});

describe('reimbursement approver role options', () => {
  it('returns only executable routes as selectable and uses OWNER for safe branch recovery', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'ACCOUNTANT', name: 'Accountant', holders: [approverHolder(['b1'])] }),
      approverRole({ key: 'FINANCE', name: 'Finance', holders: [] }),
      approverRole({ key: 'STAFF', name: 'Staff', permissionKeys: ['reimbursement.read'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'SYSTEM_ADMIN', name: 'System Admin', holders: [approverHolder(['b1', 'b2'])] }),
    ], approverBranches);

    assert.equal(options.find((item) => item.key === 'MANAGER')?.coverage, 'COMPLETE');
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, true);
    assert.deepEqual(options.find((item) => item.key === 'ACCOUNTANT')?.uncoveredBranchNames, ['สาขาสอง']);
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.coverage, 'PARTIAL');
    assert.equal(options.find((item) => item.key === 'ACCOUNTANT')?.selectable, true);
    assert.equal(options.find((item) => item.key === 'FINANCE')?.unavailableReason, 'NO_ACTIVE_HOLDERS');
    assert.equal(options.find((item) => item.key === 'STAFF')?.unavailableReason, 'MISSING_CAPABILITY');
    assert.equal(options.some((item) => item.key === 'SYSTEM_ADMIN'), false);
  });

  // Payout-account spec §13.3 F2: approving never needed the pay right, so the policy screen is told which roles lack it.
  it('says whether a role can also record the payment, without changing which roles are selectable', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', permissionKeys: [...approverPermissions, 'reimbursement.payment.record'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'OLD_APPROVER', name: 'Old approver', holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'STAFF', name: 'Staff', permissionKeys: ['reimbursement.read', 'reimbursement.payment.record'], holders: [approverHolder(['b1', 'b2'])] }),
    ], approverBranches);
    assert.deepEqual(Object.fromEntries(options.map((item) => [item.key, [item.selectable, item.canRecordPayment]])),
      { OWNER: [true, true], OLD_APPROVER: [true, false], STAFF: [false, true] });
  });

  it('blocks partial coverage when OWNER cannot recover the uncovered branch', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', holders: [approverHolder(['b1'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1'])] }),
    ], approverBranches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('does not use OWNER as recovery when the role lacks approval capability', () => {
    const options = buildReimbursementApproverRoleOptions([
      approverRole({ key: 'OWNER', name: 'Owner', permissionKeys: ['reimbursement.read'], holders: [approverHolder(['b1', 'b2'])] }),
      approverRole({ key: 'MANAGER', name: 'Manager', holders: [approverHolder(['b1'])] }),
    ], approverBranches);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.selectable, false);
    assert.equal(options.find((item) => item.key === 'MANAGER')?.unavailableReason, 'OWNER_RECOVERY_NOT_READY');
  });

  it('maps the selected role to the server-owned routing mode', () => {
    assert.equal(approverModeForRole('MANAGER'), 'MANAGER_ROLE');
    assert.equal(approverModeForRole('OWNER'), 'OWNER_ROLE');
    assert.equal(approverModeForRole('ACCOUNTANT'), 'CUSTOM_ROLE');
  });
});

// Owner order 2026-09-21 ("ผู้ใช้คนเดียวที่กำหนดบทบาทเอง ต้องทำได้นะ"): a requester dropped from the
// route only as a self-approver gets the step back when nobody else could take it.
describe('submission route when the requester is the only approver', () => {
  const APPROVE = ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'];
  type Holder = { userId: string; branchScopeMode?: string; branchIds?: string[] };
  /** Just enough Prisma for routing: approve-capable roles with their holders, no entitlement rows (all on). */
  function resolver(roles: Record<string, Holder[]>, named: unknown = null, scopeKey = 'system') {
    return new ListReimbursementApproverOptionsUseCase({ client: {
      role: { findMany: async () => Object.entries(roles).map(([key, holders]) => ({
        key, name: key, scopeKey, status: 'ACTIVE',
        permissions: APPROVE.map((permission) => ({ permission: { key: permission } })),
        memberships: holders.map((holder) => ({ membership: {
          userId: holder.userId, branchScopeMode: holder.branchScopeMode ?? 'ALL_BRANCHES', defaultBranchId: null,
          branchScopes: (holder.branchIds ?? []).map((branchId) => ({ branchId })), roles: [{ role: { key, status: 'ACTIVE' } }],
        } })),
      })) },
      branch: { findMany: async () => [] },
      companyFeatureEntitlement: { findMany: async () => [] },
      companyMembership: { findFirst: async () => named },
    } } as any);
  }
  const input = { companyId: 'co-1', roleKey: 'CUSTOM_SOLO', branchId: 'branch-1', requesterUserId: 'solo-1', allowSelfApproval: false };
  const otherBranch = { branchScopeMode: 'SELECTED_BRANCHES', branchIds: ['branch-2'] };

  for (const roleKey of ['OWNER', 'ADMIN', 'MANAGER']) {
    it(`${roleKey}: routes switch-off claims to peers, switch-on claims also to self, and keeps the solo exception`, async () => {
      const peerRoles = { [roleKey]: [{ userId: 'solo-1' }, { userId: 'peer-1' }] };
      const off = await resolver(peerRoles).resolveSubmissionRoute({ ...input, roleKey });
      assert.deepEqual([off.recipientUserIds, off.soloSelfApproval], [['peer-1'], undefined]);
      const on = await resolver(peerRoles).resolveSubmissionRoute({ ...input, roleKey, allowSelfApproval: true });
      assert.deepEqual([on.recipientUserIds, on.soloSelfApproval], [['peer-1', 'solo-1'], undefined]);
      const solo = await resolver({ [roleKey]: [{ userId: 'solo-1' }] }).resolveSubmissionRoute({ ...input, roleKey });
      assert.deepEqual([solo.recipientUserIds, solo.soloSelfApproval], [['solo-1'], true]);
      const ownerFallback = await resolver({ [roleKey]: [{ userId: 'solo-1' }], OWNER: [{ userId: 'owner-1' }] })
        .resolveSubmissionRoute({ ...input, roleKey });
      assert.deepEqual(ownerFallback.recipientUserIds, ['owner-1']);
    });
    it(`${roleKey}: a named requester falls back to another approver unless the switch is on`, async () => {
      const named = { userId: 'solo-1', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [],
        roles: [{ role: { key: roleKey, permissions: APPROVE.map((key) => ({ permission: { key } })) } }] };
      const namedInput = { companyId: 'co-1', userId: 'solo-1', branchId: 'branch-1', requesterUserId: 'solo-1', allowSelfApproval: false, fallbackRole: roleKey };
      const routes = resolver({ [roleKey]: [{ userId: 'solo-1' }, { userId: 'peer-1' }] }, named);
      assert.equal(await routes.resolveNamedSubmissionRoute(namedInput), null);
      assert.deepEqual((await routes.resolveNamedSubmissionRoute({ ...namedInput, allowSelfApproval: true }))?.recipientUserIds, ['solo-1']);
      const solo = await resolver({ [roleKey]: [{ userId: 'solo-1' }] }, named).resolveNamedSubmissionRoute(namedInput);
      assert.deepEqual([solo?.recipientUserIds, solo?.soloSelfApproval], [['solo-1'], true]);
    });
  }

  it('gives the step back to a solo holder of the routed role instead of refusing the claim', async () => {
    assert.deepEqual(await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [] }).resolveSubmissionRoute(input), {
      responsibilityRole: 'CUSTOM_SOLO', effectiveTaskRole: 'CUSTOM_SOLO', recipientUserIds: ['solo-1'],
      ownerRecipientUserIds: [], ownerFallbackUsed: false, soloSelfApproval: true,
    });
    // "Anyone else eligible" covers this claim's branch: an owner elsewhere does not count.
    const ownerElsewhere = await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [{ userId: 'owner-1', ...otherBranch }] }).resolveSubmissionRoute(input);
    assert.deepEqual([ownerElsewhere.recipientUserIds, ownerElsewhere.soloSelfApproval], [['solo-1'], true]);
  });

  it('keeps the normal rule whenever someone else can approve', async () => {
    const peer = await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }, { userId: 'peer-1' }], OWNER: [] }).resolveSubmissionRoute(input);
    assert.deepEqual([peer.recipientUserIds, peer.soloSelfApproval], [['peer-1'], undefined]);
    // The OWNER fallback is still preferred when the owner is someone else and covers the branch.
    const owner = await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [{ userId: 'owner-1' }] }).resolveSubmissionRoute(input);
    assert.deepEqual([owner.recipientUserIds, owner.effectiveTaskRole, owner.ownerFallbackUsed, owner.soloSelfApproval], [['owner-1'], 'OWNER', true, undefined]);
  });

  it('drops the requester but keeps every other holder of every policy role', async () => {
    const roles = { CEO: [{ userId: 'solo-1' }, { userId: 'ceo-1' }], OWNER: [{ userId: 'owner-1' }], MANAGER: [{ userId: 'mgr-1' }] };
    const both = await resolver(roles).resolveSubmissionRoute({ ...input, roleKey: 'CEO', roleKeys: ['CEO', 'OWNER'] });
    assert.deepEqual([both.responsibilityRole, both.effectiveTaskRole, both.recipientUserIds, both.ownerFallbackUsed], ['CEO', 'CEO', ['ceo-1', 'owner-1'], false]);
    // Nobody in any listed role: the owner fallback still applies.
    const empty = await resolver({ CEO: [], MANAGER: [], OWNER: [{ userId: 'owner-1' }] }).resolveSubmissionRoute({ ...input, roleKey: 'CEO', roleKeys: ['CEO', 'MANAGER'] });
    assert.deepEqual([empty.recipientUserIds, empty.effectiveTaskRole, empty.ownerFallbackUsed], [['owner-1'], 'OWNER', true]);
  });

  it('still refuses when the requester could not approve it either', async () => {
    // Not a holder of the routed role (the default MANAGER route, their own role elsewhere)…
    await assert.rejects(() => resolver({ MANAGER: [], OWNER: [] }).resolveSubmissionRoute({ ...input, roleKey: 'MANAGER' }), /reimbursement_approver_not_ready/);
    // …or a holder who does not cover the claim's branch.
    await assert.rejects(() => resolver({ CUSTOM_SOLO: [{ userId: 'solo-1', ...otherBranch }], OWNER: [] }).resolveSubmissionRoute(input), /reimbursement_approver_not_ready/);
  });

  it('does not offer a shop the Mangmee sales roles as approvers, and still lists them inside the platform company (RB-34)', async () => {
    // The picker ran its own role query, so the two platform-only system roles stayed in a shop's
    // approver list after the role list and the employee form had stopped showing them.
    const roles = { MANAGER: [{ userId: 'mgr-1' }], MANGMEE_SALES_LEAD: [{ userId: 'lead-1' }], MANGMEE_SALES: [] };
    assert.deepEqual((await resolver(roles).load('co-1')).map((option) => option.key), ['MANAGER']);
    assert.deepEqual((await resolver(roles).load(PLATFORM_TENANT_ID)).map((option) => option.key).sort(), ['MANAGER', 'MANGMEE_SALES', 'MANGMEE_SALES_LEAD']);
    // Not offered also means not routable: a shop policy cannot send a claim to a platform-only role.
    await assert.rejects(() => resolver(roles).resolveSubmissionRoute({ ...input, roleKey: 'MANGMEE_SALES_LEAD' }), /approver_role_not_eligible/);
  });

  it('does not offer a shop its own copy of a platform-only role either (RB-34)', async () => {
    // Editing a system role by id forked it into a company role with the same key. That copy is
    // scoped to the shop, and the filter above dropped only the system row.
    const roles = { MANAGER: [{ userId: 'mgr-1' }], MANGMEE_SALES_LEAD: [{ userId: 'lead-1' }], MANGMEE_SALES: [{ userId: 'sales-1' }] };
    assert.deepEqual((await resolver(roles, null, 'co-1').load('co-1')).map((option) => option.key), ['MANAGER']);
    await assert.rejects(() => resolver(roles, null, 'co-1').resolveSubmissionRoute({ ...input, roleKey: 'MANGMEE_SALES' }), /approver_role_not_eligible/);
    // The platform company's own override of one is an ordinary role there.
    assert.deepEqual((await resolver(roles, null, PLATFORM_TENANT_ID).load(PLATFORM_TENANT_ID)).map((option) => option.key).sort(), ['MANAGER', 'MANGMEE_SALES', 'MANGMEE_SALES_LEAD']);
  });

  it('is decided at submit only: a background re-read never routes a claim to its requester', async () => {
    const { companyId, ...routeInput } = input;
    assert.deepEqual(await resolver({ CUSTOM_SOLO: [{ userId: 'solo-1' }], OWNER: [] }).resolveSubmissionRoutesBestEffort(companyId, [routeInput]), [null]);
  });

  it('gives a named approver who filed the claim the step only when nobody else could take it', async () => {
    const named = { userId: 'solo-1', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [],
      roles: [{ role: { key: 'CUSTOM_SOLO', permissions: APPROVE.map((key) => ({ permission: { key } })) } }] };
    const namedInput = { companyId: 'co-1', userId: 'solo-1', branchId: 'branch-1', requesterUserId: 'solo-1', allowSelfApproval: false, fallbackRole: 'MANAGER' };
    assert.deepEqual(await resolver({ MANAGER: [], OWNER: [] }, named).resolveNamedSubmissionRoute(namedInput), {
      responsibilityRole: 'MANAGER', effectiveTaskRole: 'MANAGER', recipientUserIds: ['solo-1'],
      ownerRecipientUserIds: [], ownerFallbackUsed: false, soloSelfApproval: true,
    });
    // An owner can take it: the named route steps aside and the caller's role route picks the owner.
    assert.equal(await resolver({ MANAGER: [], OWNER: [{ userId: 'owner-1' }] }, named).resolveNamedSubmissionRoute(namedInput), null);
  });
});

describe('reimbursement policy role save', () => {
  const policyCtx = {
    companyId: 'co-1', userId: 'user-1', requestId: 'req-1',
    permissions: ['reimbursement.policy.manage'],
  } as any;
  const option = {
    key: 'ACCOUNTANT', name: 'Accountant', optionLabel: 'Accountant',
    eligibleApproverCount: 1, coverage: 'COMPLETE' as const, uncoveredBranchNames: [], selectable: true,
  };
  const policy = (data: Record<string, unknown>) => ({
    id: 'policy-1', companyId: 'co-1', currency: 'THB', approvalThresholdAmount: '1.00',
    approvalRequiredFromAmount: '1.00', approverMode: 'CUSTOM_ROLE', defaultApproverRole: 'ACCOUNTANT',
    allowSelfApproval: false, requireReceipt: true, allowMissingReceiptWithReason: false,
    duplicatePolicy: 'WARN', financeReviewRequired: true, status: 'ACTIVE', createdByUserId: 'user-1',
    createdAt: new Date('2026-08-21T00:00:00.000Z'), updatedAt: new Date('2026-08-21T00:00:00.000Z'),
    ...data,
  });

  it('lets policy managers read the form they are allowed to save', async () => {
    const useCase = new GetReimbursementPolicyUseCase({ findPolicy: async () => policy({}) } as any);
    const result = await useCase.execute(policyCtx);
    assert.equal(result.id, 'policy-1');
  });

  it('revalidates and canonicalizes an explicit role edit before writing', async () => {
    let written: Record<string, unknown> | undefined;
    const repo = {
      findPolicy: async () => null,
      upsertPolicy: async (_companyId: string, _branchId: null, data: Record<string, unknown>) => {
        written = data;
        return policy(data);
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any, { log: async () => undefined } as any,
      { load: async () => [option, { ...option, key: 'OWNER', name: 'Owner', optionLabel: 'Owner' }] } as any,
    );

    await useCase.execute(policyCtx, { defaultApproverRoles: [' ACCOUNTANT ', 'OWNER', 'ACCOUNTANT'] });
    assert.deepEqual(written, {
      defaultApproverRoles: ['ACCOUNTANT', 'OWNER'], defaultApproverRole: 'ACCOUNTANT',
      approverMode: 'CUSTOM_ROLE', defaultApproverUserId: null,
    });
  });

  it('rejects a stale or ineligible role without writing the policy', async () => {
    let wrote = false;
    const useCase = new UpdateReimbursementPolicyUseCase(
      { findPolicy: async () => null, upsertPolicy: async () => { wrote = true; return policy({}); } } as any,
      { log: async () => undefined } as any,
      { load: async () => [{ ...option, selectable: false }, { ...option, key: 'OWNER' }] } as any,
    );

    // One unready role is enough to refuse the whole list.
    await assert.rejects(useCase.execute(policyCtx, { defaultApproverRoles: ['OWNER', 'ACCOUNTANT'] }), /approver_role_not_eligible/);
    assert.equal(wrote, false);
  });

  it('persists audit and policy-updated outbox facts in the policy transaction', async () => {
    const outboxRows: any[] = [];
    const audits: any[] = [];
    const saved = policy({});
    const repo = {
      findPolicy: async () => null,
      upsertPolicy: async (
        _companyId: string, _branchId: null, _data: Record<string, unknown>, _userId: string,
        _expectedUpdatedAt: Date | undefined, onPersisted: (tx: any, before: null, after: any) => Promise<void>,
      ) => {
        await onPersisted({ outboxEvent: { createMany: async ({ data }: any) => { outboxRows.push(...data); } } }, null, saved);
        return saved;
      },
    };
    const useCase = new UpdateReimbursementPolicyUseCase(
      repo as any,
      { log: async (entry: any, tx: any) => { assert.ok(tx); audits.push(entry); } } as any,
      { load: async () => [option] } as any,
    );

    await useCase.execute(policyCtx, { defaultApproverRoles: ['ACCOUNTANT'] });
    assert.equal(audits[0]?.action, 'reimbursement.policy.update');
    assert.equal(outboxRows[0]?.eventType, 'reimbursement.policy_updated');
    assert.equal(outboxRows[0]?.aggregateId, 'policy-1');
  });
});

// ---- Payout account (payout spec §8–§11, owner decisions 2026-10-01) ----
//
// The repository fake keeps the two payout tables in memory, and every read and write on them is the
// production function, so these cases exercise the real freeze, masking and reveal code.

const KBANK = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountNumber: '012-3-45678-9' };
const SCB = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'BANK_ACCOUNT' as const, bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี', accountNumber: '000123456789012' };
const PROMPTPAY = { payoutMethod: 'BANK_TRANSFER' as const, payoutKind: 'PROMPTPAY_PHONE' as const, accountName: 'นาย สมชาย ใจดี', accountNumber: '081-234-5678' };
const PAYOUT_NAMES: Record<string, string> = { 'staff-1': 'สมชาย', 'manager-1': 'วิภา', 'finance-1': 'อรทัย', 'owner-1': 'เจ้าของร้าน' };
/** Every full number a case types in, as stored and as typed. None may ever appear in a payload, an audit row or a notification. */
const FULL_NUMBERS = ['0123456789', '012-3-45678-9', '000123456789012', '0812345678', '081-234-5678'];
const leaksNumber = (value: unknown) => FULL_NUMBERS.some((number) => JSON.stringify(value ?? null).includes(number));

function payoutWorld(options: RepoOptions = {}) {
  const state = fakeRepo({ noDefaultPayout: true, ...options });
  Object.assign(state.repo, {
    getUserDisplayNames: async (_companyId: string, ids: string[]) => Object.fromEntries(ids.filter((id) => PAYOUT_NAMES[id]).map((id) => [id, PAYOUT_NAMES[id]])),
    listInternalNotes: async () => [],
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(ids),
    isUserRelatedToRequest: async () => false,
  });
  const audits: any[] = [];
  const notifications: any[] = [];
  const audit = { log: async (entry: any) => { audits.push(entry); }, logOrThrow: async (entry: any) => { audits.push(entry); } } as any;
  const payouts = payoutUseCase(state.repo, audit, notifications);
  const evidence = evidenceService();
  const submit = new SubmitReimbursementUseCase(state.repo, audit, noopOutbox, evidence, readyApproverRoutes, noopProjections);
  const detail = new GetReimbursementDetailUseCase(state.repo, evidence);
  return {
    state, audits, notifications, payouts,
    create: new CreateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    update: new UpdateReimbursementDraftUseCase(state.repo, audit, evidence, payouts),
    submit,
    detail,
    /** What the claim page does: read the claim, then send it with the token of the account that page showed. */
    send: async (context: any, id: string) => submit.execute(context, id, { payoutSubmitToken: (await detail.execute(context, id)).payout?.submitToken }),
    reopen: new ReopenRejectedReimbursementUseCase(state.repo, audit),
    reveal: new RevealClaimPayoutUseCase(state.repo, audit, { credentialEncryptionKey: PAYOUT_KEY } as any),
  };
}

const claimInput = (extra: Record<string, unknown> = {}) => ({ reason: 'ค่าเดินทาง', branchId: 'branch-1', lines: [inputLine({ attachmentId: 'att-1' })], ...extra }) as any;
const financeCtx = () => ctx({
  userId: 'finance-1', roles: ['FINANCE'],
  permissions: ['reimbursement.create', 'reimbursement.finance_review', 'reimbursement.submit', 'reimbursement.read', 'reimbursement.update_own_draft'],
});
const managerCtx = (overrides: Partial<any> = {}) => ctx({
  userId: 'manager-1', roles: ['MANAGER'], permissions: ['access.employee.read', 'access.employee.update', 'reimbursement.create'], ...overrides,
});
const EMPLOYEE = { displayName: 'สมชาย', hasEmployeeProfile: true, allBranches: false, branchIds: ['branch-1'], managesPeople: false };

describe('payout: a member sets their own default account', () => {
  it('works for every self-service role and for an owner who has no employee record', async () => {
    for (const [role, permissions] of Object.entries(ROLE_GRANTS).filter(([key]) => !PLATFORM_ROLE_KEYS.includes(key))) {
      // No employee record anywhere in this world: the account hangs off the membership alone.
      const world = payoutWorld();
      const me = ctx({ userId: `${role}-user`, roles: [role], permissions });
      const set = await world.payouts.setOwn(me, KBANK);
      assert.deepEqual(set.account && { bank: set.account.bankName, last4: set.account.accountLast4, name: set.account.accountName },
        { bank: 'ธนาคารกสิกรไทย', last4: '6789', name: 'นาย สมชาย ใจดี' }, role);
      assert.equal((await world.payouts.revealOwn(me)).accountNumber, '0123456789', role);
      assert.equal((await world.payouts.setOwn(me, { payoutMethod: 'CASH' })).account?.payoutMethod, 'CASH', role);
      assert.deepEqual(await world.payouts.deleteOwn(me), { account: null });
      assert.deepEqual(await world.payouts.getOwn(me), { account: null, canEdit: true });
    }
  });

  it('keeps every digit: leading zeros, 6 to 20 digits, and a PromptPay mobile number', async () => {
    const world = payoutWorld();
    for (const [input, full, last4] of [[KBANK, '0123456789', '6789'], [SCB, '000123456789012', '9012'], [PROMPTPAY, '0812345678', '5678']] as const) {
      assert.equal((await world.payouts.setOwn(ctx(), input)).account?.accountLast4, last4);
      assert.equal((await world.payouts.revealOwn(ctx())).accountNumber, full);
    }
    await assert.rejects(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: '12345' }), /payout_destination_invalid/);
    await assert.rejects(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: '123456789012345678901' }), /payout_destination_invalid/);
    await assert.rejects(world.payouts.setOwn(ctx(), { ...PROMPTPAY, accountNumber: '1234567890123' }), /payout_destination_invalid/);
    await assert.rejects(world.payouts.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER' } as any), /payout_destination_required/);
    await assert.rejects(world.payouts.setOwn(ctx(), { payoutMethod: 'CHEQUE' } as any), /payout_method_required/);
    // Cash needs no account at all.
    assert.deepEqual(Object.keys((await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' })).account!).sort(), ['payoutMethod', 'updatedAt', 'userId']);
  });

  it('is one account per company, and no payload or audit row ever carries the number', async () => {
    const world = payoutWorld();
    const here = ctx();
    const elsewhere = ctx({ companyId: 'co-2' });
    const answers = [await world.payouts.setOwn(here, KBANK), await world.payouts.setOwn(elsewhere, SCB), await world.payouts.getOwn(here)];
    assert.equal((await world.payouts.getOwn(here)).account?.accountLast4, '6789');
    assert.equal((await world.payouts.getOwn(elsewhere)).account?.accountLast4, '9012');
    assert.equal((await world.payouts.revealOwn(elsewhere)).accountNumber, '000123456789012');
    assert.equal(leaksNumber(answers), false);
    assert.equal(leaksNumber(world.audits), false);
    assert.ok(answers.every((answer) => !('accountNumber' in (answer.account ?? {})) && !('accountNumberEncrypted' in (answer.account ?? {}))));
    // Every change and every reveal is on record, with the last 4 before and after.
    assert.deepEqual(world.audits.map((row) => row.action), [
      'reimbursement.payout_account.set', 'reimbursement.payout_account.set', 'reimbursement.payout_account.reveal',
    ]);
    assert.deepEqual(world.audits[0].metadataJson, {
      accountUserId: 'staff-1', byOwner: true, before: null,
      after: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountLast4: '6789', version: 1 },
    });
  });

  it('refuses a member who may not file claims, and a reveal with nothing set', async () => {
    const world = payoutWorld();
    const noClaims = ctx({ permissions: ['reimbursement.read_own'] });
    for (const call of [() => world.payouts.getOwn(noClaims), () => world.payouts.setOwn(noClaims, KBANK), () => world.payouts.deleteOwn(noClaims), () => world.payouts.revealOwn(noClaims)]) {
      await assert.rejects(call, /Missing permission: reimbursement.create/);
    }
    await assert.rejects(world.payouts.revealOwn(ctx()), /payout_account_not_set/);
    assert.equal(world.state.payoutTables.accounts.length, 0);
  });
});

describe('payout: someone else sets a member account (owner decision 2026-10-01)', () => {
  it('lets an employee-data editor set a subordinate account, records it and tells the account owner', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const answer = await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    // The editor typed the full number once; what comes back is the last 4, like for everyone else.
    assert.equal(answer.account?.accountLast4, '6789');
    assert.equal(answer.account?.setByOtherName, 'วิภา');
    assert.equal(leaksNumber(answer), false);

    assert.equal(world.audits.length, 1);
    assert.deepEqual([world.audits[0].action, world.audits[0].riskLevel, world.audits[0].actorUserId, world.audits[0].metadataJson.byOwner], [
      'reimbursement.payout_account.set', 'HIGH', 'manager-1', false,
    ]);
    assert.equal(leaksNumber(world.audits), false);

    // The owner's condition: the account owner is told who, when and which account, last 4 only.
    assert.equal(world.notifications.length, 1);
    const notice = world.notifications[0];
    assert.deepEqual(notice.recipientUserIds, ['staff-1']);
    assert.equal(notice.title, 'วิภา ตั้งบัญชีรับเงินคืนของคุณ');
    assert.match(notice.body, /^ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 ตั้งเมื่อ .+ ถ้าไม่ใช่บัญชีของคุณ เปิดดูแล้วแก้ได้ทันที$/);
    assert.equal(notice.deepLinkHref, '/companies/co-1/reimbursements/payout-account');
    assert.equal(notice.triggerKey, 'reimbursement.payout_account_set_by_other');
    // Where a person's money goes: not held back by quiet hours, and a failed push is recorded.
    assert.equal(notice.severity, 'critical');
    assert.equal(leaksNumber(notice), false);

    // The account owner sees who set it until they save it themselves; the editor still cannot read the number.
    assert.equal((await world.payouts.getOwn(ctx())).account?.setByOtherName, 'วิภา');
    assert.equal((await world.payouts.getForMember(managerCtx(), 'staff-1')).account?.accountLast4, '6789');
    assert.equal(typeof (world.payouts as any).revealForMember, 'undefined', 'there is no way to reveal someone else default account');
    await assert.rejects(world.payouts.revealOwn(managerCtx()), /payout_account_not_set/, "the editor's own reveal reads the editor's own account");
    assert.equal((await world.payouts.revealOwn(ctx())).accountNumber, '0123456789');
  });

  it('notifies again on every later change by someone else, including a switch to cash', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    await world.payouts.setForMember(managerCtx(), 'staff-1', PROMPTPAY);
    await world.payouts.setForMember(managerCtx(), 'staff-1', { payoutMethod: 'CASH' });
    assert.equal(world.notifications.length, 3);
    // One notification per change: the dedup period is the change itself (its version and its moment).
    assert.deepEqual(world.notifications.map((notice) => notice.periodKey.split(':')[0]), ['v1', 'v2', 'v3']);
    assert.equal(new Set(world.notifications.map((notice) => notice.periodKey)).size, 3);
    assert.match(world.notifications[1].body, /^พร้อมเพย์เบอร์ลงท้าย 5678 ตั้งเมื่อ /);
    assert.match(world.notifications[2].body, /^ตั้งให้คุณรับเงินคืนเป็นเงินสด เมื่อ .+ ถ้าไม่ถูกต้อง เปิดดูแล้วแก้ได้ทันที$/);
    assert.equal(leaksNumber(world.notifications), false);
  });

  // The version starts again at 1 after the member deletes the account. A period made of the version
  // alone would fold the second notice into the first, and the member would not be told.
  it('tells the member again when someone sets the account after the member deleted it', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    await world.payouts.deleteOwn(ctx());
    await world.payouts.setForMember(managerCtx(), 'staff-1', SCB);
    assert.deepEqual(world.notifications.map((notice) => notice.periodKey.split(':')[0]), ['v1', 'v1']);
    assert.notEqual(world.notifications[0].periodKey, world.notifications[1].periodKey);
    assert.match(world.notifications[1].body, /^ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012 ตั้งเมื่อ /);
  });

  it('sends nothing when the account owner edits their own account', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE, 'manager-1': { ...EMPLOYEE, displayName: 'วิภา' } } });
    await world.payouts.setOwn(ctx(), KBANK);
    await world.payouts.setOwn(ctx(), SCB);
    // An editor saving their OWN account through the employee page is a self-edit too.
    await world.payouts.setForMember(managerCtx(), 'manager-1', KBANK);
    assert.equal(world.notifications.length, 0);
    assert.ok(world.audits.every((row) => row.metadataJson.byOwner === true && row.riskLevel === 'MEDIUM'));
    // Saving it themselves also clears "set by someone else".
    await world.payouts.setForMember(managerCtx(), 'staff-1', PROMPTPAY);
    assert.equal((await world.payouts.getOwn(ctx())).account?.setByOtherName, 'วิภา');
    await world.payouts.setOwn(ctx(), KBANK);
    assert.equal((await world.payouts.getOwn(ctx())).account?.setByOtherName, undefined);
  });

  // Security review M1: the notice is the owner's condition for letting anyone else set an account,
  // and the notification writer makes recipients of ACTIVE members only. A draft, invited, suspended
  // or disabled member would never be told, so nobody sets their account for them: not a manager,
  // not an admin, not the owner.
  it('refuses a member who is not active, whoever asks, and tells an active member', async () => {
    const editRights = ['access.employee.read', 'access.employee.update', 'reimbursement.create'];
    const editors = [managerCtx(), ctx({ userId: 'admin-1', roles: ['ADMIN'], permissions: editRights }), ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: editRights })];
    for (const membershipStatus of ['DRAFT', 'INVITED', 'SUSPENDED', 'DISABLED']) {
      for (const editor of editors) {
        const label = `${editor.roles[0]} → ${membershipStatus}`;
        const world = payoutWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus } } });
        assert.equal((await world.payouts.getForMember(editor, 'staff-1')).canEdit, false, `${label}: no button`);
        await assert.rejects(world.payouts.setForMember(editor, 'staff-1', KBANK), (error: any) => {
          assert.equal(error.getStatus(), 409, label);
          assert.match(error.message, /^payout_account_member_not_active$/, label);
          return true;
        }, label);
        // The same through "save as the requester's default" on a claim filed for them.
        const preparer = ctx({ ...editor, permissions: [...editRights, 'reimbursement.finance_review', 'reimbursement.update_own_draft'] });
        await assert.rejects(world.create.execute(preparer, claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } })), /^ConflictException: payout_account_member_not_active$/, label);
        // Each attempt is on record with its reason; nothing was written and no notice went into the void.
        assert.deepEqual(world.audits.map((row) => [row.action, row.result, row.metadataJson.reason]),
          Array(2).fill(['reimbursement.payout_account.set', 'DENIED', 'target_not_active']), label);
        assert.deepEqual([world.state.payoutTables.accounts.length, world.notifications.length], [0, 0], label);
      }
    }
    // The same member once active: the account is set, and they are the one and only person told.
    for (const editor of editors) {
      const world = payoutWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus: 'ACTIVE' } } });
      assert.equal((await world.payouts.getForMember(editor, 'staff-1')).canEdit, true);
      assert.equal((await world.payouts.setForMember(editor, 'staff-1', KBANK)).account?.accountLast4, '6789');
      assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds), [['staff-1']]);
    }
  });

  it('refuses another company, an owner with no employee record, another branch, and a company without reimbursements', async () => {
    const world = payoutWorld({ payoutMembers: {
      'staff-1': EMPLOYEE,
      'owner-1': { displayName: 'เจ้าของร้าน', hasEmployeeProfile: false, allBranches: true, branchIds: [], managesPeople: true },
      'staff-b2': { ...EMPLOYEE, branchIds: ['branch-2'] },
      'staff-both': { ...EMPLOYEE, branchIds: ['branch-1', 'branch-2'] },
      'admin-1': { ...EMPLOYEE, allBranches: true, branchIds: [] },
    } });
    const branchManager = managerCtx({ scopes: { branchIds: ['branch-1'] } });

    // A user id from another company is simply not a member here.
    await assert.rejects(world.payouts.setForMember(managerCtx(), 'user-of-another-company', KBANK), /payout_member_not_found/);
    await assert.rejects(world.payouts.getForMember(managerCtx(), 'user-of-another-company'), /payout_member_not_found/);
    // A business owner has no employee record: only they set their own.
    await assert.rejects(world.payouts.setForMember(managerCtx(), 'owner-1', KBANK), /payout_member_not_found/);
    // A branch-limited editor: only members wholly inside the editor's branches.
    assert.equal((await world.payouts.setForMember(branchManager, 'staff-1', KBANK)).account?.accountLast4, '6789');
    for (const outside of ['staff-b2', 'staff-both', 'admin-1']) {
      await assert.rejects(world.payouts.setForMember(branchManager, outside, KBANK), /payout_account_edit_denied/, outside);
    }
    assert.equal(world.audits.filter((row) => row.result === 'DENIED' && row.metadataJson.reason === 'outside_editor_branch_scope').length, 3);
    // An editor with every branch is not limited.
    assert.equal((await world.payouts.setForMember(managerCtx(), 'staff-b2', SCB)).account?.accountLast4, '9012');
    // No right to edit employee data, or the company does not use reimbursements.
    await assert.rejects(world.payouts.setForMember(managerCtx({ permissions: ['access.employee.read'] }), 'staff-1', KBANK), /payout_account_edit_denied/);
    await assert.rejects(world.payouts.setForMember(managerCtx({ entitlementDeniedPermissions: { 'reimbursement.create': 'reimbursements' } }), 'staff-1', KBANK), /payout_account_edit_denied/);
    await assert.rejects(world.payouts.getForMember(ctx(), 'staff-1'), /Missing permission: access.employee.read/);
    // Nothing refused left a row or a notification behind.
    assert.deepEqual(world.state.payoutTables.accounts.map((row) => row.userId).sort(), ['staff-1', 'staff-b2']);
    assert.equal(world.notifications.length, 2);
  });
});

// Owner direction 2026-10-01 (security): the employee-edit right reaches the whole company, so on its
// own it would let a manager point a peer's, an admin's or another branch's reimbursements at any
// account. Whose account an editor may set is its own rule.
describe('payout: whose account an editor may set (payment-redirection guard)', () => {
  const members = {
    'staff-1': EMPLOYEE,
    'staff-b2': { ...EMPLOYEE, displayName: 'พนักงานสาขาสอง', branchIds: ['branch-2'] },
    'finance-1': { ...EMPLOYEE, displayName: 'อรทัย', allBranches: true, branchIds: [] },
    'manager-2': { ...EMPLOYEE, displayName: 'ผู้จัดการอีกคน', managesPeople: true },
    'hr-1': { ...EMPLOYEE, displayName: 'ฝ่ายบุคคล', managesPeople: true, allBranches: true, branchIds: [] },
    'admin-1': { ...EMPLOYEE, displayName: 'ผู้ดูแลบริษัท', managesPeople: true, allBranches: true, branchIds: [] },
    'owner-1': { displayName: 'เจ้าของร้าน', hasEmployeeProfile: false, managesPeople: true, allBranches: true, branchIds: [] },
  };
  const editRights = ['access.employee.read', 'access.employee.update', 'reimbursement.create'];
  const editors = {
    owner: ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: editRights }),
    admin: ctx({ userId: 'admin-1', roles: ['ADMIN'], permissions: editRights }),
    manager: ctx({ userId: 'manager-1', roles: ['MANAGER'], permissions: editRights }),
    branchManager: ctx({ userId: 'manager-1', roles: ['MANAGER'], permissions: editRights, scopes: { branchIds: ['branch-1'] } }),
    hr: ctx({ userId: 'hr-1', roles: ['HR'], permissions: editRights }),
    customRole: ctx({ userId: 'custom-1', roles: ['SHIFT_LEAD'], permissions: editRights, scopes: { branchIds: ['branch-1'] } }),
  };

  it('lets an owner or an admin set any employee account, and tells the account owner each time', async () => {
    for (const editor of [editors.owner, editors.admin]) {
      const world = payoutWorld({ payoutMembers: members });
      for (const target of ['staff-1', 'staff-b2', 'finance-1', 'manager-2', 'hr-1'].filter((id) => id !== editor.userId)) {
        assert.equal((await world.payouts.getForMember(editor, target)).canEdit, true, `${editor.roles[0]} → ${target}`);
        assert.equal((await world.payouts.setForMember(editor, target, KBANK)).account?.accountLast4, '6789', `${editor.roles[0]} → ${target}`);
      }
      // Nobody but the member sets the member's own account without the notice: one per change, to that member.
      assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds[0]), ['staff-1', 'staff-b2', 'finance-1', 'manager-2', 'hr-1']);
      assert.equal(world.audits.filter((row) => row.result === 'DENIED').length, 0);
    }
    // The business owner has no employee record: not even an admin sets the owner's account.
    const world = payoutWorld({ payoutMembers: members });
    await assert.rejects(world.payouts.setForMember(editors.admin, 'owner-1', KBANK), /payout_member_not_found/);
  });

  it('holds everyone else to their own people: no peer, no superior, no other branch', async () => {
    const refusals: Array<[keyof typeof editors, string, string]> = [
      // A manager and a peer manager, the admin, and HR (who edit employee data themselves).
      ['manager', 'manager-2', 'target_manages_people'], ['manager', 'admin-1', 'target_manages_people'], ['manager', 'hr-1', 'target_manages_people'],
      // HR and a custom role with the employee-edit right are held to the same rule.
      ['hr', 'manager-2', 'target_manages_people'], ['hr', 'admin-1', 'target_manages_people'], ['customRole', 'manager-2', 'target_manages_people'],
      // A branch-limited editor: another branch, and a member who works across every branch.
      ['branchManager', 'staff-b2', 'outside_editor_branch_scope'], ['branchManager', 'finance-1', 'outside_editor_branch_scope'],
      ['customRole', 'staff-b2', 'outside_editor_branch_scope'],
      // The peer rule comes first: a peer in the editor's own branch is still a peer.
      ['branchManager', 'manager-2', 'target_manages_people'],
    ];
    for (const [editor, target, reason] of refusals) {
      const world = payoutWorld({ payoutMembers: members });
      assert.equal((await world.payouts.getForMember(editors[editor], target)).canEdit, false, `${editor} → ${target}: no button`);
      await assert.rejects(world.payouts.setForMember(editors[editor], target, KBANK), (error: any) => {
        assert.equal(error.getStatus(), 403);
        assert.match(error.message, /payout_account_edit_denied/);
        return true;
      }, `${editor} → ${target}`);
      // The attempt is on record with its reason; nothing was written and nobody was notified.
      assert.deepEqual(world.audits.map((row) => [row.action, row.result, row.riskLevel, row.actorUserId, row.targetId, row.metadataJson.reason]),
        [['reimbursement.payout_account.set', 'DENIED', 'HIGH', editors[editor].userId, target, reason]], `${editor} → ${target}`);
      assert.deepEqual([world.state.payoutTables.accounts.length, world.notifications.length], [0, 0]);
      // The same refusal through "save as the requester's default" on a claim filed on their behalf.
      const preparer = ctx({ ...editors[editor], permissions: [...editRights, 'reimbursement.finance_review', 'reimbursement.update_own_draft'] });
      await assert.rejects(world.create.execute(preparer, claimInput({ requesterUserId: target, lines: [inputLine()], payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } })), /payout_account_edit_denied/);
      assert.equal(world.state.payoutTables.accounts.length, 0);
    }
  });

  it('lets a manager, HR and a custom role set the account of their own people', async () => {
    for (const [editor, targets] of [['manager', ['staff-1', 'staff-b2', 'finance-1']], ['branchManager', ['staff-1']], ['hr', ['staff-1', 'staff-b2', 'finance-1']], ['customRole', ['staff-1']]] as const) {
      const world = payoutWorld({ payoutMembers: members });
      for (const target of targets) {
        assert.equal((await world.payouts.getForMember(editors[editor], target)).canEdit, true, `${editor} → ${target}`);
        assert.equal((await world.payouts.setForMember(editors[editor], target, KBANK)).canEdit, true, `${editor} → ${target}`);
      }
      assert.equal(world.notifications.length, targets.length);
    }
  });

  // Security review S6: "owner or admin" was read off the role KEY. A role a company makes takes its
  // key from its name, so a custom role named "Admin" (or "Owner") carried the key and with it the
  // right to set anyone's account. The role has to be the system's own.
  it('holds a custom role named Admin or Owner to the rule for everyone else', async () => {
    assert.deepEqual([roleKeyFromName('Admin'), roleKeyFromName('admin'), roleKeyFromName('Owner')], ['ADMIN', 'ADMIN', 'OWNER']);
    for (const key of ['ADMIN', 'OWNER']) {
      const custom = ctx({ userId: 'custom-1', roles: [key], permissions: editRights });
      const world = payoutWorld({ payoutMembers: members, companyRoleUsers: ['custom-1'] });
      // No peer, no superior: exactly like a manager.
      for (const target of ['manager-2', 'hr-1', 'admin-1']) {
        assert.equal((await world.payouts.getForMember(custom, target)).canEdit, false, `${key} → ${target}: no button`);
        await assert.rejects(world.payouts.setForMember(custom, target, KBANK), /payout_account_edit_denied/, `${key} → ${target}`);
      }
      // And no other branch, when the role is limited to one.
      const limited = ctx({ ...custom, scopes: { branchIds: ['branch-1'] } });
      await assert.rejects(world.payouts.setForMember(limited, 'staff-b2', KBANK), /payout_account_edit_denied/);
      assert.deepEqual(world.audits.map((row) => [row.result, row.metadataJson.reason]),
        [...Array(3).fill(['DENIED', 'target_manages_people']), ['DENIED', 'outside_editor_branch_scope']], key);
      assert.deepEqual([world.state.payoutTables.accounts.length, world.notifications.length], [0, 0]);
      // Their own people remain theirs to set, with the notice.
      assert.equal((await world.payouts.setForMember(limited, 'staff-1', KBANK)).account?.accountLast4, '6789');
      assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds), [['staff-1']]);
      // The same key on the system role is the real thing.
      const real = payoutWorld({ payoutMembers: members });
      assert.equal((await real.payouts.setForMember(custom, 'manager-2', KBANK)).account?.accountLast4, '6789', key);
    }
  });

  it('asks about the system role only when the key is there, and never trusts the key alone', async () => {
    const world = payoutWorld({ payoutMembers: members });
    const asked: string[] = [];
    world.state.repo.holdsSystemOwnerOrAdminRole = async (_companyId: string, userId: string) => { asked.push(userId); return false; };
    await world.payouts.setForMember(editors.manager, 'staff-1', KBANK);
    assert.deepEqual(asked, [], 'a manager is not asked about');
    await assert.rejects(world.payouts.setForMember(editors.admin, 'manager-2', KBANK), /payout_account_edit_denied/);
    await assert.rejects(world.payouts.setForMember(editors.owner, 'manager-2', KBANK), /payout_account_edit_denied/);
    assert.deepEqual(asked, ['admin-1', 'owner-1']);
  });

  it('never needs the rule for a member own account, whichever screen it is saved from', async () => {
    const world = payoutWorld({ payoutMembers: members });
    // A manager manages people, so nobody but an owner or admin could set theirs; they still set their own.
    assert.equal((await world.payouts.setForMember(editors.manager, 'manager-1', KBANK)).account?.setByOtherName, undefined);
    assert.equal((await world.payouts.getOwn(editors.manager)).canEdit, true);
    assert.deepEqual([world.notifications.length, world.audits[0].metadataJson.byOwner], [0, true]);
  });
});

describe('payout: a draft follows the latest default until submit', () => {
  it('shows the requester default as it is now: set, edited, switched to cash, removed', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput());
    const tokens: Array<string | undefined> = [];
    /** The payout block without its token; the tokens are collected to compare below. */
    const shown = async () => {
      const { submitToken, ...payout } = (await world.detail.execute(ctx(), draft.id)).payout!;
      tokens.push(submitToken);
      return payout;
    };

    assert.deepEqual(await shown(), { followsDefault: true, notReadyReason: 'payout_method_required', canRevealAccountNumber: false });
    await world.payouts.setOwn(ctx(), KBANK);
    assert.deepEqual(await shown(), {
      followsDefault: true, payoutMethod: 'BANK_TRANSFER', source: 'DEFAULT_ACCOUNT', payoutKind: 'BANK_ACCOUNT',
      bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', canRevealAccountNumber: false,
    });
    await world.payouts.setOwn(ctx(), SCB);
    assert.equal((await shown()).accountLast4, '9012');
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    assert.deepEqual(await shown(), { followsDefault: true, payoutMethod: 'CASH', source: 'DEFAULT_ACCOUNT', canRevealAccountNumber: false });
    await world.payouts.deleteOwn(ctx());
    assert.equal((await shown()).notReadyReason, 'payout_method_required');
    // The token names what a submit would freeze: none while nothing can be sent, and a different
    // one for every account or method the page showed.
    assert.deepEqual([tokens[0], tokens[4]], [undefined, undefined]);
    for (const token of tokens.slice(1, 4)) assert.match(token!, /^[0-9a-f]{32}$/);
    assert.equal(new Set(tokens.slice(1, 4)).size, 3);
    // A draft never keeps a copy: nothing was written to the claim's own table.
    assert.equal(world.state.payoutTables.destinations.length, 0);
    assert.equal(world.state.request.payoutMethod ?? null, null);
  });

  it('names who set the default when it was not the requester', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(ctx(), claimInput());
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.enteredByName, 'วิภา');
    await world.payouts.setOwn(ctx(), KBANK);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.enteredByName, undefined);
  });

  // Security review S1: the frozen copy recorded who pressed send, so an approver was never shown
  // that the account they attest was put there by someone other than the requester.
  it('keeps who set the default on the frozen copy, and names them to the approver when it is not the requester', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const approver = ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: ['reimbursement.read', 'reimbursement.approve'] });
    await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    // The requester sends it themselves; the account was still set by the manager.
    const sent = await world.send(ctx(), draft.id);
    assert.deepEqual([sent.payout?.source, sent.payout?.enteredByUserId, sent.payout?.enteredByName], ['DEFAULT_ACCOUNT', 'manager-1', 'วิภา']);
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.source, row.createdByUserId]), [['DEFAULT_ACCOUNT', 'manager-1']]);
    const seenByApprover = (await world.detail.execute(approver, draft.id)).payout!;
    assert.deepEqual([seenByApprover.accountLast4, seenByApprover.enteredByUserId, seenByApprover.enteredByName], ['6789', 'manager-1', 'วิภา']);
    // The frozen copy keeps saying so, whatever happens to the default afterwards.
    await world.payouts.setOwn(ctx(), SCB);
    assert.equal((await world.detail.execute(approver, draft.id)).payout?.enteredByName, 'วิภา');

    // Withdrawn and sent again with the default the requester has now saved themselves: nobody else is named.
    await world.reopen.execute(ctx(), draft.id);
    const resent = await world.send(ctx(), draft.id);
    assert.deepEqual([resent.payout?.version, resent.payout?.accountLast4, resent.payout?.enteredByUserId, resent.payout?.enteredByName], [2, '9012', undefined, undefined]);
    assert.equal(world.state.payoutTables.destinations.find((row) => row.version === 2)!.createdByUserId, 'staff-1');
  });

  it('names nobody when the requester set their own default, also when someone else sends the claim for them', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }));
    const sent = await world.send(financeCtx(), draft.id);
    // The account is the requester's own entry; who pressed send is on the claim, not on the account.
    assert.deepEqual([sent.payout?.source, sent.payout?.enteredByUserId, sent.payout?.enteredByName], ['DEFAULT_ACCOUNT', undefined, undefined]);
    assert.deepEqual([world.state.payoutTables.destinations[0]!.createdByUserId, world.state.request.submittedByUserId], ['staff-1', 'finance-1']);
  });

  it('takes cash, or an account for this claim only, in place of the default', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'CASH' } }));
    const shown = async () => { const { submitToken: _token, ...payout } = (await world.detail.execute(ctx(), draft.id)).payout!; return payout; };
    assert.deepEqual(await shown(), { payoutMethod: 'CASH', canRevealAccountNumber: false });

    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    assert.deepEqual(await shown(), {
      payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี',
      accountLast4: '9012', version: 1, source: 'REQUESTER', holderType: 'SELF', canRevealAccountNumber: true,
    });
    // The default is untouched, and typing again edits the same working row instead of piling versions up.
    assert.equal((await world.payouts.getOwn(ctx())).account?.accountLast4, '6789');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...PROMPTPAY } });
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.frozenAt]), [[1, '5678', null]]);
    // Back to the default: the draft keeps no ciphertext of its own.
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'DEFAULT' } });
    assert.equal(world.state.payoutTables.destinations.length, 0);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.accountLast4, '6789');
  });

  it('refuses an account that is missing or malformed without changing the draft', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput());
    await assert.rejects(world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', payoutKind: 'BANK_ACCOUNT' } as any }), /payout_destination_required/);
    await assert.rejects(world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: '12345' } }), /payout_destination_invalid/);
    await assert.rejects(world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, accountName: '123456' } })), /payout_destination_invalid/);
    assert.equal(world.state.payoutTables.destinations.length, 0);
  });

  it('saves a typed account as the default and lets the claim follow it', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } }));
    assert.equal((await world.payouts.getOwn(ctx())).account?.accountLast4, '6789');
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.followsDefault, true);
    assert.equal(world.state.payoutTables.destinations.length, 0);
    assert.equal(world.notifications.length, 0, 'their own account, so nobody is notified');
    // The next claim needs no typing.
    const submitted = await world.send(ctx(), draft.id);
    assert.deepEqual([submitted.payout?.payoutMethod, submitted.payout?.accountLast4, submitted.payout?.source], ['BANK_TRANSFER', '6789', 'DEFAULT_ACCOUNT']);
  });
});

describe('payout: submit gate and the claim own snapshot', () => {
  it('refuses a claim with no receiving method and takes cash without an account', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput());
    await assert.rejects(world.send(ctx(), draft.id), /payout_method_required/);
    assert.equal(world.state.request.status, 'DRAFT');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'CASH' } });
    const submitted = await world.send(ctx(), draft.id);
    assert.deepEqual(submitted.payout, { payoutMethod: 'CASH' });
    assert.equal(submitted.payoutMethod, 'CASH');
    assert.equal(world.state.payoutTables.destinations.length, 0);
  });

  it('freezes its own copy at submit: later changes to the default never reach the claim', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const submitted = await world.send(ctx(), draft.id);
    const frozen = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 1, source: 'DEFAULT_ACCOUNT' };
    assert.deepEqual(submitted.payout, frozen);
    assert.equal(leaksNumber(submitted), false);
    const request = world.state.request;
    const stored = { method: request.payoutMethod, version: request.payoutDestinationVersion, fingerprint: request.payoutFingerprint, hash: request.approvalSnapshotHash };
    // The approval hash covers exactly this snapshot.
    assert.equal(stored.hash, computeSnapshotHash({
      amount: request.amount, currency: request.currency, categoryKey: request.categoryKey, incurredDate: request.incurredDate.toISOString(),
      reason: request.reason, primaryAttachmentId: request.primaryAttachmentId, lines: request.lines,
      approvalPolicySnapshotJson: request.approvalPolicySnapshotJson,
      payoutMethod: 'BANK_TRANSFER', payoutDestinationVersion: 1, payoutFingerprint: world.state.payoutTables.destinations[0]!.fingerprint,
    }));

    // The member now edits the default twice and finally removes it.
    // The requester is told that the default is no longer this account (a removed default is not another account).
    for (const [change, told] of [[() => world.payouts.setOwn(ctx(), SCB), true], [() => world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' as const }), true], [() => world.payouts.deleteOwn(ctx()), false]] as const) {
      await change();
      const now = await world.detail.execute(ctx(), draft.id);
      assert.deepEqual(now.payout, { ...frozen, canRevealAccountNumber: true, ...(told && { defaultAccountChanged: true }) }, 'display');
      assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0123456789', 'reveal');
      assert.deepEqual({ method: world.state.request.payoutMethod, version: world.state.request.payoutDestinationVersion, fingerprint: world.state.request.payoutFingerprint, hash: world.state.request.approvalSnapshotHash }, stored, 'attestation target and hash');
    }
    assert.equal(world.state.payoutTables.destinations.length, 1);
    // The frozen copy itself cannot be rewritten, whatever code tries.
    await assert.rejects(
      world.state.payoutTables.client.reimbursementPayoutDestination.updateMany({ where: { reimbursementRequestId: draft.id }, data: { accountLast4: '0000' } }),
      /reimbursement_payout_destination_frozen/,
    );
  });

  it('refuses the submit when the default changed after it was read, instead of freezing an account nobody hashed', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const submitAtomic = world.state.repo.submitDraftAtomic;
    // The member saves a different default between the use case reading it and the transaction.
    world.state.repo.submitDraftAtomic = async (data: any) => { await world.payouts.setOwn(ctx(), SCB); return submitAtomic(data); };
    await assert.rejects(world.send(ctx(), draft.id), /payout_destination_changed/);
    assert.equal(world.state.payoutTables.destinations.length, 0);
    world.state.repo.submitDraftAtomic = submitAtomic;
    assert.equal((await world.send(ctx(), draft.id)).payout?.accountLast4, '9012');
  });

  it('sent again after a withdraw: an unchanged account keeps its version, a changed default gets the next', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    await world.reopen.execute(ctx(), draft.id);
    // Back in draft it follows the default again, so it shows whatever the default is now.
    assert.equal(world.state.request.payoutMethod, null);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.followsDefault, true);
    assert.equal((await world.send(ctx(), draft.id)).payout?.version, 1);

    await world.reopen.execute(ctx(), draft.id);
    await world.payouts.setOwn(ctx(), SCB);
    const resent = await world.send(ctx(), draft.id);
    assert.deepEqual([resent.payout?.version, resent.payout?.accountLast4], [2, '9012']);
    // Version 1 stays as history, untouched.
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4]).sort(), [[1, '6789'], [2, '9012']]);
  });

  it('an account named for the claim survives a withdraw, and a new one becomes the next version', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK } }));
    await world.send(ctx(), draft.id);
    await world.reopen.execute(ctx(), draft.id);
    assert.deepEqual([world.state.request.payoutMethod, world.state.request.payoutDestinationVersion], ['BANK_TRANSFER', 1]);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.accountLast4, '6789');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    const resent = await world.send(ctx(), draft.id);
    assert.deepEqual([resent.payout?.version, resent.payout?.accountLast4], [2, '9012']);
    assert.equal(world.state.payoutTables.destinations.every((row) => row.frozenAt), true);
  });

  it('records which snapshot was frozen in the submit audit, without any account detail', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    const submit = world.audits.find((row) => row.action === 'reimbursement.request.submit');
    assert.deepEqual(submit.metadataJson.payout, { method: 'BANK_TRANSFER', version: 1, followsDefault: true });
    assert.equal(leaksNumber(world.audits), false);
    assert.equal(leaksNumber(world.state.calls.outbox), false);
    assert.ok(world.state.calls.outbox.every((event: any) => !/payout|account/i.test(JSON.stringify(event.payloadJson.data))), 'no event payload carries account data');
  });

  // Where the payout lanes meet in one submit: a claim nobody has to approve, paid into the requester's
  // default account. The account is frozen and hashed in the submit transaction, and that same submit
  // still hands the payment to the people who would have approved it (owner rule 2026-10-01).
  it('freezes the account and names the would-be approvers when a claim that needs no approval is sent', async () => {
    const world = payoutWorld({ policy: {
      id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), currency: 'THB', approvalRequiredFromAmount: '1000.00',
      approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
      financeReviewRequired: false, status: 'ACTIVE', requireReceipt: false, allowMissingReceiptWithReason: false,
    } });
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const eventTypes = () => world.state.calls.outbox.map((event: any) => event.eventType);
    readyApproverRoutes.resolveWouldBeApproverUserIds = async () => ['approver-1', 'approver-2'];
    try {
      // Sent without the account its page showed: refused inside the transaction, so no event of the submit exists.
      await assert.rejects(world.submit.execute(ctx(), draft.id), /payout_destination_changed/);
      assert.deepEqual([world.state.request.status, eventTypes()], ['DRAFT', []]);

      const sent = await world.send(ctx(), draft.id);
      const request = world.state.request;
      assert.deepEqual([sent.status, sent.payout?.accountLast4, sent.payout?.version, sent.payout?.source], ['READY_FOR_PAYMENT', '6789', 1, 'DEFAULT_ACCOUNT']);
      // The lane's side: the claim's own copy is frozen, and the stored hash is the hash of the claim with it.
      assert.equal(world.state.payoutTables.destinations[0]!.frozenAt !== null && hasPayoutSnapshot(request), true);
      assert.equal(request.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(request, request.approvalPolicySnapshotJson)));
      // The assembly's side: every event of the submit came through the transaction, and the ready-to-pay
      // event names who would have approved the claim.
      assert.deepEqual(eventTypes(), ['reimbursement.request_submitted', 'reimbursement.approval_not_required',
        'reimbursement.policy_projection_started', 'reimbursement.approved', 'reimbursement.ready_for_payment']);
      const ready = world.state.calls.outbox.find((event: any) => event.eventType === 'reimbursement.ready_for_payment').payloadJson.data;
      assert.deepEqual([ready.approverRecipientUserIds, ready.decision, ready.status], [['approver-1', 'approver-2'], 'BELOW_APPROVAL_THRESHOLD', 'READY_FOR_PAYMENT']);
      // Neither side's events, nor the audit rows, carry anything of the account.
      assert.equal(leaksNumber([world.state.calls.outbox, world.audits]), false);
      assert.ok(world.state.calls.outbox.every((event: any) => !/payout|account|6789/i.test(JSON.stringify(event.payloadJson.data))));
    } finally {
      delete readyApproverRoutes.resolveWouldBeApproverUserIds;
    }
  });
});

// Payout spec §22 row 1 (security review S7): a member who changes their default after sending a claim
// expects the claim to follow. It does not, by design; the requester is told so on the claim.
describe('payout: the requester is told when their default changed after the claim was sent', () => {
  const flag = async (world: ReturnType<typeof payoutWorld>, viewer: any, id: string) => (await world.detail.execute(viewer, id)).payout?.defaultAccountChanged;
  const approver = () => ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: ['reimbursement.read', 'reimbursement.approve'] });

  it('says so to the requester alone, from the fingerprints, and never shows a fingerprint', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }));
    assert.equal(await flag(world, ctx(), draft.id), undefined, 'a draft follows the default: nothing has changed for it');
    await world.send(ctx(), draft.id);
    assert.equal(await flag(world, ctx(), draft.id), undefined, 'the default is still the account the claim copied');
    // The same account saved again is the same account.
    await world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: '0123456789' });
    assert.equal(await flag(world, ctx(), draft.id), undefined);

    await world.payouts.setOwn(ctx(), SCB);
    assert.equal(await flag(world, ctx(), draft.id), true);
    // The claim itself still shows, and reveals, the account it was sent with.
    const shown = await world.detail.execute(ctx(), draft.id);
    assert.equal(shown.payout?.accountLast4, '6789');
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0123456789');
    // Nobody else is told: not the approver, not whoever prepared the claim.
    assert.equal(await flag(world, approver(), draft.id), undefined);
    assert.equal(await flag(world, financeCtx(), draft.id), undefined);
    // The answer is a yes or nothing; no fingerprint of either account leaves the server.
    const { accounts, destinations } = world.state.payoutTables;
    for (const fingerprint of [accounts[0]!.fingerprint, destinations[0]!.fingerprint]) assert.equal(JSON.stringify(shown).includes(fingerprint), false);
    assert.doesNotMatch(JSON.stringify(shown), /fingerprint/i);

    // Switched to cash is a change too; a removed default is not a newer account.
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    assert.equal(await flag(world, ctx(), draft.id), true);
    await world.payouts.deleteOwn(ctx());
    assert.equal(await flag(world, ctx(), draft.id), undefined);
  });

  it('follows the claim while telling can still change something, and stops once it is paid or closed', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    await world.payouts.setOwn(ctx(), SCB);
    for (const [status, told] of [
      ['PENDING_APPROVAL', true], ['APPROVED', true], ['FINANCE_REVIEW', true], ['READY_FOR_PAYMENT', true],
      ['PARTIALLY_PAID', undefined], ['PAID', undefined], ['REJECTED', undefined], ['CANCELLED', undefined], ['VOIDED', undefined],
    ] as const) {
      world.state.request.status = status;
      assert.equal(await flag(world, ctx(), draft.id), told, status);
    }
    // Taken back and sent again, the claim copies the default as it is now: nothing left to say.
    world.state.request.status = 'PENDING_APPROVAL';
    await world.reopen.execute(ctx(), draft.id);
    assert.equal(await flag(world, ctx(), draft.id), undefined, 'a draft again');
    const resent = await world.send(ctx(), draft.id);
    assert.deepEqual([resent.payout?.accountLast4, await flag(world, ctx(), draft.id)], ['9012', undefined]);
  });

  it('says nothing about a claim that never followed the default', async () => {
    // An account typed for this claim, and cash: the default was never theirs to follow.
    for (const payout of [{ mode: 'SPECIFIED' as const, ...KBANK }, { mode: 'CASH' as const }]) {
      const world = payoutWorld();
      await world.payouts.setOwn(ctx(), PROMPTPAY);
      const draft = await world.create.execute(ctx(), claimInput({ payout }));
      await world.send(ctx(), draft.id);
      await world.payouts.setOwn(ctx(), SCB);
      assert.equal(await flag(world, ctx(), draft.id), undefined, payout.mode);
    }
  });
});

// Payout spec §17.2: the claim page shows every account a claim has been sent with. The detail carries them
// masked like the current one (bank, account name, the last 4 digits), with who entered each and who attested it.
describe('payout: the accounts a claim has been sent with', () => {
  const historyOf = async (world: ReturnType<typeof payoutWorld>, id: string, viewer = ctx()) => (await world.detail.execute(viewer, id)).payoutHistory;
  const at = (hour: number) => new Date(Date.UTC(2026, 9, 1, hour));
  /** What the approval transaction writes when the approver ticks "ตรวจบัญชีแล้ว". */
  const attest = (world: ReturnType<typeof payoutWorld>, verifiedVersion: number, actorUserId: string, approvalStepId: string, verifiedAt = at(4)) =>
    attestClaimPayout(world.state.payoutTables.client, world.state.request, { verifiedVersion, actorUserId, verifiedAt, approvalStepId });

  it('lists each account the claim was sent with, oldest first, with who attested it and at which approval', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    // A first draft was never sent with any account: nothing to list.
    assert.equal(await historyOf(world, draft.id), undefined);
    await world.send(ctx(), draft.id);
    const first = { version: 1, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', source: 'DEFAULT_ACCOUNT',
      frozenAt: world.state.payoutTables.destinations[0]!.frozenAt.toISOString() };
    assert.deepEqual(await historyOf(world, draft.id), [first]);

    await attest(world, 1, 'manager-1', 'step-1');
    const attested = { ...first, verifiedByUserId: 'manager-1', verifiedByName: 'วิภา', verifiedAt: at(4).toISOString(), approvalStepId: 'step-1' };
    const approved = await world.detail.execute(ctx(), draft.id);
    assert.deepEqual(approved.payoutHistory, [attested]);
    // The same attestation the card reads off the claim's current account.
    assert.deepEqual([approved.payout?.version, approved.payout?.verifiedByUserId, approved.payout?.verifiedByName, approved.payout?.verifiedAt], [1, 'manager-1', 'วิภา', at(4).toISOString()]);

    // Taken back, the default changed, sent again: version 1 stays as it was approved, version 2 is the one in use.
    await world.reopen.execute(ctx(), draft.id);
    assert.deepEqual(await historyOf(world, draft.id), [attested], 'a draft that follows the default again keeps its history');
    await world.payouts.setOwn(ctx(), SCB);
    await world.send(ctx(), draft.id);
    const resent = await world.detail.execute(ctx(), draft.id);
    assert.equal(resent.payout?.version, 2);
    assert.deepEqual(resent.payoutHistory, [attested, { version: 2, payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารไทยพาณิชย์', accountName: 'นาย สมชาย ใจดี',
      accountLast4: '9012', source: 'DEFAULT_ACCOUNT', frozenAt: world.state.payoutTables.destinations.find((row) => row.version === 2)!.frozenAt.toISOString() }]);
    // Every reader of the claim gets the same rows: they hold no more than the current account does.
    assert.deepEqual(await historyOf(world, draft.id, financeCtx()), resent.payoutHistory);
    assert.equal(leaksNumber(resent), false);
    assert.doesNotMatch(JSON.stringify(resent.payoutHistory), /fingerprint|encrypted|accountNumber/i);
  });

  it('says who entered an account the requester did not, and keeps a name it cannot resolve as an id', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    // Typed, not sent: the draft's working account is its current choice, not history.
    assert.equal(await historyOf(world, draft.id), undefined);
    await world.send(financeCtx(), draft.id);
    const [typed] = (await historyOf(world, draft.id))!;
    assert.deepEqual([typed!.source, typed!.enteredByUserId, typed!.enteredByName], ['PREPARER', 'finance-1', 'อรทัย']);
    // The requester's own account names nobody.
    await world.reopen.execute(ctx(), draft.id);
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    await world.send(ctx(), draft.id);
    const own = (await historyOf(world, draft.id))!.at(-1)!;
    assert.deepEqual([own.version, own.source, own.enteredByUserId, own.enteredByName], [2, 'REQUESTER', undefined, undefined]);
    // Whoever typed version 1 has left the company: the row still says someone else did.
    world.state.repo.getUserDisplayNames = async () => ({});
    const [unnamed] = (await historyOf(world, draft.id))!;
    assert.deepEqual([unnamed!.enteredByUserId, 'enteredByName' in unnamed!], ['finance-1', false]);
  });

  it('drops an attestation from the account a draft is about to be sent with again, as the claim\'s own account block does', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK } }));
    await world.send(ctx(), draft.id);
    await attest(world, 1, 'manager-1', 'step-1');
    assert.equal((await historyOf(world, draft.id))![0]!.verifiedByUserId, 'manager-1');
    // An account named for the claim stays the draft's choice after a withdraw. Its attestation is of the round
    // that ended: the next submit clears it, so neither the card nor the history shows it meanwhile.
    await world.reopen.execute(ctx(), draft.id);
    const reopened = await world.detail.execute(ctx(), draft.id);
    assert.deepEqual([reopened.status, reopened.payout?.version, reopened.payout?.verifiedAt], ['DRAFT', 1, undefined]);
    assert.deepEqual(reopened.payoutHistory!.map((row) => [row.version, row.verifiedByUserId, row.verifiedAt, row.approvalStepId]), [[1, undefined, undefined, undefined]]);
    await world.send(ctx(), draft.id);
    assert.deepEqual((await historyOf(world, draft.id))!.map((row) => [row.version, row.verifiedByUserId]), [[1, undefined]]);
  });

  it('never lists the copy of the default kept with a legacy claim\'s payment: the claim was never sent with it', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    // A claim sent before claims carried an account: a number, no payout columns.
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'CASH' } }));
    await world.send(ctx(), draft.id);
    Object.assign(world.state.request, { payoutMethod: null, payoutDestinationVersion: null, payoutFingerprint: null });
    const account = world.state.payoutTables.accounts[0]!;
    await confirmPaymentPayout(world.state.payoutTables.client, world.state.request,
      { payoutDefaultToken: legacyPayoutConfirmToken(draft.id, account.fingerprint) }, { actorUserId: 'manager-1', confirmedAt: at(6) });
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.source, !!row.frozenAt]), [[1, 'LEGACY_PAYMENT', true]]);
    const detail = await world.detail.execute(ctx(), draft.id);
    assert.deepEqual(['payout' in detail, 'payoutHistory' in detail], [false, false]);
  });
});

describe('payout: filing a claim on behalf of someone', () => {
  it("uses the requester's account, never the preparer's, and follows the requester's default until submit", async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(financeCtx(), SCB); // the preparer's own account, which must never appear
    await world.payouts.setOwn(ctx(), KBANK); // the requester's
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }));
    const seenByPreparer = async () => (await world.detail.execute(financeCtx(), draft.id)).payout;

    assert.deepEqual([(await seenByPreparer())?.accountLast4, (await seenByPreparer())?.canRevealAccountNumber], ['6789', false]);
    // The requester changes their default while the claim is still a draft: the draft shows the new one.
    await world.payouts.setOwn(ctx(), PROMPTPAY);
    assert.equal((await seenByPreparer())?.accountLast4, '5678');

    const submitted = await world.send(financeCtx(), draft.id);
    assert.deepEqual([submitted.payout?.accountLast4, submitted.payout?.source, submitted.payout?.enteredByName], ['5678', 'DEFAULT_ACCOUNT', undefined]);
    // After submit the requester's default changes again; the claim does not.
    await world.payouts.setOwn(ctx(), KBANK);
    assert.equal((await seenByPreparer())?.accountLast4, '5678');
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0812345678', 'the requester reads their own frozen number');
    // The preparer holds no payment right and is not the approver: last 4 only.
    assert.equal((await seenByPreparer())?.canRevealAccountNumber, false);
    await assert.rejects(world.reveal.execute(financeCtx(), draft.id), /payout_reveal_denied/);
  });

  it('lets the preparer type the requester account, records who typed it, and shows them the last 4 afterwards', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    const forPreparer = (await world.detail.execute(financeCtx(), draft.id)).payout;
    assert.deepEqual([forPreparer?.source, forPreparer?.enteredByName, forPreparer?.accountLast4, forPreparer?.canRevealAccountNumber], ['PREPARER', 'อรทัย', '6789', false]);
    await assert.rejects(world.reveal.execute(financeCtx(), draft.id), /payout_reveal_denied/);
    // The requester opens their own claim and sees the account that was put on it.
    const forRequester = (await world.detail.execute(ctx(), draft.id)).payout;
    assert.deepEqual([forRequester?.enteredByName, forRequester?.canRevealAccountNumber], ['อรทัย', true]);
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '0123456789');
    assert.equal(world.state.payoutTables.accounts.length, 0, 'nobody default was set');
  });

  // Security review S2: the per-claim path told nobody. Whoever types where the requester's money
  // goes on a claim filed for them is named to the requester, exactly as for a default account.
  it('tells the requester, and nobody else, when someone else changes the draft destination', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    assert.equal(world.notifications.length, 1);
    const notice = world.notifications[0];
    // To the requester alone: not the preparer, not the shop owner, not an approver.
    assert.deepEqual(notice.recipientUserIds, ['staff-1']);
    assert.equal(notice.title, 'อรทัย เลือกวิธีรับเงินคืนในใบเบิกของคุณ');
    assert.equal(notice.body, 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789 · เปิดใบเบิกเพื่อตรวจ ถ้าไม่ถูกต้อง แจ้งผู้จัดทำใบเบิก');
    assert.equal(notice.deepLinkHref, `/companies/co-1/reimbursements/${draft.id}`);
    assert.deepEqual([notice.triggerKey, notice.severity, notice.sourceType, notice.sourceId], ['reimbursement.payout_account_set_by_other', 'critical', 'reimbursement_request', draft.id]);

    // Changed again by the preparer: a notice of its own. Typed by the requester: none.
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'SPECIFIED', ...PROMPTPAY } });
    assert.equal(world.notifications.length, 2);
    assert.match(world.notifications[1].body, /^พร้อมเพย์เบอร์ลงท้าย 5678 · เปิดใบเบิก/);
    assert.notEqual(world.notifications[1].periodKey, notice.periodKey);
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    // Cash and the standing account are choices too.
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'CASH' } });
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'DEFAULT' } });
    assert.equal(world.notifications.length, 4);
    assert.ok(world.notifications.every((entry) => entry.recipientUserIds.length === 1 && entry.recipientUserIds[0] === 'staff-1'));
    assert.equal(leaksNumber(world.notifications), false);
  });

  it('announces every changed draft destination once, including first cash and standing-account choices', async () => {
    for (const initial of [{ mode: 'CASH' }, { mode: 'DEFAULT' }, { mode: 'SPECIFIED', ...KBANK }] as const) {
      const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
      await world.payouts.setOwn(ctx(), PROMPTPAY);
      const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: initial }));
      assert.equal(world.notifications.length, 1, initial.mode);
      assert.deepEqual(world.notifications[0].recipientUserIds, ['staff-1']);
      assert.match(world.notifications[0].body, initial.mode === 'CASH' ? /รับเป็นเงินสด/ : initial.mode === 'DEFAULT' ? /พร้อมเพย์เบอร์ลงท้าย 5678/ : /ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789/);
      await world.update.execute(financeCtx(), draft.id, { payout: initial });
      assert.equal(world.notifications.length, 1, 'identical save is silent');
      await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
      assert.equal(world.notifications.length, 2, 'next destination is a new notice');
      assert.notEqual(world.notifications[0].periodKey, world.notifications[1].periodKey);
      await world.update.execute(ctx(), draft.id, { payout: { mode: 'CASH' } });
      await world.update.execute(ctx(), draft.id, { payout: { mode: 'DEFAULT' } });
      assert.equal(world.notifications.length, 2, 'own choices are silent');
      assert.equal(leaksNumber(world.notifications), false);
    }
  });

  it('reads the requester membership once for a typed draft account, including a standing-account save', async () => {
    for (const saveAsDefault of [false, true]) {
      const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
      const findMember = world.state.repo.findPayoutMember.bind(world.state.repo);
      let reads = 0;
      world.state.repo.findPayoutMember = async (...args: Parameters<typeof findMember>) => { reads++; return findMember(...args); };
      const editor = ctx({ userId: 'finance-1', permissions: [...financeCtx().permissions, 'access.employee.update'] });
      const change = await world.payouts.draftPayoutChange(editor, 'staff-1', { mode: 'SPECIFIED', ...KBANK, saveAsDefault });
      assert.equal(reads, 1, `saveAsDefault=${saveAsDefault}`);
      assert.ok(change.onChanged, 'the same active membership authorizes the notice');
    }
  });

  it('compares the full sealed draft destination and does not repeat a typed-account save', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'SPECIFIED', ...KBANK } });
    assert.equal(world.notifications.length, 1);
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: '9999956789' } });
    assert.equal(world.notifications.length, 2, 'the same last four digits are not the same account');
    assert.equal(leaksNumber(world.notifications), false);
    assert.doesNotMatch(JSON.stringify(world.notifications), /9999956789/);
  });

  it('keeps automatic draft defaults silent and accepts cash/default changes for inactive requesters without a notice', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }));
    assert.equal(world.notifications.length, 0);
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'CASH' } });
    assert.equal(world.notifications.length, 1);
    for (const membershipStatus of ['DRAFT', 'INVITED', 'SUSPENDED', 'DISABLED']) {
      const inactive = payoutWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus } } });
      const id = (await inactive.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }))).id;
      await inactive.update.execute(financeCtx(), id, { payout: { mode: 'CASH' } });
      assert.equal(inactive.state.request.payoutMethod, 'CASH');
      await inactive.update.execute(financeCtx(), id, { payout: { mode: 'DEFAULT' } });
      assert.equal(inactive.state.request.payoutMethod, null);
      assert.equal(inactive.notifications.length, 0);
    }
  });

  it('combines a draft account and its standing-account save into one claim notice, leaving standalone saves alone', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const editor = ctx({ userId: 'finance-1', permissions: [...financeCtx().permissions, 'access.employee.update'] });
    const draft = await world.create.execute(editor, claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } }));
    assert.deepEqual(world.notifications.map(n => n.sourceType), ['reimbursement_request']);
    assert.match(world.notifications[0].body, /บันทึกบัญชีนี้เป็นบัญชีรับเงินคืนประจำของคุณด้วย/);
    assert.equal((await world.payouts.getOwn(ctx())).account?.accountLast4, '6789');
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB, saveAsDefault: true } });
    assert.equal(world.notifications.length, 1, 'own combined save is silent');
    await world.payouts.setForMember(editor, 'staff-1', PROMPTPAY);
    assert.deepEqual(world.notifications.map(n => n.sourceType), ['reimbursement_request', 'member_payout_account']);
    assert.equal(leaksNumber([world.notifications, world.audits]), false);
  });

  it('types no account for a requester a notice cannot reach', async () => {
    for (const membershipStatus of ['DRAFT', 'INVITED', 'SUSPENDED', 'DISABLED']) {
      const world = payoutWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus } } });
      const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1' }));
      await assert.rejects(world.update.execute(financeCtx(), draft.id, { payout: { mode: 'SPECIFIED', ...KBANK } }), (error: any) => {
        assert.equal(error.getStatus(), 409, membershipStatus);
        assert.match(error.message, /^payout_account_member_not_active$/, membershipStatus);
        return true;
      });
      assert.deepEqual([world.state.payoutTables.destinations.length, world.notifications.length, world.state.request.payoutMethod ?? null], [0, 0, null], membershipStatus);
      // Cash and the requester's own default remain open: neither is an account someone typed for them.
      await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'CASH' } });
    }
  });

  it('records the receiving choice and who typed an account on the draft audit rows, never the account', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'CASH' } });
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'DEFAULT' } });
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...PROMPTPAY, saveAsDefault: true } });
    await world.update.execute(ctx(), draft.id, { reason: 'แก้เหตุผลอย่างเดียว' });
    const draftRows = world.audits.filter((row) => /^reimbursement\.request\.(create|update_draft)$/.test(row.action));
    assert.deepEqual(draftRows.map((row) => [row.action.split('.').pop(), row.actorUserId, row.metadataJson?.payout]), [
      ['create', 'finance-1', { mode: 'SPECIFIED', source: 'PREPARER', holderType: 'SELF' }],
      ['update_draft', 'staff-1', { mode: 'SPECIFIED', source: 'REQUESTER', holderType: 'SELF' }],
      ['update_draft', 'staff-1', { mode: 'CASH' }],
      ['update_draft', 'staff-1', { mode: 'DEFAULT' }],
      ['update_draft', 'staff-1', { mode: 'SPECIFIED', source: 'REQUESTER', holderType: 'SELF', savedAsDefault: true }],
      // A draft edit that leaves the receiving choice alone says nothing about it.
      ['update_draft', 'staff-1', undefined],
    ]);
    assert.equal(leaksNumber(world.audits), false);
    assert.doesNotMatch(JSON.stringify(draftRows), /accountLast4|accountName|bankName|fingerprint|6789|9012|5678/);
  });

  it('still says someone else entered the account when their name can no longer be resolved', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK } }));
    assert.deepEqual([(await world.detail.execute(ctx(), draft.id)).payout?.enteredByUserId, (await world.detail.execute(ctx(), draft.id)).payout?.enteredByName], ['finance-1', 'อรทัย']);
    // The preparer has left the company: no name comes back for them.
    delete PAYOUT_NAMES['finance-1'];
    try {
      const shown = (await world.detail.execute(ctx(), draft.id)).payout!;
      assert.deepEqual([shown.source, shown.enteredByUserId, shown.enteredByName], ['PREPARER', 'finance-1', undefined]);
    } finally { PAYOUT_NAMES['finance-1'] = 'อรทัย'; }
    // The requester's own account carries neither.
    await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    const own = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.deepEqual([own.source, own.enteredByUserId, own.enteredByName], ['REQUESTER', undefined, undefined]);
  });

  it('saves it as the requester default only for a preparer who may edit employee data, and tells the requester', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const input = claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true } });
    await assert.rejects(world.create.execute(financeCtx(), input), /payout_account_edit_denied/);
    assert.equal(world.state.payoutTables.accounts.length, 0);

    const hr = ctx({ userId: 'finance-1', permissions: [...financeCtx().permissions, 'access.employee.update'] });
    const draft = await world.create.execute(hr, input);
    assert.deepEqual(world.state.payoutTables.accounts.map((row) => [row.userId, row.accountLast4, row.updatedByUserId]), [['staff-1', '6789', 'finance-1']]);
    assert.equal((await world.detail.execute(hr, draft.id)).payout?.followsDefault, true);
    assert.deepEqual(world.notifications.map((notice) => notice.recipientUserIds), [['staff-1']]);
  });
});

describe('payout: a draft made from LINE', () => {
  // LINE writes a draft with no account data at all (it has no payout field); it is sent on the web.
  it('submits on the web when the requester has a default account, with nothing to add', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const lineDraft = await world.create.execute(ctx(), claimInput());
    assert.equal(world.state.request.payoutMethod ?? null, null);
    assert.equal((await world.send(ctx(), lineDraft.id)).payout?.accountLast4, '6789');
  });

  it('says what is missing when the requester has none, and submits once a method is chosen', async () => {
    const world = payoutWorld();
    const lineDraft = await world.create.execute(ctx(), claimInput());
    assert.deepEqual((await world.detail.execute(ctx(), lineDraft.id)).payout, { followsDefault: true, notReadyReason: 'payout_method_required', canRevealAccountNumber: false });
    await assert.rejects(world.send(ctx(), lineDraft.id), /payout_method_required/);
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    assert.equal((await world.send(ctx(), lineDraft.id)).payout?.payoutMethod, 'CASH');
  });
});

describe('payout: lists carry the receiving method and nothing of the account', () => {
  it('returns the method on a row and no bank, name, last 4 or number', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    await world.send(ctx(), draft.id);
    Object.assign(world.state.repo, { listRequestPage: async () => ({ rows: [world.state.request], groups: [] }), findPendingApprovalSteps: async () => [] });
    const page = await new ListReimbursementsUseCase(world.state.repo).execute(ctx(), {});
    assert.equal(page.items[0]!.payoutMethod, 'BANK_TRANSFER');
    assert.ok(!/payout(?!Method)|bankName|accountName|accountLast4|accountNumber|fingerprint/i.test(JSON.stringify(page)));
    assert.equal(leaksNumber(page), false);
  });
});

// Owner direction 2026-10-01: a draft follows the member's default account, and since a manager may
// change that default, the requester could send a claim to an account they never saw. The page shows
// the account that will be frozen, and the submit is bound to what it showed.
describe('payout: the claim is sent with the account its page showed (show before freeze)', () => {
  it('refuses a submit that names no account, and one whose default was changed after the page was read', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    // A list-row submit, a browser tab from before the release, a script: nothing was shown, nothing is sent.
    await assert.rejects(world.submit.execute(ctx(), draft.id), /payout_destination_changed/);
    await assert.rejects(world.submit.execute(ctx(), draft.id, null), /payout_destination_changed/);
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: 'f'.repeat(32) }), /payout_destination_changed/);

    // The requester reads the page, then a manager changes their default before they press send.
    const seen = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.equal(seen.accountLast4, '6789');
    await world.payouts.setForMember(managerCtx(), 'staff-1', SCB);
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: seen.submitToken }), (error: any) => {
      assert.equal(error.getStatus(), 409);
      assert.match(error.message, /payout_destination_changed/);
      return true;
    });
    assert.deepEqual([world.state.request.status, world.state.request.payoutFingerprint ?? null, world.state.payoutTables.destinations.length], ['DRAFT', null, 0]);

    // They look again: the page now shows the new account and says who set it. That is what they send.
    const latest = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.deepEqual([latest.accountLast4, latest.enteredByName], ['9012', 'วิภา']);
    assert.notEqual(latest.submitToken, seen.submitToken);
    const sent = await world.submit.execute(ctx(), draft.id, { payoutSubmitToken: latest.submitToken });
    assert.deepEqual([sent.status, sent.payout?.accountLast4, sent.payout?.submitToken], ['PENDING_APPROVAL', '9012', undefined]);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.submitToken, undefined, 'a sent claim has nothing left to send');
  });

  it('refuses when the default was removed, or switched between a transfer and cash, after the page was read', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const tokenOf = async () => (await world.detail.execute(ctx(), draft.id)).payout?.submitToken;

    const transfer = await tokenOf();
    await world.payouts.setOwn(ctx(), { payoutMethod: 'CASH' });
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: transfer }), /payout_destination_changed/, 'a transfer the page showed is not sent as cash');
    const cash = await tokenOf();
    await world.payouts.setOwn(ctx(), KBANK);
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: cash }), /payout_destination_changed/, 'cash the page showed is not sent as a transfer');
    // The same account saved again is the same account: no needless refusal.
    assert.equal(await tokenOf(), transfer);
    await world.payouts.deleteOwn(ctx());
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: transfer }), (error: any) => {
      assert.equal(error.getStatus(), 409);
      assert.match(error.message, /payout_method_required/);
      return true;
    });
    assert.equal(world.state.request.status, 'DRAFT');
  });

  it('takes cash the draft chose without a token, and refuses a token that is not what the claim would freeze', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'CASH' } }));
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: 'e'.repeat(32) }), /payout_destination_changed/);
    // Cash chosen on the claim itself depends on nothing that was shown and on nobody else's edit.
    assert.equal((await world.submit.execute(ctx(), draft.id)).status, 'PENDING_APPROVAL');
  });

  // Security review S2: an account typed into the claim was sent blind. A preparer (or the requester
  // in another tab) can change it between the page being read and the button being pressed, so a
  // transfer is sent only with the token of the account that was on the page.
  it('sends an account typed into the claim only with the token of the page that showed it', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK } }));
    // A list-row submit, an older browser tab, a script: nothing was shown, nothing is sent.
    for (const input of [undefined, null, {}, { payoutSubmitToken: 'e'.repeat(32) }]) {
      await assert.rejects(world.submit.execute(ctx(), draft.id, input), (error: any) => {
        assert.equal(error.getStatus(), 409);
        assert.match(error.message, /^payout_destination_changed$/);
        return true;
      });
    }
    // The requester reads the page; then someone who prepares claims for them types another account.
    const seen = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.deepEqual([seen.accountLast4, seen.followsDefault], ['6789', undefined]);
    await world.update.execute(financeCtx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } });
    await assert.rejects(world.submit.execute(ctx(), draft.id, { payoutSubmitToken: seen.submitToken }), /payout_destination_changed/);
    assert.deepEqual([world.state.request.status, world.state.request.payoutFingerprint ?? null, world.state.payoutTables.destinations[0]!.frozenAt], ['DRAFT', null, null]);
    // They look again, see the account now on the claim and who typed it, and send that.
    const latest = (await world.detail.execute(ctx(), draft.id)).payout!;
    assert.deepEqual([latest.accountLast4, latest.source, latest.enteredByName], ['9012', 'PREPARER', 'อรทัย']);
    assert.notEqual(latest.submitToken, seen.submitToken);
    const sent = await world.submit.execute(ctx(), draft.id, { payoutSubmitToken: latest.submitToken });
    assert.deepEqual([sent.status, sent.payout?.accountLast4], ['PENDING_APPROVAL', '9012']);
  });
});

describe('payout: a legacy claim is one thing everywhere', () => {
  /** What an older build stores on submit: no payout columns of its own, a hash without a payout part. */
  function sendWithAnOlderBuild(request: any) {
    Object.assign(request, {
      status: 'PENDING_APPROVAL', submittedAt: new Date('2026-10-01T03:00:00.000Z'), requestNo: 'RB-202610-000009',
      approvalSnapshotHash: computeSnapshotHash(claimSnapshotFields({ ...request, payoutFingerprint: undefined })),
    });
  }

  // The rollback window: the draft chose its account under this build, an older build sent it.
  it('shows, lists, hashes, attests and reveals a draft choice sent by an older build as a legacy claim', async () => {
    const world = payoutWorld();
    const draft = await world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK } }));
    const request = world.state.request;
    sendWithAnOlderBuild(request);
    assert.deepEqual([request.payoutMethod, request.payoutDestinationVersion, request.payoutFingerprint ?? null], ['BANK_TRANSFER', 1, null]);

    assert.equal((await world.detail.execute(ctx(), draft.id)).payout, undefined, 'no account is shown for the claim');
    Object.assign(world.state.repo, { listRequestPage: async () => ({ rows: [request], groups: [] }), findPendingApprovalSteps: async () => [] });
    assert.equal((await new ListReimbursementsUseCase(world.state.repo).execute(ctx(), {})).items[0]!.payoutMethod, undefined);
    await assert.rejects(world.reveal.execute(ctx(), draft.id), /payout_reveal_denied/);
    // The live approval check recomputes exactly what the older build stored, and asks for no attestation.
    assert.equal(computeSnapshotHash(claimSnapshotFields(request, request.approvalPolicySnapshotJson)), request.approvalSnapshotHash);
    assert.equal(payoutAttestationError(request, undefined), null);
    assert.equal(hasPayoutSnapshot(request), false);

    // Withdrawn under this build, the draft's own choice is back, and sending it freezes a real snapshot.
    await world.reopen.execute(ctx(), draft.id);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout?.accountLast4, '6789');
    const sent = await world.send(ctx(), draft.id);
    assert.deepEqual([sent.payout?.version, hasPayoutSnapshot(world.state.request), world.state.payoutTables.destinations[0]!.frozenAt !== null], [1, true, true]);
  });

  // Part B stores a copy of the account a legacy claim was paid to. The claim itself stays legacy.
  it('keeps a claim sent before the field existed legacy, also when account rows exist for it', async () => {
    const world = payoutWorld();
    await world.payouts.setOwn(ctx(), KBANK);
    const draft = await world.create.execute(ctx(), claimInput());
    const request = world.state.request;
    sendWithAnOlderBuild(request);
    const before = { hash: request.approvalSnapshotHash, signature: claimSignatureAckHash(request) };
    const sealed = sealPayoutDestination(KBANK, PAYOUT_KEY)!;
    world.state.payoutTables.destinations.push({
      id: 'destination-paid', companyId: 'co-1', reimbursementRequestId: draft.id, version: 1, ...sealed,
      source: 'DEFAULT_ACCOUNT', createdByUserId: 'finance-1', frozenAt: new Date('2026-10-02T00:00:00.000Z'),
    });

    assert.equal((await world.detail.execute(ctx(), draft.id)).payout, undefined);
    await assert.rejects(world.reveal.execute(ctx(), draft.id), /payout_reveal_denied/);
    assert.deepEqual({ hash: computeSnapshotHash(claimSnapshotFields(request, request.approvalPolicySnapshotJson)), signature: claimSignatureAckHash(request) }, before);
    assert.equal(payoutAttestationError(request, undefined), null);
    // The member's default is not shown as the claim's account either: nothing after submit reads it.
    await world.payouts.setOwn(ctx(), SCB);
    assert.equal((await world.detail.execute(ctx(), draft.id)).payout, undefined);
  });
});

describe('payout: nothing but the two reveal calls carries the number', () => {
  it('keeps the number, the ciphertext and the fingerprint out of every response, row, audit entry, notice, event and export', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE } });
    const out: unknown[] = [];
    out.push(await world.payouts.setForMember(managerCtx(), 'staff-1', KBANK), await world.payouts.getForMember(managerCtx(), 'staff-1'));
    out.push(await world.payouts.setOwn(ctx(), PROMPTPAY), await world.payouts.getOwn(ctx()));
    const draft = await world.create.execute(ctx(), claimInput());
    out.push(draft, await world.detail.execute(ctx(), draft.id));
    out.push(await world.update.execute(ctx(), draft.id, { payout: { mode: 'SPECIFIED', ...SCB } }), await world.detail.execute(ctx(), draft.id));
    out.push(await world.send(ctx(), draft.id), await world.detail.execute(ctx(), draft.id));
    Object.assign(world.state.repo, { listRequestPage: async () => ({ rows: [world.state.request], groups: [] }), findPendingApprovalSteps: async () => [] });
    out.push(await new ListReimbursementsUseCase(world.state.repo).execute(ctx(), {}));
    out.push(await new ExportReimbursementEvidenceUseCase(world.state.repo, { log: async (entry: any) => { world.audits.push(entry); } } as any)
      .execute(ctx({ permissions: ['reimbursement.export', 'reimbursement.read'] }), draft.id));
    out.push(world.audits, world.notifications, world.state.calls.outbox);

    const { accounts, destinations } = world.state.payoutTables;
    const secrets = [...FULL_NUMBERS, ...[...accounts, ...destinations].flatMap((row) => [row.accountNumberEncrypted, row.fingerprint])];
    assert.equal(secrets.length, FULL_NUMBERS.length + 4);
    const text = JSON.stringify(out);
    for (const secret of secrets) assert.equal(text.includes(secret), false, `leaked: ${String(secret).slice(0, 12)}…`);
    assert.doesNotMatch(text, /"(?:payout)?(?:accountNumber\w*|fingerprint)":/i, 'no field is even named after them');
    // The last 4 digits are what everyone may see, and the two reveal calls are the only way to the rest.
    assert.match(text, /"accountLast4":"9012"/);
    assert.equal((await world.reveal.execute(ctx(), draft.id)).accountNumber, '000123456789012');
    assert.equal((await world.payouts.revealOwn(ctx())).accountNumber, '0812345678');
  });

  it('never echoes what was typed in a refusal', async () => {
    const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE, 'admin-1': { ...EMPLOYEE, allBranches: true, branchIds: [] } } });
    const typed = '0123456789';
    const refusals: unknown[] = [];
    const refused = async (attempt: Promise<unknown>) => {
      await assert.rejects(attempt, (error: any) => { refusals.push([error.message, error.getResponse?.()]); return true; });
    };
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: `${typed}${typed}${typed}` }));
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: `${typed}x` }));
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountName: typed }));
    await refused(world.payouts.setOwn(ctx(), { payoutMethod: 'BANK_TRANSFER', accountNumber: typed } as any));
    await refused(world.payouts.setOwn(ctx(), { ...KBANK, accountNumber: typed, payoutMethod: 'TRANSFER_TO_ME' } as any));
    await refused(world.payouts.setForMember(managerCtx({ scopes: { branchIds: ['branch-9'] } }), 'staff-1', { ...KBANK, accountNumber: typed }));
    await refused(world.payouts.setForMember(managerCtx(), 'nobody', { ...KBANK, accountNumber: typed }));
    await refused(world.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: `${typed}x` } })));
    await refused(world.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, accountNumber: typed, saveAsDefault: true } })));
    assert.equal(refusals.length, 9);
    assert.equal(JSON.stringify([refusals, world.audits]).includes(typed), false);
  });
});

// The finance note is copied into the requester's notification (web and LINE). People write account
// numbers there ("โอนเข้า 123-4-56789-0 แทน"), and a plain "six digits in a row" check lets that through.
describe('payout: a note that goes into a notification carries no account number', () => {
  it('refuses the finance note before anything is decided, and takes an ordinary one', async () => {
    const decisions: any[] = [];
    const repo = {
      findRequestById: async () => ({ id: 'rb-1', companyId: 'co-1', branchId: 'branch-1', status: 'FINANCE_REVIEW', updatedAt: new Date('2026-10-01T00:00:00.000Z') }),
      recordFinanceReviewAtomic: async (data: any) => { decisions.push(data); throw new Error('stop after the guard'); },
      beginFinanceApprovalAtomic: async (data: any) => { decisions.push(data); throw new Error('stop after the guard'); },
    } as any;
    const review = new FinanceReviewReimbursementUseCase(repo, { log: async () => undefined } as any, {} as any, {} as any, {} as any);
    const finance = ctx({ userId: 'finance-1', permissions: ['reimbursement.read', 'reimbursement.finance_review'] });
    for (const note of ['บัญชีผิด โอนเข้า 123-4-56789-0 แทน', 'พร้อมเพย์ 081 000 1234', 'เลขบัญชี 0123456789', 'โอนเข้า 123.4.56789.0', 'พร้อมเพย์ ๐๘๑๒๓๔๕๖๗๘']) {
      for (const decision of ['NEEDS_INFO', 'APPROVED_FOR_PAYMENT'] as const) {
        await assert.rejects(review.execute(finance, 'rb-1', { decision, note }), (error: any) => {
          assert.equal(error.getStatus?.(), 400);
          assert.match(error.message, /^note_contains_account_number$/);
          return true;
        }, note);
      }
    }
    assert.equal(decisions.length, 0);
    // A note without one goes on to the decision.
    await assert.rejects(review.execute(finance, 'rb-1', { decision: 'NEEDS_INFO', note: 'ใบเสร็จลงวันที่ 01-10-2569 ไม่ตรงกับวันที่เบิก' }), /stop after the guard/);
    assert.equal(decisions.length, 1);
    // So do the product's own document numbers and a plain amount: what a reviewer actually writes.
    for (const note of ['ซ้ำกับใบ RB-202609-0003', 'ดูรายการ EXP-2026-10-000123 ประกอบ', 'ยอดเกิน 1500000 บาท']) {
      await assert.rejects(review.execute(finance, 'rb-1', { decision: 'NEEDS_INFO', note }), /stop after the guard/, note);
    }
    assert.equal(decisions.length, 4);
  });
});

// ---- Payout account correction round (payout spec §14, AC29-AC32) ----
//
// One claim over the fake repository. The three transactions of a round are imitated the way the other
// transactions above are (their locks, their guards and what they leave untouched are proven against a
// real PostgreSQL in prisma-reimbursement.repository.draft-submit-race.spec.ts). The account itself is
// frozen, attested and read by the production payout functions, and every decision about who may do
// what is the use cases' own.

const OUT_OF_ROUND = {
  payoutCorrectionRequestedAt: undefined, payoutCorrectionRequestedByUserId: undefined, payoutCorrectionReasonCode: undefined,
  payoutCorrectionNote: undefined, payoutCorrectionSubmittedAt: undefined,
};
const approverCtx = (overrides: Partial<any> = {}) => ctx({
  userId: 'manager-1', roles: ['MANAGER'], permissions: ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'], ...overrides,
});
const payerCtx = (overrides: Partial<any> = {}) => ctx({
  userId: 'payer-1', roles: ['ACCOUNTANT'], permissions: ['reimbursement.read', 'reimbursement.payment.record'], ...overrides,
});
const readerCtx = () => ctx({ userId: 'reader-1', roles: ['AUDITOR'], permissions: ['reimbursement.read'] });
const NO_APPROVAL_POLICY = {
  id: 'policy-1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), currency: 'THB', approvalRequiredFromAmount: '1000.00',
  approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER', allowSelfApproval: false, duplicatePolicy: 'WARN',
  financeReviewRequired: false, status: 'ACTIVE', requireReceipt: false, allowMissingReceiptWithReason: false,
};

function correctionWorld(options: RepoOptions = {}) {
  const world = payoutWorld({ payoutMembers: { 'staff-1': EMPLOYEE }, ...options });
  const { repo, calls } = world.state;
  const db = world.state.payoutTables.client;
  const steps: any[] = calls.approvalSteps;
  const payments: any[] = [];
  const claim = () => world.state.request;
  const bump = (changes: Record<string, unknown>) => Object.assign(claim(), changes, { updatedAt: new Date(claim().updatedAt.getTime() + 1) });
  const findPlain = repo.findRequestById;
  const names: Record<string, string> = { ...PAYOUT_NAMES, 'payer-1': 'ประไพ' };
  /**
   * Today's approval route for the claim's step, as the submit's resolver answers it (the manager the
   * claim was approved by, unless a case says otherwise; an error is what the resolver throws when
   * nobody is on it), and who would approve a claim nobody has to.
   */
  let routeToday: string[] | Error = ['manager-1'];
  const routeCalls: any[] = [];
  const routes = {
    resolveNamedSubmissionRoute: async () => null,
    resolveSubmissionRoute: async (input: any) => {
      routeCalls.push(input);
      if (routeToday instanceof Error) throw routeToday;
      return { recipientUserIds: routeToday };
    },
    resolveWouldBeApproverUserIds: async () => ['manager-1'],
  } as any;
  let activeApprovers: string[] | undefined;
  const submitPlain = repo.submitDraftAtomic;
  Object.assign(repo, {
    // The step a submit creates, with the columns the database fills in.
    submitDraftAtomic: async (data: any) => {
      const result = await submitPlain(data);
      for (const step of steps) {
        Object.assign(step, { companyId: 'co-1', reimbursementRequestId: claim().id, status: step.status ?? 'PENDING', assignedAt: step.assignedAt ?? data.request.submittedAt });
      }
      return result;
    },
    findRequestById: async (companyId: string, id: string, withRelations?: boolean) => {
      const found = await findPlain(companyId, id, false);
      return found && withRelations ? { ...found, approvalSteps: steps, payments, duplicateCandidates: [] } : found;
    },
    getUserDisplayNames: async (_companyId: string, ids: string[]) => Object.fromEntries(ids.filter((id) => names[id]).map((id) => [id, names[id]])),
    findActiveApproverUserIds: async (_companyId: string, ids: string[]) => new Set(activeApprovers ?? ids),
    listPaymentPayoutDestinations: (companyId: string, requestId: string, versions: number[]) => readPaymentPayoutDestinations(db, companyId, requestId, versions),
    listPaymentSlips: async () => ({}),
    areClaimProjectionsReady: async () => true,
    listRequests: async ({ statuses }: any) => (statuses.includes(claim().status) ? [{ ...claim(), approvalSteps: steps }] : []),
    requestPayoutCorrectionAtomic: async (data: any) => {
      const request = claim();
      if (data.expectedUpdatedAt.getTime() !== request.updatedAt.getTime()) throw new ConflictException('reimbursement_changed');
      const again = !!request.payoutCorrectionSubmittedAt;
      const setAside = steps.filter((step) => (again ? step.id === request.currentApprovalStepId : step.status === 'APPROVED' && !step.invalidatedAt));
      for (const step of setAside) Object.assign(step, again && { status: 'CANCELLED' }, { invalidatedAt: data.requestedAt, invalidatedReason: 'payout_account_correction' });
      const entry = {
        kind: 'SENT_BACK', at: data.requestedAt.toISOString(), byUserId: data.actorUserId, reasonCode: data.reasonCode, ...(data.note && { note: data.note }),
        ...(!again && { approved: {
          ...(hasPayoutSnapshot(request) && { payoutMethod: request.payoutMethod, ...(request.payoutDestinationVersion != null && { payoutVersion: request.payoutDestinationVersion }) }),
          ...(request.approvedAt && { at: request.approvedAt.toISOString() }),
        } }),
      };
      bump({
        status: 'PENDING_APPROVAL', approvedAt: undefined, paymentStatus: 'NOT_PAYABLE', currentApprovalStepId: null,
        payoutCorrectionRequestedAt: data.requestedAt, payoutCorrectionRequestedByUserId: data.actorUserId, payoutCorrectionReasonCode: data.reasonCode,
        payoutCorrectionNote: data.note, payoutCorrectionSubmittedAt: undefined, payoutCorrectionLog: [...(request.payoutCorrectionLog ?? []), entry],
      });
      await data.onPersisted(fakeTx(calls.outbox), { again, setAsideStepIds: setAside.map((step) => step.id), signaturesRemoved: 0, declarationsSetAside: 0 });
      return request;
    },
    submitPayoutCorrectionAtomic: async (data: any) => {
      const request = claim();
      if (data.expectedUpdatedAt.getTime() !== request.updatedAt.getTime()) throw new ConflictException('reimbursement_changed');
      if (data.payout.write.mode === 'DEFAULT') await data.payout.onPersisted?.(db, request.id);
      const columns = await freezePayoutCorrection(db, request, {
        write: data.payout.write, frozenAt: data.submittedAt, seenDefaultToken: data.seenDefaultToken, defaultSetInThisTransaction: data.defaultSetInThisTransaction,
        previous: payoutCorrectionRoundStart(request),
        approvalRequired: request.approvalPolicySnapshotJson?.requiresApproval ?? !!payoutCorrectionSourceStep(request),
      });
      if (data.payout.write.mode !== 'DEFAULT') await data.payout.onPersisted?.(db, request.id);
      const approvalSnapshotHash = computeSnapshotHash(claimSnapshotFields({ ...request, ...columns }, request.approvalPolicySnapshotJson));
      const source: any = payoutCorrectionSourceStep<any>({ ...request, approvalSteps: steps });
      const replaced = source?.status === 'PENDING' ? source : undefined;
      if (replaced) Object.assign(replaced, { status: 'CANCELLED', invalidatedAt: data.submittedAt, invalidatedReason: 'payout_account_correction' });
      // Of the people the old step named, those on today's approval route; nobody left, no frozen list.
      const onRoute = (userId: string) => data.approverRouteUserIds.includes(userId);
      const stillAssigned = (source?.assignedApproverUserIds ?? []).filter(onRoute);
      const step = source ? {
        id: `step-${steps.length + 1}`, companyId: request.companyId, reimbursementRequestId: request.id, sequenceNo: source.sequenceNo, status: 'PENDING',
        approverUserId: source.approverUserId && onRoute(source.approverUserId) ? source.approverUserId : undefined,
        approverRoleSnapshot: source.approverRoleSnapshot, assignedApproverUserIds: stillAssigned.length > 0 ? stillAssigned : undefined,
        requestSnapshotHash: approvalSnapshotHash, assignedAt: data.submittedAt,
      } : undefined;
      if (step) steps.push(step);
      // The repository's own comparison of the two stored fingerprints, over the same tables, made once: here.
      const sameAsApproved = await payoutCorrectionKeptDestination(db, request, columns, payoutCorrectionRoundStart(request));
      const entry = {
        kind: 'ACCOUNT_SUBMITTED', at: data.submittedAt.toISOString(), byUserId: data.actorUserId, payoutMethod: columns.payoutMethod,
        ...(columns.payoutDestinationVersion !== null && { payoutVersion: columns.payoutDestinationVersion }),
        ...(sameAsApproved && { sameAsApproved: true }),
      };
      const log = [...request.payoutCorrectionLog, entry];
      bump({
        ...columns, approvalSnapshotHash, payoutCorrectionLog: log,
        ...(step ? { currentApprovalStepId: step.id, payoutCorrectionSubmittedAt: data.submittedAt }
          : { status: 'READY_FOR_PAYMENT', approvedAt: data.submittedAt, paymentStatus: 'UNPAID', ...OUT_OF_ROUND }),
      });
      await data.onPersisted(fakeTx(calls.outbox), {
        columns, ...(step && { step }), ...(replaced && { replacedStepId: replaced.id }), readyForPayment: !step, answer: payoutCorrectionFacts(log).at(-1)?.answer,
      });
      return { request, ...(step && { step }), readyForPayment: !step };
    },
    approvePayoutCorrectionAtomic: async (data: any) => {
      const request = claim();
      if (data.expectedUpdatedAt.getTime() !== request.updatedAt.getTime()) throw new ConflictException('stale_approval_snapshot');
      const step = steps.find((candidate) => candidate.id === request.currentApprovalStepId);
      await attestClaimPayout(db, request, { verifiedVersion: data.payoutVerifiedVersion, thirdPartyAccepted: data.payoutThirdPartyAccepted, actorUserId: data.actorUserId, verifiedAt: data.decidedAt, approvalStepId: step.id });
      Object.assign(step, { status: 'APPROVED', decidedAt: data.decidedAt, decisionByUserId: data.actorUserId, comment: data.comment });
      bump({
        status: 'READY_FOR_PAYMENT', approvedAt: data.decidedAt, paymentStatus: 'UNPAID', currentApprovalStepId: null, ...OUT_OF_ROUND,
        payoutCorrectionLog: [...request.payoutCorrectionLog, { kind: 'REAPPROVED', at: data.decidedAt.toISOString(), byUserId: data.actorUserId, approvalStepId: step.id }],
      });
      await data.onApprovedPersisted(fakeTx(calls.outbox), step.id);
      return request;
    },
  });
  const evidence = evidenceService();
  const audit = { log: async (entry: any) => { world.audits.push(entry); } } as any;
  const sendBack = new RequestPayoutCorrectionUseCase(repo, audit, evidence);
  const giveAccount = new SubmitPayoutCorrectionUseCase(repo, audit, evidence, world.payouts, routes);
  const approve = new ApproveReimbursementUseCase(repo, audit, { execute: async () => { throw new Error('a correction round builds no expense record'); } } as any, evidence);
  const reject = new RejectReimbursementUseCase(repo, audit, evidence);
  return {
    ...world, steps, payments, claim, bump, routes, routeCalls, sendBack, giveAccount, approve, reject,
    setActiveApprovers: (ids: string[] | undefined) => { activeApprovers = ids; },
    setRouteToday: (route: string[] | Error) => { routeToday = route; },
    events: () => calls.outbox as any[],
    /** A claim sent with the requester's default account, approved by its manager (who checked version 1), waiting for payment. */
    async ready(send: { payout?: Record<string, unknown>; setDefault?: typeof KBANK | null } = {}) {
      if (send.setDefault !== null) await world.payouts.setOwn(ctx(), send.setDefault ?? KBANK);
      const draft = await world.create.execute(ctx(), claimInput(send.payout ? { payout: send.payout } : {}));
      await world.send(ctx(), draft.id);
      const approvedAt = new Date();
      if (steps[0]) {
        await attestClaimPayout(db, claim(), { verifiedVersion: claim().payoutDestinationVersion ?? undefined, actorUserId: 'manager-1', verifiedAt: approvedAt, approvalStepId: steps[0].id });
        Object.assign(steps[0], { status: 'APPROVED', assignedApproverUserIds: ['manager-1'], decisionByUserId: 'manager-1', decidedAt: approvedAt });
        bump({ status: 'READY_FOR_PAYMENT', approvedAt, currentApprovalStepId: null, paymentStatus: 'UNPAID' });
      }
      calls.outbox.length = 0;
      world.audits.length = 0;
      world.notifications.length = 0;
      return draft.id as string;
    },
  };
}

describe('payout correction: sending a claim that waits for payment back for its account (AC29)', () => {
  const reason = { reasonCode: 'ACCOUNT_NUMBER_WRONG' };

  it('takes whoever may record its payment, the approver it stands on and its requester, and nobody else', async () => {
    const senders: Array<[string, any, string]> = [
      ['whoever may record its payment', payerCtx(), 'PAYER'],
      ['the approver it stands on, who cannot pay', approverCtx(), 'APPROVER'],
      ['its requester', ctx(), 'REQUESTER'],
    ];
    for (const [who, viewer, sentBackBy] of senders) {
      const world = correctionWorld();
      const id = await world.ready();
      assert.deepEqual((await world.detail.execute(viewer, id)).payoutCorrectionActions, { canRequest: true, canSubmit: false }, who);
      const detail = await world.sendBack.execute(viewer, id, reason);
      assert.deepEqual([detail.status, detail.requestNo, detail.payoutCorrection?.phase, detail.currentDesk], ['PENDING_APPROVAL', 'RB-202601-000001', 'AWAITING_REQUESTER', { kind: 'REQUESTER' }], who);
      assert.equal(world.audits.find((entry) => entry.action === 'reimbursement.payout_correction.request').metadataJson.sentBackBy, sentBackBy, who);
    }
    const refused: Array<[string, any]> = [
      ['a reader of the claim', readerCtx()],
      // The finance reviewer holds no pay right here, and reviewing is not paying.
      ['a finance reviewer who cannot pay', financeCtx()],
      ['an approver of other claims', approverCtx({ userId: 'manager-2' })],
      ['whoever may pay, outside the claim branch', payerCtx({ scopes: { branchIds: ['branch-2'] } })],
      ['a requester who may not edit their own claims', ctx({ permissions: ['reimbursement.read_own'] })],
    ];
    for (const [who, viewer] of refused) {
      const world = correctionWorld();
      const id = await world.ready();
      const flags = await world.detail.execute(viewer, id).then((detail) => detail.payoutCorrectionActions, () => undefined);
      assert.equal(flags, undefined, `${who}: no button`);
      await assert.rejects(() => world.sendBack.execute(viewer, id, reason), (error: any) => error.getStatus() === 403, who);
      assert.deepEqual([world.claim().status, world.events()], ['READY_FOR_PAYMENT', []], who);
    }
    // A refusal for want of the right is on record: it is an attempt to stop a payment.
    const world = correctionWorld();
    const id = await world.ready();
    await assert.rejects(() => world.sendBack.execute(readerCtx(), id, reason), /^ForbiddenException: payout_correction_denied$/);
    assert.deepEqual(world.audits.map((entry) => [entry.action, entry.result, entry.actorUserId]), [['reimbursement.payout_correction.request', 'DENIED', 'reader-1']]);
  });

  it('refuses a claim that is paid, not at the pay step, being cancelled, or already with its requester', async () => {
    const world = correctionWorld();
    const id = await world.ready();
    // Paid: the payment is voided first, the account it went into is never changed under it.
    world.payments.push({ id: 'pay-1', status: 'RECORDED', paidAmount: '120.0000', paidAt: new Date(), paidByUserId: 'payer-1', paymentMethod: 'BANK_TRANSFER' });
    await assert.rejects(() => world.sendBack.execute(payerCtx(), id, reason), (error: any) => error.getStatus() === 409 && error.message === 'payout_correction_not_allowed');
    assert.equal((await world.detail.execute(payerCtx(), id)).payoutCorrectionActions, undefined);
    // A voided payment does not stand in the way.
    world.payments[0].status = 'VOIDED';
    assert.equal((await world.detail.execute(payerCtx(), id)).payoutCorrectionActions?.canRequest, true);

    for (const status of ['DRAFT', 'FINANCE_REVIEW', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED']) {
      world.bump({ status });
      await assert.rejects(() => world.sendBack.execute(payerCtx(), id, reason), /payout_correction_not_allowed/, status);
    }
    world.bump({ status: 'READY_FOR_PAYMENT', cancellationPendingAt: new Date(), cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ยกเลิกคำขอเบิกค่าใช้จ่าย' });
    await assert.rejects(() => world.sendBack.execute(payerCtx(), id, reason), (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_cancellation_pending');
    assert.equal((await world.detail.execute(payerCtx(), id)).payoutCorrectionActions, undefined);
    world.bump({ cancellationPendingAt: undefined, cancellationPendingByUserId: undefined, cancellationPendingReason: undefined });

    await world.sendBack.execute(payerCtx(), id, reason);
    // Someone with the page from before presses again: the claim is already with its requester.
    await assert.rejects(() => world.sendBack.execute(approverCtx(), id, reason), (error: any) => error.getStatus() === 409 && error.message === 'payout_correction_in_progress');
    assert.equal(world.events().length, 1);
  });

  it('takes a reason from the fixed list and a note that carries no account number, and tells the requester alone', async () => {
    const world = correctionWorld();
    const id = await world.ready();
    for (const bad of [{}, { reasonCode: '' }, { reasonCode: 'เลขบัญชีผิด' }, { reasonCode: 'account_number_wrong' }, { reasonCode: 7 }, undefined]) {
      await assert.rejects(() => world.sendBack.execute(payerCtx(), id, bad as any), (error: any) => error.getStatus() === 400 && error.message === 'payout_correction_reason_required');
    }
    await assert.rejects(() => world.sendBack.execute(payerCtx(), id, { reasonCode: 'OTHER', note: 'x'.repeat(501) }), (error: any) => error.getStatus() === 400 && error.message === 'payout_correction_note_too_long');
    for (const note of ['ที่ถูกคือ 012-3-45678-9', 'โอนเข้า 0812345678 แทน']) {
      await assert.rejects(() => world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_NUMBER_WRONG', note }), (error: any) => error.getStatus() === 400 && error.message === 'note_contains_account_number');
    }
    assert.deepEqual([world.claim().status, world.events(), world.audits], ['READY_FOR_PAYMENT', [], []]);

    const detail = await world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_NAME_MISMATCH', note: '  ชื่อบัญชีเป็นของภรรยา  ' });
    assert.deepEqual(detail.payoutCorrection, {
      phase: 'AWAITING_REQUESTER', requestedAt: world.claim().payoutCorrectionRequestedAt.toISOString(), requestedByUserId: 'payer-1', requestedByName: 'ประไพ',
      reasonCode: 'ACCOUNT_NAME_MISMATCH', note: 'ชื่อบัญชีเป็นของภรรยา',
      previous: { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789', version: 1 },
      previouslyApprovedAt: world.steps[0].decidedAt.toISOString(),
    });
    // One notice, for the requester: the reason in the list's own words, nothing anyone typed, no account.
    const [event] = world.events();
    assert.equal(world.events().length, 1);
    assert.equal(event.eventType, 'reimbursement.payout_correction_requested');
    assert.deepEqual(event.payloadJson.data, {
      requestId: id, requestNo: 'RB-202601-000001', requesterUserId: 'staff-1', status: 'PENDING_APPROVAL',
      payoutCorrectionTitle: 'ใบเบิกต้องแก้บัญชีรับเงิน',
      payoutCorrectionNotice: 'เหตุผล: ชื่อบัญชีไม่ตรงกับผู้เบิก · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน',
    });
    assert.equal(event.payloadJson.actorUserId, 'payer-1');
    const [entry] = world.audits;
    assert.deepEqual([world.audits.length, entry.action, entry.result, entry.riskLevel], [1, 'reimbursement.payout_correction.request', 'SUCCESS', 'HIGH']);
    assert.deepEqual(entry.metadataJson, {
      requestNo: 'RB-202601-000001', reasonCode: 'ACCOUNT_NAME_MISMATCH', hasNote: true, sentBackBy: 'PAYER', again: false,
      payoutMethod: 'BANK_TRANSFER', payoutVersion: 1, setAsideStepIds: ['step-1'], signaturesRemoved: 0, declarationsSetAside: 0,
    });
    assert.ok(!JSON.stringify([world.events(), world.audits]).includes('ภรรยา'), 'the note stays on the claim');
    assert.equal(leaksNumber([detail, world.events(), world.audits]), false);
  });
});

describe('payout correction: what the claim says and allows while it is in a round (AC30)', () => {
  it('is with its requester, in the approval bucket, in no queue, and cannot be paid, decided or reopened', async () => {
    const world = correctionWorld();
    const id = await world.ready();
    const before = { ...world.claim() };
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'BANK_WRONG' });
    const claim = world.claim();
    // Only the round moved: the number, the amounts, the lines, the evidence and every other state are the ones it was approved with.
    for (const field of ['requestNo', 'amount', 'outstandingAmount', 'paymentTotalAmount', 'lines', 'duplicateStatus', 'postingStatus', 'financeReviewStatus',
      'receiptRequirementStatus', 'approvalSnapshotHash', 'approvalPolicySnapshotJson', 'submittedAt', 'payoutMethod', 'payoutDestinationVersion', 'payoutFingerprint']) {
      assert.deepEqual(claim[field], before[field], field);
    }
    assert.deepEqual([claim.status, claim.approvedAt, claim.paymentStatus, claim.currentApprovalStepId], ['PENDING_APPROVAL', undefined, 'NOT_PAYABLE', null]);

    // Every reader says the same: with the requester, not with an approver and not "waiting for the system".
    for (const viewer of [ctx(), approverCtx(), payerCtx(), readerCtx()]) {
      const detail = await world.detail.execute(viewer, id);
      assert.deepEqual([detail.currentDesk, detail.payoutCorrectionPhase, detail.awaitingSystem, detail.paymentDesk, detail.approvalActions],
        [{ kind: 'REQUESTER' }, 'AWAITING_REQUESTER', undefined, undefined, { canApprove: false, canReject: false }], viewer.userId);
      assert.equal(reimbursementHubBucket(detail), 'review');
    }
    assert.equal(hubBucketOfStatus(claim.status, claim.financeReviewStatus), 'review', 'the card that counts it is the one whose list shows it');
    assert.deepEqual(await new ListFinanceQueueUseCase(world.state.repo).execute(financeCtx()), []);

    // Not payable, by its status and by name.
    const pay = new RecordReimbursementPaymentUseCase(world.state.repo, noopAudit,
      { execute: async () => ({ id: 'seq-1', documentNumber: 'RBPAY-1' }) } as any, { execute: async () => undefined } as any, evidenceService());
    await assert.rejects(() => pay.execute(payerCtx(), id, { paidAmount: claim.amount, paymentMethod: 'CASH', paidAt: new Date().toISOString() } as any),
      (error: any) => error.getStatus() === 409 && error.message === 'payout_correction_in_progress');
    // Not a draft again: its expense records stand, only its account changes.
    await assert.rejects(() => world.reopen.execute(ctx(), id), (error: any) => error.getStatus() === 409 && error.message === 'payout_correction_in_progress');
    await assert.rejects(() => world.update.execute(ctx(), id, { reason: 'แก้ยอด' } as any), /Cannot edit|DRAFT|draft/i);
    assert.deepEqual([world.claim().status, world.claim().payoutCorrectionRequestedAt !== undefined], ['PENDING_APPROVAL', true]);
  });

  it('can still be cancelled, by the rule every claim is cancelled by', async () => {
    const world = correctionWorld({ claimProjections: [{ id: 'exp-1', sourceReimbursementLineId: 'rbl-1' }] });
    const id = await world.ready();
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'REQUESTER_ASKED' });
    const cancel = new CancelReimbursementUseCase(world.state.repo, noopAudit, world.state.voidExpense);
    const cancelled = await cancel.execute(ctx({ permissions: ['reimbursement.cancel_own', 'reimbursement.read_own'] }), id, 'ยกเลิกคำขอเบิกค่าใช้จ่าย');
    assert.deepEqual([cancelled.status, world.state.calls.voided, cancelled.currentDesk, cancelled.payoutCorrectionPhase], ['CANCELLED', ['exp-1'], undefined, undefined]);
    // A claim that is no longer waiting for approval is in no round, whatever its columns still say.
    assert.equal((await world.detail.execute(ctx(), id)).payoutCorrection, undefined);
    // It is refused for what it is, by both calls and for whoever asks.
    await assert.rejects(() => world.giveAccount.execute(ctx(), id, { mode: 'CASH' }), /^ConflictException: payout_correction_not_requested$/);
    await assert.rejects(() => world.sendBack.execute(payerCtx(), id, { reasonCode: 'OTHER' }), /^ConflictException: payout_correction_not_allowed$/);
  });
});

describe('payout correction: the requester gives the account and it is approved again (AC31)', () => {
  const sentBack = async (world: ReturnType<typeof correctionWorld>, send: Parameters<ReturnType<typeof correctionWorld>['ready']>[0] = {}) => {
    const id = await world.ready(send);
    // A reason the claim takes: a wrong account number is no reason for a claim that asked for cash.
    await world.sendBack.execute(payerCtx(), id, { reasonCode: world.claim().payoutMethod === 'CASH' ? 'CASH_NOT_PAYABLE' : 'ACCOUNT_NUMBER_WRONG' });
    world.events().length = 0;
    world.audits.length = 0;
    return id;
  };

  it('lets the requester, or a finance reviewer on their behalf, give it, and nobody else', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    // Before anything was sent back, there is nothing to give.
    const untouched = correctionWorld();
    const readyId = await untouched.ready();
    await assert.rejects(() => untouched.giveAccount.execute(ctx(), readyId, { mode: 'CASH' }), (error: any) => error.getStatus() === 409 && error.message === 'payout_correction_not_requested');

    const flags = async (viewer: any) => (await world.detail.execute(viewer, id)).payoutCorrectionActions;
    const kbankDefault = { payoutMethod: 'BANK_TRANSFER', payoutKind: 'BANK_ACCOUNT', bankName: 'ธนาคารกสิกรไทย', accountName: 'นาย สมชาย ใจดี', accountLast4: '6789' };
    const requesterFlags = await flags(ctx());
    assert.deepEqual({ ...requesterFlags, requesterDefault: { ...requesterFlags!.requesterDefault, token: 'x' } },
      { canRequest: false, canSubmit: true, requesterDefault: { ...kbankDefault, token: 'x' }, submitModes: ['DEFAULT', 'SPECIFIED', 'SAVED', 'CASH', 'PREVIOUS'] });
    assert.equal(requesterFlags!.requesterDefault!.token, payoutDefaultToken(id, await world.state.repo.findMemberPayoutAccount('co-1', 'staff-1')));
    assert.deepEqual((await flags(financeCtx()))?.canSubmit, true, 'on the requester\'s behalf, as for a draft');
    for (const viewer of [approverCtx(), payerCtx(), readerCtx()]) {
      assert.equal(await flags(viewer), undefined, viewer.userId);
      await assert.rejects(() => world.giveAccount.execute(viewer, id, { mode: 'CASH' }), /^ForbiddenException: payout_correction_denied$/, viewer.userId);
    }
    assert.deepEqual(world.audits.map((entry) => [entry.action, entry.result]), Array(3).fill(['reimbursement.payout_correction.submit', 'DENIED']));
    assert.deepEqual([world.claim().payoutCorrectionSubmittedAt, world.events()], [undefined, []]);
    assert.equal(leaksNumber(requesterFlags), false);
  });

  // Upgrade test 2026-10-02: a finance reviewer filled in an account for a requester who had left, and was told it
  // could not be taken only after pressing save. The detail now lists the choices the endpoint takes from this viewer.
  it('says up front which choices the account endpoint takes from this viewer, and the endpoint takes those and refuses the rest', async () => {
    const offered = async (world: ReturnType<typeof correctionWorld>, viewer: any, id: string) => {
      const actions = (await world.detail.execute(viewer, id)).payoutCorrectionActions;
      return [actions?.submitModes, actions?.specifiedRefusal];
    };
    const refused = (code: string) => (error: any) => error.getStatus() === 409 && error.message === code;

    // An active requester with a default, on a claim approved with an account: every choice, for them and for a finance reviewer.
    const world = correctionWorld();
    const id = await sentBack(world);
    for (const viewer of [ctx(), financeCtx()]) assert.deepEqual(await offered(world, viewer, id), [['DEFAULT', 'SPECIFIED', ...(viewer.userId === 'staff-1' ? ['SAVED'] : []), 'CASH', 'PREVIOUS'], undefined], viewer.userId);
    // Whoever may not give the account is told nothing of its choices.
    assert.equal((await world.detail.execute(approverCtx(), id)).payoutCorrectionActions, undefined);

    // The requester left: nobody types an account for them, and the detail says so before anyone tries. They have no
    // default either, so that choice is not listed.
    const gone = correctionWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus: 'DISABLED' } } });
    const goneId = await sentBack(gone, { setDefault: null, payout: { mode: 'SPECIFIED', ...KBANK } });
    assert.deepEqual(await offered(gone, financeCtx(), goneId), [['CASH', 'PREVIOUS'], 'REQUESTER_NOT_ACTIVE']);
    await assert.rejects(() => gone.giveAccount.execute(financeCtx(), goneId, { mode: 'SPECIFIED', ...SCB }), refused('payout_account_member_not_active'));
    await assert.rejects(() => gone.giveAccount.execute(financeCtx(), goneId, { mode: 'DEFAULT', defaultToken: 'x' }), refused('payout_method_required'));
    assert.equal(gone.claim().payoutCorrectionSubmittedAt, undefined, 'the two unlisted choices wrote nothing');
    assert.equal((await gone.giveAccount.execute(financeCtx(), goneId, { mode: 'PREVIOUS' })).payoutCorrection?.phase, 'AWAITING_APPROVAL');
    // Still the same list while the account waits for approval, where it may be given again; cash is taken too.
    assert.deepEqual(await offered(gone, financeCtx(), goneId), [['CASH', 'PREVIOUS'], 'REQUESTER_NOT_ACTIVE']);
    assert.equal((await gone.giveAccount.execute(financeCtx(), goneId, { mode: 'CASH' })).payout?.payoutMethod, 'CASH');
    // An inactive requester who set a default before leaving: the default is theirs and nobody types it, so it is listed and taken.
    const left = correctionWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus: 'DISABLED' } } });
    const leftId = await sentBack(left);
    assert.deepEqual(await offered(left, financeCtx(), leftId), [['DEFAULT', 'CASH', 'PREVIOUS'], 'REQUESTER_NOT_ACTIVE']);
    const token = (await left.detail.execute(financeCtx(), leftId)).payoutCorrectionActions!.requesterDefault!.token;
    assert.equal((await left.giveAccount.execute(financeCtx(), leftId, { mode: 'DEFAULT', defaultToken: token })).payoutCorrection?.phase, 'AWAITING_APPROVAL');

    // A claim that had no account of its own has none to keep: that choice is not listed, and is refused.
    const legacy = correctionWorld();
    const legacyId = await legacy.ready({ setDefault: null, payout: { mode: 'CASH' } });
    Object.assign(legacy.claim(), { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined });
    await legacy.sendBack.execute(payerCtx(), legacyId, { reasonCode: 'NO_ACCOUNT_ON_CLAIM' });
    assert.deepEqual(await offered(legacy, ctx(), legacyId), [['SPECIFIED', 'SAVED', 'CASH'], undefined]);
    await assert.rejects(() => legacy.giveAccount.execute(ctx(), legacyId, { mode: 'PREVIOUS' }), refused('payout_destination_required'));
    await assert.rejects(() => legacy.giveAccount.execute(ctx(), legacyId, { mode: 'DEFAULT', defaultToken: 'x' }), refused('payout_method_required'));
    assert.equal((await legacy.giveAccount.execute(ctx(), legacyId, { mode: 'SPECIFIED', ...KBANK })).payout?.accountLast4, '6789');
  });

  it('freezes the new account as a new version, asks the same approvers again and shows them both accounts', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    const hashBefore = world.claim().approvalSnapshotHash;
    const detail = await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });

    // A new frozen version; the first one stays as it was, with who checked it.
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.frozenAt !== null, row.verifiedByUserId ?? null, row.source]),
      [[1, '6789', true, 'manager-1', 'DEFAULT_ACCOUNT'], [2, '9012', true, null, 'REQUESTER']]);
    const claim = world.claim();
    assert.deepEqual([claim.status, claim.payoutMethod, claim.payoutDestinationVersion, claim.currentApprovalStepId], ['PENDING_APPROVAL', 'BANK_TRANSFER', 2, 'step-2']);
    // The hash is the same claim with the new account, and the new step is bound to it.
    assert.notEqual(claim.approvalSnapshotHash, hashBefore);
    assert.equal(claim.approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(claim, claim.approvalPolicySnapshotJson)));
    assert.deepEqual(world.steps.map((step) => [step.id, step.status, step.sequenceNo, step.assignedApproverUserIds, step.approverRoleSnapshot, step.invalidatedReason ?? null]), [
      ['step-1', 'APPROVED', 1, ['manager-1'], 'MANAGER', 'payout_account_correction'],
      ['step-2', 'PENDING', 1, ['manager-1'], 'MANAGER', null],
    ]);
    assert.equal(world.steps[1].requestSnapshotHash, claim.approvalSnapshotHash);

    // What every viewer reads: waiting for the same approver, with the account it had and the one it has now.
    assert.deepEqual([detail.currentDesk, detail.payoutCorrectionPhase, detail.payoutCorrection?.phase, detail.payoutCorrection?.submittedAt],
      [{ kind: 'APPROVER', names: ['วิภา'] }, 'AWAITING_APPROVAL', 'AWAITING_APPROVAL', claim.payoutCorrectionSubmittedAt.toISOString()]);
    assert.deepEqual([detail.payoutCorrection?.previous?.accountLast4, detail.payoutCorrection?.previous?.version, detail.payout?.accountLast4, detail.payout?.version, detail.payout?.verifiedAt],
      ['6789', 1, '9012', 2, undefined]);
    assert.deepEqual((await world.detail.execute(approverCtx(), id)).approvalActions, { canApprove: true, canReject: true });
    assert.deepEqual((await world.detail.execute(approverCtx(), id)).payoutCorrectionActions, { canRequest: true, canSubmit: false }, 'the approver may send it back again');
    assert.deepEqual((await world.detail.execute(payerCtx(), id)).payoutCorrectionActions, undefined, 'whoever pays has nothing to do until it is approved');

    // One notice, to the approvers of the new step, not to the requester who sent it.
    const [event] = world.events();
    assert.deepEqual([world.events().length, event.eventType, event.eventKey], [1, 'reimbursement.payout_correction_submitted', `reimbursement.payout_correction_submitted:reimbursement_request:${id}:step-2`]);
    assert.deepEqual(event.payloadJson.data, {
      requestId: id, requestNo: 'RB-202601-000001', requesterUserId: 'staff-1', amount: claim.amount, currency: 'THB',
      status: 'PENDING_APPROVAL', stepId: 'step-2', approverRecipientUserIds: ['manager-1'],
      // Another account in place of the one the claim had: the one answer whose notice says "ใหม่".
      payoutAnswerTitle: 'รออนุมัติบัญชีรับเงินใหม่', payoutAnswerNotice: 'รอคุณตรวจและอนุมัติบัญชีรับเงินใหม่',
    });
    const [entry] = world.audits;
    assert.deepEqual([world.audits.length, entry.action, entry.result], [1, 'reimbursement.payout_correction.submit', 'SUCCESS']);
    assert.deepEqual(entry.metadataJson, {
      requestNo: 'RB-202601-000001', payout: { mode: 'SPECIFIED', source: 'REQUESTER', method: 'BANK_TRANSFER', version: 2 },
      onBehalfOfRequester: false, previousVersion: 1, approvalStepId: 'step-2', replacedStepId: null, readyForPayment: false,
    });
    assert.equal(leaksNumber([detail, world.events(), world.audits]), false);
  });

  it('takes the same account again, the default as the page showed it, cash, and a new default, each as a new answer', async () => {
    // Sent back by mistake: the requester confirms the account it had. Still a new version and a new approval.
    const same = correctionWorld();
    const sameId = await sentBack(same);
    const token = (await same.detail.execute(ctx(), sameId)).payoutCorrectionActions!.requesterDefault!.token;
    await same.giveAccount.execute(ctx(), sameId, { mode: 'DEFAULT', defaultToken: token });
    assert.deepEqual(same.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.source]), [[1, '6789', 'DEFAULT_ACCOUNT'], [2, '6789', 'DEFAULT_ACCOUNT']]);
    assert.deepEqual([same.claim().payoutDestinationVersion, same.claim().currentApprovalStepId], [2, 'step-2']);

    // The default changed after the page was read: the page is asked to show it again, and nothing is frozen.
    const moved = correctionWorld();
    const movedId = await sentBack(moved);
    const seen = (await moved.detail.execute(ctx(), movedId)).payoutCorrectionActions!.requesterDefault!.token;
    await moved.payouts.setOwn(ctx(), SCB);
    for (const defaultToken of [seen, undefined, 'x']) {
      await assert.rejects(() => moved.giveAccount.execute(ctx(), movedId, { mode: 'DEFAULT', defaultToken } as any), (error: any) => error.getStatus() === 409 && error.message === 'payout_destination_changed');
    }
    assert.deepEqual([moved.state.payoutTables.destinations.length, moved.claim().payoutCorrectionSubmittedAt, moved.events()], [1, undefined, []]);

    // Cash: no account row, and the claim says cash.
    const cash = correctionWorld();
    const cashId = await sentBack(cash);
    const asCash = await cash.giveAccount.execute(ctx(), cashId, { mode: 'CASH' });
    assert.deepEqual([cash.claim().payoutMethod, cash.claim().payoutDestinationVersion, cash.state.payoutTables.destinations.length, asCash.payout?.payoutMethod, asCash.payoutCorrection?.previous?.accountLast4],
      ['CASH', null, 1, 'CASH', '6789']);

    // "Save as my default": the default is set in the same transaction, and the claim copies exactly that.
    const saved = correctionWorld();
    const savedId = await sentBack(saved);
    await saved.giveAccount.execute(ctx(), savedId, { mode: 'SPECIFIED', saveAsDefault: true, ...PROMPTPAY });
    assert.deepEqual([saved.state.payoutTables.accounts[0]!.accountLast4, saved.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.source])],
      ['5678', [[1, '6789', 'DEFAULT_ACCOUNT'], [2, '5678', 'DEFAULT_ACCOUNT']]]);
    assert.equal(leaksNumber([saved.events(), saved.audits]), false);
  });

  it('lets a finance reviewer give it on the requester\'s behalf, and tells the requester who answered and with which account', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    await world.giveAccount.execute(financeCtx(), id, { mode: 'SPECIFIED', ...SCB });
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.source, row.createdByUserId]).slice(1), [[2, 'PREPARER', 'finance-1']]);
    assert.equal(world.audits[0].metadataJson.onBehalfOfRequester, true);
    // ONE notice, to the requester alone, with the last four digits: the notice of a round answered for them, in the
    // words of that answer, and not also the one an account typed on a draft sends ("… ระบุบัญชีรับเงินในใบเบิกของคุณ").
    assert.deepEqual(world.notifications.map((notice) => [notice.recipientUserIds, notice.triggerKey, notice.title]),
      [[['staff-1'], 'reimbursement.payout_account_set_by_other', 'อรทัย แก้บัญชีรับเงินในใบเบิกของคุณ: RB-202601-000001']]);
    assert.match(world.notifications[0].body, /^ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012 /);
    assert.equal(leaksNumber([world.notifications, world.events(), world.audits]), false);
  });

  // Final review W6. A claim sent back by mistake, whose account was typed for that claim, could not get it
  // back once its requester had left: only the stored default or cash could be given for them.
  it('lets a finance reviewer keep the account the claim had for a requester who is no longer active, and still refuses typing one for them', async () => {
    const world = correctionWorld({ payoutMembers: { 'staff-1': { ...EMPLOYEE, membershipStatus: 'DISABLED' } } });
    const id = await sentBack(world, { setDefault: null, payout: { mode: 'SPECIFIED', ...KBANK } });
    const hashBefore = world.claim().approvalSnapshotHash;
    // Typing a new account for someone no notice can reach stays refused, and nothing is written.
    await assert.rejects(() => world.giveAccount.execute(financeCtx(), id, { mode: 'SPECIFIED', ...SCB }), (error: any) => error.getStatus() === 409 && error.message === 'payout_account_member_not_active');
    assert.deepEqual([world.state.payoutTables.destinations.length, world.claim().payoutCorrectionSubmittedAt], [1, undefined]);

    const given = await world.giveAccount.execute(financeCtx(), id, { mode: 'PREVIOUS' });
    // The same account as a new frozen version, with who entered it as it was: nobody typed anything.
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.source, row.createdByUserId, row.frozenAt !== null, row.verifiedByUserId ?? null]),
      [[1, '6789', 'REQUESTER', 'staff-1', true, 'manager-1'], [2, '6789', 'REQUESTER', 'staff-1', true, null]]);
    assert.equal(world.state.payoutTables.destinations[1]!.accountNumberEncrypted, world.state.payoutTables.destinations[0]!.accountNumberEncrypted, 'the sealed number moved as it is');
    assert.deepEqual([given.payoutCorrection?.phase, given.payout?.version, given.payout?.accountLast4, world.claim().currentApprovalStepId], ['AWAITING_APPROVAL', 2, '6789', 'step-2']);
    // Approved again like any other answer: a new hash, a new step, a notice to its approver, and none to the requester.
    assert.notEqual(world.claim().approvalSnapshotHash, hashBefore);
    assert.deepEqual([world.events().map((event) => event.eventType), world.notifications], [['reimbursement.payout_correction_submitted'], []]);
    const entry = world.audits.find((row) => row.result === 'SUCCESS');
    assert.deepEqual([entry.metadataJson.payout, entry.metadataJson.onBehalfOfRequester, entry.metadataJson.previousVersion], [{ mode: 'PREVIOUS', method: 'BANK_TRANSFER', version: 2 }, true, 1]);
    const waiting = await world.detail.execute(approverCtx(), id);
    assert.equal((await world.approve.execute(approverCtx(), id, undefined, waiting.approvalSnapshotHash, 2)).status, 'READY_FOR_PAYMENT');
    assert.equal(leaksNumber([given, world.events(), world.audits]), false);
  });

  it('keeps the account the claim was approved with, not one refused since: cash stays cash, and a claim that had none has nothing to keep', async () => {
    // Another account was given and refused: "the account it had" is still the one it was approved with.
    const world = correctionWorld();
    const id = await sentBack(world);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    await world.sendBack.execute(approverCtx(), id, { reasonCode: 'ACCOUNT_NAME_MISMATCH' });
    assert.deepEqual([world.claim().payoutDestinationVersion, (await world.detail.execute(ctx(), id)).payoutCorrection?.previous?.version], [2, 1]);
    await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.accountLast4, row.source]),
      [[1, '6789', 'DEFAULT_ACCOUNT'], [2, '9012', 'REQUESTER'], [3, '6789', 'DEFAULT_ACCOUNT']]);
    assert.equal(world.claim().payoutDestinationVersion, 3);

    const cash = correctionWorld();
    const cashId = await sentBack(cash, { setDefault: null, payout: { mode: 'CASH' } });
    await cash.giveAccount.execute(ctx(), cashId, { mode: 'PREVIOUS' });
    assert.deepEqual([cash.claim().payoutMethod, cash.claim().payoutDestinationVersion, cash.state.payoutTables.destinations.length], ['CASH', null, 0]);

    // Sent before claims carried a receiving method: there is no account of its own to keep.
    const legacy = correctionWorld();
    const legacyId = await legacy.ready({ setDefault: null, payout: { mode: 'CASH' } });
    Object.assign(legacy.claim(), { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined });
    await legacy.sendBack.execute(payerCtx(), legacyId, { reasonCode: 'NO_ACCOUNT_ON_CLAIM' });
    await assert.rejects(() => legacy.giveAccount.execute(ctx(), legacyId, { mode: 'PREVIOUS' }), (error: any) => error.getStatus() === 409 && error.message === 'payout_destination_required');
    assert.equal(legacy.claim().payoutCorrectionSubmittedAt, undefined);
  });

  // Upgrade test 2026-10-02: a requester who chose "ใช้บัญชีเดิมของใบนี้" left the approver a card with two accounts
  // that read alike (bank, name, last 4 digits) and no word that they are one account. The server knows: it compares
  // what it stores, and says yes or no.
  it('says whether the account given in a round is the very account the claim had, and gives away nothing it compared', async () => {
    const same = async (world: ReturnType<typeof correctionWorld>, id: string) => (await world.detail.execute(approverCtx(), id)).payoutCorrection?.sameAsPrevious;
    const world = correctionWorld();
    const id = await sentBack(world);
    // Not asked before an account is given: there is nothing to compare yet.
    const waiting = await world.detail.execute(ctx(), id);
    assert.deepEqual([waiting.payoutCorrection?.phase, 'sameAsPrevious' in waiting.payoutCorrection!], ['AWAITING_REQUESTER', false]);
    // "The account the claim had", the same account typed again, and the default that is that account: each a new version, each the same account.
    const kept = await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.deepEqual([kept.payoutCorrection?.phase, kept.payoutCorrection?.sameAsPrevious, kept.payout?.version, kept.payoutCorrection?.previous?.version], ['AWAITING_APPROVAL', true, 2, 1]);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...KBANK });
    assert.equal(await same(world, id), true, 'typed again, digit for digit');
    const token = (await world.detail.execute(ctx(), id)).payoutCorrectionActions!.requesterDefault!.token;
    await world.giveAccount.execute(ctx(), id, { mode: 'DEFAULT', defaultToken: token });
    assert.equal(await same(world, id), true, 'the default it was sent with');
    // Another account, the same number under another name, and another method are not.
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    assert.equal(await same(world, id), false);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...KBANK, accountName: 'นาง สมศรี ใจดี' });
    assert.equal(await same(world, id), false, 'the same last 4 digits under another name is another account');
    await world.giveAccount.execute(ctx(), id, { mode: 'CASH' });
    assert.equal(await same(world, id), false);
    // The answer is all that leaves: no fingerprint of either account in what any reader of the claim gets.
    await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    const answer = JSON.stringify(await world.detail.execute(approverCtx(), id));
    for (const row of world.state.payoutTables.destinations) assert.equal(answer.includes(row.fingerprint), false);
    assert.doesNotMatch(answer, /fingerprint/i);
    assert.equal(leaksNumber(answer), false);

    // Cash both times is the same receiving method; cash changed to an account is not.
    const cash = correctionWorld();
    const cashId = await sentBack(cash, { setDefault: null, payout: { mode: 'CASH' } });
    assert.equal((await cash.giveAccount.execute(ctx(), cashId, { mode: 'PREVIOUS' })).payoutCorrection?.sameAsPrevious, true);
    assert.equal((await cash.giveAccount.execute(ctx(), cashId, { mode: 'SPECIFIED', ...KBANK })).payoutCorrection?.sameAsPrevious, false);
    // A claim that had no account of its own was given its first: never "the same".
    const legacy = correctionWorld();
    const legacyId = await legacy.ready({ setDefault: null, payout: { mode: 'CASH' } });
    Object.assign(legacy.claim(), { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined });
    await legacy.sendBack.execute(payerCtx(), legacyId, { reasonCode: 'NO_ACCOUNT_ON_CLAIM' });
    assert.equal((await legacy.giveAccount.execute(ctx(), legacyId, { mode: 'SPECIFIED', ...KBANK })).payoutCorrection?.sameAsPrevious, false);
  });

  // Final review W11: a claim being cancelled takes no account and no approval of one, in either phase of
  // a round, and offers neither. (The approval's own refusal is the repository's, under the claim lock.)
  it('takes no account for a claim that is being cancelled, offers nothing on it, and takes the account again once the cancellation is withdrawn', async () => {
    const cancelling = { cancellationPendingAt: new Date(), cancellationPendingByUserId: 'staff-1', cancellationPendingReason: 'ยกเลิกคำขอเบิกค่าใช้จ่าย' };
    const withdrawn = { cancellationPendingAt: undefined, cancellationPendingByUserId: undefined, cancellationPendingReason: undefined };
    const refused = (error: any) => error.getStatus() === 409 && error.message === 'reimbursement_cancellation_pending';
    const world = correctionWorld();
    const id = await sentBack(world);

    // With its requester.
    world.bump(cancelling);
    for (const viewer of [ctx(), financeCtx()]) {
      await assert.rejects(() => world.giveAccount.execute(viewer, id, { mode: 'SPECIFIED', ...SCB }), refused, viewer.userId);
      assert.equal((await world.detail.execute(viewer, id)).payoutCorrectionActions, undefined, viewer.userId);
    }
    assert.deepEqual([world.state.payoutTables.destinations.length, world.claim().payoutCorrectionSubmittedAt, world.events(), world.steps.length], [1, undefined, [], 1]);
    world.bump(withdrawn);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });

    // With its approver: no second answer is taken, and the approver is offered neither decision.
    world.bump(cancelling);
    await assert.rejects(() => world.giveAccount.execute(ctx(), id, { mode: 'CASH' }), refused);
    const shown = await world.detail.execute(approverCtx(), id);
    assert.deepEqual([shown.approvalActions, shown.payoutCorrectionActions, shown.currentDesk], [{ canApprove: false, canReject: false }, undefined, { kind: 'SYSTEM' }]);
    assert.deepEqual([world.state.payoutTables.destinations.length, world.claim().payoutMethod, world.steps.map((step) => step.status)], [2, 'BANK_TRANSFER', ['APPROVED', 'PENDING']]);
    world.bump(withdrawn);
    assert.deepEqual((await world.detail.execute(approverCtx(), id)).approvalActions, { canApprove: true, canReject: true });
  });

  // Final review W8. A second press that arrived after the first was taken froze another version, opened
  // another step and sent another notice: the call compared against its own read, not against the page's.
  it('refuses a second press of the same form once the first was taken, and still takes another account from the page of the waiting step', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    // What the form was opened on.
    const shown = (await world.detail.execute(ctx(), id)).updatedAt;
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB, expectedUpdatedAt: shown });
    const standing = () => [world.state.payoutTables.destinations.length, world.steps.map((step) => [step.id, step.status]), world.events().length, world.claim().payoutDestinationVersion];
    const taken = standing();
    assert.deepEqual(taken, [2, [['step-1', 'APPROVED'], ['step-2', 'PENDING']], 1, 2]);

    for (const late of [{ mode: 'SPECIFIED', ...SCB }, { mode: 'CASH' }, { mode: 'PREVIOUS' }] as const) {
      await assert.rejects(() => world.giveAccount.execute(ctx(), id, { ...late, expectedUpdatedAt: shown } as any),
        (error: any) => error.getStatus() === 409 && ((error.getResponse() as any).code ?? error.message) === 'reimbursement_changed', late.mode);
    }
    assert.deepEqual(standing(), taken, 'no version frozen, no step opened, nobody told');

    // The requester reads the claim again and gives another account while it waits: the page they read is the claim as it stands.
    const waiting = (await world.detail.execute(ctx(), id)).updatedAt;
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...PROMPTPAY, expectedUpdatedAt: waiting });
    assert.deepEqual(standing(), [3, [['step-1', 'APPROVED'], ['step-2', 'CANCELLED'], ['step-3', 'PENDING']], 2, 3]);
  });

  it('replaces the step that waits when the requester gives another account before it is approved', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...PROMPTPAY });
    assert.deepEqual(world.steps.map((step) => [step.id, step.status, step.invalidatedReason ?? null]),
      [['step-1', 'APPROVED', 'payout_account_correction'], ['step-2', 'CANCELLED', 'payout_account_correction'], ['step-3', 'PENDING', null]]);
    assert.deepEqual([world.claim().payoutDestinationVersion, world.claim().currentApprovalStepId, world.steps[2].assignedApproverUserIds], [3, 'step-3', ['manager-1']]);
    assert.deepEqual(world.audits.map((entry) => [entry.metadataJson.approvalStepId, entry.metadataJson.replacedStepId]), [['step-2', null], ['step-3', 'step-2']]);
    // The approver who still has the page of the second account approves nothing: neither its hash nor its version is current.
    const stale = world.steps[1].requestSnapshotHash;
    await assert.rejects(() => world.approve.execute(approverCtx(), id, undefined, stale, 2), /payout_destination_changed|stale_approval_snapshot/);
    assert.equal(world.claim().status, 'PENDING_APPROVAL');
  });

  // Final review S2. The old step may be weeks old and a claim in a round cannot be withdrawn and sent
  // again, so the new step keeps only the people who are on today's approval route.
  const ownerCtx = () => ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: ['reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'] });
  /** The manager the claim was approved by, moved to a staff role since: still an active member, no approve right. */
  const demotedCtx = () => approverCtx({ roles: ['STAFF'], permissions: ['reimbursement.read'] });

  it('asks the same approver again while they are on today\'s approval route for the step\'s role and branch', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    await world.giveAccount.execute(ctx(), id, { mode: 'CASH' });
    // The route is the submit's own, asked for the step's recorded role, the claim's branch and requester, under the claim's self-approval rule.
    assert.deepEqual(world.routeCalls, [{ companyId: 'co-1', branchId: world.claim().branchId, requesterUserId: 'staff-1', allowSelfApproval: false, roleKey: 'MANAGER', roleKeys: ['MANAGER'] }]);
    assert.deepEqual([world.steps[1].assignedApproverUserIds, world.events()[0].payloadJson.data.approverRecipientUserIds], [['manager-1'], ['manager-1']]);
    assert.deepEqual((await world.detail.execute(approverCtx(), id)).approvalActions, { canApprove: true, canReject: true });
  });

  it('does not ask a demoted approver, who cannot approve the account change, and lets the owner approve it when nobody else is left', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    // Today the manager role has no holder for this branch: the route falls to the owner.
    world.setRouteToday(['owner-1']);
    const given = await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    // The new step names nobody: its recorded role, or the owner, decides it.
    assert.deepEqual([world.steps[1].status, world.steps[1].assignedApproverUserIds, world.steps[1].approverUserId, world.steps[1].approverRoleSnapshot], ['PENDING', undefined, undefined, 'MANAGER']);
    assert.deepEqual(given.currentDesk, { kind: 'APPROVER' });
    assert.deepEqual(world.events()[0].payloadJson.data.approverRecipientUserIds, ['owner-1'], 'the notice asks who can approve, not who used to');

    const forDemoted = await world.detail.execute(demotedCtx(), id);
    assert.deepEqual([forDemoted.approvalActions, forDemoted.payoutCorrectionActions], [{ canApprove: false, canReject: false }, undefined]);
    await assert.rejects(() => world.approve.execute(demotedCtx(), id, undefined, forDemoted.approvalSnapshotHash, 2), (error: any) => error.getStatus() === 403);
    await assert.rejects(() => world.reject.execute(demotedCtx(), id, 'ไม่อนุมัติ'), (error: any) => error.getStatus() === 403);
    assert.equal(world.claim().status, 'PENDING_APPROVAL');

    const forOwner = await world.detail.execute(ownerCtx(), id);
    assert.deepEqual(forOwner.approvalActions, { canApprove: true, canReject: true });
    const approved = await world.approve.execute(ownerCtx(), id, undefined, forOwner.approvalSnapshotHash, 2);
    assert.deepEqual([approved.status, world.steps[1].decisionByUserId], ['READY_FOR_PAYMENT', 'owner-1']);
  });

  it('keeps of several approvers only those still on the route, and names nobody when the role itself can no longer approve', async () => {
    const world = correctionWorld();
    const id = await world.ready();
    world.steps[0].assignedApproverUserIds = ['manager-1', 'manager-2'];
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    world.events().length = 0;
    // manager-1 was moved to another role; manager-2 and a manager hired since hold it today.
    world.setRouteToday(['manager-2', 'manager-3']);
    await world.giveAccount.execute(ctx(), id, { mode: 'CASH' });
    assert.deepEqual([world.steps[1].assignedApproverUserIds, world.events()[0].payloadJson.data.approverRecipientUserIds], [['manager-2'], ['manager-2']]);
    assert.deepEqual((await world.detail.execute(approverCtx({ userId: 'manager-2' }), id)).approvalActions, { canApprove: true, canReject: true });
    assert.deepEqual((await world.detail.execute(approverCtx(), id)).approvalActions, { canApprove: false, canReject: false }, 'the step is the remaining assignee\'s');

    // The role lost the approve right for everyone: the resolver finds no route at all.
    const unrouted = correctionWorld();
    const unroutedId = await sentBack(unrouted);
    unrouted.setRouteToday(new BadRequestException('approver_role_not_eligible'));
    await unrouted.giveAccount.execute(ctx(), unroutedId, { mode: 'CASH' });
    assert.deepEqual([unrouted.steps[1].assignedApproverUserIds, unrouted.events()[0].payloadJson.data.approverRecipientUserIds], [undefined, undefined]);
    assert.deepEqual((await unrouted.detail.execute(ownerCtx(), unroutedId)).approvalActions, { canApprove: true, canReject: true });
    // Anything else the resolver fails with is not "nobody": the account is not given on a guess.
    const failing = correctionWorld();
    const failingId = await sentBack(failing);
    failing.setRouteToday(new Error('database unavailable'));
    await assert.rejects(() => failing.giveAccount.execute(ctx(), failingId, { mode: 'CASH' }), /database unavailable/);
    assert.equal(failing.claim().payoutCorrectionSubmittedAt, undefined);
  });

  it('is approved for the account alone and is ready for payment at once, with its whole round on record', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    const waiting = await world.detail.execute(approverCtx(), id);
    world.events().length = 0;
    world.audits.length = 0;

    const approved = await world.approve.execute(approverCtx(), id, undefined, waiting.approvalSnapshotHash, waiting.payout!.version);
    assert.deepEqual([approved.status, approved.currentDesk, approved.payoutCorrection, approved.payoutCorrectionPhase, world.claim().paymentStatus],
      ['READY_FOR_PAYMENT', { kind: 'PAYMENT' }, undefined, undefined, 'UNPAID']);
    // The account the approver checked is the one the claim now has and the pay step shows.
    const forPayer = await world.detail.execute(payerCtx(), id);
    assert.deepEqual([forPayer.payout?.version, forPayer.payout?.accountLast4, forPayer.payout?.verifiedByName, forPayer.payoutCorrectionActions],
      [2, '9012', 'วิภา', { canRequest: true, canSubmit: false }]);
    assert.deepEqual(world.state.payoutTables.destinations.map((row) => [row.version, row.verifiedByUserId ?? null, row.approvalStepId ?? null]), [[1, 'manager-1', 'step-1'], [2, 'manager-1', 'step-2']]);
    assert.deepEqual(world.events().map((event) => event.eventType), ['reimbursement.ready_for_payment']);

    // The timeline's three lines (spec §17.2), with the people named; the note-free reason is a code the page words.
    // Each line carries the fact its words are chosen from: what the claim held when it was sent back, what its
    // requester answered, and which answer was approved.
    const at = (index: number) => world.claim().payoutCorrectionLog[index].at;
    assert.deepEqual(forPayer.payoutCorrectionHistory, [
      { kind: 'SENT_BACK', at: at(0), byUserId: 'payer-1', byName: 'ประไพ', reasonCode: 'ACCOUNT_NUMBER_WRONG', held: 'ACCOUNT' },
      { kind: 'ACCOUNT_SUBMITTED', at: at(1), byUserId: 'staff-1', byName: 'สมชาย', payoutMethod: 'BANK_TRANSFER', payoutVersion: 2, answer: 'NEW_ACCOUNT' },
      { kind: 'REAPPROVED', at: at(2), byUserId: 'manager-1', byName: 'วิภา', approvalStepId: 'step-2', answer: 'NEW_ACCOUNT' },
    ]);
    assert.deepEqual(forPayer.approvalSteps.map((step) => [step.id, step.status]), [['step-1', 'APPROVED'], ['step-2', 'APPROVED']]);
    assert.equal(leaksNumber([approved, forPayer, world.events(), world.audits]), false);
  });

  it('goes back to its requester when the approver refuses the new account, and can be answered again', async () => {
    const world = correctionWorld();
    const id = await sentBack(world);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    world.events().length = 0;
    // Through either door: the reject button of the approval card, or the send-back call itself.
    const again = await world.reject.execute(approverCtx(), id, 'ชื่อบัญชีไม่ตรง', 'ACCOUNT_NAME_MISMATCH');
    assert.deepEqual([again.status, again.payoutCorrection?.phase, again.payoutCorrection?.requestedByName, again.payoutCorrection?.note, again.payoutCorrection?.previous?.version],
      ['PENDING_APPROVAL', 'AWAITING_REQUESTER', 'วิภา', 'ชื่อบัญชีไม่ตรง', 1]);
    assert.deepEqual(world.steps.map((step) => [step.id, step.status]), [['step-1', 'APPROVED'], ['step-2', 'CANCELLED']]);
    assert.deepEqual(world.events().map((event) => event.eventType), ['reimbursement.payout_correction_requested']);

    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...PROMPTPAY });
    // The same people as the approval the claim stood on, not nobody because the last step was cancelled.
    assert.deepEqual([world.steps[2].status, world.steps[2].assignedApproverUserIds, world.claim().payoutDestinationVersion], ['PENDING', ['manager-1'], 3]);
    const viaEndpoint = await world.sendBack.execute(approverCtx(), id, { reasonCode: 'ACCOUNT_UNUSABLE' });
    assert.equal(viaEndpoint.payoutCorrection?.phase, 'AWAITING_REQUESTER');
    // Whoever may pay has no say while the account waits for its approver.
    await world.giveAccount.execute(ctx(), id, { mode: 'CASH' });
    await assert.rejects(() => world.sendBack.execute(payerCtx(), id, { reasonCode: 'OTHER' }), /^ForbiddenException: payout_correction_denied$/);
    assert.deepEqual((await world.detail.execute(ctx(), id)).payoutCorrectionHistory!.map((event) => [event.kind, event.byName, event.reasonCode ?? event.payoutMethod]), [
      ['SENT_BACK', 'ประไพ', 'ACCOUNT_NUMBER_WRONG'], ['ACCOUNT_SUBMITTED', 'สมชาย', 'BANK_TRANSFER'], ['SENT_BACK', 'วิภา', 'ACCOUNT_NAME_MISMATCH'],
      ['ACCOUNT_SUBMITTED', 'สมชาย', 'BANK_TRANSFER'], ['SENT_BACK', 'วิภา', 'ACCOUNT_UNUSABLE'], ['ACCOUNT_SUBMITTED', 'สมชาย', 'CASH'],
    ]);
  });
});

describe('payout correction: claims finance passed, claims nobody approves and legacy claims (3B)', () => {
  it('D2: payout submission without approval states the ready transaction duplicate block', async (t) => {
    for (const block of ['CONFIRMED', 'UNRESOLVED', 'NONE']) await t.test(block, async () => {
      const world = correctionWorld({ policy: NO_APPROVAL_POLICY });
      const id = await world.ready();
      await world.sendBack.execute(payerCtx(), id, { reasonCode: 'BANK_WRONG' });
      world.events().length = 0;
      world.state.repo.paymentNoticeFacts = async (tx: any) => { assert.ok(tx.outboxEvent); return { paymentDuplicateBlock: block, duplicateReasons: [] }; };
      await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
      assert.equal(world.events().length, block === 'CONFIRMED' ? 0 : 1);
      if (world.events()[0]) {
        assert.equal(world.events()[0].payloadJson.data.paymentDuplicateBlock, block);
        assert.deepEqual(world.events()[0].payloadJson.data.approverRecipientUserIds, ['manager-1']);
      }
    });
  });
  it('makes a claim nobody had to approve ready for payment as soon as its account is given', async () => {
    const world = correctionWorld({ policy: NO_APPROVAL_POLICY });
    const id = await world.ready();
    assert.deepEqual([world.claim().status, world.steps.length], ['READY_FOR_PAYMENT', 0]);
    const sentBack = await world.sendBack.execute(payerCtx(), id, { reasonCode: 'BANK_WRONG' });
    assert.deepEqual([sentBack.payoutCorrection?.phase, sentBack.currentDesk, sentBack.awaitingSystem], ['AWAITING_REQUESTER', { kind: 'REQUESTER' }, undefined]);
    world.events().length = 0;
    world.audits.length = 0;

    const given = await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    assert.deepEqual([given.status, given.payoutCorrection, given.payout?.version, given.payout?.verifiedAt, world.claim().paymentStatus, world.steps.length],
      ['READY_FOR_PAYMENT', undefined, 2, undefined, 'UNPAID', 0]);
    // Nobody approved the account: whoever pays is the one to check it, and is told so by the notice they already get.
    assert.deepEqual(world.events().map((event) => event.eventType), ['reimbursement.ready_for_payment']);
    assert.deepEqual(world.events()[0].payloadJson.data, {
      requestId: id, requestNo: 'RB-202601-000001', requesterUserId: 'staff-1', amount: world.claim().amount, currency: 'THB',
      status: 'READY_FOR_PAYMENT', decision: 'BELOW_APPROVAL_THRESHOLD', paymentDuplicateBlock: 'NONE', approverRecipientUserIds: ['manager-1'],
    });
    assert.deepEqual([world.audits[0].metadataJson.readyForPayment, world.audits[0].metadataJson.approvalStepId], [true, null]);
    assert.deepEqual(given.payoutCorrectionHistory, undefined, 'the answer of a write carries no timeline; the page reads the claim again');
    assert.deepEqual((await world.detail.execute(ctx(), id)).payoutCorrectionHistory!.map((event) => event.kind), ['SENT_BACK', 'ACCOUNT_SUBMITTED']);
  });

  it('keeps the result of a finance review: the account is approved again, the review is not', async () => {
    const world = correctionWorld();
    const id = await world.ready();
    world.bump({ financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: 'finance-1', financeReviewedAt: new Date() });
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_UNUSABLE' });
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    assert.deepEqual([world.claim().financeReviewStatus, world.claim().financeReviewedByUserId], ['APPROVED_FOR_PAYMENT', 'finance-1']);
    world.events().length = 0;
    const waiting = await world.detail.execute(approverCtx(), id);
    const approved = await world.approve.execute(approverCtx(), id, undefined, waiting.approvalSnapshotHash, 2);
    assert.deepEqual([approved.status, approved.financeReviewStatus], ['READY_FOR_PAYMENT', 'APPROVED_FOR_PAYMENT']);
    // The ready-to-pay notice asks the finance reviewer who passed the claim first, as it did the first time:
    // the event names them where the notice looks first, ahead of its own actor, the approver. That is
    // the order the claim page names the two in (`paymentTurnUserIds`).
    const [ready] = world.events();
    assert.deepEqual([world.events().length, ready.eventType], [1, 'reimbursement.ready_for_payment']);
    assert.deepEqual([ready.payloadJson.data.financeReviewerUserId, ready.payloadJson.actorUserId], paymentTurnUserIds({ ...world.claim(), approvalSteps: world.steps }));
    assert.deepEqual([ready.payloadJson.data.financeReviewerUserId, ready.payloadJson.actorUserId], ['finance-1', 'manager-1']);
    // And still where a rule made before this order looks second, so nobody is dropped before the template sync runs.
    assert.deepEqual(ready.payloadJson.data.approverRecipientUserIds, ['finance-1']);
  });

  it('gives a legacy claim an account through a round: from then on it is hashed and attested like any claim with one', async () => {
    const world = correctionWorld();
    const id = await world.ready({ setDefault: null, payout: { mode: 'CASH' } });
    // As a build from before claims carried an account left it: no method, no account part in its hash.
    const claim = world.claim();
    Object.assign(claim, { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined });
    claim.approvalSnapshotHash = computeSnapshotHash(claimSnapshotFields(claim, claim.approvalPolicySnapshotJson));
    const legacyHash = claim.approvalSnapshotHash;
    assert.equal(hasPayoutSnapshot(claim), false);

    const sentBack = await world.sendBack.execute(payerCtx(), id, { reasonCode: 'NO_ACCOUNT_ON_CLAIM' });
    assert.deepEqual([sentBack.payoutCorrection?.previous, sentBack.payout], [undefined, undefined], 'it had no account to show');
    assert.equal(world.claim().approvalSnapshotHash, legacyHash, 'sending back changes no hash');
    const given = await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...KBANK });
    assert.deepEqual([given.payout?.version, given.payout?.accountLast4, hasPayoutSnapshot(world.claim())], [1, '6789', true]);
    assert.notEqual(world.claim().approvalSnapshotHash, legacyHash);
    assert.equal(world.claim().approvalSnapshotHash, computeSnapshotHash(claimSnapshotFields(world.claim(), world.claim().approvalPolicySnapshotJson)));
    // Its approver now has an account to check, like any claim paid by transfer.
    await assert.rejects(() => world.approve.execute(approverCtx(), id, undefined, world.claim().approvalSnapshotHash), /payout_verification_required/);
    const approved = await world.approve.execute(approverCtx(), id, undefined, world.claim().approvalSnapshotHash, 1);
    assert.deepEqual([approved.status, approved.payout?.verifiedByName], ['READY_FOR_PAYMENT', 'วิภา']);
  });

  // Payout spec §14.3. The reasons a send-back takes are the ones that are true of what the claim holds. Before, every
  // claim was offered the reasons of a wrong account: a claim with no account took five reasons that presumed one, and
  // so did a claim that had asked for cash, which has none.
  it('takes a reason only from the list of what the claim holds: one for a claim with no account, three of its own for cash, and no wrong bank for a PromptPay number', async () => {
    const refused = (error: any) => error.getStatus() === 400 && error.message === 'payout_correction_reason_required';
    const LEGACY = { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined };
    type Made = { world: ReturnType<typeof correctionWorld>; id: string; by: any };
    /** A claim that waits for payment, as it was sent; `legacy`: as a build from before claims carried a destination left it. */
    const ready = (send: Record<string, unknown>, legacy = false) => async (): Promise<Made> => {
      const world = correctionWorld();
      const id = await world.ready(send as any);
      if (legacy) Object.assign(world.claim(), LEGACY);
      return { world, id, by: payerCtx() };
    };
    /** The same claim sent back and answered: it waits for its approver, who may send it back again. */
    const answered = (claim: () => Promise<Made>, reasonCode: string, give: Record<string, unknown>) => async (): Promise<Made> => {
      const made = await claim();
      await made.world.sendBack.execute(payerCtx(), made.id, { reasonCode });
      await made.world.giveAccount.execute(ctx(), made.id, give as any);
      return { ...made, by: approverCtx() };
    };
    /** Every reason the send-back takes from such a claim, each tried on a claim of its own. A refusal writes nothing. */
    const taken = async (make: () => Promise<Made>) => {
      const codes: string[] = [];
      for (const reasonCode of Object.keys(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS)) {
        const { world, id, by } = await make();
        const before = [world.claim().status, world.claim().updatedAt.getTime(), world.events().length, world.audits.length];
        try {
          await world.sendBack.execute(by, id, { reasonCode });
          codes.push(reasonCode);
        } catch (error) {
          assert.ok(refused(error), `${reasonCode}: ${String(error)}`);
          assert.deepEqual([world.claim().status, world.claim().updatedAt.getTime(), world.events().length, world.audits.length], before, reasonCode);
        }
      }
      return codes;
    };
    const OF_AN_ACCOUNT = ['ACCOUNT_NUMBER_WRONG', 'ACCOUNT_NAME_MISMATCH', 'BANK_WRONG', 'ACCOUNT_UNUSABLE', 'REQUESTER_ASKED', 'OTHER'];
    const OF_CASH = ['CASH_NOT_PAYABLE', 'REQUESTER_ASKED_METHOD', 'OTHER'];
    const withAccount = ready({});
    const withPromptPay = ready({ setDefault: PROMPTPAY });
    const withCash = ready({ setDefault: null, payout: { mode: 'CASH' } });
    const withNothing = ready({ setDefault: null, payout: { mode: 'CASH' } }, true);

    // At the pay step: what the claim was approved with.
    assert.deepEqual(await taken(withAccount), OF_AN_ACCOUNT);
    // A PromptPay number has no bank to be wrong.
    assert.deepEqual(await taken(withPromptPay), OF_AN_ACCOUNT.filter((code) => code !== 'BANK_WRONG'));
    assert.deepEqual(await taken(withCash), OF_CASH);
    // No account: that one reason, and not even "อื่น ๆ".
    assert.deepEqual(await taken(withNothing), ['NO_ACCOUNT_ON_CLAIM']);

    // From the waiting step: what its requester just gave, whatever the claim held before.
    assert.deepEqual(await taken(answered(withNothing, 'NO_ACCOUNT_ON_CLAIM', { mode: 'SPECIFIED', ...KBANK })), OF_AN_ACCOUNT);
    assert.deepEqual(await taken(answered(withNothing, 'NO_ACCOUNT_ON_CLAIM', { mode: 'CASH' })), OF_CASH);
    assert.deepEqual(await taken(answered(withAccount, 'ACCOUNT_NUMBER_WRONG', { mode: 'CASH' })), OF_CASH);
    assert.deepEqual(await taken(answered(withAccount, 'ACCOUNT_NUMBER_WRONG', { mode: 'SPECIFIED', ...PROMPTPAY })), OF_AN_ACCOUNT.filter((code) => code !== 'BANK_WRONG'));
    assert.deepEqual(await taken(answered(withCash, 'CASH_NOT_PAYABLE', { mode: 'SPECIFIED', ...SCB })), OF_AN_ACCOUNT);

    // The list the form offers is the list the endpoint takes: one function, asked the same question.
    assert.deepEqual([OF_AN_ACCOUNT, OF_AN_ACCOUNT.filter((code) => code !== 'BANK_WRONG'), OF_CASH, ['NO_ACCOUNT_ON_CLAIM']],
      [reimbursementPayoutCorrectionReasons('ACCOUNT', 'BANK_ACCOUNT'), reimbursementPayoutCorrectionReasons('ACCOUNT', 'PROMPTPAY_PHONE'), reimbursementPayoutCorrectionReasons('CASH'), reimbursementPayoutCorrectionReasons('NOTHING')]);

    // What was sent back is on the claim, in its audit row and in the requester's notice, in the list's own words.
    const legacy = await withNothing();
    const sentBack = await legacy.world.sendBack.execute(payerCtx(), legacy.id, { reasonCode: 'NO_ACCOUNT_ON_CLAIM' });
    assert.deepEqual([sentBack.payoutCorrection?.phase, sentBack.payoutCorrection?.reasonCode, legacy.world.claim().payoutCorrectionReasonCode, legacy.world.audits[0].metadataJson.reasonCode],
      ['AWAITING_REQUESTER', 'NO_ACCOUNT_ON_CLAIM', 'NO_ACCOUNT_ON_CLAIM', 'NO_ACCOUNT_ON_CLAIM']);
    assert.deepEqual(legacy.world.events().map((event) => event.payloadJson.data.payoutCorrectionNotice), ['เหตุผล: ใบนี้ยังไม่มีบัญชีรับเงิน · เปิดใบเบิกเพื่อเพิ่มบัญชีรับเงิน']);

    // The reject call of the approval card is the same send-back: the same list, and "อื่น ๆ" when it names no reason.
    const cashAnswer = await answered(withAccount, 'ACCOUNT_NUMBER_WRONG', { mode: 'CASH' })();
    await assert.rejects(() => cashAnswer.world.reject.execute(approverCtx(), cashAnswer.id, 'ขอให้รับเป็นการโอน', 'ACCOUNT_NAME_MISMATCH'), refused);
    const again = await cashAnswer.world.reject.execute(approverCtx(), cashAnswer.id, 'ขอให้รับเป็นการโอน');
    assert.deepEqual([again.payoutCorrection?.phase, again.payoutCorrection?.reasonCode, again.payoutCorrection?.note], ['AWAITING_REQUESTER', 'OTHER', 'ขอให้รับเป็นการโอน']);
  });

  // A PromptPay destination is a phone number, which the entry form calls "เบอร์พร้อมเพย์". Before, the requester of a
  // PromptPay claim was told "เหตุผล: เลขบัญชีไม่ถูกต้อง". The reason is the same one, under the same code: the words follow
  // the kind of the account the claim holds when it is sent back.
  it('tells the requester the reason in the words of the account kind: "เบอร์พร้อมเพย์" of a PromptPay number, from the pay step and from the waiting step', async () => {
    const notice = (world: ReturnType<typeof correctionWorld>) => world.events()
      .filter((event) => event.eventType === 'reimbursement.payout_correction_requested').at(-1)!.payloadJson.data.payoutCorrectionNotice;
    const PROMPTPAY_WORDS = 'เหตุผล: เบอร์พร้อมเพย์ไม่ถูกต้อง · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน';
    const BANK_WORDS = 'เหตุผล: เลขบัญชีไม่ถูกต้อง · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน';

    const promptPay = correctionWorld();
    const promptPayId = await promptPay.ready({ setDefault: PROMPTPAY as any });
    const sentBack = await promptPay.sendBack.execute(payerCtx(), promptPayId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    assert.equal(notice(promptPay), PROMPTPAY_WORDS);
    // The code on the claim, in its detail and in its audit row is the one sent: only the words differ.
    assert.deepEqual([sentBack.payoutCorrection?.reasonCode, promptPay.claim().payoutCorrectionReasonCode, promptPay.audits[0].metadataJson.reasonCode],
      ['ACCOUNT_NUMBER_WRONG', 'ACCOUNT_NUMBER_WRONG', 'ACCOUNT_NUMBER_WRONG']);

    const bank = correctionWorld();
    const bankId = await bank.ready();
    await bank.sendBack.execute(payerCtx(), bankId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    assert.equal(notice(bank), BANK_WORDS);

    // From the waiting step the claim holds what was just given: the words are those of that answer, not of what the round began with.
    await bank.giveAccount.execute(ctx(), bankId, { mode: 'SPECIFIED', ...PROMPTPAY });
    await bank.sendBack.execute(approverCtx(), bankId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    assert.equal(notice(bank), PROMPTPAY_WORDS);
    await promptPay.giveAccount.execute(ctx(), promptPayId, { mode: 'SPECIFIED', ...SCB });
    await promptPay.sendBack.execute(approverCtx(), promptPayId, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    assert.equal(notice(promptPay), BANK_WORDS);
    // Every other reason of a PromptPay number reads as it does of any account.
    const other = correctionWorld();
    const otherId = await other.ready({ setDefault: PROMPTPAY as any });
    await other.sendBack.execute(payerCtx(), otherId, { reasonCode: 'ACCOUNT_NAME_MISMATCH' });
    assert.equal(notice(other), 'เหตุผล: ชื่อบัญชีไม่ตรงกับผู้เบิก · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน');
  });
});

// Payout spec §14.2: the words of a round. Every reader of a round chooses its words from two facts: what the claim
// held when it was sent back, and what its requester answered against what the round began with. Both are on the
// row, the detail and each line of the timeline, read from the round's log by one function, and "the same
// destination" is decided once, when the answer is taken.
describe('payout correction: what the claim held and what its requester answered, for every reader of a round', () => {
  const LEGACY = { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined };
  /** A claim that waits for payment holding an account (its requester's default, KBANK), cash, or nothing. */
  const holding = async (held: 'ACCOUNT' | 'CASH' | 'NOTHING') => {
    const world = correctionWorld();
    const id = await world.ready(held === 'ACCOUNT' ? {} : { setDefault: null, payout: { mode: 'CASH' } });
    if (held === 'NOTHING') Object.assign(world.claim(), LEGACY);
    return { world, id };
  };
  // A reason each of the three takes, whichever way its list is drawn.
  const REASON = { ACCOUNT: 'ACCOUNT_NUMBER_WRONG', CASH: 'OTHER', NOTHING: 'NO_ACCOUNT_ON_CLAIM' } as const;
  const facts = (detail: { payoutCorrectionHistory?: Array<{ kind: string; held?: string; answer?: string }> }) =>
    detail.payoutCorrectionHistory!.map((event) => [event.kind, event.held, event.answer]);

  it('names each of the seven answers on the row, the detail and the timeline, and calls "the same" only a destination that was kept', async () => {
    const cases = [
      ['ACCOUNT', { mode: 'SPECIFIED', ...SCB }, 'NEW_ACCOUNT', false, 'รออนุมัติบัญชีรับเงินใหม่'],
      ['ACCOUNT', { mode: 'PREVIOUS' }, 'SAME_ACCOUNT', true, 'รออนุมัติบัญชีรับเงินเดิม'],
      ['ACCOUNT', { mode: 'CASH' }, 'CASH_INSTEAD', false, 'รออนุมัติการรับเป็นเงินสด'],
      ['CASH', { mode: 'SPECIFIED', ...KBANK }, 'ACCOUNT_INSTEAD', false, 'รออนุมัติบัญชีรับเงิน'],
      ['CASH', { mode: 'CASH' }, 'SAME_CASH', true, 'รออนุมัติการรับเป็นเงินสด'],
      ['NOTHING', { mode: 'SPECIFIED', ...KBANK }, 'FIRST_ACCOUNT', false, 'รออนุมัติบัญชีรับเงิน'],
      ['NOTHING', { mode: 'CASH' }, 'FIRST_CASH', false, 'รออนุมัติการรับเป็นเงินสด'],
    ] as const;
    for (const [held, give, answer, same, label] of cases) {
      const { world, id } = await holding(held);
      const sentBack = await world.sendBack.execute(payerCtx(), id, { reasonCode: REASON[held] });
      // With its requester: the row says what the claim holds, and nothing of an answer yet.
      assert.deepEqual([sentBack.payoutMethod, sentBack.payoutCorrectionAnswer, toRequestSummary(world.claim()).payoutCorrectionAnswer],
        [{ ACCOUNT: 'BANK_TRANSFER', CASH: 'CASH', NOTHING: undefined }[held], undefined, undefined], answer);
      // The requester's notice is titled and worded for what the claim held: its event carries both sentences, finished.
      const asked = world.events().at(-1).payloadJson.data;
      assert.deepEqual([world.events().at(-1).eventType, asked.payoutCorrectionTitle, asked.payoutCorrectionNotice], ['reimbursement.payout_correction_requested', ...{
        ACCOUNT: ['ใบเบิกต้องแก้บัญชีรับเงิน', 'เหตุผล: เลขบัญชีไม่ถูกต้อง · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน'],
        CASH: ['ใบเบิกต้องเลือกวิธีรับเงินคืนอีกครั้ง', 'เหตุผล: อื่น ๆ · เปิดใบเบิกเพื่อเลือกวิธีรับเงินคืน'],
        NOTHING: ['ใบเบิกต้องเพิ่มบัญชีรับเงิน', 'เหตุผล: ใบนี้ยังไม่มีบัญชีรับเงิน · เปิดใบเบิกเพื่อเพิ่มบัญชีรับเงิน'],
      }[held]], answer);

      const given = await world.giveAccount.execute(ctx(), id, give as any);
      // The approvers' notice is titled with the claim's own status label and names the same thing in its body.
      const waits = world.events().at(-1).payloadJson.data;
      assert.deepEqual([world.events().at(-1).eventType, waits.payoutAnswerTitle, waits.payoutAnswerNotice],
        ['reimbursement.payout_correction_submitted', label, `รอคุณตรวจและอนุมัติ${label.replace('รออนุมัติ', '')}`], answer);
      assert.deepEqual({ title: waits.payoutAnswerTitle, body: waits.payoutAnswerNotice }, reimbursementPayoutAnswerNotice(answer), answer);
      const row = toRequestSummary(world.claim());
      assert.deepEqual([given.payoutCorrectionPhase, given.payoutCorrectionAnswer, row.payoutCorrectionAnswer, given.payoutCorrection?.sameAsPrevious, reimbursementPayoutRoundStatus(row)],
        ['AWAITING_APPROVAL', answer, answer, same, label], answer);
      // Decided once, when the answer was taken, and kept on the round's log: a read compares nothing.
      assert.equal(world.claim().payoutCorrectionLog.at(-1).sameAsApproved, same ? true : undefined, answer);

      const waiting = await world.detail.execute(approverCtx(), id);
      await world.approve.execute(approverCtx(), id, undefined, waiting.approvalSnapshotHash, waiting.payout?.version);
      const after = await world.detail.execute(payerCtx(), id);
      assert.deepEqual(facts(after), [['SENT_BACK', held, undefined], ['ACCOUNT_SUBMITTED', undefined, answer], ['REAPPROVED', undefined, answer]], answer);
      // Out of its round it is a claim waiting for payment like any other, and the log's own key stays on the server.
      assert.deepEqual([after.status, after.payoutCorrectionAnswer, toRequestSummary(world.claim()).payoutCorrectionAnswer], ['READY_FOR_PAYMENT', undefined, undefined], answer);
      assert.doesNotMatch(JSON.stringify(after), /sameAsApproved|fingerprint/i, answer);
    }
  });

  it('says what the claim held at every send-back, and measures every answer against what its round began with', async () => {
    const { world, id } = await holding('ACCOUNT');
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    await world.giveAccount.execute(ctx(), id, { mode: 'CASH' });
    // Not taken by the approver: the claim is with its requester again, holding the answer that was refused.
    await world.sendBack.execute(approverCtx(), id, { reasonCode: 'OTHER' });
    const refused = await world.detail.execute(ctx(), id);
    assert.deepEqual([refused.payoutCorrectionPhase, refused.payoutMethod, refused.payoutCorrectionAnswer, reimbursementPayoutRoundStatus(refused)],
      ['AWAITING_REQUESTER', 'CASH', undefined, 'รอผู้เบิกเลือกวิธีรับเงินคืน']);
    // Its requester is told so in the words of cash, though the round began with an account.
    const notice = () => { const { payoutCorrectionTitle, payoutCorrectionNotice } = world.events().at(-1).payloadJson.data; return [payoutCorrectionTitle, payoutCorrectionNotice]; };
    assert.deepEqual(notice(), ['ใบเบิกต้องเลือกวิธีรับเงินคืนอีกครั้ง', 'เหตุผล: อื่น ๆ · เปิดใบเบิกเพื่อเลือกวิธีรับเงินคืน']);
    // The next answer is measured against the account the round began with, not against the cash just refused.
    const kept = await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.deepEqual([kept.payoutCorrectionAnswer, kept.payoutCorrection?.sameAsPrevious], ['SAME_ACCOUNT', true]);
    await world.sendBack.execute(approverCtx(), id, { reasonCode: 'ACCOUNT_NAME_MISMATCH' });
    assert.equal(reimbursementPayoutRoundStatus(await world.detail.execute(ctx(), id)), 'รอผู้เบิกแก้บัญชีรับเงิน');
    assert.deepEqual(notice(), ['ใบเบิกต้องแก้บัญชีรับเงิน', 'เหตุผล: ชื่อบัญชีไม่ตรงกับผู้เบิก · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน']);
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    const waiting = await world.detail.execute(approverCtx(), id);
    await world.approve.execute(approverCtx(), id, undefined, waiting.approvalSnapshotHash, waiting.payout?.version);

    // A second round begins with what the first one approved: going back to the first account is another account
    // now, and "the account the claim had" is the one approved last.
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'REQUESTER_ASKED' });
    assert.equal((await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...KBANK })).payoutCorrectionAnswer, 'NEW_ACCOUNT');
    const again = await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.deepEqual([again.payoutCorrectionAnswer, again.payout?.accountLast4], ['SAME_ACCOUNT', '9012']);
    assert.deepEqual(facts(await world.detail.execute(ctx(), id)), [
      ['SENT_BACK', 'ACCOUNT', undefined], ['ACCOUNT_SUBMITTED', undefined, 'CASH_INSTEAD'],
      ['SENT_BACK', 'CASH', undefined], ['ACCOUNT_SUBMITTED', undefined, 'SAME_ACCOUNT'],
      ['SENT_BACK', 'ACCOUNT', undefined], ['ACCOUNT_SUBMITTED', undefined, 'NEW_ACCOUNT'], ['REAPPROVED', undefined, 'NEW_ACCOUNT'],
      ['SENT_BACK', 'ACCOUNT', undefined], ['ACCOUNT_SUBMITTED', undefined, 'NEW_ACCOUNT'], ['ACCOUNT_SUBMITTED', undefined, 'SAME_ACCOUNT'],
    ]);
  });

  // D2: an answer taken by a build from before the key existed carries none. It reads as not the same; nothing is compared again.
  it('reads an answer with no record of having been kept as another destination', async () => {
    const { world, id } = await holding('ACCOUNT');
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    const kept = await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.equal(kept.payoutCorrectionAnswer, 'SAME_ACCOUNT');
    delete world.claim().payoutCorrectionLog.at(-1).sameAsApproved;
    const read = await world.detail.execute(approverCtx(), id);
    assert.deepEqual([read.payoutCorrectionAnswer, read.payoutCorrection?.sameAsPrevious, reimbursementPayoutRoundStatus(read)], ['NEW_ACCOUNT', false, 'รออนุมัติบัญชีรับเงินใหม่']);
  });
});

// No sentence may say the requester did what someone else did for them. A finance reviewer may answer a round on the
// requester's behalf (payout spec §14.5): the row, the detail and the timeline then say who answered, so that every
// sentence that says what was done can say it of that person.
describe('payout correction: who answered, when someone answers for the requester', () => {
  const LEGACY = { payoutMethod: undefined, payoutFingerprint: undefined, payoutDestinationVersion: undefined };
  const holding = async (held: 'ACCOUNT' | 'CASH' | 'NOTHING') => {
    const world = correctionWorld();
    const id = await world.ready(held === 'ACCOUNT' ? {} : { setDefault: null, payout: { mode: 'CASH' } });
    if (held === 'NOTHING') Object.assign(world.claim(), LEGACY);
    await world.sendBack.execute(payerCtx(), id, { reasonCode: { ACCOUNT: 'ACCOUNT_NUMBER_WRONG', CASH: 'CASH_NOT_PAYABLE', NOTHING: 'NO_ACCOUNT_ON_CLAIM' }[held] });
    return { world, id };
  };

  it('names the finance reviewer who answered, on the row, the detail and the timeline, and in every sentence made from them, for each of the seven answers', async () => {
    const cases = [
      ['ACCOUNT', { mode: 'SPECIFIED', ...SCB }, 'NEW_ACCOUNT', 'อรทัย แก้บัญชีรับเงินแทนผู้เบิก'],
      ['ACCOUNT', { mode: 'PREVIOUS' }, 'SAME_ACCOUNT', 'อรทัย ยืนยันบัญชีเดิมแทนผู้เบิก'],
      ['ACCOUNT', { mode: 'CASH' }, 'CASH_INSTEAD', 'อรทัย เปลี่ยนวิธีรับเงินคืนแทนผู้เบิก'],
      ['CASH', { mode: 'SPECIFIED', ...KBANK }, 'ACCOUNT_INSTEAD', 'อรทัย เปลี่ยนวิธีรับเงินคืนแทนผู้เบิก'],
      ['CASH', { mode: 'CASH' }, 'SAME_CASH', 'อรทัย ยืนยันวิธีรับเงินคืนเดิมแทนผู้เบิก'],
      ['NOTHING', { mode: 'SPECIFIED', ...KBANK }, 'FIRST_ACCOUNT', 'อรทัย เพิ่มบัญชีรับเงินแทนผู้เบิก'],
      ['NOTHING', { mode: 'CASH' }, 'FIRST_CASH', 'อรทัย เลือกวิธีรับเงินคืนแทนผู้เบิก'],
    ] as const;
    for (const [held, give, answer, did] of cases) {
      const { world, id } = await holding(held);
      const given = await world.giveAccount.execute(financeCtx(), id, give as any);
      // The detail names who answered. A list row resolves no names, and still says it was not the requester.
      const who = { byUserId: 'finance-1', byName: 'อรทัย', onBehalf: true as const };
      assert.deepEqual([given.payoutCorrectionAnswer, given.payoutCorrectionAnsweredBy], [answer, who], answer);
      assert.deepEqual(toRequestSummary(world.claim()).payoutCorrectionAnsweredBy, { byUserId: 'finance-1', onBehalf: true }, answer);
      const waiting = await world.detail.execute(approverCtx(), id);
      const event = waiting.payoutCorrectionHistory!.at(-1)!;
      assert.deepEqual([event.kind, event.answer, event.byUserId, event.byName, event.onBehalf], ['ACCOUNT_SUBMITTED', answer, 'finance-1', 'อรทัย', true], answer);

      // The sentences made from them, as the web will make them: the timeline row, the approver's step note and the
      // card's note name อรทัย and say it was for the requester. Nothing says the requester did it.
      const said = [
        reimbursementPayoutRoundDid(event.answer!, event),
        reimbursementPayoutRoundApproverNote(waiting.payoutCorrectionAnswer!, waiting.payoutCorrectionAnsweredBy),
        reimbursementPayoutRoundGivenNote(waiting.payoutCorrectionAnsweredBy),
      ];
      assert.equal(said[0], did, answer);
      assert.equal(said[1], reimbursementPayoutRoundApproverNote(answer, who), answer);
      assert.doesNotMatch(said.join(' ').replaceAll('แทนผู้เบิก', ''), /ผู้เบิก|finance-1/, answer);
      for (const sentence of answer === 'NEW_ACCOUNT' ? [said[0]!, said[2]!] : said) assert.match(sentence, /อรทัย .*แทนผู้เบิก/, answer);

      // The approvers' notice says what waits for them and names nobody: it is the notice of the same answer by the requester.
      const waits = world.events().at(-1).payloadJson.data;
      assert.deepEqual([world.events().at(-1).eventType, { title: waits.payoutAnswerTitle, body: waits.payoutAnswerNotice }],
        ['reimbursement.payout_correction_submitted', reimbursementPayoutAnswerNotice(answer)], answer);
      assert.doesNotMatch(`${waits.payoutAnswerTitle} ${waits.payoutAnswerNotice}`, /ผู้เบิก|อรทัย/, answer);

      // Approved: the approval is the approver's own act, and out of its round the claim carries no answerer.
      await world.approve.execute(approverCtx(), id, undefined, waiting.approvalSnapshotHash, waiting.payout?.version);
      const after = await world.detail.execute(payerCtx(), id);
      assert.deepEqual(after.payoutCorrectionHistory!.map((entry) => [entry.kind, entry.byName, entry.onBehalf]),
        [['SENT_BACK', 'ประไพ', undefined], ['ACCOUNT_SUBMITTED', 'อรทัย', true], ['REAPPROVED', 'วิภา', undefined]], answer);
      assert.deepEqual([after.payoutCorrectionAnsweredBy, toRequestSummary(world.claim()).payoutCorrectionAnsweredBy], [undefined, undefined], answer);
    }
  });

  it('says the requester answered when they did, also after someone answered for them', async () => {
    const { world, id } = await holding('ACCOUNT');
    await world.giveAccount.execute(financeCtx(), id, { mode: 'CASH' });
    assert.equal((await world.detail.execute(approverCtx(), id)).payoutCorrectionAnsweredBy?.onBehalf, true);
    // The requester gives the account themselves while the reviewer's answer still waits: theirs is the answer now.
    const own = await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.deepEqual([own.payoutCorrectionAnswer, own.payoutCorrectionAnsweredBy], ['SAME_ACCOUNT', { byUserId: 'staff-1', byName: 'สมชาย' }]);
    assert.deepEqual(toRequestSummary(world.claim()).payoutCorrectionAnsweredBy, { byUserId: 'staff-1' });
    const history = (await world.detail.execute(approverCtx(), id)).payoutCorrectionHistory!;
    assert.deepEqual(history.map((entry) => [entry.kind, entry.answer, entry.onBehalf]),
      [['SENT_BACK', undefined, undefined], ['ACCOUNT_SUBMITTED', 'CASH_INSTEAD', true], ['ACCOUNT_SUBMITTED', 'SAME_ACCOUNT', undefined]]);
    assert.deepEqual(history.slice(1).map((entry) => reimbursementPayoutRoundDid(entry.answer!, entry)), ['อรทัย เปลี่ยนวิธีรับเงินคืนแทนผู้เบิก', 'ผู้เบิกยืนยันบัญชีเดิม']);
    assert.equal(reimbursementPayoutRoundApproverNote(own.payoutCorrectionAnswer!, own.payoutCorrectionAnsweredBy),
      'รอคุณอนุมัติบัญชีรับเงินเดิม ผู้เบิกยืนยันบัญชีเดิมของใบนี้ ไม่ได้เปลี่ยน ตรวจบัญชีด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน');
    // With its requester (not yet answered, or sent back again) nobody has answered what the claim waits for.
    await world.sendBack.execute(approverCtx(), id, { reasonCode: 'OTHER' });
    assert.equal((await world.detail.execute(ctx(), id)).payoutCorrectionAnsweredBy, undefined);
  });

  // Owner rule 2026-10-01 (decision D12): the person whose money it is hears of every change someone else makes for
  // them. Before, the requester was told only of an account TYPED for them: their default account, the account the
  // claim had, and cash, chosen for them, told them nothing.
  it('tells the requester of every answer someone gives for them, once, in the words of that answer, to them alone', async () => {
    const anAccount = (masked: string) => `${masked} · เปิดใบเบิกเพื่อตรวจ ถ้าไม่ใช่บัญชีของคุณ แก้ได้ทันที`;
    const asCash = 'รับเป็นเงินสด · เปิดใบเบิกเพื่อตรวจ ถ้าไม่ถูกต้อง แก้ได้ทันที';
    const [kbank, scb, promptPay] = ['ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789', 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012', 'พร้อมเพย์เบอร์ลงท้าย 5678'];
    // The four choices of the form (an account typed, the requester's default, the account the claim had, cash), over
    // the three things a claim can hold: every one of the seven answers. `DEFAULT`: the requester's default as it is now.
    const cases: Array<['ACCOUNT' | 'CASH' | 'NOTHING', Record<string, unknown>, string, string, string]> = [
      ['ACCOUNT', { mode: 'SPECIFIED', ...SCB }, 'NEW_ACCOUNT', 'อรทัย แก้บัญชีรับเงินในใบเบิกของคุณ', anAccount(scb)],
      ['ACCOUNT', { mode: 'DEFAULT', setDefault: PROMPTPAY }, 'NEW_ACCOUNT', 'อรทัย แก้บัญชีรับเงินในใบเบิกของคุณ', anAccount(promptPay)],
      ['ACCOUNT', { mode: 'DEFAULT' }, 'SAME_ACCOUNT', 'อรทัย ยืนยันบัญชีเดิมในใบเบิกของคุณ', anAccount(kbank)],
      ['ACCOUNT', { mode: 'PREVIOUS' }, 'SAME_ACCOUNT', 'อรทัย ยืนยันบัญชีเดิมในใบเบิกของคุณ', anAccount(kbank)],
      ['ACCOUNT', { mode: 'CASH' }, 'CASH_INSTEAD', 'อรทัย เปลี่ยนวิธีรับเงินคืนในใบเบิกของคุณ', asCash],
      ['CASH', { mode: 'SPECIFIED', ...KBANK }, 'ACCOUNT_INSTEAD', 'อรทัย เปลี่ยนวิธีรับเงินคืนในใบเบิกของคุณ', anAccount(kbank)],
      ['CASH', { mode: 'PREVIOUS' }, 'SAME_CASH', 'อรทัย ยืนยันวิธีรับเงินคืนเดิมในใบเบิกของคุณ', asCash],
      ['CASH', { mode: 'CASH' }, 'SAME_CASH', 'อรทัย ยืนยันวิธีรับเงินคืนเดิมในใบเบิกของคุณ', asCash],
      ['NOTHING', { mode: 'SPECIFIED', ...KBANK }, 'FIRST_ACCOUNT', 'อรทัย เพิ่มบัญชีรับเงินในใบเบิกของคุณ', anAccount(kbank)],
      ['NOTHING', { mode: 'CASH' }, 'FIRST_CASH', 'อรทัย เลือกวิธีรับเงินคืนในใบเบิกของคุณ', asCash],
    ];
    for (const [held, { setDefault, ...give }, answer, title, body] of cases) {
      const label = `${held} ${String(give['mode'])} ${answer}`;
      const { world, id } = await holding(held);
      // The requester changed their default after the claim was sent: "use the default account" is then another account.
      if (setDefault) await world.payouts.setOwn(ctx(), setDefault as typeof PROMPTPAY);
      const defaultToken = give['mode'] === 'DEFAULT' ? (await world.detail.execute(financeCtx(), id)).payoutCorrectionActions!.requesterDefault!.token : undefined;
      world.events().length = 0;
      assert.equal(world.notifications.length, 0, label);

      const given = await world.giveAccount.execute(financeCtx(), id, { ...give, ...(defaultToken && { defaultToken }) } as any);
      assert.equal(given.payoutCorrectionAnswer, answer, label);
      // One notice, to the requester alone (not the reviewer who answered, not an approver, not the shop owner), with
      // the claim's number and a link to the claim, as the notice of an account typed for someone is sent.
      assert.deepEqual(world.notifications.map(({ periodKey: _period, ...notice }) => notice), [{
        companyId: 'co-1', triggerKey: 'reimbursement.payout_account_set_by_other', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: id,
        severity: 'critical', title: `${title}: RB-202601-000001`, body, deepLinkHref: `/companies/co-1/reimbursements/${id}`, recipientUserIds: ['staff-1'],
      }], label);
      // The words are the one function's, from the answer the claim now carries and the account it now shows.
      const words = reimbursementPayoutAnsweredForRequesterNotice(given.payoutCorrectionAnswer, 'อรทัย', given.payout);
      assert.deepEqual([`${words.title}: ${given.requestNo}`, words.body], [world.notifications[0].title, body], label);
      // The approvers are asked as for any answer: one event, and it is not the requester's notice.
      assert.deepEqual(world.events().map((event) => event.eventType), ['reimbursement.payout_correction_submitted'], label);
      assert.equal(leaksNumber([world.notifications, world.events()]), false, label);
      assert.doesNotMatch(`${world.notifications[0].title} ${world.notifications[0].body}`, /สมชาย|finance-1|staff-1|[A-Z]{2,}_[A-Z_]+/, label);
    }
  });

  it('tells the requester nothing of an answer they give themselves, and tells them again of the next one given for them', async () => {
    const { world, id } = await holding('ACCOUNT');
    const token = async (viewer: any) => (await world.detail.execute(viewer, id)).payoutCorrectionActions!.requesterDefault!.token;
    // The requester's own answers, each of the four choices: nobody did anything for them.
    await world.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    await world.giveAccount.execute(ctx(), id, { mode: 'DEFAULT', defaultToken: await token(ctx()) });
    await world.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    await world.giveAccount.execute(ctx(), id, { mode: 'CASH' });
    assert.equal(world.notifications.length, 0);

    // The reviewer answers twice while the answer waits: each answer is a change of its own, and a notice of its own.
    await world.giveAccount.execute(financeCtx(), id, { mode: 'PREVIOUS' });
    await world.giveAccount.execute(financeCtx(), id, { mode: 'CASH' });
    assert.deepEqual(world.notifications.map((notice) => [notice.recipientUserIds, notice.title]), [
      [['staff-1'], 'อรทัย ยืนยันบัญชีเดิมในใบเบิกของคุณ: RB-202601-000001'],
      [['staff-1'], 'อรทัย เปลี่ยนวิธีรับเงินคืนในใบเบิกของคุณ: RB-202601-000001'],
    ]);
    assert.notEqual(world.notifications[0].periodKey, world.notifications[1].periodKey);
    // An answer that is refused changes nothing and tells nobody.
    await assert.rejects(() => world.giveAccount.execute(financeCtx(), id, { mode: 'DEFAULT', defaultToken: 'x' }), /payout_destination_changed/);
    await assert.rejects(() => world.giveAccount.execute(approverCtx(), id, { mode: 'CASH' }), /payout_correction_denied/);
    assert.equal(world.notifications.length, 2);
  });

  // One act, one notice: the claim also says the standing account was saved.
  it('combines a round answer and its standing-account save into one claim notice', async () => {
    const { world, id } = await holding('ACCOUNT');
    const owner = ctx({ userId: 'owner-1', roles: ['OWNER'], permissions: ['reimbursement.read', 'reimbursement.create', 'reimbursement.finance_review', 'access.employee.update'] });
    await world.giveAccount.execute(owner, id, { mode: 'SPECIFIED', saveAsDefault: true, ...SCB });
    assert.deepEqual(world.notifications.map((notice) => [notice.recipientUserIds, notice.sourceType, notice.title, notice.deepLinkHref]), [
      [['staff-1'], 'reimbursement_request', 'เจ้าของร้าน แก้บัญชีรับเงินในใบเบิกของคุณ: RB-202601-000001', `/companies/co-1/reimbursements/${id}`],
    ]);
    assert.match(world.notifications[0].body, /บันทึกบัญชีนี้เป็นบัญชีรับเงินคืนประจำของคุณด้วย/);
    assert.equal((await world.payouts.getOwn(ctx())).account?.accountLast4, '9012');
    assert.equal(leaksNumber(world.notifications), false);
  });

  it('tells the requester of an answer given for them on a claim nobody approves, which is ready for payment at once', async () => {
    const world = correctionWorld({ policy: NO_APPROVAL_POLICY });
    const id = await world.ready();
    await world.sendBack.execute(payerCtx(), id, { reasonCode: 'ACCOUNT_NUMBER_WRONG' });
    world.events().length = 0;
    const given = await world.giveAccount.execute(financeCtx(), id, { mode: 'SPECIFIED', ...SCB });
    assert.deepEqual([given.status, world.events().map((event) => event.eventType)], ['READY_FOR_PAYMENT', ['reimbursement.ready_for_payment']]);
    // Nobody approves this account before it is paid into: the requester is the one person who can say it is wrong.
    assert.deepEqual(world.notifications.map((notice) => [notice.recipientUserIds, notice.title, notice.body]), [[['staff-1'],
      'อรทัย แก้บัญชีรับเงินในใบเบิกของคุณ: RB-202601-000001', 'ธนาคารไทยพาณิชย์ เลขบัญชีลงท้าย 9012 · เปิดใบเบิกเพื่อตรวจ ถ้าไม่ใช่บัญชีของคุณ แก้ได้ทันที']]);
  });
});

describe('multi payout 2a draft and submit', () => {
  const third = { holderType: 'THIRD_PARTY' as const, holderNote: 'คู่สมรสของผู้เบิก' };
  function world() {
    const w = payoutWorld({ policy: { id: 'policy-2a', updatedAt: new Date('2026-10-05'), status: 'ACTIVE', currency: 'THB', requireReceipt: false, allowMissingReceiptWithReason: false, approvalRequiredFromAmount: '1000', financeReviewRequired: true, duplicatePolicy: 'WARN', approverMode: 'MANAGER_ROLE', defaultApproverRole: 'MANAGER', allowSelfApproval: false }, payoutMembers: { 'staff-1': EMPLOYEE } });
    const savedRepo = new PrismaReimbursementRepository({ client: w.state.payoutTables.client } as any, {} as any);
    Object.assign(w.state.repo, {
      addSavedPayoutAccount: savedRepo.addSavedPayoutAccount.bind(savedRepo),
      listSavedPayoutAccounts: savedRepo.listSavedPayoutAccounts.bind(savedRepo),
      removeSavedPayoutAccount: savedRepo.removeSavedPayoutAccount.bind(savedRepo),
    });
    return w;
  }
  it('copies a saved account inside the draft transaction, keeps it independent, and applies the approval floor', async () => {
    const w = world();
    const saved = await w.payouts.addSavedOwn(ctx(), { ...KBANK, ...third });
    const sealed = { ...w.state.payoutTables.savedAccounts[0] };
    await w.create.execute(ctx(), claimInput({ payout: { mode: 'SAVED', savedAccountId: saved.id } }));
    const row = w.state.payoutTables.destinations[0]!;
    assert.deepEqual([row.source, row.holderType, row.holderNote, row.accountNumberEncrypted], ['SAVED_ACCOUNT', third.holderType, third.holderNote, sealed.accountNumberEncrypted]);
    assert.notEqual(row.fingerprint, sealed.fingerprint);
    await w.payouts.deleteSavedOwn(ctx(), saved.id);
    await w.payouts.setOwn(ctx(), SCB);
    assert.equal(row.accountNumberEncrypted, sealed.accountNumberEncrypted);
    const detail = await w.detail.execute(ctx(), 'rb-1');
    assert.equal(detail.payout?.approvalRequiredForThirdParty, true);
    await w.send(ctx(), 'rb-1');
    assert.equal(w.state.request.status, 'PENDING_APPROVAL');
    assert.equal(w.state.calls.approvalSteps.length, 1);
    assert.equal(w.state.request.approvalPolicySnapshotJson.approvalFloor, 'THIRD_PARTY_PAYOUT');
    assert.deepEqual(w.audits.find((entry) => entry.action === 'reimbursement.request.create').metadataJson.payout, { mode: 'SAVED', holderType: 'THIRD_PARTY' });
    assert.equal(w.notifications.length, 0);
  });
  it('refuses foreign saved ids, preparer choices and unknown or malformed modes without following the default', async () => {
    const w = world();
    const saved = await w.payouts.addSavedOwn(ctx(), { ...KBANK, holderType: 'SELF' });
    await assert.rejects(() => w.payouts.draftPayoutChange(financeCtx(), 'staff-1', { mode: 'SAVED', savedAccountId: saved.id }), /payout_saved_account_not_found/);
    for (const input of [null, {}, { mode: 'UNKNOWN' }, { mode: 'SAVED' }, { mode: 'SAVED', savedAccountId: '' }]) await assert.rejects(() => w.payouts.draftPayoutChange(ctx(), 'staff-1', input as any), (e: any) => e.getStatus?.() === 400);
    for (const owner of [ctx({ userId: 'other' }), ctx({ companyId: 'other' })]) {
      const change = await w.payouts.draftPayoutChange(owner, owner.userId, { mode: 'SAVED', savedAccountId: saved.id });
      await assert.rejects(() => applyDraftPayoutChange(w.state.payoutTables.client, { ...w.state.request, id: 'rb-1', companyId: owner.companyId, requesterUserId: owner.userId, status: 'DRAFT' }, change, true), /payout_saved_account_not_found/);
    }
    const own = await w.payouts.draftPayoutChange(ctx(), 'staff-1', { mode: 'SAVED', savedAccountId: saved.id });
    await assert.rejects(() => applyDraftPayoutChange(w.state.payoutTables.client, { id: 'rb-1', companyId: 'co-1', requesterUserId: 'other', status: 'DRAFT' }, own, true), /payout_saved_account_not_found/);
  });
  it('saves typed accounts atomically, reuses duplicates at the limit, and refuses unsafe combinations', async () => {
    const w = world();
    const tx = w.state.payoutTables.client;
    const claim = { id: 'rb-1', companyId: 'co-1', requesterUserId: 'staff-1', status: 'DRAFT' } as any;
    const change = await w.payouts.draftPayoutChange(ctx(), 'staff-1', { mode: 'SPECIFIED', ...KBANK, ...third, saveForLater: true });
    await tx.$transaction((client: any) => applyDraftPayoutChange(client, claim, change, true));
    assert.equal(w.state.payoutTables.savedAccounts.length, 1);
    for (let index = 1; index < 20; index++) await w.payouts.addSavedOwn(ctx(), { ...KBANK, holderType: 'SELF', accountNumber: `000000${String(index).padStart(4, '0')}` });
    await tx.$transaction((client: any) => applyDraftPayoutChange(client, claim, change, true));
    assert.equal(w.state.payoutTables.savedAccounts.length, 20);
    const before = { ...w.state.payoutTables.destinations[0] };
    const another = await w.payouts.draftPayoutChange(ctx(), 'staff-1', { mode: 'SPECIFIED', ...SCB, ...third, saveForLater: true });
    await assert.rejects(() => tx.$transaction((client: any) => applyDraftPayoutChange(client, claim, another)), /payout_saved_account_limit/);
    assert.deepEqual(w.state.payoutTables.destinations[0], before);
    for (const input of [{ mode: 'SPECIFIED', ...KBANK, ...third, saveAsDefault: true }, { mode: 'SPECIFIED', ...KBANK, saveAsDefault: true, saveForLater: true }]) await assert.rejects(() => w.payouts.draftPayoutChange(ctx(), 'staff-1', input as any), (e: any) => [400, 409].includes(e.getStatus?.()));
    await assert.rejects(() => w.payouts.draftPayoutChange(financeCtx(), 'staff-1', { mode: 'SPECIFIED', ...KBANK, saveForLater: true }), (e: any) => e.getStatus?.() === 403);
  });
  it('tells the requester of a preparer typed third-party account using only the short flag', async () => {
    const w = world();
    await w.create.execute(financeCtx(), claimInput({ requesterUserId: 'staff-1', payout: { mode: 'SPECIFIED', ...KBANK, ...third } }));
    assert.match(w.notifications[0].body, /\(บัญชีของบุคคลอื่น\)/);
    assert.doesNotMatch(w.notifications[0].body, /คู่สมรส|0123456789/);
  });
  it('checks holder routing again at freeze, reuses the version and requires acceptance again after reopening', async () => {
    const w = world();
    await w.create.execute(ctx(), claimInput({ payout: { mode: 'SPECIFIED', ...KBANK, ...third } }));
    const request = w.state.request;
    const token = (await w.detail.execute(ctx(), 'rb-1')).payout!.submitToken;
    await assert.rejects(() => freezePayoutAtSubmit(w.state.payoutTables.client, request, { actorUserId: 'staff-1', frozenAt: new Date(), seenToken: token, expectedThirdParty: false }), /payout_destination_changed/);
    await w.send(ctx(), 'rb-1');
    const db = w.state.payoutTables.client;
    await attestClaimPayout(db, w.state.request, { verifiedVersion: 1, thirdPartyAccepted: true, actorUserId: 'staff-1', verifiedAt: new Date(), approvalStepId: 'step-1' });
    const paid = await confirmPaymentPayout(db, w.state.request, { payoutDestinationVersion: 1 }, { actorUserId: 'payer-1', confirmedAt: new Date() });
    assert.equal(paid?.payerVerified, true);
    const columns = await draftPayoutAfterReopen(db, w.state.request);
    Object.assign(request, columns, { status: 'DRAFT' });
    await w.send(ctx(), 'rb-1');
    assert.equal(request.payoutDestinationVersion, 1);
    assert.equal(w.state.payoutTables.destinations[0]!.verifiedByUserId, null);
    await assert.rejects(() => attestClaimPayout(db, request, { verifiedVersion: 1, actorUserId: 'manager-1', verifiedAt: new Date(), approvalStepId: 'step-2' }), /payout_third_party_acceptance_required/);
  });
});

it('multi payout 2a: membership locks serialize writers without blocking foreign-key checks', async () => {
  const tables = fakePayoutTables();
  const repo = new PrismaReimbursementRepository({ client: tables.client } as any, {} as any);
  await repo.addSavedPayoutAccount({ companyId: 'co-1', userId: 'staff-1', holderType: 'SELF', destination: sealPayoutDestination(KBANK, PAYOUT_KEY)! }, async () => undefined);
  const locks = tables.rowLocks.filter((sql) => sql.includes('CompanyMembership'));
  assert.equal(locks.length, 1);
  assert.match(locks[0]!, /FOR NO KEY UPDATE/);
});

// Round 2b reuses the real payout readers/freezer over the existing transaction fixture.
describe('multi payout 2b correction and readers', () => {
  const third = { holderType: 'THIRD_PARTY' as const, holderNote: 'คู่สมรสของผู้เบิก' };
  function world(options: RepoOptions = {}) {
    const w = correctionWorld(options);
    const savedRepo = new PrismaReimbursementRepository({ client: w.state.payoutTables.client } as any, {} as any);
    Object.assign(w.state.repo, { addSavedPayoutAccount: savedRepo.addSavedPayoutAccount.bind(savedRepo), findSavedPayoutAccount: savedRepo.findSavedPayoutAccount.bind(savedRepo) });
    return w;
  }
  it('takes saved accounts only from the requester and copies holder facts through PREVIOUS', async () => {
    const w = world();
    const id = await w.ready();
    await w.sendBack.execute(ctx(), id, { reasonCode: 'REQUESTER_ASKED' });
    assert.ok((await w.detail.execute(ctx(), id)).payoutCorrectionActions?.submitModes?.includes('SAVED'));
    assert.ok(!(await w.detail.execute(financeCtx(), id)).payoutCorrectionActions?.submitModes?.includes('SAVED'));
    const saved = await w.payouts.addSavedOwn(ctx(), { ...SCB, ...third });
    await assert.rejects(() => w.giveAccount.execute(financeCtx(), id, { mode: 'SAVED', savedAccountId: saved.id }), /payout_saved_account_not_found/);
    const given = await w.giveAccount.execute(ctx(), id, { mode: 'SAVED', savedAccountId: saved.id });
    assert.deepEqual([given.payout?.holderType, given.payout?.holderNote], [third.holderType, third.holderNote]);
    assert.match(w.events().find((event) => event.eventType === 'reimbursement.payout_correction_submitted')!.payloadJson.data.payoutAnswerNotice, /\(บัญชีของบุคคลอื่น\)/);
    await assert.rejects(() => w.approve.execute(approverCtx(), id, undefined, w.claim().approvalSnapshotHash, 2), /payout_third_party_acceptance_required/);
    await w.approve.execute(approverCtx(), id, undefined, w.claim().approvalSnapshotHash, 2, true);
    await w.sendBack.execute(ctx(), id, { reasonCode: 'REQUESTER_ASKED' });
    const kept = await w.giveAccount.execute(ctx(), id, { mode: 'PREVIOUS' });
    assert.deepEqual([kept.payout?.holderType, kept.payout?.holderNote], [third.holderType, third.holderNote]);
    assert.deepEqual([kept.payoutCorrection?.previous?.holderType, kept.payoutCorrection?.previous?.holderNote], [third.holderType, third.holderNote]);
  });
  it('states and refuses third-party answers on a no-approval claim before writing', async () => {
    const w = world({ policy: NO_APPROVAL_POLICY });
    const id = await w.ready();
    await w.sendBack.execute(ctx(), id, { reasonCode: 'REQUESTER_ASKED' });
    assert.equal((await w.detail.execute(ctx(), id)).payoutCorrectionActions?.thirdPartyRefusal, 'APPROVAL_NOT_REQUIRED');
    const saved = await w.payouts.addSavedOwn(ctx(), { ...SCB, ...third });
    const before = JSON.stringify(w.state.payoutTables.destinations);
    for (const input of [{ mode: 'SPECIFIED', ...SCB, ...third }, { mode: 'SAVED', savedAccountId: saved.id }]) await assert.rejects(() => w.giveAccount.execute(ctx(), id, input as any), /payout_third_party_needs_approval/);
    assert.equal(JSON.stringify(w.state.payoutTables.destinations), before);
    const specified = await w.payouts.draftPayoutChange(ctx(), 'staff-1', { mode: 'SPECIFIED', ...SCB, ...third }, true);
    await assert.rejects(() => freezePayoutCorrection(w.state.payoutTables.client, w.claim(), { write: specified.write, frozenAt: new Date(), approvalRequired: false } as any), /payout_third_party_needs_approval/);
    assert.equal(JSON.stringify(w.state.payoutTables.destinations), before);
    await w.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB });
    assert.equal(w.claim().status, 'READY_FOR_PAYMENT');
  });
  it('maps the same holder facts onto current, historical and payment accounts without secrets', async () => {
    const w = world();
    const id = await w.ready();
    await w.sendBack.execute(ctx(), id, { reasonCode: 'REQUESTER_ASKED' });
    await w.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB, ...third });
    const db = w.state.payoutTables.client;
    for (const account of [await readClaimPayout(db, w.claim()), (await readClaimPayoutVersions(db, w.claim())).find((row) => row.version === 2), (await readPaymentPayoutDestinations(db, 'co-1', id, [2]))[2]]) {
      assert.deepEqual([account?.holderType, account?.holderNote], [third.holderType, third.holderNote]);
      assert.doesNotMatch(JSON.stringify(account), /accountNumberEncrypted|0123456789/);
    }
    const payer = await confirmPaymentPayout(db, w.claim(), { payoutDestinationVersion: 2 }, { actorUserId: 'payer-1', confirmedAt: new Date() });
    assert.equal(payer?.holderType, 'THIRD_PARTY');
    assert.equal((payer as any)?.holderNote, undefined, 'payment notice and audit facts never carry the note');
  });
  it('saveForLater accepts the current default without adding a saved row, even at the limit', async () => {
    const w = world();
    await w.payouts.setOwn(ctx(), KBANK);
    for (let index = 0; index < 20; index++) await w.payouts.addSavedOwn(ctx(), { ...SCB, accountNumber: `000000${String(index).padStart(4, '0')}`, holderType: 'SELF' });
    const change = await w.payouts.draftPayoutChange(ctx(), 'staff-1', { mode: 'SPECIFIED', ...KBANK, saveForLater: true });
    const db = w.state.payoutTables.client;
    await db.$transaction((tx: any) => applyDraftPayoutChange(tx, { id: 'draft-2b', companyId: 'co-1', requesterUserId: 'staff-1', status: 'DRAFT' }, change, true));
    assert.equal(w.state.payoutTables.savedAccounts.length, 20);
    assert.equal(w.state.payoutTables.destinations.at(-1)?.accountLast4, '6789');
    await assert.rejects(() => w.payouts.addSavedOwn(ctx(), { ...KBANK, holderType: 'SELF' }), /payout_saved_account_is_default/);
  });
});

it('W4 API refuses name mismatch for third-party accounts at payment and correction approval without writes', async () => {
  for (const answered of [false, true]) {
    const w = correctionWorld();
    const id = await w.ready();
    await w.sendBack.execute(payerCtx(), id, { reasonCode: 'REQUESTER_ASKED' });
    await w.giveAccount.execute(ctx(), id, { mode: 'SPECIFIED', ...SCB, holderType: 'THIRD_PARTY', holderNote: 'คู่สมรสของผู้เบิก' });
    if (!answered) await w.approve.execute(approverCtx(), id, undefined, w.claim().approvalSnapshotHash, 2, true);
    const before = JSON.stringify([w.claim(), w.audits, w.events()]);
    await assert.rejects(() => w.sendBack.execute(answered ? approverCtx() : payerCtx(), id, { reasonCode: 'ACCOUNT_NAME_MISMATCH' }), (error: any) => {
      assert.equal(error.getStatus(), 400);
      assert.equal(error.getResponse().code, 'payout_correction_name_mismatch_third_party');
      assert.equal(error.getResponse().message, 'บัญชีของบุคคลอื่นใช้เหตุผลว่าชื่อบัญชีไม่ตรงกับผู้เบิกไม่ได้ เลือกเหตุผลอื่น');
      return true;
    });
    assert.equal(JSON.stringify([w.claim(), w.audits, w.events()]), before);
    await w.sendBack.execute(answered ? approverCtx() : payerCtx(), id, { reasonCode: 'ACCOUNT_UNUSABLE' });
  }
});


describe('paid claim list document completion', () => {
  it('lists digital completion, declared paper completion and an unsigned claim with the same server facts as detail', async () => {
    const at = new Date('2026-10-13T00:00:00.000Z');
    const rows = ['digital', 'paper', 'unsigned'].map((id) => ({ id, companyId: 'co-1', requesterUserId: 'staff-1', amount: '100', currency: 'THB',
      incurredDate: at, status: 'PAID', financeReviewStatus: 'NOT_REQUIRED', createdAt: at, updatedAt: at,
      claimSignatures: id === 'digital' ? [{ role: 'REQUESTER' }, { role: 'APPROVER' }] : [] }));
    const repo = { findPolicy: async () => null, listRequestPage: async () => ({ rows, groups: [], duplicateBlockedCount: 0 }),
      findPendingApprovalSteps: async () => [], getUserDisplayNames: async () => ({}),
      findAcknowledgedSignedCopyRequestIds: async (_companyId: string, ids: string[]) => { assert.deepEqual(ids, ['digital', 'paper', 'unsigned']); return new Set(['paper']); } } as any;
    const page = await new ListReimbursementsUseCase(repo).execute(ctx({ permissions: ['reimbursement.read'] }), {});
    assert.deepEqual(page.items.map((row) => [row.id, row.documentSignedVia]), [['digital', 'DIGITAL'], ['paper', 'PAPER'], ['unsigned', null]]);
  });
});


it('claim source bootstrap exposes the current receipt rule with create permission', async () => {
  const repo = { resolveCreateBranchId: async () => 'b', assertReimbursementRequester: async () => {}, listReimbursementRequesters: async () => [], listReimbursementSources: async () => [],
    findPolicy: async () => ({ requireReceipt: true, allowMissingReceiptWithReason: false }) } as any;
  const result = await new ListReimbursementSourcesUseCase(repo).execute({ companyId: 'co-1', userId: 'staff-1', permissions: ['reimbursement.create'], scopes: {} } as any, 'b');
  assert.deepEqual(result.receiptPolicy, { requireReceipt: true, allowMissingReceiptWithReason: false });
});

describe('hub work queues', () => {
  it('lets payment recorders read only the payment queue and refuses unrelated readers', async () => {
    const asked: any[] = [];
    const queue = new ListFinanceQueueUseCase({ listRequests: async (query: any) => { asked.push(query); return []; }, findPolicy: async () => null } as any);
    await queue.execute(ctx({ permissions: ['reimbursement.payment.record'] }));
    assert.deepEqual(asked[0].statuses, ['READY_FOR_PAYMENT', 'PARTIALLY_PAID']);
    await assert.rejects(queue.execute(ctx()), ForbiddenException);
  });
});

describe('requester bell notice routes', () => {
  for (const [event, key] of [
    ['reimbursement.approved', 'reimbursement_decision_requester'],
    ['reimbursement.rejected', 'reimbursement_decision_requester'],
    ['reimbursement.correction_requested', 'reimbursement_correction_requester'],
    ['reimbursement.payment_recorded', 'reimbursement_payment_recorded'],
  ]) it(`${event} already tells only the requester, excluding their own action`, () => {
    const binding = WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG[key!];
    assert.ok((binding!.eventTypes as string[] | undefined)?.includes(event!) || binding!.eventType === event);
    const template = WORKFLOW_TEMPLATE_CATALOG.find(row => row.key === key)!;
    assert.equal(template.autoEnable, true);
    const notice = template.defaultActionJson.find(action => action.actionType === 'SEND_NOTIFICATION')!.configJson as any;
    assert.deepEqual(notice.recipientPayloadKeys, ['requesterUserId']);
    assert.deepEqual(notice.excludeRecipientPayloadKeys, ['actorUserId']);
    assert.equal(notice.skipWhenAllRecipientsExcluded, true);
    assert.match(notice.deepLinkPathTemplate, /reimbursements/);
  });
});

describe('claim receipt waiver through expense confirmation', () => {
  it('carries the submitted waiver through the approver, finance and reconciliation confirmation path', async () => {
    const expense = { id: 'exp', companyId: 'co-1', branchId: 'branch-1', sourceReimbursementRequestId: 'rb-1', sourceReimbursementLineId: 'line-1',
      status: 'READY_FOR_CONFIRMATION', duplicateStatus: 'NO_MATCH', attachments: [], lines: [],
      primaryAttachmentId: null, missingReceiptReason: null, vendorNameSnapshot: 'ร้านตลาด', expenseDate: new Date('2026-01-01'),
      grandTotalAmount: '100', currency: 'THB', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      sourceDocumentType: 'OTHER_EXPENSE_DOCUMENT', taxEvidenceStatus: 'SUPPORTING_ONLY', updatedAt: new Date('2026-01-01') };
    const writes: any[] = [];
    const expenses = { findByIdWithRelations: async () => expense, runDuplicateCheck: async () => ({ duplicateStatus: 'NO_MATCH' }),
      finalizeAndConfirmExpenseCas: async (data: any) => { writes.push(data); return { expense: { ...expense, status: 'CONFIRMED' }, finalized: [] }; } } as any;
    const confirm = new ConfirmExpenseUseCase(expenses, noopAudit, {} as any, {} as any);
    const orchestrator = new ReimbursementProjectionOrchestratorService({ listClaimProjections: async () => [expense] } as any, expenses, {} as any, confirm, noopAudit);
    const request = { id: 'rb-1', branchId: 'branch-1', receiptRequirementStatus: 'WAIVED_BY_POLICY' } as any;
    await orchestrator.reconcileExisting(ctx(), request, false);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].substituteCoveredByClaimForm, true);
    assert.deepEqual(writes[0].reimbursementReview, { requestId: 'rb-1', lineId: 'line-1' });
    await assert.rejects(orchestrator.reconcileExisting(ctx(), { ...request, receiptRequirementStatus: 'REQUIRED' }, false));
    await assert.rejects(confirm.execute(ctx({ permissions: ['expense.confirm'] }), 'exp'));
    await assert.rejects(confirm.executeForReimbursement(ctx(), 'exp', { reimbursementRequestId: 'other', reimbursementLineId: 'line-1', branchId: 'branch-1', allowMissingReceiptWithReason: false, receiptWaivedByPolicy: true }), /reimbursement_projection_authority_mismatch/);
    assert.equal(writes.length, 1);
  });
});

describe('hub bootstrap', () => {
  it('reads each accessible queue once and counts only actions waiting for this reader', async () => {
    const controller = Object.create(ReimbursementController.prototype) as any;
    let approvalReads = 0, financeReads = 0;
    controller.listRequests = { hubPolicy: async () => ({ financeReviewRequired: false }), execute: async () => ({ total: 9 }) };
    controller.approvalQueue = { execute: async () => { approvalReads++; return [
      { approvalActions: { canApprove: true, canReject: true } }, { approvalActions: { canApprove: false, canReject: true } },
    ]; } };
    controller.financeQueue = { execute: async () => { financeReads++; return [
      { status: 'FINANCE_REVIEW', financeReviewStatus: 'PENDING' }, { status: 'READY_FOR_PAYMENT', branchId: 'b1' },
      { status: 'READY_FOR_PAYMENT', branchId: 'b1', hasDuplicateBlocker: true }, { status: 'READY_FOR_PAYMENT', branchId: 'b1', cancellationPending: true },
      { status: 'PARTIALLY_PAID', branchId: 'b1' }, { status: 'READY_FOR_PAYMENT' },
      { status: 'READY_FOR_PAYMENT', branchId: 'b1', duplicateReasons: ['EXPENSE_CONFIRMATION'] },
    ]; } };
    const answer = await controller.hub(ctx({ permissions: ['reimbursement.finance_review', 'reimbursement.payment.record'] }));
    assert.deepEqual(answer, { financeReviewRequired: false, hasApprovalTasks: true, listCounts: { approvals: 2, finance: 7 }, queueCounts: { approvals: 1, finance: 2 } });
    assert.deepEqual([approvalReads, financeReads], [1, 1]);
    assert.deepEqual((await controller.hub(ctx())).queueCounts, { approvals: 1 });
    assert.equal(financeReads, 1, 'no finance read without a queue right');
  });
});

it('list exposes the same self-owner approval action as the detail', async () => {
 const request = { currentApprovalStepId: 'step', branchId: 'branch-1', incurredDate: new Date(), id: 'rb-own', companyId: 'c1', status: 'PENDING_APPROVAL', requesterUserId: 'owner', amount: '85', currency: 'THB', createdAt: new Date(), updatedAt: new Date() };
 const repo = { findPolicy: async () => null, listRequestPage: async () => ({ rows: [request], groups: [] }), findPendingApprovalSteps: async () => [{ id: 'step', reimbursementRequestId: request.id, status: 'PENDING', stepOrder: 1, approverRoleSnapshot: 'MANAGER', assignedApproverUserIds: [] }], getUserDisplayNames: async () => ({}), findActiveApproverUserIds: async () => new Set() };
 const answer = await new ListReimbursementsUseCase(repo as any).execute(ctx({ userId: 'owner', roles: ['OWNER'], permissions: ['reimbursement.read', 'reimbursement.approve'] }), {});
 assert.equal(answer.items[0]?.approvalActions?.canApprove, true);
});

it('duplicate comparisons read both directions and retain resolved history', async () => {
 let where: any;
 const repo = new PrismaReimbursementRepository({ client: { reimbursementDuplicateCandidate: { findMany: async (query: any) => { where = query.where; return [{ id: 'pair', reimbursementRequestId: 'later', candidateRequestId: 'earlier', status: 'OVERRIDDEN', resolvedByUserId: 'reviewer', resolvedAt: new Date('2026-10-13') }]; } } } } as any, {} as any);
 const rows = await repo.listClaimDuplicateComparisons('company', 'earlier');
 assert.deepEqual(where, { companyId: 'company', OR: [{ reimbursementRequestId: 'earlier' }, { candidateRequestId: 'earlier' }], status: { in: ['OPEN', 'OVERRIDDEN', 'DISMISSED'] } });
 assert.equal(rows[0]?.candidateRequestId, 'later');
 assert.equal(rows[0]?.resolvedByUserId, 'reviewer');
 assert.equal(rows[0]?.status, 'OVERRIDDEN');
});


it('the claim list summary carries the saved send-back reason', () => {
  const summary = toRequestSummary({ id: 'returned', status: 'REJECTED', incurredDate: new Date(), createdAt: new Date(), updatedAt: new Date(),
    rejectionReason: 'ใบเสร็จซ้ำกับใบก่อน', financeReviewStatus: 'NOT_REQUIRED', duplicateStatus: 'CLEAR' } as any);
  assert.equal(summary.rejectionReason, 'ใบเสร็จซ้ำกับใบก่อน');
});


describe('CLAIM-LIST scoped queue metrics', () => {
  it('sums approval and payment amounts from all aggregate groups, excluding returned approval work', () => {
    const groups = [
      { status: 'DRAFT', count: 2, amount: '10.10' },
      { status: 'PENDING_APPROVAL', count: 3, amount: '20.20' },
      { status: 'PENDING_APPROVAL', needsCorrection: true, count: 1, amount: '5.00' },
      { status: 'READY_FOR_PAYMENT', count: 4, amount: '30.30' },
      { status: 'PARTIALLY_PAID', count: 1, amount: '4.40' },
      { status: 'PAID', count: 1, amount: '9.90' },
    ];
    const summary = hubSummary(groups as any, 1, '7.70');
    assert.deepEqual(summary.metrics, {
      pendingApproval: { count: 3, amount: '20.2000' },
      pendingPayment: { count: 4, amount: '27.0000' },
    });
    assert.equal(summary.totalAmount, '79.9000');
    assert.equal(summary.counts.all, 12);
  });

});
describe('Round 3 LINE submit/cancel use-case preview', () => {
  for (const action of ['submit', 'cancel'] as const) {
    it(`${action}: permits the owner, refuses missing permission/status/branch/revision and makes no business writes`, async () => {
      const state = fakeRepo();
      const uc = useCases(state);
      await uc.create.execute(ctx(), { reason: 'ค่าเดินทาง', missingReceiptReason: 'ใบเสร็จหาย', lines: [inputLine({ attachmentId: 'att-1' })] } as any);
      await uc.update.execute(ctx(), state.request.id, { payout: { mode: 'CASH' } });
      const actor = ctx({ authProvider: 'line', permissions: [...ctx().permissions, 'reimbursement.cancel_own'] });
      const detail = { payout: { submitToken: payoutSubmitToken(state.request.id, await state.repo.planSubmitPayout(state.request)) } };
      const before = JSON.stringify(state.request), audits = state.calls.audits.length;
      const cancel = new CancelReimbursementUseCase(state.repo, noopAudit, state.voidExpense);
      const run = (context: any, revision = state.request.updatedAt) => action === 'submit'
        ? uc.submit.execute(context, state.request.id, { payoutSubmitToken: detail.payout?.submitToken }, { previewOnly: true, expectedUpdatedAt: revision })
        : cancel.execute(context, state.request.id, undefined, undefined, { previewOnly: true, expectedUpdatedAt: revision });
      assert.equal((await run(actor)).status, 'DRAFT');
      assert.equal(JSON.stringify(state.request), before); assert.equal(state.calls.audits.length, audits);
      await assert.rejects(() => run({ ...actor, permissions: ['reimbursement.read_own'] }), /permission|Cannot cancel/i);
      await assert.rejects(() => run({ ...actor, scopes: { branchIds: ['other'] } }), /branch/i);
      await assert.rejects(() => run(actor, new Date(0)), /version_changed/);
      state.request.status = 'PAID'; await assert.rejects(() => run(actor), /Cannot.*(submit|cancel)/i);
    });
  }
});
