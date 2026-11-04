import { BadRequestException } from '@nestjs/common';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AddExpenseCaptureFileUseCase,
  CloseExpenseCaptureGroupUseCase,
  CompleteExpenseCaptureFileUseCase,
  ConvertExpenseToCaptureGroupUseCase,
  CreateExpenseCaptureGroupUseCase,
  DetachExpenseCaptureFileUseCase,
  ExpenseCaptureAccessService,
  GetExpenseCaptureCapabilityUseCase,
  GetExpenseCaptureGroupUseCase,
  ListExpenseCaptureGroupsUseCase,
} from './expense-capture-group.use-case';
import { FEATURE_TEMPORARILY_UNAVAILABLE } from '../../../employee-access/application/entitlement.helper';

/**
 * Fakes in the style of `expense-upload.use-case.spec.ts`: hand-built collaborators, no framework.
 * The capture repository is an in-memory double that keeps the two properties the use cases lean
 * on — the revision compare-and-set and the PENDING_UPLOAD → STORED transition — so a spec that
 * says "the second writer loses" is testing the real branch, not a stub that always says yes.
 */
class FakeCaptureRepo {
  groups = new Map<string, any>();
  files = new Map<string, any>();
  jobs: any[] = [];
  observations: any[] = [];
  links: any[] = [];
  expenses = new Map<string, any>();
  /** Attachment rows, so a second wiring of the use cases over the same repo sees the same bytes. */
  objects = new Map<string, any>();
  locks: string[] = [];
  private seq = 0;

  private id(prefix: string) { this.seq += 1; return `${prefix}-${this.seq}`; }

  get client() { return this.tx(); }

  tx() {
    const repo = this;
    return {
      $executeRaw: async () => 0,
      attachmentLink: {
        findMany: async ({ where }: any) => repo.links.filter((link) => matchLink(link, where)),
        findFirst: async ({ where }: any) => repo.links.find((link) => matchLink(link, where)) ?? null,
        deleteMany: async ({ where }: any) => {
          const before = repo.links.length;
          repo.links = repo.links.filter((link) => !matchLink(link, where));
          return { count: before - repo.links.length };
        },
      },
      expenseRecord: {
        updateMany: async ({ where, data }: any) => {
          const row = repo.expenses.get(where.id);
          const stale = !row || row.companyId !== where.companyId
            || (where.updatedAt && row.updatedAt.getTime() !== where.updatedAt.getTime())
            || (where.captureGroupId === null && row.captureGroupId);
          if (stale) return { count: 0 };
          Object.assign(row, data, { updatedAt: new Date() });
          return { count: 1 };
        },
      },
      reimbursementLine: { findFirst: async () => null },
      expenseSubstituteReceiptEvidence: { findFirst: async () => null },
    };
  }

  /** Set to make the NEXT transaction blow up, the way a lost connection or a constraint would. */
  failNextTransaction = false;

  transaction<T>(run: (tx: any) => Promise<T>): Promise<T> {
    if (this.failNextTransaction) {
      this.failNextTransaction = false;
      return Promise.reject(new Error('simulated transaction failure'));
    }
    return run(this.tx());
  }

  async lockGroup(_db: any, companyId: string, groupId: string) { this.locks.push(`${companyId}:expense-capture:${groupId}`); }

  async findGroup(_db: any, companyId: string, groupId: string) {
    const group = this.groups.get(groupId);
    return group && group.companyId === companyId ? { ...group } : null;
  }

  async listGroups(_db: any, input: any) {
    const rows = [...this.groups.values()].filter((group) => group.companyId === input.companyId
      && (!input.status || group.status === input.status)
      && (!input.createdByUserId || group.createdByUserId === input.createdByUserId));
    return { rows, total: rows.length };
  }

  async createGroup(_db: any, input: any) {
    const group = {
      id: this.id('g'), revision: 1, status: 'OPEN', businessUse: 'UNKNOWN', fundingRoute: 'UNKNOWN',
      payerUserId: null, handoffState: 'NONE', acceptedAllocationId: null, closedReason: null,
      closedAt: null, createdAt: new Date(), updatedAt: new Date(), note: null, ...input,
    };
    this.groups.set(group.id, group);
    return { ...group };
  }

  async bumpRevision(_db: any, input: any) {
    const group = this.groups.get(input.groupId);
    if (!group || group.companyId !== input.companyId || group.revision !== input.expectedRevision) return null;
    Object.assign(group, input.data ?? {}, { revision: input.expectedRevision + 1 });
    return group.revision;
  }

  async bumpRevisionForCommittedEffect(_db: any, input: any) {
    const group = this.groups.get(input.groupId);
    Object.assign(group, input.data ?? {}, { revision: group.revision + 1 });
    return group.revision;
  }

  async markFileRejected(_db: any, input: any) {
    const file = this.files.get(input.fileId);
    if (!file || file.uploadState !== 'PENDING_UPLOAD') return false;
    file.uploadState = 'REJECTED';
    return true;
  }

  async listFileStatesForGroups(_db: any, companyId: string, groupIds: string[]) {
    return [...this.files.values()]
      .filter((file) => file.companyId === companyId && groupIds.includes(file.groupId))
      .map((file) => ({ groupId: file.groupId, uploadState: file.uploadState }));
  }

  async listJobStatesForGroups(_db: any, companyId: string, groupIds: string[]) {
    return this.jobs
      .filter((job) => job.companyId === companyId && groupIds.includes(job.groupId))
      .map((job) => ({ groupId: job.groupId, status: job.status }));
  }

  async listFiles(_db: any, companyId: string, groupId: string) {
    return [...this.files.values()]
      .filter((file) => file.companyId === companyId && file.groupId === groupId)
      .sort((left, right) => left.position - right.position);
  }

  async findFile(_db: any, companyId: string, groupId: string, fileId: string) {
    const file = this.files.get(fileId);
    return file && file.companyId === companyId && file.groupId === groupId ? { ...file } : null;
  }

  async nextFilePosition(_db: any, companyId: string, groupId: string) {
    return (await this.listFiles(null, companyId, groupId)).length + 1;
  }

  async createFile(_db: any, input: any) {
    const file = {
      id: this.id('f'), uploadState: 'PENDING_UPLOAD', checksumSha256: null, pageCount: null,
      detachedReason: null, electronicVerificationJson: { status: 'NOT_CHECKED', method: null, checkedAt: null },
      createdAt: new Date(), updatedAt: new Date(), ...input,
    };
    this.files.set(file.id, file);
    return { ...file };
  }

  async markFileStored(_db: any, input: any) {
    const file = this.files.get(input.fileId);
    if (!file || file.companyId !== input.companyId || file.uploadState !== 'PENDING_UPLOAD') return false;
    Object.assign(file, { uploadState: 'STORED', checksumSha256: input.checksumSha256, byteSize: input.byteSize });
    return true;
  }

  async markFileDetached(_db: any, input: any) {
    const file = this.files.get(input.fileId);
    if (!file || file.uploadState === 'DETACHED') return false;
    Object.assign(file, { uploadState: 'DETACHED', detachedReason: input.reason, detachedAt: new Date() });
    return true;
  }

  async createReadJob(_db: any, input: any) {
    const job = { id: this.id('job'), status: 'QUEUED', manifestJson: null, pausedReason: null, lastErrorCode: null, ...input };
    this.jobs.push(job);
    return job;
  }

  async findJobByFile(_db: any, companyId: string, fileId: string) {
    return this.jobs.filter((job) => job.companyId === companyId && job.fileId === fileId).at(-1) ?? null;
  }

  async listJobsByGroup(_db: any, companyId: string, groupId: string) {
    return this.jobs.filter((job) => job.companyId === companyId && job.groupId === groupId);
  }

  async cancelJobsForFile(_db: any, companyId: string, fileId: string) {
    let count = 0;
    for (const job of this.jobs) {
      if (job.companyId === companyId && job.fileId === fileId && job.status !== 'CANCELLED') {
        job.status = 'CANCELLED'; count += 1;
      }
    }
    return count;
  }

  async createObservation(_db: any, input: any) {
    const observation = { id: this.id('obs'), createdAt: new Date(), stale: false, ...input };
    this.observations.push(observation);
    return observation;
  }

  async listObservations(_db: any, companyId: string, groupId: string) {
    return this.observations.filter((row) => row.companyId === companyId && row.groupId === groupId && !row.stale);
  }

  async findGroupAllocation() { return null; }

  async listDerivedSources(_db: any, companyId: string, groupId: string) {
    return [...this.expenses.values()]
      .filter((expense) => expense.companyId === companyId && expense.captureGroupId === groupId)
      .map((expense) => ({
        id: expense.id, captureScopeKey: expense.captureScopeKey ?? null,
        captureAllocationId: expense.captureAllocationId ?? null, status: expense.status,
        grandTotalAmount: expense.grandTotalAmount ?? '0', payerUserId: expense.payerUserId ?? null,
      }));
  }

  /** W05: nothing in these fakes consumes a derived source, so a handed-off group stays reopenable. */
  async isReopenableAfterHandoff() { return true; }

  /** W06: certificates the test seeded on a derived source, keyed the way the repository keys them. */
  certificates = new Map<string, any>();

  async listDerivedCertificates(_db: any, _companyId: string, expenseIds: string[]) {
    return new Map(expenseIds.filter((id) => this.certificates.has(id)).map((id) => [id, this.certificates.get(id)]));
  }
}

function matchLink(link: any, where: any): boolean {
  const target = (value: any, expected: any) => {
    if (expected === undefined) return true;
    if (expected && typeof expected === 'object' && 'in' in expected) return expected.in.includes(value);
    if (expected && typeof expected === 'object' && 'not' in expected) return value !== expected.not;
    return value === expected;
  };
  if (where.OR) return where.OR.some((clause: any) => matchLink(link, { ...where, OR: undefined, ...clause }));
  return target(link.companyId, where.companyId) && target(link.attachmentId, where.attachmentId)
    && target(link.targetType, where.targetType) && target(link.targetId, where.targetId)
    && target(link.purpose, where.purpose);
}

const audit = { log: async () => undefined } as any;
const openLaunchGate = { assertLaunchRouteOpen: async () => undefined } as any;
const config = (intakeEnabled = true) => ({
  expenseCaptureGroupIntakeEnabled: intakeEnabled,
  uploadMaxBytes: 10_485_760,
  expenseCapturePdfMaxPages: 60,
} as any);

const ctx = (over: Record<string, unknown> = {}) => ({
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'co-1', membershipId: 'mem-1',
  roles: ['STAFF'], permissions: ['expense.receipt.upload', 'expense.create', 'expense.update', 'attachment.create'],
  scopes: {}, authProvider: 'watchdog', ...over,
} as any);

function build(options: { intakeEnabled?: boolean; repo?: FakeCaptureRepo; rejectFile?: boolean } = {}) {
  const capture = options.repo ?? new FakeCaptureRepo();
  const appConfig = config(options.intakeEnabled ?? true);
  const access = new ExpenseCaptureAccessService(capture as any, appConfig);
  const expenses = {
    resolveCreateBranchId: async (_companyId: string, _scopes: any, branchId?: string) => branchId ?? 'branch-1',
    linkAttachmentToTarget: async (attachmentId: string, targetType: string, targetId: string, purpose: string, companyId: string) => {
      capture.links.push({ attachmentId, targetType, targetId, purpose, companyId });
    },
    findById: async (companyId: string, expenseId: string) => {
      const expense = capture.expenses.get(expenseId);
      return expense && expense.companyId === companyId ? { ...expense } : null;
    },
    findByIdWithRelations: async (companyId: string, expenseId: string) => {
      const expense = capture.expenses.get(expenseId);
      return expense && expense.companyId === companyId ? { ...expense, lines: expense.lines ?? [], attachments: [] } : null;
    },
  } as any;
  const intents: any[] = [];
  const intentActors: any[] = [];
  const intentSources: any[] = [];
  const completionActors: any[] = [];
  const completionPolicies: any[] = [];
  // The attachment row has a lifecycle here, because the fix under test turns on reading it back:
  // PENDING_UPLOAD after the intent, ACTIVE once the shared completion has verified the bytes.
  const objects = capture.objects;
  const createIntent = {
    execute: async (actor: any, cmd: any, source: any) => {
      intents.push(cmd);
      intentActors.push(actor);
      intentSources.push(source);
      const attachmentId = `att-${intents.length}`;
      objects.set(attachmentId, { id: attachmentId, companyId: actor.companyId, uploadedByUserId: actor.userId, branchId: cmd.branchId, status: 'PENDING_UPLOAD', byteSize: cmd.byteSize });
      return {
        attachmentId, uploadUrl: '/upload', uploadMethod: 'PUT',
        uploadHeaders: {}, expiresAt: new Date('2026-09-18T00:00:00.000Z'),
      };
    },
  } as any;
  const completed: any[] = [];
  let onCompleteUpload: (() => void) | undefined;
  const completeUpload = {
    execute: async (actor: any, cmd: any, policy: any) => {
      completionPolicies.push(policy);
      completed.push(cmd);
      completionActors.push(actor);
      const object = objects.get(cmd.attachmentId);
      // The real one refuses anything that is not PENDING_UPLOAD; a fake that forgives that would
      // hide the exact stranding this fix exists for.
      if (!object || object.status !== 'PENDING_UPLOAD') throw new Error('Attachment is not in PENDING_UPLOAD state.');
      if (options.rejectFile) {
        object.status = 'QUARANTINED';
        throw new BadRequestException({ code: 'EMBEDDED_FILE_REJECTED' });
      }
      Object.assign(object, { status: 'ACTIVE', checksumSha256: 'sha-1', byteSize: 1_000, objectVersionId: 'v1' });
      onCompleteUpload?.();
      return { ...object };
    },
  } as any;
  const attachments = {
    findSubstituteEvidenceRetentionHold: async () => null,
    findById: async ({ id, companyId }: any) => {
      const object = objects.get(id);
      return object && object.companyId === companyId ? { ...object } : null;
    },
  } as any;
  // W03's fire-and-forget start. It records rather than runs: `complete` must answer the upload
  // without ever waiting for a provider.
  const runner = { kicked: [] as string[], kick(jobId: string) { this.kicked.push(jobId); } };

  return {
    capture, access, intents, completed, objects, runner, intentActors, intentSources, completionActors, completionPolicies,
    duringCompleteUpload: (hook: () => void) => { onCompleteUpload = hook; },
    capability: new GetExpenseCaptureCapabilityUseCase(access),
    create: new CreateExpenseCaptureGroupUseCase(capture as any, expenses, access, audit, openLaunchGate),
    list: new ListExpenseCaptureGroupsUseCase(capture as any),
    get: new GetExpenseCaptureGroupUseCase(capture as any, access, appConfig),
    addFile: new AddExpenseCaptureFileUseCase(capture as any, access, createIntent, audit, openLaunchGate),
    completeFile: new CompleteExpenseCaptureFileUseCase(capture as any, expenses, access, completeUpload, attachments, audit, runner as any),
    detachFile: new DetachExpenseCaptureFileUseCase(capture as any, access, attachments, audit),
    closeGroup: new CloseExpenseCaptureGroupUseCase(capture as any, access, audit),
    convert: new ConvertExpenseToCaptureGroupUseCase(capture as any, expenses, access, audit, openLaunchGate, capture as any),
    attachments,
  };
}

const code = (error: any) => error?.getResponse?.()?.code ?? error?.response?.code;

describe('capture group creation and reading', () => {
  it('creates an OPEN group at revision 1 with the deep link W04 will render', async () => {
    const app = build();
    const result = await app.create.execute(ctx(), { note: '  ซื้อของร้านค้า  ' });
    assert.equal(result.revision, 1);
    assert.equal(result.webPath, `/companies/co-1/expenses`, "appendix §25: the group page is withdrawn");
    const group = app.capture.groups.get(result.groupId);
    assert.equal(group.status, 'OPEN');
    assert.equal(group.note, 'ซื้อของร้านค้า');
    assert.equal(group.branchId, 'branch-1');
  });

  it('stores the LINE chat a result may be pushed into, and never returns it (W07-int)', async () => {
    const app = build();
    const lineCtx = ctx({ authProvider: 'line' });
    const { groupId } = await app.create.execute(lineCtx, {
      intakeChannel: 'LINE', lineChatKeyHash: 'chat-hash-1', linePushTargetId: 'Cgroup-chat-id',
    } as any);
    assert.equal(app.capture.groups.get(groupId).linePushTargetId, 'Cgroup-chat-id');

    const detail = await app.get.execute(ctx({ permissions: ['expense.read'] }), groupId);
    assert.ok(!('linePushTargetId' in (detail as Record<string, unknown>)));
    assert.ok(!JSON.stringify(detail).includes('Cgroup-chat-id'), 'a raw chat id never leaves the API');

    // A web caller cannot smuggle one in: without the hash the column stays null.
    const web = await app.create.execute(ctx(), { linePushTargetId: 'Cgroup-chat-id' } as any);
    assert.equal(app.capture.groups.get(web.groupId).linePushTargetId, null);
  });

  it('refuses a caller with no upload or create authority', async () => {
    const app = build();
    await assert.rejects(
      () => app.create.execute(ctx({ permissions: ['expense.read'] }), {}),
      (error: any) => error.getStatus() === 403,
    );
  });

  it('refuses creation with the intake flag off, and says so with the shared code (A47)', async () => {
    const app = build({ intakeEnabled: false });
    await assert.rejects(() => app.create.execute(ctx(), {}), (error: any) =>
      error.getStatus() === 403 && code(error) === FEATURE_TEMPORARILY_UNAVAILABLE);
  });

  it('reports the capability from config instead of letting a client hard-code limits', async () => {
    const app = build();
    assert.deepEqual(await app.capability.execute(ctx()), {
      maxBytes: 10_485_760,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      pdfAutomaticRead: true,
      pdfMaxPagesAutomatic: 60,
    });
  });

  it('answers 404 for another company, so an id cannot be probed across tenants (A15)', async () => {
    const app = build();
    const { groupId } = await app.create.execute(ctx(), {});
    await assert.rejects(
      () => app.get.execute(ctx({ companyId: 'co-2', permissions: ['expense.read'] }), groupId),
      (error: any) => error.getStatus() === 404,
    );
  });

  it('answers 404 when the group branch is outside the caller scope', async () => {
    const app = build();
    const { groupId } = await app.create.execute(ctx(), { branchId: 'branch-1' });
    await assert.rejects(
      () => app.get.execute(ctx({ permissions: ['expense.read'], scopes: { branchIds: ['branch-9'] } }), groupId),
      (error: any) => error.getStatus() === 404,
    );
  });

  it('lets read_own see its own group and refuses somebody else\'s', async () => {
    const app = build();
    const { groupId } = await app.create.execute(ctx(), {});
    const own = ctx({ permissions: ['expense.read_own'] });
    assert.equal((await app.get.execute(own, groupId)).groupId, groupId);
    await assert.rejects(
      () => app.get.execute(ctx({ userId: 'user-2', permissions: ['expense.read_own'] }), groupId),
      (error: any) => error.getStatus() === 403,
    );
  });

  it('lists only the caller\'s own groups for read_own, and all of them for expense.read', async () => {
    const app = build();
    await app.create.execute(ctx(), {});
    await app.create.execute(ctx({ userId: 'user-2' }), {});
    assert.equal((await app.list.execute(ctx({ permissions: ['expense.read_own'] }), {})).items.length, 1);
    assert.equal((await app.list.execute(ctx({ permissions: ['expense.read'] }), {})).items.length, 2);
  });

  it('returns no facts and no money for an empty group, only the blocker that asks for a file', async () => {
    const app = build();
    const { groupId } = await app.create.execute(ctx(), {});
    const detail = await app.get.execute(ctx({ permissions: ['expense.read', 'expense.review'] }), groupId);
    assert.equal(detail.facts, null);
    assert.deepEqual(detail.derivedSources, []);
    assert.deepEqual(detail.blockers.map((blocker) => blocker.code), ['expense_capture_no_evidence']);
    assert.equal(detail.allowedActions.includes('add_file'), true);
    assert.equal(detail.capability.pdfMaxPagesAutomatic, 60);
  });
});

describe('capture group files', () => {
  async function withGroup(options: { intakeEnabled?: boolean } = {}) {
    const app = build(options);
    const { groupId, revision } = await app.create.execute(ctx(), {});
    return { app, groupId, revision };
  }

  it('reserves storage through the shared intent and records a PENDING_UPLOAD file', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    assert.equal(added.revision, revision + 1);
    assert.equal(app.intents[0].visibility, 'INTERNAL');
    assert.equal(app.intents[0].branchId, 'branch-1');
    const file = app.capture.files.get(added.fileId);
    assert.equal(file.uploadState, 'PENDING_UPLOAD');
    assert.equal(file.position, 1);
  });

  it('refuses a stale revision BEFORE reserving storage, so a dead tab cannot eat the quota', async () => {
    const { app, groupId, revision } = await withGroup();
    await assert.rejects(() => app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision + 5,
    }), (error: any) => error.getStatus() === 409 && code(error) === 'expense_capture_group_revision_conflict');
    assert.deepEqual(app.intents, []);
  });

  it('refuses a new file with the intake flag off but still completes, detaches and closes (A47)', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });

    const closed = build({ intakeEnabled: false, repo: app.capture });
    await assert.rejects(() => closed.addFile.execute(ctx(), groupId, {
      originalFileName: 'second.pdf', mimeType: 'application/pdf', byteSize: 10, expectedRevision: added.revision,
    }), (error: any) => code(error) === FEATURE_TEMPORARILY_UNAVAILABLE);

    const completed = await closed.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    assert.equal(completed.uploadState, 'STORED');
    // W08/IG13: the reserved upload finishes AND its read is admitted and started. A47 asks for
    // "ยังอ่าน/กู้คืน…ได้" — a flag that stranded a paid-for read would fail exactly here.
    assert.equal(closed.capture.jobs.length, 1, 'the queued read job still exists with intake closed');
    assert.equal(closed.runner.kicked.length, 1, 'and the runner is still started for it');
    // The read model is still served, and it is the SERVER that drops the button.
    assert.equal((await closed.get.execute(ctx({ permissions: ['expense.read'] }), groupId)).allowedActions.includes('add_file'), false);
    const view = await closed.get.execute(ctx({ permissions: ['expense.read', 'expense.update'] }), groupId);
    assert.deepEqual(view.allowedActions, ['detach_file', 'close'], 'detach and close still end the work');
    assert.equal(view.files.length, 1, 'and the evidence already stored is still readable');
    const detached = await closed.detachFile.execute(ctx(), groupId, added.fileId, { reason: 'ส่งผิดไฟล์', expectedRevision: completed.revision });
    assert.equal(detached.cancelledJobs, 1);
    await closed.closeGroup.execute(ctx(), groupId, { reason: 'CANCELLED', expectedRevision: detached.revision });
  });

  it('completes an upload once: the file is STORED, linked to the group, and one read job is queued', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    const result = await app.completeFile.execute(ctx(), groupId, added.fileId, {
      byteSize: 2_000, checksumSha256: 'sha-1', expectedRevision: added.revision,
    });

    assert.equal(result.replayed, false);
    assert.equal(app.capture.files.get(added.fileId).uploadState, 'STORED');
    assert.deepEqual(app.capture.links.map((link) => [link.targetType, link.purpose, link.targetId]),
      [['expense.capture_group', 'expense.capture.evidence', groupId]]);
    assert.equal(app.capture.jobs.length, 1);
    const job = app.capture.jobs[0]!;
    assert.equal(job.status, 'QUEUED');
    assert.equal(job.ownerType, 'CAPTURE_GROUP');
    assert.equal(job.attachmentChecksum, 'sha-1');
    assert.ok(job.ocrAdmissionRequestId, 'the OCR admission fence is minted with the job');
    assert.deepEqual(job.manifestJson, { pageCount: null, pages: [], chunks: [], windows: [], electronicVerification: { status: 'NOT_CHECKED' } });
    // §2.4: the evidence lock is taken before the group lock, never the other way round.
    assert.equal(app.capture.locks.at(-1), `co-1:expense-capture:${groupId}`);
  });

  it('replays a second complete instead of storing twice or queueing a second read', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    const first = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    const second = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });

    assert.equal(second.replayed, true);
    assert.equal(second.readJobId, first.readJobId);
    assert.equal(app.capture.jobs.length, 1);
    assert.equal(app.completed.length, 1, 'storage completion runs once');
  });

  it('finishes a retry after the recording transaction failed, without storing the bytes twice', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });

    // The storage side effect lands, then the recording transaction dies (lost connection, CAS
    // loss, anything). Before the fix the attachment was ACTIVE while the file stayed
    // PENDING_UPLOAD, and every retry was refused by the shared completion — stranded forever.
    app.capture.failNextTransaction = true;
    await assert.rejects(() => app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision }),
      /simulated transaction failure/);
    assert.equal(app.objects.get(added.attachmentId).status, 'ACTIVE', 'the bytes are already verified and stored');
    assert.equal(app.capture.files.get(added.fileId).uploadState, 'PENDING_UPLOAD');

    const retried = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    assert.equal(retried.uploadState, 'STORED');
    assert.equal(retried.replayed, false);
    assert.equal(app.completed.length, 1, 'the shared completion is never asked to verify the same object twice');
    assert.equal(app.capture.jobs.length, 1, 'and the retry does not queue a second read');
  });

  it('records a completion whose revision moved while the bytes were being stored', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    // Somebody else mutates the group while storage is running — an irreversible effect must not
    // be answered with a conflict, or the file is lost with its bytes already paid for.
    app.duringCompleteUpload(() => { app.capture.groups.get(groupId).revision += 1; });

    const result = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    assert.equal(result.uploadState, 'STORED');
    assert.equal(result.revision, added.revision + 2, 'the bump is unconditional once the bytes exist');
    assert.equal(app.capture.jobs.length, 1);
  });

  it('rejects the file slot when the object was quarantined, instead of retrying forever', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    app.objects.get(added.attachmentId).status = 'QUARANTINED';

    await assert.rejects(() => app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision }),
      (error: any) => error.getStatus() === 409 && code(error) === 'expense_capture_file_state_invalid');
    assert.equal(app.capture.files.get(added.fileId).uploadState, 'REJECTED');
    assert.deepEqual(app.completed, [], 'nothing tries to complete bytes the scanner refused');
  });

  it('refuses a resumed completion whose checksum no longer matches the stored bytes', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    app.capture.failNextTransaction = true;
    await assert.rejects(() => app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision }), /simulated/);

    await assert.rejects(() => app.completeFile.execute(ctx(), groupId, added.fileId, {
      expectedRevision: added.revision, checksumSha256: 'sha-different',
    }), (error: any) => error.getStatus() === 400);
    assert.equal(app.capture.files.get(added.fileId).uploadState, 'PENDING_UPLOAD');
  });

  it('refuses to detach a file a derived expense already uses as its receipt', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    const stored = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    app.capture.links.push({
      companyId: 'co-1', attachmentId: added.attachmentId, targetType: 'expense.record',
      targetId: 'e-1', purpose: 'expense.receipt.primary',
    });

    await assert.rejects(() => app.detachFile.execute(ctx(), groupId, added.fileId, {
      reason: 'ไม่ต้องการแล้ว', expectedRevision: stored.revision,
    }), (error: any) => error.getStatus() === 409 && code(error) === 'expense_capture_file_detach_blocked');
    assert.equal(app.capture.files.get(added.fileId).uploadState, 'STORED');
  });

  it('refuses to detach a file a certified substitute receipt retains', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    const stored = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    app.attachments.findSubstituteEvidenceRetentionHold = async () => ({ evidenceId: 'ev-1' });

    await assert.rejects(() => app.detachFile.execute(ctx(), groupId, added.fileId, {
      reason: 'ไม่ต้องการแล้ว', expectedRevision: stored.revision,
    }), (error: any) => code(error) === 'expense_capture_file_detach_blocked');
  });

  it('detaches a free file: the group link goes, the job is cancelled, the object is not deleted', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    const stored = await app.completeFile.execute(ctx(), groupId, added.fileId, { expectedRevision: added.revision });
    const detached = await app.detachFile.execute(ctx(), groupId, added.fileId, {
      reason: 'ส่งผิดไฟล์', expectedRevision: stored.revision,
    });

    assert.equal(detached.cancelledJobs, 1);
    assert.equal(app.capture.jobs[0]!.status, 'CANCELLED');
    assert.equal(app.capture.files.get(added.fileId).uploadState, 'DETACHED');
    assert.deepEqual(app.capture.links, []);
  });

  it('refuses a detach reason that is empty or longer than the column allows', async () => {
    const { app, groupId, revision } = await withGroup();
    const added = await app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 2_000, expectedRevision: revision,
    });
    for (const reason of ['   ', 'x'.repeat(501)]) {
      await assert.rejects(() => app.detachFile.execute(ctx(), groupId, added.fileId, { reason, expectedRevision: added.revision }),
        (error: any) => error.getStatus() === 400);
    }
  });

  it('refuses a file on a closed group', async () => {
    const { app, groupId, revision } = await withGroup();
    const closed = await app.closeGroup.execute(ctx(), groupId, { reason: 'NO_COMPANY_PORTION', expectedRevision: revision });
    await assert.rejects(() => app.addFile.execute(ctx(), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 10, expectedRevision: closed.revision,
    }), (error: any) => code(error) === 'expense_capture_group_closed');
  });

  it('refuses a colleague who may upload but does not own the group', async () => {
    const { app, groupId, revision } = await withGroup();
    await assert.rejects(() => app.addFile.execute(ctx({ userId: 'user-2' }), groupId, {
      originalFileName: 'bill.pdf', mimeType: 'application/pdf', byteSize: 10, expectedRevision: revision,
    }), (error: any) => error.getStatus() === 403);
  });
});

describe('closing a capture group', () => {
  it('records NO_COMPANY_PORTION as a closed job, not a cancelled one', async () => {
    const app = build();
    const { groupId, revision } = await app.create.execute(ctx(), {});
    const closed = await app.closeGroup.execute(ctx(), groupId, { reason: 'NO_COMPANY_PORTION', expectedRevision: revision });
    assert.equal(closed.status, 'CLOSED_NO_HANDOFF');
    assert.equal(app.capture.groups.get(groupId).closedReason, 'NO_COMPANY_PORTION');
    assert.ok(app.capture.groups.get(groupId).closedAt);
  });

  it('refuses to close a group whose handoff is active', async () => {
    const app = build();
    const { groupId, revision } = await app.create.execute(ctx(), {});
    app.capture.groups.get(groupId).handoffState = 'ACTIVE';
    await assert.rejects(() => app.closeGroup.execute(ctx(), groupId, { reason: 'CANCELLED', expectedRevision: revision }),
      (error: any) => error.getStatus() === 409 && code(error) === 'expense_capture_handoff_active');
  });

  it('lets exactly one of two concurrent closes win on the revision', async () => {
    const app = build();
    const { groupId, revision } = await app.create.execute(ctx(), {});
    const results = await Promise.allSettled([
      app.closeGroup.execute(ctx(), groupId, { reason: 'CANCELLED', expectedRevision: revision }),
      app.closeGroup.execute(ctx(), groupId, { reason: 'NO_COMPANY_PORTION', expectedRevision: revision }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    assert.equal(code(rejected.reason), 'expense_capture_group_revision_conflict');
  });

  it('refuses a close reason outside the contract', async () => {
    const app = build();
    const { groupId, revision } = await app.create.execute(ctx(), {});
    await assert.rejects(() => app.closeGroup.execute(ctx(), groupId, { reason: 'BECAUSE' as never, expectedRevision: revision }),
      (error: any) => error.getStatus() === 400);
  });

  it('refuses a viewer without update or review authority', async () => {
    const app = build();
    const { groupId, revision } = await app.create.execute(ctx(), {});
    await assert.rejects(
      () => app.closeGroup.execute(ctx({ permissions: ['expense.read'] }), groupId, { reason: 'CANCELLED', expectedRevision: revision }),
      (error: any) => error.getStatus() === 403,
    );
  });
});

describe('converting an expense into a capture group (§3.1)', () => {
  const updatedAt = new Date('2026-09-18T01:00:00.000Z');

  function withExpense(over: Record<string, unknown> = {}) {
    const app = build();
    app.capture.expenses.set('e-1', {
      id: 'e-1', companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
      currency: 'THB', expenseDate: new Date('2026-09-17T00:00:00.000Z'), paymentStatus: 'UNPAID', paidAmount: '0',
      postingStatus: 'not_required', grandTotalAmount: '321.50', vendorNameSnapshot: 'ร้านวัสดุ',
      vendorTaxIdSnapshot: '0105560012345', sourceDocumentType: 'RECEIPT', updatedAt, captureGroupId: null,
      lines: [{ lineNumber: 1, description: 'ปูน', quantity: '1', unitPrice: '321.50', lineTotalAmount: '321.50' }],
      ...over,
    });
    return app;
  }

  it('adopts the receipt files, pins the scope key and changes no amount', async () => {
    const app = withExpense();
    app.capture.links.push({
      companyId: 'co-1', attachmentId: 'att-old', targetType: 'expense.record', targetId: 'e-1',
      purpose: 'expense.receipt.primary',
      attachment: { originalFileName: 'bill.jpg', mimeType: 'image/jpeg', byteSize: 900, checksumSha256: 'sha-old' },
      createdAt: new Date(),
    });

    const result = await app.convert.execute(ctx(), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() });

    assert.equal(result.adoptedFiles, 1);
    assert.equal(result.captureScopeKey, 'issuer:0105560012345');
    const expense = app.capture.expenses.get('e-1');
    assert.equal(expense.captureGroupId, result.groupId);
    assert.equal(expense.captureScopeKey, 'issuer:0105560012345');
    assert.equal(expense.grandTotalAmount, '321.50', 'conversion never re-totals the expense');
    assert.equal(expense.status, 'NEEDS_REVIEW', 'and never moves its status');

    const files = await app.capture.listFiles(null, 'co-1', result.groupId);
    assert.equal(files[0]!.uploadState, 'STORED');
    assert.equal(files[0]!.checksumSha256, 'sha-old');
    assert.equal(app.capture.links.some((link) => link.targetType === 'expense.capture_group' && link.purpose === 'expense.capture.evidence'), true);
    assert.equal(app.capture.links.some((link) => link.targetType === 'expense.record' && link.purpose === 'expense.receipt.primary'), true,
      'the expense keeps its own receipt link: the bytes are shared, not moved');

    const [observation] = app.capture.observations;
    assert.equal(observation.source, 'EXPENSE_FACTS');
    assert.equal(observation.version, 1);
    assert.equal(observation.payloadJson.totals[0].amount, '321.50');
  });

  it('surfaces the adopted facts as the group read model', async () => {
    const app = withExpense();
    const result = await app.convert.execute(ctx(), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() });
    const detail = await app.get.execute(ctx({ permissions: ['expense.read'] }), result.groupId);
    assert.equal(detail.facts?.documents[0]?.issuer.taxId, '0105560012345');
    // W06: a §3.1 conversion has no allocation to reserve, so the ordinary certificate rules decide.
    assert.deepEqual(detail.derivedSources, [{
      expenseId: 'e-1', scopeKey: 'issuer:0105560012345', status: 'NEEDS_REVIEW', grandTotalAmount: '321.50',
      payerUserId: null, certificate: null, nextAction: 'certificate_available',
    }]);
  });

  it('refuses a stale expectedUpdatedAt', async () => {
    const app = withExpense();
    await assert.rejects(() => app.convert.execute(ctx(), 'e-1', { expectedUpdatedAt: '2026-09-18T02:00:00.000Z' }),
      (error: any) => error.getStatus() === 409 && code(error) === 'EXPENSE_UPDATE_CONFLICT');
  });

  it('refuses an expense that is already in a group', async () => {
    const app = withExpense({ captureGroupId: 'g-existing' });
    await assert.rejects(() => app.convert.execute(ctx(), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() }),
      (error: any) => code(error) === 'expense_capture_group_exists');
  });

  for (const [label, over] of [
    ['confirmed', { status: 'CONFIRMED' }],
    ['paid', { paymentStatus: 'PAID', paidAmount: '100' }],
    ['posted', { postingStatus: 'posted' }],
    ['claim-born', { sourceReimbursementRequestId: 'r-1' }],
  ] as const) {
    it(`refuses an expense that is already ${label}`, async () => {
      const app = withExpense(over as Record<string, unknown>);
      await assert.rejects(() => app.convert.execute(ctx(), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() }),
        (error: any) => error.getStatus() === 409 && code(error) === 'expense_capture_convert_ineligible');
      assert.equal(app.capture.groups.size, 0, 'no group is created for a refused conversion');
    });
  }

  it('refuses a conversion with the intake flag off', async () => {
    const app = build({ intakeEnabled: false });
    app.capture.expenses.set('e-1', { id: 'e-1', companyId: 'co-1', createdByUserId: 'user-1', status: 'DRAFT', updatedAt });
    await assert.rejects(() => app.convert.execute(ctx(), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() }),
      (error: any) => code(error) === FEATURE_TEMPORARILY_UNAVAILABLE);
  });

  it('refuses another user\'s expense without review authority, and 404s across companies', async () => {
    const app = withExpense();
    await assert.rejects(
      () => app.convert.execute(ctx({ userId: 'user-2' }), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() }),
      (error: any) => error.getStatus() === 403,
    );
    await assert.rejects(
      () => app.convert.execute(ctx({ companyId: 'co-2' }), 'e-1', { expectedUpdatedAt: updatedAt.toISOString() }),
      (error: any) => error.getStatus() === 404,
    );
  });
});

describe('certificate progress per derived source (W06, A40)', () => {
  const issuer = (taxId: string, name: string) => ({
    ref: `doc-${taxId}`, pageIndexes: [0], kind: 'MARKETPLACE_ORDER', family: 'ORDER',
    issuer: { name, taxId }, documentNumber: `${name}-1`, documentDate: '2026-09-18', currency: 'THB',
    classification: { documentKind: 'MARKETPLACE_ORDER', confidence: 0.9 },
  });

  function handedOff() {
    const app = build();
    const group = { id: 'g-ab', companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'user-1',
      intakeChannel: 'WEB', revision: 3, status: 'HANDED_OFF', businessUse: 'MIXED', fundingRoute: 'EMPLOYEE',
      payerUserId: 'payer-1', handoffState: 'ACTIVE', acceptedAllocationId: 'alloc-1', closedReason: null,
      closedAt: null, note: null, createdAt: new Date(), updatedAt: new Date() };
    app.capture.groups.set(group.id, group);
    app.capture.observations.push({
      id: 'obs-1', companyId: 'co-1', groupId: group.id, fileId: 'file-1', version: 1, source: 'AI', stale: false,
      payloadJson: {
        documents: [issuer('0105560012345', 'ร้านเอ'), issuer('0105560099999', 'ร้านบี')],
        items: [
          { id: '0:1', documentRef: 'doc-0105560012345', description: 'กระดาษ', quantity: '1', unitPrice: '810.00', amount: '810.00', event: 'sale', evidenceSpan: 'กระดาษ' },
          { id: '0:2', documentRef: 'doc-0105560099999', description: 'ปากกา', quantity: '1', unitPrice: '480.00', amount: '480.00', event: 'sale', evidenceSpan: 'ปากกา' },
        ],
        components: [],
        totals: [
          { documentRef: 'doc-0105560012345', kind: 'document_total', amount: '810.00', evidenceSpan: '810' },
          { documentRef: 'doc-0105560099999', kind: 'document_total', amount: '480.00', evidenceSpan: '480' },
        ],
        payments: [
          { documentRef: 'doc-0105560012345', method: 'BANK_TRANSFER', status: 'paid', amount: '810.00', occurredAt: '2026-09-18', evidenceSpan: 'จ่ายแล้ว' },
          { documentRef: 'doc-0105560099999', method: 'BANK_TRANSFER', status: 'paid', amount: '480.00', occurredAt: '2026-09-18', evidenceSpan: 'จ่ายแล้ว' },
        ],
        refunds: [],
        completeness: { itemsTruncated: false, unreadableRows: 0, pagesCovered: [0], notes: [] },
      },
    });
    for (const [id, taxId, amount] of [['e-a', '0105560012345', '810.00'], ['e-b', '0105560099999', '480.00']] as const) {
      app.capture.expenses.set(id, {
        id, companyId: 'co-1', branchId: 'branch-1', createdByUserId: 'user-1', status: 'NEEDS_REVIEW',
        grandTotalAmount: amount, payerUserId: 'payer-1', captureGroupId: group.id,
        captureAllocationId: 'alloc-1', captureScopeKey: `issuer:${taxId}`, updatedAt: new Date(),
      });
    }
    return app;
  }

  it('says which shop is issued and which one may still be prepared', async () => {
    const app = handedOff();
    app.capture.certificates.set('e-a', {
      evidenceId: 'sub-a', status: 'ISSUED', signatureMode: 'DIGITAL',
      fundingSource: 'PERSONAL_ADVANCE', documentNumber: 'SRC-E-A-V1',
    });

    const detail = await app.get.execute(ctx({ permissions: ['expense.read'] }), 'g-ab');

    assert.deepEqual(detail.derivedSources.map((source) => [source.expenseId, source.nextAction]), [
      ['e-a', 'certificate_issued'],
      ['e-b', 'certificate_available'],
    ]);
    assert.equal(detail.derivedSources[0]!.certificate?.documentNumber, 'SRC-E-A-V1');
    assert.equal(detail.derivedSources[1]!.certificate, null, 'B has no document to open yet');
  });

  it('blocks the shop whose allocation moved on, and never the sibling that did not', async () => {
    const app = handedOff();
    app.capture.expenses.get('e-b')!.captureAllocationId = 'alloc-0';

    const detail = await app.get.execute(ctx({ permissions: ['expense.read'] }), 'g-ab');

    assert.equal(detail.derivedSources.find((source) => source.expenseId === 'e-a')?.nextAction, 'certificate_available');
    assert.equal(detail.derivedSources.find((source) => source.expenseId === 'e-b')?.nextAction, 'blocked');
  });

  it('offers no certificate for a shop that issued a receipt (A18)', async () => {
    const app = handedOff();
    app.capture.observations[0]!.payloadJson.documents[1]!.kind = 'RECEIPT';

    const detail = await app.get.execute(ctx({ permissions: ['expense.read'] }), 'g-ab');

    assert.equal(detail.derivedSources.find((source) => source.expenseId === 'e-b')?.nextAction, 'receipt_present');
  });
});


it('R1 capture uploader completes and replays', async () => {
  const app = build();
  const actor = ctx({ scopes: { branchIds: ['branch-1'] } });
  const group = await app.create.execute(actor, { branchId: 'branch-1' });
  const added = await app.addFile.execute(actor, group.groupId, { originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1_000, expectedRevision: 1 });
  const completed = await app.completeFile.execute(actor, group.groupId, added.fileId, { expectedRevision: added.revision });
  assert.deepEqual(app.completionActors, [actor]);
  const replay = await app.completeFile.execute(actor, group.groupId, added.fileId, { expectedRevision: completed.revision });
  assert.equal(replay.replayed, true);
  assert.equal(app.completed.length, 1);
  assert.equal(app.objects.get(added.attachmentId).uploadedByUserId, actor.userId);
});

it('R11 upload callers preserve branch and identity', async () => {
  const app = build();
  const actor = ctx({ scopes: { branchIds: ['branch-1'] } });
  const group = await app.create.execute(actor, { branchId: 'branch-1' });
  await app.addFile.execute(actor, group.groupId, { originalFileName: 'receipt.jpg', mimeType: 'image/jpeg', byteSize: 1_000, expectedRevision: 1 });
  assert.deepEqual(app.intentActors, [actor]);
  assert.equal(app.intents[0].branchId, 'branch-1');
  assert.deepEqual(app.intentSources, [{ captureGroupId: group.groupId }]);
  assert.equal([...app.capture.files.values()][0].addedByUserId, actor.userId);
});


it('R4 capture completion uses receipt policy and retains refusal recovery', async () => {
  for (const freeExpenseDrafts of [false, true]) {
    const options = { rejectFile: true };
    const app = build(options);
    const actor = ctx({ freeExpenseDrafts, permissions: ['expense.receipt.upload', 'expense.update', 'attachment.create'] });
    const group = await app.create.execute(actor, { branchId: 'branch-1' });
    const added = await app.addFile.execute(actor, group.groupId, { originalFileName: 'receipt.pdf', mimeType: 'application/pdf', byteSize: 1_000, expectedRevision: 1 });
    await assert.rejects(() => app.completeFile.execute(actor, group.groupId, added.fileId, { expectedRevision: added.revision }), (error: any) => error.getResponse().code === 'EMBEDDED_FILE_REJECTED');
    assert.deepEqual(app.completionPolicies, [{ inspectionPolicy: 'RECEIPT' }]);
    assert.equal(app.capture.jobs.length, 0);
    assert.equal(app.capture.groups.get(group.groupId).status, 'OPEN');
    await assert.rejects(() => app.completeFile.execute(actor, group.groupId, added.fileId, { expectedRevision: added.revision }), (error: any) => error.getResponse().code === 'expense_capture_file_state_invalid');
    options.rejectFile = false;
    const replacement = await app.addFile.execute(actor, group.groupId, { originalFileName: 'other.pdf', mimeType: 'application/pdf', byteSize: 1_000, expectedRevision: added.revision });
    const completed = await app.completeFile.execute(actor, group.groupId, replacement.fileId, { expectedRevision: replacement.revision });
    assert.equal(completed.uploadState, 'STORED');
    assert.equal(app.capture.jobs.length, 1);
  }
});
