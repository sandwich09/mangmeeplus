import { Injectable, Logger } from '@nestjs/common';
import { computeTrustScore } from '../../domain/logic/crm-ai-trust.logic';
import { CrmAiContextRepository } from '../../infrastructure/crm-ai-context.repository';

export type ScanCrmTrustScoresResult = { scanned: number; updated: number; failed: number };

@Injectable()
export class ScanCrmTrustScoresUseCase {
  private readonly logger = new Logger(ScanCrmTrustScoresUseCase.name);

  constructor(private readonly repo: CrmAiContextRepository) {}

  async execute(now = new Date()): Promise<ScanCrmTrustScoresResult> {
    const candidates = await this.repo.findTrustScanCandidates(now);
    const customers = new Map((await this.repo.findTrustSignalCustomers(candidates.map((candidate) => candidate.id), now)).map((customer) => [customer.id, customer]));
    let updated = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        const customer = customers.get(candidate.id);
        if (!customer) throw new Error('CRM customer not found for trust scan');
        const signals = this.repo.getTrustSignals(customer, now, candidate.inbound30d);
        const result = computeTrustScore(signals);
        await this.repo.saveTrustScore(candidate.companyId, candidate.id, result.score, result.factors, now);
        updated += 1;
      } catch {
        failed += 1;
      }
    }

    const result = { scanned: candidates.length, updated, failed };
    this.logger.log(JSON.stringify({ event: 'crm_trust_score_scan', ...result }));
    return result;
  }
}
