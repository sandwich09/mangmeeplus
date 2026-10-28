import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  EXPENSE_CAPTURE_OBSERVATION_LIMITS,
  emptyExpenseCaptureReadManifest,
  type AiModelLineage,
  type ExpenseCaptureAssembledObservations,
  type ExpenseCaptureExtractWindow,
  type ExpenseCaptureManifestPageState,
  type ExpenseCaptureObservations,
  type ExpenseCaptureReadChunk,
  type ExpenseCapturePausedReason,
  type ExpenseCaptureReadManifest,
  type ReceiptOcrFieldResult,
  EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE,
} from '@watchdog-bms/contracts';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { PrismaAttachmentRepository } from '../../../data-model-core/infrastructure/repositories/prisma-attachment.repository';
import { LaunchShadowProbe } from '../../../feature-launch/application/launch-shadow.probe';
import { SHADOW_SURFACES } from '../../../feature-launch/domain/shadow-surface.catalog';
import { admitCompanyOcr, companyOcrErrorCode, isSinglePageReceiptImage, settleCompanyOcrAdmission, releaseCompanyOcrAdmissionWithinTransaction, completeCompanyOcrAdmission, completeCompanyOcrAdmissionWithinTransaction, type CompanyOcrSourceRoute } from '../../../line-ai/application/company-ocr-governance';
import { assertFreeExpenseSourceActor, isFreeExpenseDraftCompany } from '../../../system-partner-management/application/free-expense-access';
import { lockPlanTermCompany } from '../../../system-partner-management/application/lock-plan-term-company';
import { safeLineErrorDetails } from '../../../line-ai/infrastructure/line-reply.adapter';
import { assembleCaptureObservations, planWindows, priorDocuments } from '../../domain/logic/expense-capture-assembly.logic';
import { isExpenseExtractionEligible, sourceDocumentTypeFromClassification, toSourceDocumentType } from '../../domain/logic/expense-document.logic';
import { captureFieldsFromObservations } from '../../domain/logic/expense-capture-fields.logic';
import { planCaptureSinglePageChunk, planCapturePreprocessing, type CaptureChunkPlan } from '../../domain/logic/expense-capture-preprocess.logic';
import { PrismaExpenseCaptureRepository, type CaptureReadJobRow, type CaptureDb } from '../../infrastructure/prisma-expense-capture.repository';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { ExpenseCaptureReadClient } from '../../infrastructure/expense-capture-read.client';
import { ExpenseCaptureAutoSplitService } from './expense-capture-auto-split.service';
import { aiSelectableExpenseCategories } from './expense-category-bootstrap.service';
import { isStaleOcrApply, ReceiptOcrApplyService } from './receipt-ocr-apply.service';

/** Appendix §4.5: the lease one chunk must comfortably fit inside, renewed after every chunk. */
export const EXPENSE_CAPTURE_LEASE_MS = 210_000;
/** Per-job ceilings of §4.6. Reaching one PAUSEs with the reason, keeping everything read so far. */
export const EXPENSE_CAPTURE_MAX_PROVIDER_CALLS = 40;
/** §4.6 "เวลา ≤ 15 นาที" — of the JOB, summed over every resume, not of one lucky attempt. */
export const EXPENSE_CAPTURE_MAX_RUN_MS = 15 * 60_000;
/** A job that keeps dying takes its file out of the queue instead of looping on it forever. */
export const EXPENSE_CAPTURE_MAX_ATTEMPTS = 5;
/** The terminal notification seam: the LINE wave and the web both read this one event. */
/** One string, owned by the contracts package: the LINE result consumer drains exactly this type. */
export const EXPENSE_CAPTURE_READ_FINISHED_EVENT: typeof EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE = EXPENSE_CAPTURE_READ_FINISHED_EVENT_TYPE;

type CaptureCheckpoint = {
  windowPlanVersion?: 2 | 3;
  version: 1;
  /** Page index → what stage 1 read. Bounded per page by the gateway's own page cap. */
  pages: Record<string, { text: string; truncated?: boolean; blank?: boolean }>;
  chunks: Record<string, 'done' | 'failed'>;
  /** Window id → the observations stage 2 returned, so a resume never re-asks a paid question. */
  windows: Record<string, ExpenseCaptureObservations>;
  /** The OCR read this job counted, so a resumed job releases the SAME event it admitted. */
  ocrEventId?: string;
  ocrQuotaSource?: 'FREE_MONTHLY_3';
  ocrMonthKey?: string;
  usableResultStored?: boolean;
  /** Milliseconds every PREVIOUS run of this job spent. The budget is per job, not per attempt:
   *  without this a file that dies at 14 minutes gets a fresh 15 every time it is re-claimed. */
  runMillis?: number;
  /** Derivative bytes this job has already produced, for the same reason. */
  derivativeBytes?: number;
  resplitChunks?: string[];
  lineage?: AiModelLineage[];
  /**
   * Appendix §25 auto-split: document ref → the expense draft that document produced, from the
   * SECOND document on. This is the idempotency record — a retried drain or a re-claimed job skips
   * every ref that is already here, so one document can never produce two expenses.
   */
  splitExpenseIds?: Record<string, string>;
};

const emptyCheckpoint = (): CaptureCheckpoint => ({ version: 1, pages: {}, chunks: {}, windows: {} });

/** Unit tests build the runner directly; the probe is evidence, never a precondition for a read. */
const NOOP_SHADOW = {
  startSweep: () => ({ record: async () => undefined, flush: async () => ({}) }),
} as unknown as LaunchShadowProbe;

type RunOutcome = {
  status: 'DONE' | 'PARTIAL' | 'PAUSED' | 'FAILED' | 'CANCELLED';
  pausedReason?: ExpenseCapturePausedReason;
  errorCode?: string;
  applied?: boolean;
  multiDocument?: boolean;
  documentCount?: number;
  usablePersisted?: boolean;
  /** Appendix §25: the drafts the auto-split created, in document order from the second on. */
  splitExpenseIds?: string[];
  /**
   * The FIRST document's classification and printed total, so the LINE push can print the §18.4
   * sentence for a non-receipt and the amount it confirmed — read off the assembled observation,
   * never re-derived by a consumer.
   */
  classification?: ExpenseCaptureAssembledObservations['documents'][number]['classification'] | null;
  documentTotal?: string | null;
};

/**
 * The durable reader of appendix §4.5.
 *
 * Everything about it is built around two facts: a provider call costs real money, and a process
 * can die between two of them. So every finished chunk and every finished window is CHECKPOINTED
 * before the next one starts, every write after the claim is fenced on the lease (a runner that
 * lost its lease writes nothing and stops silently), and the customer's OCR read is admitted once
 * per JOB — a resumed job re-reads only what it has no answer for.
 */
@Injectable()
export class ExpenseCaptureReadRunnerService {
  private readonly logger = new Logger(ExpenseCaptureReadRunnerService.name);
  /** In-process concurrency (`EXPENSE_CAPTURE_READ_CONCURRENCY`); per-company is in the claim. */
  private running = 0;

  constructor(
    private readonly capture: PrismaExpenseCaptureRepository,
    private readonly attachments: PrismaAttachmentRepository,
    private readonly expenses: PrismaExpenseRepository,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
    private readonly client: ExpenseCaptureReadClient,
    private readonly applyService: ReceiptOcrApplyService,
    private readonly outbox: OutboxAppendService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly autoSplit: ExpenseCaptureAutoSplitService,
    private readonly shadow: LaunchShadowProbe = NOOP_SHADOW,
    @Optional() private readonly permissions?: PermissionResolverService,
  ) {}

  /**
   * Start a job in this process without making the HTTP request wait for a provider (§4.5).
   * Fire-and-forget on purpose, and it can NEVER throw into its caller: the file is already stored
   * and the drain will pick the job up anyway.
   */
  kick(jobId: string): void {
    void this.claimAndRun(jobId).catch((error) => {
      this.logger.warn({ msg: 'capture.read.kick_failed', jobId, ...safeLineErrorDetails(error) });
    });
  }

  /** The worker-facing sweep: claim what is queued or stranded and start it, without awaiting. */
  async drain(batchSize = 3): Promise<{ claimed: number }> {
    const free = Math.max(0, this.config.expenseCaptureReadConcurrency - this.running);
    if (free === 0) return { claimed: 0 };
    const jobs = await this.capture.claimReadJobs({
      batchSize: Math.min(batchSize, free), leaseOwner: this.leaseOwner(), leaseMs: EXPENSE_CAPTURE_LEASE_MS,
    });
    // Shadow evidence BEFORE the work, on the companies the claim actually picked: a probe placed
    // after a filter can only ever record `available` (shadow catalog header).
    const sweep = this.shadow.startSweep(SHADOW_SURFACES.expenseCaptureReadDrain);
    try {
      for (const job of jobs) await sweep.record(job.companyId, 'expenses');
      await sweep.flush();
    } catch (error) {
      this.logger.warn({ msg: 'capture.read.shadow_failed', ...safeLineErrorDetails(error) });
    }
    for (const job of jobs) {
      this.running += 1;
      void this.runClaimed(job)
        .catch((error) => this.logger.warn({ msg: 'capture.read.run_failed', jobId: job.id, ...safeLineErrorDetails(error) }))
        .finally(() => { this.running -= 1; });
    }
    return { claimed: jobs.length };
  }

  private leaseOwner(): string {
    return `${process.env['HOSTNAME'] ?? 'api'}:${randomUUID()}`;
  }

  private async claimAndRun(jobId: string): Promise<void> {
    if (this.running >= this.config.expenseCaptureReadConcurrency) return;
    const job = await this.capture.claimReadJob({
      jobId, leaseOwner: this.leaseOwner(), leaseMs: EXPENSE_CAPTURE_LEASE_MS,
    });
    if (!job) return;
    this.running += 1;
    try {
      await this.runClaimed(job);
    } finally {
      this.running -= 1;
    }
  }

  /** One claimed job, start to terminal state. Never throws — every exit writes a state. */
  async runClaimed(job: CaptureReadJobRow): Promise<void> {
    const owner = job.leaseOwner!;
    const startedAt = Date.now();
    let checkpoint = readCheckpoint(job.checkpointJson);
    let outcome: RunOutcome;
    try {
      outcome = await this.execute(job, owner, startedAt, checkpoint, (next) => { checkpoint = next; });
    } catch (error) {
      this.logger.error({ msg: 'capture.read.unhandled', jobId: job.id, ...safeLineErrorDetails(error) });
      outcome = { status: 'FAILED', errorCode: 'CAPTURE_READ_UNHANDLED' };
    }
    // The job's own clock, banked before the terminal write: a PAUSED job that is re-claimed must
    // resume with the time it has already spent, not with a fresh 15 minutes (§4.6).
    checkpoint = { ...checkpoint, runMillis: (checkpoint.runMillis ?? 0) + (Date.now() - startedAt) };
    await this.finish(job, owner, outcome, checkpoint);
  }

  private async execute(
    job: CaptureReadJobRow,
    owner: string,
    startedAt: number,
    checkpoint: CaptureCheckpoint,
    save: (next: CaptureCheckpoint) => void,
  ): Promise<RunOutcome> {
    if (job.attempts > EXPENSE_CAPTURE_MAX_ATTEMPTS) {
      return { status: 'FAILED', errorCode: 'attempts_exhausted' };
    }
    if (!await this.ownerStillValid(job)) return { status: 'CANCELLED' };

    const attachment = await this.attachments.findById({ id: job.attachmentId, companyId: job.companyId });
    if (!attachment || attachment.status !== 'ACTIVE') return { status: 'FAILED', errorCode: 'source_changed' };
    const object = await this.storage.getObject({
      bucket: attachment.bucket,
      objectKey: attachment.objectKey,
      ...(job.objectVersionId ?? attachment.objectVersionId ? { objectVersionId: (job.objectVersionId ?? attachment.objectVersionId)! } : {}),
    });
    // The manifest points at the ORIGINAL's checksum; bytes that no longer hash to it are a
    // different document, and reading them would attach another file's facts to this expense.
    const checksum = createHash('sha256').update(object.bytes).digest('hex');
    if (job.attachmentChecksum && checksum !== job.attachmentChecksum) {
      return { status: 'FAILED', errorCode: 'source_changed' };
    }

    const plan = await planCapturePreprocessing(object.bytes, attachment.mimeType, {
      maxPages: this.config.expenseCapturePdfMaxPages,
    });
    if (plan.failure) {
      // D09 (§2.2): a file we cannot open is a file whose electronic origin cannot be checked
      // either — `UNAVAILABLE`, never the `NOT_CHECKED` of a file nobody has looked at yet.
      await this.markElectronicUnavailable(job, owner);
      return { status: 'FAILED', errorCode: plan.failure };
    }

    let manifest = markPages(buildManifest(plan), Object.entries(checkpoint.pages).map(([index, page]) => ({
      index: Number(index), state: page.blank ? 'blank'
        : page.truncated || (plan.pageCount === 1 && transcriptionStopsBeforeTotals(page.text)) ? 'partial' : 'read',
    })));
    for (const chunk of plan.chunks) {
      if (chunk.pageIndexes.every(page => checkpoint.pages[String(page)] && !checkpoint.pages[String(page)]!.truncated)) {
        manifest = markChunk(manifest, chunk.id, 'done');
        checkpoint = { ...checkpoint, chunks: { ...checkpoint.chunks, [chunk.id]: 'done' } };
      }
    }
    // The manifest is durable BEFORE the first provider call, so a crash mid-read still tells the
    // reviewer how many pages the file has and which of them nobody has read yet.
    if (!await this.capture.updateJobFenced({ jobId: job.id, leaseOwner: owner, data: { manifestJson: manifest as never } })) {
      return { status: 'CANCELLED' };
    }
    if (job.fileId && plan.pageCount > 0) {
      await this.capture.setFilePageCount(this.capture.client, { companyId: job.companyId, fileId: job.fileId, pageCount: plan.pageCount });
    }

    const admitted = await this.admitOcrRead(job, checkpoint, isSinglePageReceiptImage(attachment.mimeType));
    if (!admitted.ok) return { status: 'PAUSED', pausedReason: 'ai_credit', errorCode: admitted.errorCode };
    if (admitted.eventId && (checkpoint.ocrEventId !== admitted.eventId || !checkpoint.ocrMonthKey)) {
      checkpoint = { ...checkpoint, ocrEventId: admitted.eventId, ...(admitted.monthKey ? { ocrMonthKey: admitted.monthKey } : {}), ...(admitted.quotaSource ? { ocrQuotaSource: admitted.quotaSource } : {}) };
      save(checkpoint);
    }

    if (!await this.freeOperationStillAllowed(job, checkpoint)) return { status: 'CANCELLED', errorCode: 'BILLING_ACCESS_INACTIVE' };

    let calls = job.providerCallCount;
    // Both ceilings count what the JOB has spent, not what this run has: the earlier runs' totals
    // come off the checkpoint and this run adds to them.
    const spentMs = () => (checkpoint.runMillis ?? 0) + (Date.now() - startedAt);
    let derivativeBytes = checkpoint.derivativeBytes ?? 0;
    const derivativeCeiling = this.config.expenseCaptureDerivativeMaxBytes;
    let pausedReason: RunOutcome['pausedReason'];
    const queue: CaptureChunkPlan[] = [...plan.chunks];
    const lineage: AiModelLineage[] = [...(checkpoint.lineage ?? [])];

    for (let index = 0; index < queue.length; index += 1) {
      const chunk = queue[index]!;
      if (chunk.pageIndexes.every(page => checkpoint.pages[String(page)] && !checkpoint.pages[String(page)]!.truncated)) continue;
      if (calls >= EXPENSE_CAPTURE_MAX_PROVIDER_CALLS) { pausedReason = 'call_budget'; break; }
      if (spentMs() > EXPENSE_CAPTURE_MAX_RUN_MS) { pausedReason = 'time_budget'; break; }
      // Measured BEFORE the call: the chunk is already in memory, and the point of the ceiling is
      // to stop the NEXT one from being built, keeping everything read so far.
      derivativeBytes += chunk.byteLength;
      if (derivativeBytes > derivativeCeiling) { pausedReason = 'memory_budget'; break; }
      if (!await this.capture.renewJobLease({ jobId: job.id, leaseOwner: owner, leaseMs: EXPENSE_CAPTURE_LEASE_MS })) {
        return { status: 'CANCELLED' };
      }

      if (!await this.freeOperationStillAllowed(job, checkpoint)) return { status: 'CANCELLED', errorCode: 'BILLING_ACCESS_INACTIVE' };
      let result = await this.readChunk(job, chunk);
      calls += 1;
      // One retry for a timeout; a money refusal is NOT retried — it would refuse again
      // and each attempt is a fresh hold.
      if (result.status !== 'ok' && result.errorCode === 'PROVIDER_TIMEOUT' && calls < EXPENSE_CAPTURE_MAX_PROVIDER_CALLS) {
        if (!await this.freeOperationStillAllowed(job, checkpoint)) return { status: 'CANCELLED', errorCode: 'BILLING_ACCESS_INACTIVE' };
        result = await this.readChunk(job, chunk, true);
        calls += 1;
      }
      if (result.status !== 'ok') {
        if (isBudgetRefusal(result.errorCode)) { pausedReason = 'ai_credit'; break; }
        checkpoint = { ...checkpoint, chunks: { ...checkpoint.chunks, [chunk.id]: 'failed' }, derivativeBytes };
        manifest = markChunk(manifest, chunk.id, 'failed', result.errorCode);
        await this.persist(job, owner, { checkpoint, manifest, calls });
        save(checkpoint);
        continue;
      }
      const pages = { ...checkpoint.pages };
      for (const page of result.pages) {
        pages[String(page.pageIndex)] = {
          text: page.text.slice(0, EXPENSE_CAPTURE_PAGE_TEXT_CHARS),
          ...(page.truncated ? { truncated: true } : {}),
          ...(page.blank ? { blank: true } : {}),
        };
      }
      // Later windows consume priorDocuments: replacing a partial page invalidates that window
      // and its dependants, even if their own text is unchanged. Complete earlier pages stay paid.
      const oldWindows = new Map(planWindows(checkpoint.pages).map(window => [window.id, window.pages]));
      const newWindows = planWindows(pages);
      const changedIndex = newWindows.findIndex(window => JSON.stringify(oldWindows.get(window.id)) !== JSON.stringify(window.pages));
      const reusable = new Set(newWindows.slice(0, changedIndex < 0 ? newWindows.length : changedIndex).map(window => window.id));
      const windows = checkpoint.windowPlanVersion === 3 ? Object.fromEntries(Object.entries(checkpoint.windows)
        .filter(([id]) => reusable.has(id))) : checkpoint.windows;
      checkpoint = { ...checkpoint, pages, windows, chunks: { ...checkpoint.chunks, [chunk.id]: 'done' }, derivativeBytes };
      if (result.modelLineage) lineage.push(result.modelLineage);
      checkpoint = { ...checkpoint, lineage: lineage.slice(0, 8) };
      manifest = markChunk(manifest, chunk.id, 'done');
      manifest = markPages(manifest, result.pages.map((page) => ({
        index: page.pageIndex,
        state: page.blank ? 'blank'
          // Controller review of W10 D3: a one-page document whose transcription has an item table
          // but stops before any total row was cut short whatever the model declared — the 896-px
          // Lazada screenshot came back exactly so, with no `partial` admission. Only single-page
          // files: a longer document legitimately prints its totals on a later page.
          : page.truncated || (plan.pageCount === 1 && transcriptionStopsBeforeTotals(page.text)) ? 'partial'
            : 'read',
      })));

      // A truncated page is re-read ALONE once (§4.5): the earlier pages of the chunk are complete
      // and keeping them is the whole reason stage 1 reports per-page truncation.
      const truncated = result.pages.filter((page) => page.truncated).map((page) => page.pageIndex);
      if (truncated.length > 0 && chunk.pageIndexes.length > 1 && !(checkpoint.resplitChunks ?? []).includes(chunk.id)) {
        for (const pageIndex of truncated) {
          const single = await planCaptureSinglePageChunk(object.bytes, attachment.mimeType, pageIndex, `${chunk.id}p${pageIndex}`);
          if (single) queue.push(single);
        }
        checkpoint = { ...checkpoint, resplitChunks: [...(checkpoint.resplitChunks ?? []), chunk.id] };
      }
      await this.persist(job, owner, { checkpoint, manifest, calls });
      save(checkpoint);
    }

    // Windows run over whatever stage 1 produced, even when the read stopped early: facts from the
    // pages that WERE read are worth more to the reviewer than a job that reports only a pause.
    if (!pausedReason) {
      const savedWindows = Object.values(checkpoint.windows);
      // Earlier window ids could cover several pages. Never apply one to a new single-page window.
      if (savedWindows.length && checkpoint.windowPlanVersion !== 3) {
        return { status: 'FAILED', errorCode: 'CAPTURE_WINDOW_EVIDENCE_VERSION_CHANGED' };
      }
      checkpoint = { ...checkpoint, windowPlanVersion: 3 };
      const windows = planWindows(checkpoint.pages);
      manifest = { ...manifest, windows: windows.map((window) => ({ id: window.id, pageIndexes: window.pageIndexes, state: checkpoint.windows[window.id] ? 'done' as const : 'pending' as const })) };
      // The shop's active categories minus the catch-all, so each document can name one the apply
      // below writes when it clearly fits, by the photo reader's rule (Owner 2026-09-29).
      const activeCategories = aiSelectableExpenseCategories(await this.expenses.listCategories(job.companyId))
        .map(({ id, name }) => ({ id, name }));
      for (const window of windows) {
        if (checkpoint.windows[window.id]) continue;
        if (calls >= EXPENSE_CAPTURE_MAX_PROVIDER_CALLS) { pausedReason = 'call_budget'; break; }
        if (spentMs() > EXPENSE_CAPTURE_MAX_RUN_MS) { pausedReason = 'time_budget'; break; }
        if (!await this.capture.renewJobLease({ jobId: job.id, leaseOwner: owner, leaseMs: EXPENSE_CAPTURE_LEASE_MS })) {
          return { status: 'CANCELLED' };
        }
        if (!await this.freeOperationStillAllowed(job, checkpoint)) return { status: 'CANCELLED', errorCode: 'BILLING_ACCESS_INACTIVE' };
        const extract = (retry = false) => this.client.extractWindow({
          companyId: job.companyId,
          userId: 'system',
          requestId: `${job.id}:${window.id}${retry ? ':timeout-retry' : ''}`,
          jobId: job.id,
          windowId: window.id,
          window: {
            fileLabel: job.fileId ?? job.expenseId ?? job.id,
            pageIndexes: window.pageIndexes,
            pages: window.pages,
            ...(priorDocuments(checkpoint.windows).length > 0 ? { priorDocuments: priorDocuments(checkpoint.windows) } : {}),
          },
          activeCategories,
        });
        let result = await extract();
        calls += 1;
        if (result.status !== 'ok' && result.errorCode === 'PROVIDER_TIMEOUT'
          && calls < EXPENSE_CAPTURE_MAX_PROVIDER_CALLS && spentMs() <= EXPENSE_CAPTURE_MAX_RUN_MS) {
          if (!await this.capture.renewJobLease({ jobId: job.id, leaseOwner: owner, leaseMs: EXPENSE_CAPTURE_LEASE_MS })) return { status: 'CANCELLED' };
          if (!await this.freeOperationStillAllowed(job, checkpoint)) return { status: 'CANCELLED', errorCode: 'BILLING_ACCESS_INACTIVE' };
          result = await extract(true);
          calls += 1;
        }
        if (result.status !== 'ok') {
          if (isBudgetRefusal(result.errorCode)) { pausedReason = 'ai_credit'; break; }
          manifest = markWindow(manifest, window.id, 'failed');
          await this.persist(job, owner, { checkpoint, manifest, calls });
          continue;
        }
        checkpoint = { ...checkpoint, windows: { ...checkpoint.windows, [window.id]: result.observations } };
        if (result.modelLineage) lineage.push(result.modelLineage);
        checkpoint = { ...checkpoint, lineage: lineage.slice(0, 16) };
        manifest = markWindow(manifest, window.id, 'done');
        await this.persist(job, owner, { checkpoint, manifest, calls });
        save(checkpoint);
      }
    }

    const assembled = assembleCaptureObservations(
      planWindows(checkpoint.pages).flatMap(window => checkpoint.windows[window.id]
        ? [{ id: window.id, pageIndexes: window.pageIndexes, observations: checkpoint.windows[window.id]! }] : []),
      { pageCount: plan.pageCount },
    );
    const free = checkpoint.ocrQuotaSource === 'FREE_MONTHLY_3';
    if (free && (assembled.multiDocument || assembled.documents.length > 1)) {
      return { status: 'FAILED', errorCode: 'FREE_MULTI_DOCUMENT_UNSUPPORTED', documentCount: 0 };
    }
    const mapped = free ? captureFieldsFromObservations(assembled) : null;
    if (free && (!mapped || !isExpenseExtractionEligible(mapped.classification, mapped.fields.grandTotalAmount, true))) {
      return { status: 'FAILED', errorCode: 'FREE_EXPENSE_DOCUMENT_REQUIRED', documentCount: 0 };
    }
    if (!await this.freeOperationStillAllowed(job, checkpoint) || !await this.ownerStillValid(job)) return { status: 'CANCELLED' };
    const hasFacts = assembled.documents.length > 0;
    const observationStored = hasFacts && await this.storeObservation(job, assembled, checkpoint.lineage ?? [], checkpoint);
    if (free && observationStored) {
      checkpoint = { ...checkpoint, usableResultStored: true };
      save(checkpoint);
    }

    const failedChunks = Object.values(checkpoint.chunks).filter((state) => state === 'failed').length;
    // W10 D3: `partial` counts as unread. A page whose transcription stopped short — the model hit
    // `max_tokens`, or it declared it could not read part of the page — has facts nobody has seen, so
    // the job ends PARTIAL (§17.6) instead of DONE. A re-split page that came back whole is `read`
    // again by then, so re-reading a truncated page still clears it.
    const unreadPages = manifest.pages
      .filter((page) => page.state === 'pending' || page.state === 'failed' || page.state === 'partial').length;
    // Appendix §25: one document lands on the owning expense; several are SPLIT into ordinary
    // drafts here, before the terminal write, so `read-status` and the LINE push never have to show
    // a "split pending" state. The split ids are checkpointed so a retry finds the work done.
    const write = await this.applyOrSplit(job, assembled, checkpoint);
    if (write.splitByRef) {
      checkpoint = { ...checkpoint, splitExpenseIds: write.splitByRef };
      save(checkpoint);
    }
    const splitIds = Object.values(write.splitByRef ?? checkpoint.splitExpenseIds ?? {});

    if (pausedReason) {
      return { status: 'PAUSED', pausedReason, ...common(assembled, write.applied, splitIds), usablePersisted: observationStored || write.applied };
    }
    if (plan.pagesBeyondLimit.length > 0) {
      // Never a silent cut: the declared page scope was read, the rest stay `pending` (§4.1).
      return { status: 'PAUSED', pausedReason: 'page_limit', ...common(assembled, write.applied, splitIds), usablePersisted: observationStored || write.applied };
    }
    if (failedChunks > 0 || unreadPages > 0 || manifest.windows.some(window => window.state !== 'done') || !hasFacts) {
      return { status: 'PARTIAL', ...common(assembled, write.applied, splitIds), usablePersisted: observationStored || write.applied };
    }
    return { status: 'DONE', ...common(assembled, write.applied, splitIds), usablePersisted: observationStored || write.applied };
  }

  private async readChunk(job: CaptureReadJobRow, chunk: CaptureChunkPlan, retry = false) {
    const wire: ExpenseCaptureReadChunk = {
      id: chunk.id,
      ...(chunk.sourceMimeType ? { sourceMimeType: chunk.sourceMimeType } : {}),
      kind: chunk.kind,
      mimeType: chunk.mimeType,
      pageIndexes: chunk.pageIndexes,
      fileLabel: job.fileId ?? job.expenseId ?? job.id,
      ...(chunk.bytes ? { contentBase64: chunk.bytes.toString('base64') } : {}),
      ...(chunk.images ? {
        images: chunk.images.map((image) => ({
          contentBase64: image.bytes.toString('base64'),
          mimeType: image.mimeType, role: image.role, index: image.index,
        })),
      } : {}),
    };
    return this.client.readChunk({
      companyId: job.companyId, userId: 'system', requestId: `${job.id}:${chunk.id}${retry ? ':timeout-retry' : ''}`,
      jobId: job.id, fileLabel: wire.fileLabel, chunk: wire,
    });
  }

  /**
   * ONE customer read per job (§4.6). A resumed job answers `duplicate` and continues: the read was
   * already counted, and counting it again would charge a 15-slip trial twice for one document.
   */
  private async admitOcrRead(
    job: CaptureReadJobRow,
    checkpoint: CaptureCheckpoint,
    singlePageImage: boolean,
  ): Promise<{ ok: true; eventId?: string; monthKey?: string; quotaSource?: 'FREE_MONTHLY_3' } | { ok: false; errorCode: string }> {
    const admission = await admitCompanyOcr(this.prisma, {
      companyId: job.companyId,
      sourceRoute: captureSourceRoute(job),
      requestId: job.ocrAdmissionRequestId,
      enforceReceiptQuota: this.config.receiptQuotaEnforced,
      // A PDF, whatever its page count, never draws an add-on lot (D4).
      singlePageImage,
    });
    if (admission.allowed) return { ok: true, eventId: admission.eventId, monthKey: admission.monthKey, ...(admission.quotaSource ? { quotaSource: admission.quotaSource } : {}) };
    if (admission.reason === 'duplicate') {
      const event = await this.prisma.client.$transaction((tx) => tx.companyOcrUsageEvent.findUnique({
        where: { companyId_sourceRoute_requestId: { companyId: job.companyId, sourceRoute: captureSourceRoute(job), requestId: job.ocrAdmissionRequestId } },
      }));
      if (!event || (checkpoint.ocrEventId && checkpoint.ocrEventId !== event.id)) return { ok: false, errorCode: 'OCR_REQUEST_ALREADY_ADMITTED' };
      return { ok: true, eventId: event.id, monthKey: event.monthKey, ...(event.quotaSource === 'FREE_MONTHLY_3' ? { quotaSource: event.quotaSource } : {}) };
    }
    return { ok: false, errorCode: companyOcrErrorCode(admission) };
  }

  private async freeOperationStillAllowed(job: CaptureReadJobRow, checkpoint: CaptureCheckpoint): Promise<boolean> {
    if (checkpoint.ocrQuotaSource !== 'FREE_MONTHLY_3') return true;
    const currentFree = await isFreeExpenseDraftCompany(this.prisma.client, job.companyId);
    if (!currentFree) {
      // Buying during a read keeps its original free source; holds and expired paid access stop it.
      const company = await this.prisma.client.company.findUnique({ where: { id: job.companyId }, select: { status: true, archivedAt: true, planTerm: true } });
      if (company?.status !== 'ACTIVE' || company.archivedAt || !company.planTerm
        || company.planTerm.termDisabledAt || company.planTerm.termEndsAt <= new Date()) return false;
    }
    const owner = job.ownerType === 'EXPENSE' && job.expenseId
      ? await this.expenses.findById(job.companyId, job.expenseId)
      : job.groupId ? await this.capture.findGroup(this.capture.client, job.companyId, job.groupId) : null;
    if (!owner?.createdByUserId || !this.permissions) return false;
    if (job.ownerType === 'EXPENSE' && owner.status !== 'DRAFT' && owner.status !== 'NEEDS_REVIEW') return false;
    if (job.ownerType === 'CAPTURE_GROUP' && owner.status !== 'OPEN') return false;
    try {
      const access = await this.permissions.resolveAccess(owner.createdByUserId, job.companyId);
      if (access.companyId !== job.companyId) return false;
      if (access.scopes.branchIds && (!owner.branchId || !access.scopes.branchIds.includes(owner.branchId))) return false;
      return access.permissions.includes('expense.ocr.request')
        || access.permissions.includes(job.ownerType === 'CAPTURE_GROUP' || ('captureSource' in owner && owner.captureSource === 'LINE_UPLOAD')
          ? 'expense.receipt.line_upload' : 'expense.receipt.upload');
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  /** The owner must still want this read: a replaced primary or a closed group cancels it (§4.5). */
  private async ownerStillValid(job: CaptureReadJobRow): Promise<boolean> {
    if (job.ownerType === 'CAPTURE_GROUP') {
      if (!job.groupId || !job.fileId) return false;
      const group = await this.capture.findGroup(this.capture.client, job.companyId, job.groupId);
      if (!group || (group.status !== 'OPEN' && group.status !== 'HANDED_OFF')) return false;
      const file = await this.capture.findFile(this.capture.client, job.companyId, job.groupId, job.fileId);
      return file?.uploadState === 'STORED';
    }
    if (!job.expenseId) return false;
    const expense = await this.expenses.findById(job.companyId, job.expenseId);
    if (!expense) return false;
    if (expense.status !== 'DRAFT' && expense.status !== 'NEEDS_REVIEW' && expense.status !== 'READY_FOR_CONFIRMATION') return false;
    if (expense.primaryAttachmentId !== job.attachmentId) return false;
    // The draft may legitimately move while the read runs (a reviewer typing); `receipt-ocr-apply`
    // is the fence that refuses to overwrite it, so the read itself continues.
    return true;
  }

  private async storeObservation(
    job: CaptureReadJobRow,
    assembled: ExpenseCaptureAssembledObservations,
    lineage: AiModelLineage[],
    checkpoint: CaptureCheckpoint,
  ): Promise<boolean> {
    try {
      const write = async (db: CaptureDb) => {
        const version = await this.capture.nextObservationVersion(db, job.companyId, { fileId: job.fileId, expenseId: job.expenseId });
        await this.capture.createObservation(db, {
          companyId: job.companyId, groupId: job.groupId, expenseId: job.expenseId, fileId: job.fileId,
          jobId: job.id, version, source: 'AI', payloadJson: assembled,
        });
        if (lineage.length > 0) await db.expenseCaptureObservation.updateMany({
          where: { companyId: job.companyId, jobId: job.id, version },
          data: { modelLineageJson: lineage as never },
        });
      };
      if (checkpoint.ocrQuotaSource === 'FREE_MONTHLY_3' && checkpoint.ocrEventId) {
        const actor = job.ownerType === 'EXPENSE' && job.expenseId
          ? await this.expenses.findById(job.companyId, job.expenseId)
          : job.groupId ? await this.capture.findGroup(this.capture.client, job.companyId, job.groupId) : null;
        if (!actor?.createdByUserId) return false;
        await this.prisma.client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`partner-ocr-config:${job.companyId}`}))`;
          await lockPlanTermCompany(tx, job.companyId);
          await assertFreeExpenseSourceActor(tx, { companyId: job.companyId, userId: actor.createdByUserId, branchId: actor.branchId });
          await write(tx);
          await completeCompanyOcrAdmissionWithinTransaction(tx, { companyId: job.companyId, sourceRoute: captureSourceRoute(job),
            requestId: job.ocrAdmissionRequestId, eventId: checkpoint.ocrEventId! });
        });
      } else await write(this.capture.client);
      return true;
    } catch (error) {
      this.logger.warn({ msg: 'capture.read.observation_not_stored', jobId: job.id, ...safeLineErrorDetails(error) });
      return false;
    }
  }

  /**
   * What a finished read WRITES (appendix §25).
   *
   * One document from one issuer applies through the existing receipt path, fence and all. Several
   * documents no longer stop at "stored and shown": the first applies the same way and each further
   * one becomes its own ordinary draft, because the owner withdrew the screen that used to ask.
   */
  private async applyOrSplit(
    job: CaptureReadJobRow,
    assembled: ExpenseCaptureAssembledObservations,
    checkpoint: CaptureCheckpoint,
  ): Promise<{ applied: boolean; splitByRef?: Record<string, string> }> {
    if (job.ownerType !== 'EXPENSE' || !job.expenseId) return { applied: false };
    if (checkpoint.ocrQuotaSource === 'FREE_MONTHLY_3' && (assembled.multiDocument || assembled.documents.length > 1)) return { applied: false };
    if (assembled.documents.length > 1) {
      const split = await this.autoSplit.split({
        job: {
          id: job.id, companyId: job.companyId, ownerType: job.ownerType,
          expenseId: job.expenseId, attachmentId: job.attachmentId,
          expectedSourceUpdatedAt: job.expectedSourceUpdatedAt ?? null,
        },
        assembled,
        ...(checkpoint.splitExpenseIds ? { alreadySplit: checkpoint.splitExpenseIds } : {}),
      });
      return { applied: split.applied, splitByRef: split.splitByRef };
    }
    return { applied: await this.applyToExpense(job, assembled, checkpoint) };
  }

  /** The single-document apply: `receipt-ocr-apply`, its fence, its duplicate check, unchanged. */
  private async applyToExpense(job: CaptureReadJobRow, assembled: ExpenseCaptureAssembledObservations, checkpoint: CaptureCheckpoint): Promise<boolean> {
    if (job.ownerType !== 'EXPENSE' || !job.expenseId) return false;
    if (assembled.multiDocument || assembled.documents.length !== 1) return false;
    const mapped = captureFieldsFromObservations(assembled);
    // The SAME eligibility gate the synchronous upload path uses: a quotation or an unpaid bill
    // read out of a PDF must not fill an expense draft just because it parsed cleanly.
    if (!mapped || !isExpenseExtractionEligible(mapped.classification, mapped.fields.grandTotalAmount, true)) return false;
    const free = checkpoint.ocrQuotaSource === 'FREE_MONTHLY_3';
    const actor = free ? await this.expenses.findById(job.companyId, job.expenseId) : null;
    if (free && !actor?.createdByUserId) return false;
    const outcome = await this.applyService.apply(
      { companyId: job.companyId, userId: actor?.createdByUserId ?? 'system' },
      job.expenseId,
      mapped.fields,
      {
        ...(job.expectedSourceUpdatedAt ? { expectedUpdatedAt: job.expectedSourceUpdatedAt } : {}),
        // §16.4: the file this read is OF, so the apply can retire a `sourceStale` warning that
        // was raised about the file this one replaced.
        sourceAttachmentId: job.attachmentId,
        ocrDocumentType: toSourceDocumentType(sourceDocumentTypeFromClassification(mapped.classification ?? null)),
        sourceDocumentType: toSourceDocumentType(sourceDocumentTypeFromClassification(mapped.classification ?? null)),
        ...(free ? { sourceOnly: true, onUsablePersisted: async (tx: Parameters<typeof completeCompanyOcrAdmissionWithinTransaction>[0]) => {
          if (checkpoint.ocrEventId) await completeCompanyOcrAdmissionWithinTransaction(tx, { companyId: job.companyId, sourceRoute: captureSourceRoute(job),
            requestId: job.ocrAdmissionRequestId, eventId: checkpoint.ocrEventId });
        } } : {}),
      },
    );
    if (isStaleOcrApply(outcome) || !outcome.committedUpdatedAt) {
      await this.audit.log({
        companyId: job.companyId, actorType: 'SYSTEM', actorRefId: 'expense-capture-read',
        action: 'expense.ocr.request', targetType: 'expense_record', targetId: job.expenseId,
        requestId: job.id, result: 'FAILED', riskLevel: 'LOW',
        metadataJson: { channel: 'capture', status: 'apply_skipped_stale', jobId: job.id },
      }).catch(() => undefined);
      return false;
    }
    return true;
  }

  /** Encrypted or corrupt bytes: say so on the job manifest AND on the group's file row (§2.2). */
  private async markElectronicUnavailable(job: CaptureReadJobRow, owner: string): Promise<void> {
    const manifest: ExpenseCaptureReadManifest = {
      ...emptyExpenseCaptureReadManifest(),
      electronicVerification: { status: 'UNAVAILABLE' },
    };
    await this.capture.updateJobFenced({ jobId: job.id, leaseOwner: owner, data: { manifestJson: manifest as never } });
    if (!job.fileId) return;
    try {
      await this.capture.client.expenseCaptureFile.updateMany({
        where: { companyId: job.companyId, id: job.fileId },
        data: { electronicVerificationJson: { status: 'UNAVAILABLE', method: null, checkedAt: null } },
      });
    } catch (error) {
      this.logger.warn({ msg: 'capture.read.electronic_state_not_stored', jobId: job.id, ...safeLineErrorDetails(error) });
    }
  }

  /** Checkpoint + manifest + call count in ONE fenced write, after every chunk and window. */
  private async persist(
    job: CaptureReadJobRow,
    owner: string,
    state: { checkpoint: CaptureCheckpoint; manifest: ExpenseCaptureReadManifest; calls: number },
  ): Promise<void> {
    await this.capture.updateJobFenced({
      jobId: job.id, leaseOwner: owner,
      data: {
        checkpointJson: state.checkpoint as never,
        manifestJson: state.manifest as never,
        providerCallCount: state.calls,
      },
    });
  }

  /**
   * The terminal transition, its notification and the OCR compensation.
   *
   * The outbox row is appended in the SAME transaction as the status write, so a consumer can never
   * see a finished job with no event or an event for a job that never finished.
   */
  private async finish(
    job: CaptureReadJobRow,
    owner: string,
    outcome: RunOutcome,
    checkpoint: CaptureCheckpoint,
  ): Promise<void> {
    // "Usable" is FACTS, not a status: a PARTIAL that found the shop and the total is worth the
    // read the customer paid for, and a DONE that found nothing is not (§4.6).
    const usable = checkpoint.ocrQuotaSource === 'FREE_MONTHLY_3'
      ? checkpoint.usableResultStored === true || outcome.usablePersisted === true : (outcome.documentCount ?? 0) > 0;
    let freeAllowance: Awaited<ReturnType<typeof completeCompanyOcrAdmission>>['freeAllowance'];
    if (usable && checkpoint.ocrEventId && checkpoint.ocrQuotaSource === 'FREE_MONTHLY_3') {
      const completed = await completeCompanyOcrAdmission(this.prisma, { companyId: job.companyId, sourceRoute: captureSourceRoute(job),
        requestId: job.ocrAdmissionRequestId, eventId: checkpoint.ocrEventId });
      freeAllowance = completed.freeAllowance;
    }
    // Add-on plan PR B: facts on the job are the durable usable result — the reserved unit is used.
    if (usable && checkpoint.ocrEventId) {
      await settleCompanyOcrAdmission(this.prisma, {
        companyId: job.companyId, sourceRoute: captureSourceRoute(job),
        requestId: job.ocrAdmissionRequestId, eventId: checkpoint.ocrEventId,
      });
    }
    const written = await this.prisma.client.$transaction(async (tx) => {
      const changed = await this.capture.updateJobFenced({
        jobId: job.id, leaseOwner: owner, db: tx,
        data: {
          checkpointJson: checkpoint as never,
          status: outcome.status,
          pausedReason: outcome.pausedReason ?? null,
          lastErrorCode: outcome.errorCode ?? null,
          ...(outcome.errorCode ? { lastErrorAt: new Date() } : {}),
          completedAt: new Date(), leaseOwner: null, leasedUntil: null,
        },
      });
      // Terminal state and exact compensation commit together. Lost owners never refund a live job.
      if (changed && !usable && checkpoint.ocrEventId) {
        await releaseCompanyOcrAdmissionWithinTransaction(tx, {
          companyId: job.companyId, sourceRoute: captureSourceRoute(job),
          requestId: job.ocrAdmissionRequestId, eventId: checkpoint.ocrEventId,
          reason: 'SYSTEM_FAILURE_NO_USABLE_RESULT',
        });
      }
      if (changed) {
        await this.outbox.append(
          EXPENSE_CAPTURE_READ_FINISHED_EVENT,
          'expense_capture_read_job',
          job.id,
          {
            schemaVersion: 1,
            companyId: job.companyId,
            requestId: `${job.id}:${job.attempts}`,
            jobId: job.id,
            ownerType: job.ownerType,
            groupId: job.groupId,
            expenseId: job.expenseId,
            fileId: job.fileId,
            status: outcome.status,
            pausedReason: outcome.pausedReason ?? null,
            errorCode: outcome.errorCode ?? null,
            applied: outcome.applied ?? false,
            multiDocument: outcome.multiDocument ?? false,
            documentCount: outcome.documentCount ?? 0,
            quotaSource: checkpoint.ocrQuotaSource ?? null,
            ...(freeAllowance ? { freeAllowance } : {}),
            // Appendix §25: both lanes link to what the split created, so no consumer has to re-derive it.
            splitExpenseIds: outcome.splitExpenseIds ?? [],
            classification: outcome.classification ?? null,
            documentTotal: outcome.documentTotal ?? null,
          } as never,
          'HIGH', tx,
        );
      }
      return changed;
    });
    if (!written) return;
    this.logger.log({
      msg: 'capture.read.finished', jobId: job.id, companyId: job.companyId, ownerType: job.ownerType,
      status: outcome.status, pausedReason: outcome.pausedReason ?? null, errorCode: outcome.errorCode ?? null,
      documentCount: outcome.documentCount ?? 0, applied: outcome.applied ?? false,
    });
  }
}

/** The capture read's OCR route, which decides which lane the slip ceiling counts it under. */
function captureSourceRoute(job: Pick<CaptureReadJobRow, 'ownerType' | 'groupId'>): CompanyOcrSourceRoute {
  return job.ownerType === 'EXPENSE' ? 'receipt-capture-web' : 'receipt-capture-line';
}

const common = (assembled: ExpenseCaptureAssembledObservations, applied: boolean, splitExpenseIds: string[]) => {
  const first = assembled.documents[0];
  return {
    applied,
    multiDocument: assembled.multiDocument,
    documentCount: assembled.documents.length,
    splitExpenseIds,
    classification: first?.classification ?? null,
    documentTotal: first
      ? assembled.totals.find((total) => total.documentRef === first.ref && total.kind === 'document_total')?.amount ?? null
      : null,
  };
};

/** Keep a page's stored transcription inside the same ceiling the gateway applies to it. */
export const EXPENSE_CAPTURE_PAGE_TEXT_CHARS = 20_000;

function isBudgetRefusal(errorCode: string | undefined): boolean {
  return typeof errorCode === 'string' && errorCode.startsWith('AI_BUDGET_');
}

function readCheckpoint(value: unknown): CaptureCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyCheckpoint();
  const raw = value as Partial<CaptureCheckpoint>;
  return {
    version: 1,
    pages: raw.pages && typeof raw.pages === 'object' ? raw.pages : {},
    chunks: raw.chunks && typeof raw.chunks === 'object' ? raw.chunks : {},
    windows: raw.windows && typeof raw.windows === 'object' ? raw.windows : {},
    ...([2, 3].includes(raw.windowPlanVersion ?? 0) ? { windowPlanVersion: raw.windowPlanVersion } : {}),
    ...(raw.ocrEventId ? { ocrEventId: raw.ocrEventId } : {}),
    ...(raw.ocrMonthKey ? { ocrMonthKey: raw.ocrMonthKey } : {}),
    ...(raw.ocrQuotaSource === 'FREE_MONTHLY_3' ? { ocrQuotaSource: raw.ocrQuotaSource } : {}),
    ...(raw.usableResultStored === true ? { usableResultStored: true } : {}),
    // The two per-JOB meters. A stored value that is not a finite number is treated as no value
    // rather than as zero of a budget — a corrupted checkpoint must not hand out a fresh run.
    ...(Number.isFinite(raw.runMillis) ? { runMillis: Math.max(0, raw.runMillis!) } : {}),
    ...(Number.isFinite(raw.derivativeBytes) ? { derivativeBytes: Math.max(0, raw.derivativeBytes!) } : {}),
    ...(Array.isArray(raw.resplitChunks) ? { resplitChunks: raw.resplitChunks } : {}),
    ...(Array.isArray(raw.lineage) ? { lineage: raw.lineage } : {}),
    ...(raw.splitExpenseIds && typeof raw.splitExpenseIds === 'object' && !Array.isArray(raw.splitExpenseIds)
      ? { splitExpenseIds: raw.splitExpenseIds } : {}),
  };
}

function buildManifest(plan: Awaited<ReturnType<typeof planCapturePreprocessing>>): ExpenseCaptureReadManifest {
  const chunkByPage = new Map<number, string>();
  for (const chunk of plan.chunks) for (const page of chunk.pageIndexes) chunkByPage.set(page, chunk.id);
  const textByPage = new Map(plan.textLayer.map((page) => [page.pageIndex, page.chars]));
  return {
    ...emptyExpenseCaptureReadManifest(),
    pageCount: plan.pageCount,
    pages: Array.from({ length: plan.pageCount }, (_, index) => ({
      index,
      state: 'pending' as ExpenseCaptureManifestPageState,
      ...(chunkByPage.has(index) ? { chunkId: chunkByPage.get(index)! } : {}),
      ...(textByPage.has(index) ? { textLayerChars: textByPage.get(index)! } : {}),
    })),
    chunks: plan.chunks.map((chunk) => ({
      id: chunk.id, kind: chunk.kind, pageIndexes: chunk.pageIndexes,
      bytes: chunk.byteLength, state: 'pending' as const, calls: 0,
    })),
  };
}

function markChunk(
  manifest: ExpenseCaptureReadManifest,
  chunkId: string,
  state: 'done' | 'failed',
  errorCode?: string,
): ExpenseCaptureReadManifest {
  return {
    ...manifest,
    chunks: manifest.chunks.map((chunk) => chunk.id === chunkId
      ? { ...chunk, state, calls: chunk.calls + 1, ...(errorCode ? { errorCode } : {}) }
      : chunk),
  };
}

function markPages(
  manifest: ExpenseCaptureReadManifest,
  updates: ReadonlyArray<{ index: number; state: ExpenseCaptureManifestPageState }>,
): ExpenseCaptureReadManifest {
  const byIndex = new Map(updates.map((update) => [update.index, update.state]));
  return {
    ...manifest,
    pages: manifest.pages.map((page) => byIndex.has(page.index) ? { ...page, state: byIndex.get(page.index)! } : page),
  };
}

function markWindow(
  manifest: ExpenseCaptureReadManifest,
  windowId: string,
  state: 'done' | 'failed',
): ExpenseCaptureReadManifest {
  return {
    ...manifest,
    windows: manifest.windows.map((window) => window.id === windowId ? { ...window, state } : window),
  };
}

export type { CaptureCheckpoint, RunOutcome };
export type CaptureFields = ReceiptOcrFieldResult;

/**
 * A transcription that ends at the item table. A markdown row carrying a money amount with no
 * total-like line (รวม / ทั้งสิ้น / สุทธิ / total / VAT / ภาษี) anywhere after the last such row is a
 * page whose summary block was not read — the shape a low-resolution screenshot produces when the
 * model transcribes the large print and silently skips the small print (§17.6: PARTIAL, never DONE).
 */
export function transcriptionStopsBeforeTotals(text: string): boolean {
  const lines = text.split('\n');
  const moneyRow = /^\s*\|.*\d{1,3}(?:,\d{3})*\.\d{2}.*\|\s*$/;
  const totalLine = /รวม|ทั้งสิ้น|สุทธิ|total|grand|vat|ภาษี|net\b|amount due/i;
  let lastRow = -1;
  for (const [index, line] of lines.entries()) if (moneyRow.test(line)) lastRow = index;
  if (lastRow < 0) return false;
  // Inclusive of the last money row: a receipt whose summary is itself a table ends on a row that
  // says "Total" / "รวม" — that row IS the total block, not a sign it is missing.
  return !lines.slice(lastRow).some((line) => totalLine.test(line));
}
