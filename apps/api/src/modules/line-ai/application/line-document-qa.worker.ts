import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { parseAiBudgetGrantV2, type LineDocumentQaAttachment, type LineDocumentQaGatewayPage } from '@watchdog-bms/contracts';
import { planCapturePreprocessing, planCaptureSinglePageChunk } from '../../expenses/domain/logic/expense-capture-preprocess.logic';
import { AiGatewayClient } from '../infrastructure/ai-gateway.client';
import { LineDocumentQaService, type LineDocumentQaJobRow } from './line-document-qa.service';

const QA_CONCURRENCY = 2;

@Injectable()
export class LineDocumentQaWorker {
  private readonly logger = new Logger(LineDocumentQaWorker.name);
  private running = 0;

  constructor(private readonly jobs: LineDocumentQaService, private readonly gateway: AiGatewayClient) {}

  kick(jobId: string): void {
    void this.execute(jobId).catch((error: unknown) => this.logger.warn(`qa kick failed ${jobId}: ${error instanceof Error ? error.message : String(error)}`));
  }

  async drain(batchSize = QA_CONCURRENCY): Promise<{ claimed: number }> {
    await this.jobs.expireDue();
    const free = Math.max(0, QA_CONCURRENCY - this.running);
    if (!free) return { claimed: 0 };
    const reserved = Math.max(1, Math.min(batchSize, free));
    this.running += reserved;
    let jobs: LineDocumentQaJobRow[];
    try { jobs = await this.jobs.claimNext(this.leaseOwner(), reserved); }
    catch (error) { this.running -= reserved; throw error; }
    this.running -= reserved - jobs.length;
    for (const job of jobs) {
      void this.runClaimed(job).catch((error: unknown) => this.logger.warn(`qa run failed ${job.id}: ${error instanceof Error ? error.message : String(error)}`)).finally(() => { this.running -= 1; });
    }
    return { claimed: jobs.length };
  }

  async runClaimed(job: LineDocumentQaJobRow): Promise<void> {
    const leaseOwner = job.leaseOwner;
    if (!leaseOwner) return;
    const heartbeat = setInterval(() => { void this.jobs.renew(job, leaseOwner).catch(() => false); }, 30_000);
    heartbeat.unref();
    try {
      const grant = parseAiBudgetGrantV2((job.budgetAuthorityJson as { grant?: unknown } | null)?.grant);
      if (!grant || grant.authorityKind !== 'qa_job' || grant.authorityId !== job.id) {
        await this.jobs.markFailed(job, leaseOwner, 'QA_BUDGET_AUTHORITY_INVALID');
        return;
      }
      if (!await this.jobs.canRun(job)) {
        await this.jobs.markFailed(job, leaseOwner, 'QA_SOURCE_OR_OWNER_CHANGED');
        return;
      }
      const pages = await this.materializePages(job);
      if (!await this.jobs.canRun(job)) {
        await this.jobs.markFailed(job, leaseOwner, 'QA_SOURCE_OR_OWNER_CHANGED');
        return;
      }
      const response = await this.gateway.requestLineDocumentQa({
        requestId: `qa:${job.id}:${job.leaseFence}:${randomUUID()}`,
        companyId: job.companyId,
        userId: job.userId,
        jobId: job.id,
        jobRevision: job.revision,
        turnId: job.turnId,
        question: job.questionText,
        ...(job.questionsJson == null ? {} : { questions: job.questionsJson as import('@watchdog-bms/contracts').LineDocumentQaQuestion[] }),
        pages,
        inputDigest: job.inputDigest,
        inputSetHash: job.inputSetHash,
        questionDigest: job.questionDigest,
        readerVersion: job.readerVersion as 'line-document-qa/1',
        budgetGrantV2: grant,
      });
      if (response.status !== 'ok') {
        await this.jobs.markFailed(job, leaseOwner, response.errorCode);
        return;
      }
      if (!await this.jobs.markAnswerReady(job, leaseOwner, response.result)) {
        await this.jobs.markFailed(job, leaseOwner, 'QA_RESULT_COMMIT_REJECTED');
      }
    } catch {
      await this.jobs.markFailed(job, leaseOwner, 'QA_WORKER_FAILED');
    } finally { clearInterval(heartbeat); }
  }

  private async materializePages(job: LineDocumentQaJobRow): Promise<LineDocumentQaGatewayPage[]> {
    const attachments = job.attachmentsJson as LineDocumentQaAttachment[];
    const pages: LineDocumentQaGatewayPage[] = [];
    for (const attachment of attachments) {
      const source = await this.jobs.readJobAttachment(job, attachment.attachmentId, attachment.contentHash);
      for (const page of attachment.requestedPages) {
        // One rendered page stays one selected-page identity. A tile set is refused explicitly;
        // never send only its overview and claim the whole page was read.
        const chunk = source.mimeType === 'application/pdf'
          ? await planCaptureSinglePageChunk(source.bytes, source.mimeType, page - 1, `${job.id}:${attachment.attachmentId}:${page}`, undefined, true)
          : (await planCapturePreprocessing(source.mimeType === 'image/webp'
            ? await sharp(source.bytes, { limitInputPixels: 40_000_000 }).jpeg({ quality: 95 }).toBuffer() : source.bytes,
            source.mimeType === 'image/webp' ? 'image/jpeg' : source.mimeType, { maxPages: 1 })).chunks[0];
        if (!chunk?.bytes || chunk.kind !== 'image' || !['image/jpeg', 'image/png'].includes(chunk.mimeType)) throw new Error('QA_PAGE_RENDER_UNAVAILABLE');
        pages.push({ attachmentId: attachment.attachmentId, page, mimeType: chunk.mimeType as 'image/jpeg' | 'image/png',
          sourceMimeType: attachment.mimeType, contentHash: attachment.contentHash,
          renderedSha256: createHash('sha256').update(chunk.bytes).digest('hex'), contentBase64: chunk.bytes.toString('base64') });
      }
    }
    return pages;
  }

  /** Foreground callers may await this promise up to their own cutoff; never cancel/re-kick it. A read another
   *  tick claimed first, or a moment with every slot busy, is waited for up to the job's own foreground deadline
   *  (NAT05/NAT06 2026-09-29), so the admitting turn still answers in its reply instead of saying "กำลังอ่าน". */
  async execute(jobId: string): Promise<LineDocumentQaJobRow | null> {
    for (;;) {
      if (this.running < QA_CONCURRENCY) {
        this.running += 1;
        try {
          const claimed = await this.jobs.claim(jobId, this.leaseOwner());
          if (claimed) { await this.runClaimed(claimed); return this.jobs.getById(jobId); }
        } finally { this.running -= 1; }
      }
      const job = await this.jobs.getById(jobId);
      if (!['QUEUED', 'READING'].includes(job.status) || job.foregroundDeadlineAt.getTime() <= Date.now()) return job;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  private leaseOwner(): string { return `${process.env['HOSTNAME'] ?? 'api'}:document-qa:${randomUUID()}`; }
}
