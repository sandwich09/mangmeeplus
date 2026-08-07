import { Injectable, ForbiddenException } from '@nestjs/common';
import type {
  RequestContext,
  AiSuggestionAgent,
  AiSuggestionDomain,
  AiCandidateActionType,
  AiRiskLevel,
} from '@watchdog-bms/contracts';
import { GetCashPositionUseCase } from '../../../banking/application/use-cases/reconciliation.use-case';
import { GetCrmCustomerUseCase } from '../../../crm/application/use-cases/crm-customer.use-case';
import type { AiDraftRequestRecord } from '../../domain/models/ai-draft.model';
import { hashText } from '../../domain/logic/ai-draft-idempotency.logic';
import { defaultRiskForAction } from '../../domain/logic/ai-draft-safety.logic';

export type GeneratedCitation = {
  sourceModule: string;
  sourceRecordType: string;
  sourceRecordId: string;
  sourceField?: string;
  label: string;
  valuePreview?: string;
  webDeepLink?: string;
};

export type GeneratedCandidateAction = {
  actionType: AiCandidateActionType;
  targetModule: string;
  targetRecordType?: string;
  targetRecordId?: string;
  draftPayloadJson: Record<string, unknown>;
  riskLevel?: AiRiskLevel;
};

// The grounded evidence pack the API gathers (via source reads = tools) and hands to the
// model so it can AUTHOR the suggestion. The model never invents ids/citations — those are
// fixed here. `facts` are bounded, source-derived statements for the prompt.
export type EvidencePack = {
  agent: AiSuggestionAgent;
  domain: AiSuggestionDomain;
  defaultTitle: string;
  facts: string[];
  citations: GeneratedCitation[];
  candidateAction: GeneratedCandidateAction;
  wantsChecklist: boolean;
  artifactType: 'TEXT' | 'CHECKLIST' | 'SOURCE_DRAFT_PAYLOAD';
  needsDataReasons: string[];
  sourceStateParts: Array<string | number | undefined>;
  sourceModule?: string;
  sourceRecordType?: string;
  sourceRecordId?: string;
};

function needsData(reasons: string[], base: Partial<EvidencePack>): EvidencePack {
  return {
    agent: base.agent ?? 'CFO',
    domain: base.domain ?? 'WORKFLOW',
    defaultTitle: base.defaultTitle ?? 'AI suggestion needs more data',
    facts: [],
    citations: [],
    candidateAction: { actionType: 'NO_SOURCE_DRAFT_AVAILABLE', targetModule: 'ai-draft', draftPayloadJson: {} },
    wantsChecklist: false,
    artifactType: 'CHECKLIST',
    needsDataReasons: reasons,
    sourceStateParts: [],
    ...base,
  };
}

@Injectable()
export class SuggestionGeneratorService {
  constructor(
    private readonly getCash: GetCashPositionUseCase,
    private readonly getCustomer: GetCrmCustomerUseCase,
  ) {}

  // Gather grounded evidence for the template. No natural-language authoring happens here.
  async collectEvidence(templateKey: string, ctx: RequestContext, request: AiDraftRequestRecord): Promise<EvidencePack> {
    switch (templateKey) {
      case 'cfo_cash_risk_summary':
        return this.cfoCashRisk(ctx);
      case 'crm_followup_next_action':
        return this.crmFollowUp(ctx, request);
      case 'inventory_reorder_review':
        return this.reviewChecklist(request, 'INVENTORY', 'INVENTORY', 'inventory', 'Reorder / stock-risk review', [
          'Confirm low-stock products against current balances',
          'Check sales velocity and open purchase orders',
          'Decide reorder quantity per product',
        ]);
      case 'tax_evidence_checklist':
        return this.reviewChecklist(request, 'TAX_ACCOUNTING', 'TAX', 'tax', 'Tax evidence checklist', [
          'Confirm all VAT purchase/sales tax invoices are attached',
          'Confirm WHT certificates issued and stored',
          'Reconcile tax report totals against ledger',
        ]);
      case 'workflow_review_checklist':
        return this.reviewChecklist(request, 'WORKFLOW', 'WORKFLOW', 'workflow', 'Workflow review checklist', [
          'Review the source record the workflow flagged',
          'Confirm the required follow-up is completed',
          'Close or escalate the workflow task',
        ]);
      default:
        return needsData(['Unknown or unavailable template'], { domain: 'WORKFLOW', agent: 'WORKFLOW', defaultTitle: 'Unavailable template' });
    }
  }

  // ---- CFO: grounded cash-risk evidence from bank cash position (advisory only) ----
  private async cfoCashRisk(ctx: RequestContext): Promise<EvidencePack> {
    let positions;
    try {
      positions = await this.getCash.execute(ctx);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        return needsData(['Missing source permission: bank.cash.read'], { domain: 'CFO', agent: 'CFO', defaultTitle: 'Cash risk summary' });
      }
      throw err;
    }
    if (positions.length === 0) {
      return needsData(['No bank accounts found for cash-risk analysis'], { domain: 'CFO', agent: 'CFO', defaultTitle: 'Cash risk summary' });
    }
    const totalUnreconciled = positions.reduce((n, p) => n + (p.unreconciledLineCount ?? 0), 0);
    const totalUnmatched = positions.reduce((n, p) => n + (p.unmatchedLineCount ?? 0), 0);
    const totalPendingAdj = positions.reduce((n, p) => n + (p.pendingAdjustmentCount ?? 0), 0);
    const citations: GeneratedCitation[] = positions.slice(0, 5).map((p) => ({
      sourceModule: 'banking',
      sourceRecordType: 'bank_account',
      sourceRecordId: p.bankAccountId,
      sourceField: 'cash_position',
      label: `${p.bankAccountDisplayName} (${p.currency})`,
      valuePreview: `unreconciled ${p.unreconciledLineCount}, unmatched ${p.unmatchedLineCount}, pending adj ${p.pendingAdjustmentCount}`,
      webDeepLink: `/companies/${ctx.companyId}/banking/accounts/${p.bankAccountId}`,
    }));
    const facts = [
      `There are ${positions.length} bank account(s).`,
      `${totalUnreconciled} bank statement line(s) are unreconciled across all accounts.`,
      `${totalUnmatched} statement line(s) are unmatched.`,
      `${totalPendingAdj} bank adjustment(s) are pending approval.`,
      ...positions.slice(0, 5).map((p) => `Account ${p.bankAccountDisplayName} (${p.currency}): ${p.unreconciledLineCount} unreconciled, ${p.unmatchedLineCount} unmatched.`),
    ];
    return {
      agent: 'CFO',
      domain: 'CFO',
      defaultTitle: 'สรุปความเสี่ยงกระแสเงินสด (Cash risk summary)',
      facts,
      citations,
      candidateAction: {
        actionType: 'CREATE_REVIEW_CHECKLIST',
        targetModule: 'ai-draft',
        draftPayloadJson: { title: 'Reconcile flagged bank accounts', items: citations.map((c) => c.label) },
      },
      wantsChecklist: false,
      artifactType: 'TEXT',
      needsDataReasons: [],
      sourceStateParts: ['cash', totalUnreconciled, totalUnmatched, totalPendingAdj, positions.length],
      sourceModule: 'banking',
      sourceRecordType: 'cash_position',
      sourceRecordId: ctx.companyId,
    };
  }

  // ---- CRM: grounded follow-up evidence for a customer (real source draft on web review) ----
  private async crmFollowUp(ctx: RequestContext, request: AiDraftRequestRecord): Promise<EvidencePack> {
    const customerId = request.sourceRecordId;
    if (!customerId || request.sourceRecordType !== 'customer') {
      return needsData(['A CRM customer reference (sourceRecordType=customer) is required'], { domain: 'SALES_CRM', agent: 'CRM', defaultTitle: 'Next follow-up' });
    }
    let customer;
    try {
      const result = await this.getCustomer.execute(ctx, customerId);
      if (result.projection !== 'OPERATIONAL') {
        return needsData(['Operational CRM customer fields are not permitted for this role'], { domain: 'SALES_CRM', agent: 'CRM', defaultTitle: 'Next follow-up' });
      }
      customer = result.customer;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        return needsData(['Missing source permission: crm.customer.read'], { domain: 'SALES_CRM', agent: 'CRM', defaultTitle: 'Next follow-up' });
      }
      throw err;
    }
    const displayName = customer.displayName;
    const citations: GeneratedCitation[] = [
      {
        sourceModule: 'crm',
        sourceRecordType: 'customer',
        sourceRecordId: customer.id,
        sourceField: 'status',
        label: `Customer ${displayName}`,
        valuePreview: `status ${customer.status}`,
        webDeepLink: `/companies/${ctx.companyId}/crm/customers/${customer.id}`,
      },
    ];
    const facts = [
      `Customer ${displayName} has status ${customer.status}.`,
      customer.nextFollowUpAt ? `Next follow-up is currently scheduled for ${customer.nextFollowUpAt}.` : 'No follow-up is currently scheduled.',
      'A timely follow-up keeps the relationship active.',
    ];
    // Grounded ids stay fixed; the model may propose the follow-up title/date via actionTitle.
    return {
      agent: 'CRM',
      domain: 'SALES_CRM',
      defaultTitle: `ติดตามลูกค้า ${displayName}`,
      facts,
      citations,
      candidateAction: {
        actionType: 'CREATE_CRM_FOLLOW_UP_DRAFT',
        targetModule: 'crm',
        targetRecordType: 'customer',
        targetRecordId: customer.id,
        draftPayloadJson: { customerId: customer.id, dueAt: new Date().toISOString(), channel: 'PHONE', priority: 'NORMAL' },
        riskLevel: defaultRiskForAction('CREATE_CRM_FOLLOW_UP_DRAFT'),
      },
      wantsChecklist: false,
      artifactType: 'SOURCE_DRAFT_PAYLOAD',
      needsDataReasons: [],
      sourceStateParts: ['crm-customer', customer.id, customer.status, customer.nextFollowUpAt ?? ''],
      sourceModule: 'crm',
      sourceRecordType: 'customer',
      sourceRecordId: customer.id,
    };
  }

  // ---- Generic review-checklist evidence (self-owned fallback, no cross-module write) ----
  private reviewChecklist(
    request: AiDraftRequestRecord,
    domain: AiSuggestionDomain,
    agent: AiSuggestionAgent,
    module: string,
    title: string,
    items: string[],
  ): EvidencePack {
    const citations: GeneratedCitation[] = [];
    if (request.sourceRecordId && request.sourceRecordType) {
      citations.push({
        sourceModule: request.sourceModule ?? module,
        sourceRecordType: request.sourceRecordType,
        sourceRecordId: request.sourceRecordId,
        label: `${request.sourceRecordType} ${request.sourceRecordId}`,
      });
    }
    return {
      agent,
      domain,
      defaultTitle: title,
      facts: items,
      citations,
      candidateAction: { actionType: 'CREATE_REVIEW_CHECKLIST', targetModule: module, draftPayloadJson: { title, items } },
      wantsChecklist: true,
      artifactType: 'CHECKLIST',
      needsDataReasons: [],
      sourceStateParts: [module, request.sourceRecordId ?? '', hashText(items.join('|'))],
      sourceModule: request.sourceModule ?? module,
      sourceRecordType: request.sourceRecordType,
      sourceRecordId: request.sourceRecordId,
    };
  }
}
