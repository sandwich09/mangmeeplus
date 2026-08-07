import { Injectable, Logger } from '@nestjs/common';
import {
  AUTONOMY_JOB_MAX_ATTEMPTS,
  AUTONOMY_JOB_STALE_MS,
  RETRY_SCAN_LIMIT,
} from '../../domain/crm-inbox.constants';
import { PrismaCrmInboxRepository } from '../../infrastructure/prisma-crm-inbox.repository';
import { ProcessInboundLineMessageUseCase } from './process-inbound-line-message.use-case';

@Injectable()
export class RetryCrmAutonomyJobsUseCase {
  private readonly logger = new Logger(RetryCrmAutonomyJobsUseCase.name);

  constructor(
    private readonly repo: PrismaCrmInboxRepository,
    private readonly processInbound: ProcessInboundLineMessageUseCase,
  ) {}

  async execute(limit = RETRY_SCAN_LIMIT): Promise<{ jobsRetried: number }> {
    const now = new Date();
    const jobs = await this.repo.findRetryableAutonomyJobs(
      now,
      AUTONOMY_JOB_STALE_MS,
      AUTONOMY_JOB_MAX_ATTEMPTS,
      limit,
    );
    let jobsRetried = 0;
    for (const job of jobs) {
      if (job.attempts >= AUTONOMY_JOB_MAX_ATTEMPTS) continue;
      try {
        if (!(await this.repo.claimAutonomyJob(job, now))) continue;
        await this.processInbound.retryAutonomyJob({
          ...job,
          status: 'PENDING',
          attempts: job.attempts + 1,
          nextAttemptAt: null,
          updatedAt: now,
        });
        jobsRetried += 1;
      } catch (error) {
        this.logger.warn({ msg: 'CRM autonomy retry failed', jobId: job.id, error: (error as Error).message });
      }
    }
    return { jobsRetried };
  }
}
