import type {
  AiSuggestionAgent,
  AiSuggestionDomain,
  AiRiskLevel,
  AiSuggestionTemplateStatus,
} from '@watchdog-bms/contracts';

// First-pass, code-owned suggestion templates. Admin prompt-body editing is out of
// first-pass scope: templates are seeded/code-owned. Availability is computed from the
// source modules actually implemented, so a template needing a missing module shows
// UNAVAILABLE with a reason instead of failing at generation time.

export type AiSuggestionTemplateDef = {
  key: string;
  domain: AiSuggestionDomain;
  defaultAgent: AiSuggestionAgent;
  title: string;
  description: string;
  triggerModes: string[];
  requiredSourceModules: string[];
  requiredPermissions: string[];
  riskLevel: AiRiskLevel;
  defaultTtlMinutes: number;
};

// Source modules implemented as of item 17. Used to compute template availability.
export const IMPLEMENTED_SOURCE_MODULES = new Set<string>([
  'crm',
  'banking',
  'inventory',
  'tax',
  'accounting-documents',
  'workflow',
  'reimbursements',
  'ledger',
  'expenses',
  'procurement',
]);

const TTL_NORMAL = 7 * 24 * 60; // 7 days
const TTL_HIGH_RISK = 24 * 60; // 24 hours

export const AI_SUGGESTION_TEMPLATES: AiSuggestionTemplateDef[] = [
  {
    key: 'cfo_cash_risk_summary',
    domain: 'CFO',
    defaultAgent: 'CFO',
    title: 'สรุปความเสี่ยงกระแสเงินสด (Cash risk summary)',
    description: 'Summarize cash position, unreconciled bank lines, and pending adjustments with source citations. Advisory only — no source draft.',
    triggerModes: ['manual', 'workflow'],
    requiredSourceModules: ['banking'],
    requiredPermissions: ['ai.suggestion.request', 'bank.cash.read'],
    riskLevel: 'HIGH',
    defaultTtlMinutes: TTL_HIGH_RISK,
  },
  {
    key: 'crm_followup_next_action',
    domain: 'SALES_CRM',
    defaultAgent: 'CRM',
    title: 'การติดตามลูกค้าครั้งถัดไป (Next follow-up)',
    description: 'Propose the next-best follow-up for a customer, routed through CRM follow-up draft creation on web review.',
    triggerModes: ['manual', 'workflow'],
    requiredSourceModules: ['crm'],
    requiredPermissions: ['ai.suggestion.request', 'crm.customer.read'],
    riskLevel: 'MEDIUM',
    defaultTtlMinutes: TTL_NORMAL,
  },
  {
    key: 'inventory_reorder_review',
    domain: 'INVENTORY',
    defaultAgent: 'INVENTORY',
    title: 'ทบทวนการสั่งซื้อซ้ำ (Reorder review)',
    description: 'Produce a reorder/stock-risk review checklist from inventory reports for web review.',
    triggerModes: ['manual', 'workflow'],
    requiredSourceModules: ['inventory'],
    requiredPermissions: ['ai.suggestion.request', 'inventory.report.read'],
    riskLevel: 'MEDIUM',
    defaultTtlMinutes: TTL_NORMAL,
  },
  {
    key: 'tax_evidence_checklist',
    domain: 'TAX_ACCOUNTING',
    defaultAgent: 'TAX',
    title: 'เช็กลิสต์หลักฐานภาษี (Tax evidence checklist)',
    description: 'Build a missing VAT/WHT evidence checklist before period preparation for web review.',
    triggerModes: ['manual', 'workflow'],
    requiredSourceModules: ['tax'],
    requiredPermissions: ['ai.suggestion.request', 'tax.review_issue.read'],
    riskLevel: 'MEDIUM',
    defaultTtlMinutes: TTL_NORMAL,
  },
  {
    key: 'workflow_review_checklist',
    domain: 'WORKFLOW',
    defaultAgent: 'WORKFLOW',
    title: 'เช็กลิสต์ทบทวนเวิร์กโฟลว์ (Workflow review checklist)',
    description: 'Fallback review checklist created when a workflow requests an AI draft but no safe source draft API is available.',
    triggerModes: ['manual', 'workflow'],
    requiredSourceModules: ['workflow'],
    requiredPermissions: ['ai.suggestion.request'],
    riskLevel: 'LOW',
    defaultTtlMinutes: TTL_NORMAL,
  },
];

const TEMPLATE_BY_KEY = new Map(AI_SUGGESTION_TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): AiSuggestionTemplateDef | undefined {
  return TEMPLATE_BY_KEY.get(key);
}

export function computeTemplateAvailability(def: AiSuggestionTemplateDef): {
  status: AiSuggestionTemplateStatus;
  unavailableReason?: string;
} {
  const missing = def.requiredSourceModules.filter((m) => !IMPLEMENTED_SOURCE_MODULES.has(m));
  if (missing.length > 0) {
    return { status: 'UNAVAILABLE', unavailableReason: `Missing source modules: ${missing.join(', ')}` };
  }
  return { status: 'AVAILABLE' };
}

export function isTemplateAvailable(key: string): boolean {
  const def = getTemplate(key);
  if (!def) return false;
  return computeTemplateAvailability(def).status === 'AVAILABLE';
}
