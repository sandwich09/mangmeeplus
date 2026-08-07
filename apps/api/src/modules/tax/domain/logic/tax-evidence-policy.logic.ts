import type { TransactionTaxContext } from '@watchdog-bms/contracts';

export type TaxEvidencePolicy = {
  required: string[];
  oneOf: string[][];
  optional: string[];
};

const defaults: Partial<Record<TransactionTaxContext, TaxEvidencePolicy>> = {
  DOMESTIC_PURCHASE: { required: [], oneOf: [], optional: ['TAX_INVOICE'] },
  IMPORT_GOODS: { required: ['CUSTOMS_ENTRY'], oneOf: [], optional: [] },
  IMPORT_SERVICE: { required: ['PAYMENT_EVIDENCE'], oneOf: [], optional: ['PP36_RECEIPT'] },
  EXPORT_GOODS: { required: ['EXPORT_DECLARATION', 'PAYMENT_EVIDENCE'], oneOf: [], optional: [] },
  EXPORT_SERVICE: { required: ['FOREIGN_USE_EVIDENCE', 'PAYMENT_EVIDENCE'], oneOf: [], optional: [] },
};

const unique = (items: string[]) => [...new Set(items.map((item) => item.trim().toUpperCase()).filter(Boolean))];

function normalizeForContext(context: TransactionTaxContext, policy: TaxEvidencePolicy): TaxEvidencePolicy {
  if (context !== 'IMPORT_SERVICE') return policy;
  // The Revenue Department receipt exists only after PP36 remittance. It releases
  // input VAT later; it must never block payment-date output-liability recognition.
  return {
    ...policy,
    required: policy.required.filter((type) => type !== 'PP36_RECEIPT'),
    optional: unique([...policy.optional, 'PP36_RECEIPT']),
    oneOf: policy.oneOf.map((group) => group.filter((type) => type !== 'PP36_RECEIPT')).filter((group) => group.length > 0),
  };
}

function normalizePolicy(value: unknown): TaxEvidencePolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!['EXTEND', 'REPLACE', undefined].includes(candidate.mode as any)) return null;
  const required = Array.isArray(candidate.required) && candidate.required.every((item) => typeof item === 'string') ? unique(candidate.required as string[]) : null;
  const optional = Array.isArray(candidate.optional) && candidate.optional.every((item) => typeof item === 'string') ? unique(candidate.optional as string[]) : null;
  const oneOf = Array.isArray(candidate.oneOf) && candidate.oneOf.every((group) => Array.isArray(group) && group.length > 0 && group.every((item) => typeof item === 'string'))
    ? (candidate.oneOf as string[][]).map(unique) : null;
  return required && optional && oneOf ? { required, optional, oneOf } : null;
}

export function resolveTaxEvidencePolicy(context: TransactionTaxContext, evidenceRuleKey?: string | null): { policy: TaxEvidencePolicy; errors: string[] } {
  const baseline = defaults[context] ?? { required: [], oneOf: [], optional: [] };
  if (!evidenceRuleKey?.trim()) return { policy: normalizeForContext(context, baseline), errors: [] };
  const text = evidenceRuleKey.trim();
  if (!text.startsWith('{')) {
    return { policy: normalizeForContext(context, { ...baseline, required: unique([...baseline.required, ...text.split(',')]) }), errors: [] };
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const configured = normalizePolicy(parsed);
    if (!configured) return { policy: normalizeForContext(context, baseline), errors: ['evidence_policy_invalid'] };
    if (parsed.mode === 'REPLACE') return { policy: normalizeForContext(context, configured), errors: [] };
    return {
      policy: normalizeForContext(context, {
        required: unique([...baseline.required, ...configured.required]),
        optional: unique([...baseline.optional, ...configured.optional]),
        oneOf: [...baseline.oneOf, ...configured.oneOf],
      }),
      errors: [],
    };
  } catch {
    return { policy: normalizeForContext(context, baseline), errors: ['evidence_policy_invalid_json'] };
  }
}

export function taxEvidencePolicyComplete(policy: TaxEvidencePolicy, evidenceTypes: string[]): boolean {
  const present = new Set(unique(evidenceTypes));
  return policy.required.every((type) => present.has(type))
    && policy.oneOf.every((group) => group.some((type) => present.has(type)));
}

export function taxEvidencePolicyAllowedTypes(policy: TaxEvidencePolicy): Set<string> {
  return new Set(unique([...policy.required, ...policy.optional, ...policy.oneOf.flat()]));
}
