// AI Tool contracts – shared by API (tool adapters) and AI Gateway (orchestration).

import type { LineAiBusinessSubject } from './line-ai.js';

export type ToolCategory = 'read_summary' | 'read_detail' | 'report' | 'suggestion' | 'evidence_capture' | 'draft_create' | 'draft_update' | 'approval_request' | 'final_mutation';

/** Current AI assistant phase: read/report/suggest plus accounting evidence capture; no approval/final mutation. */
export const LINE_ALLOWED_TOOL_CATEGORIES: ToolCategory[] = ['read_summary', 'read_detail', 'report', 'suggestion', 'evidence_capture'];

/**
 * S-4 (draft-control spec §5.4/§8): editing a draft over LINE is its own category, kept OUT of
 * `LINE_ALLOWED_TOOL_CATEGORIES` on purpose — it is admitted only while `LINE_AI_DRAFT_EDIT_ENABLED`
 * is on, and even then a tool call can do no more than PREVIEW. The write happens on a confirm
 * postback, through a path no model can reach, so a `draft_update` tool is never a mutation the way
 * `final_mutation` is.
 */
export const LINE_DRAFT_UPDATE_TOOL_CATEGORY: ToolCategory = 'draft_update';

/** The categories this phase may execute, given the runtime flags. Draft-edit tools disappear
 *  entirely when the flag is off — not "refused later", absent, so the model is never offered one. */
export function allowedToolCategories(flags: { draftEditEnabled?: boolean } = {}): ToolCategory[] {
  return flags.draftEditEnabled
    ? [...LINE_ALLOWED_TOOL_CATEGORIES, LINE_DRAFT_UPDATE_TOOL_CATEGORY]
    : [...LINE_ALLOWED_TOOL_CATEGORIES];
}

/** The registry as this runtime should see it. One place decides tool visibility so the gateway's
 *  catalog and the API's executor cannot disagree about which tools exist. */
export function lineToolRegistryFor(flags: { draftEditEnabled?: boolean } = {}): ToolMeta[] {
  const allowed = new Set(allowedToolCategories(flags));
  return LINE_TOOL_REGISTRY.filter((tool) => allowed.has(tool.category) || !DYNAMIC_TOOL_CATEGORIES.has(tool.category));
}

/** Categories whose presence depends on a runtime flag. Everything else keeps its existing
 *  visibility (registered-but-unwired tools still appear and answer `unsupported_module`). */
const DYNAMIC_TOOL_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([LINE_DRAFT_UPDATE_TOOL_CATEGORY]);

export type ToolResultStatus = 'ok' | 'forbidden' | 'unsupported_module' | 'unavailable' | 'error';

export type SourceRef = {
  label: string;
  module: string;
  entityType: string;
  entityId?: string;
  asOf?: string;
  permissionChecked: true;
  webPath?: string;
};

export type ToolResult<TData = unknown> = {
  toolName: string;
  status: ToolResultStatus;
  data?: TData;
  sourceRefs: SourceRef[];
  /** ISO timestamp when data was read */
  asOf: string;
  /** True when underlying data may be stale (e.g. snapshot older than threshold) */
  stale?: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** Wall-clock ms measured by the caller boundary (gateway ErpToolClient), not by the tool adapter. */
  durationMs?: number;
};

export type ToolMeta = {
  name: string;
  description: string;
  businessSubjects: LineAiBusinessSubject[];
  questionKinds: Array<'summary' | 'search' | 'list' | 'detail' | 'breakdown' | 'explain'>;
  category: ToolCategory;
  /** Permissions that must all be present. */
  requiredPermissions: string[];
  /** When present, at least one permission must be present (for own/all source policies). */
  anyOfPermissions?: string[];
  sourceModule: string;
  supportedAgents: string[];
  sensitiveAudit: boolean;
  requiresErpPermissionCheck: boolean;
  /** Input fields that must be present before the API call is made. */
  requiredInputFields?: readonly string[];
  /** Optional input fields the model may pass (whitelisted; anything else is dropped). */
  optionalInputFields?: readonly string[];
  /** Company features that own this tool's data, when the module-level default is not precise
   *  enough. Any one of them entitles the tool. Defaults to `TOOL_MODULE_FEATURE_KEYS[sourceModule]`. */
  featureKeys?: readonly string[];
};

export function hasToolPermissions(tool: Pick<ToolMeta, 'requiredPermissions' | 'anyOfPermissions'>, permissions: readonly string[]): boolean {
  return tool.requiredPermissions.every((permission) => permissions.includes(permission))
    && (!tool.anyOfPermissions?.length || tool.anyOfPermissions.some((permission) => permissions.includes(permission)));
}

/**
 * Source module → the company features that own the data its tools read.
 *
 * Mirrors the LINE staff menu mapping in `line-staff-menu.logic.ts`, so a button the menu hides and
 * the same question typed as free text are refused for the same reason. A module absent from this
 * map is deliberately ungated: `data-model-core` is the tenant context every answer needs, and
 * `employee-access` / `hr` have no sellable feature of their own.
 *
 * Modules are mapped to the PARENT feature. Tools that belong to one submenu name it through
 * `ToolMeta.featureKeys` instead — `evaluateEntitledFeatureKeys` expands a parent's submenus, so a
 * submenu key is the precise gate rather than a stricter one.
 */
export const TOOL_MODULE_FEATURE_KEYS: Readonly<Record<string, readonly string[]>> = {
  'dashboard-notifications': ['dashboard_notifications'],
  inventory: ['inventory'],
  ledger: ['double_entry_ledger'],
  expenses: ['expenses'],
  'accounting-documents': ['sales_documents'],
  crm: ['crm'],
  'crm-inbox': ['crm'],
  'crm-sales': ['crm'],
  procurement: ['procurement'],
  banking: ['bank_reconciliation'],
  // `reimbursements` is deliberately ABSENT. Owner decision 2026-08-10 (launch matrix §6.3 r5):
  // disabling reimbursement blocks NEW claims but in-flight work keeps flowing — reads, approve,
  // reject, finance review and payout stay alive, which is why RETAINED_REIMBURSEMENT_PERMISSIONS
  // survives entitlement stripping. Gating the read tools here would silently reverse that and
  // strand an approver who is still expected to clear the queue.
  reports: ['reports'],
  tax: ['thai_tax'],
  workflow: ['workflow_automation'],
};

/** The features that entitle this tool. Empty means the tool is not feature-gated. */
export function toolFeatureKeys(tool: Pick<ToolMeta, 'featureKeys' | 'sourceModule'>): readonly string[] {
  return tool.featureKeys ?? TOOL_MODULE_FEATURE_KEYS[tool.sourceModule] ?? [];
}

/**
 * `entitled === null` is the legacy fail-open company (no entitlement rows at all) and passes, the
 * same convention `loadEntitledFeatureKeys` and every other entitlement read in the repo use.
 */
export function hasToolFeature(
  tool: Pick<ToolMeta, 'featureKeys' | 'sourceModule'>,
  entitled: ReadonlySet<string> | null,
): boolean {
  if (entitled === null) return true;
  const required = toolFeatureKeys(tool);
  return required.length === 0 || required.some((key) => entitled.has(key));
}

/**
 * Capability groups the LINE assistant may describe itself with, in reply order.
 *
 * Grouped by FEATURE KEY, not by `businessSubjects`: a tool's secondary subject would otherwise
 * advertise a module the company never bought — measured case, `dashboard.get_business_health_summary`
 * declares subject `report` and lit a "finance" line on a company with reports, ledger and banking
 * all off. Feature keys are the axis `hasToolFeature` actually gates on, so a group can only appear
 * when a tool behind it would really run. Copy lives in the gateway, keyed by these ids, so the
 * Thai and English replies can never describe different capability sets.
 */
export const LINE_CAPABILITY_GROUPS = [
  { id: 'sales', featureKeys: ['sales_documents'] },
  // `reimbursements` carries no feature key at all (owner decision 2026-08-10: its reads stay alive
  // after the feature is switched off so in-flight claims can clear), so it is matched by module —
  // otherwise a claims-only approver would be told the assistant can do nothing for them.
  { id: 'expenses', featureKeys: ['expenses', 'expenses.list'], sourceModules: ['reimbursements'] },
  { id: 'finance', featureKeys: ['double_entry_ledger', 'bank_reconciliation', 'reports'] },
  { id: 'tax', featureKeys: ['thai_tax'] },
  { id: 'inventory', featureKeys: ['inventory', 'product_catalog'] },
  { id: 'customers', featureKeys: ['crm', 'crm.inbox'] },
  { id: 'bookings', featureKeys: ['crm.bookings'] },
  { id: 'procurement', featureKeys: ['procurement'] },
  // Assigned workflow tasks and run failures are "pending work and alerts" to the user, and the old
  // hardcoded copy claimed them under that wording; they keep their own feature gate.
  { id: 'alerts', featureKeys: ['dashboard_notifications', 'workflow_automation'] },
] as const satisfies ReadonlyArray<{
  id: string;
  featureKeys: readonly string[];
  /** Matched in addition to featureKeys, for modules that are deliberately not feature-gated. */
  sourceModules?: readonly string[];
}>;

export type LineCapabilityGroupId = (typeof LINE_CAPABILITY_GROUPS)[number]['id'];

/**
 * Opening words of every capability self-description the gateway renders — the card and its teaching
 * walkthrough (capability-help spec §8 / §8.1), Thai and English. The API recognises a "ยังไง"/"how"
 * follow-up from the stored reply preview alone, so these openings are a contract between the two apps:
 * the gateway spec pins its copy against this list and the API matches on it.
 */
export const LINE_CAPABILITY_REPLY_PREFIXES = [
  'น้องมั่งมีช่วยค้นและสรุปข้อมูลงานตามสิทธิ์',
  'Nong Mangmee can find and summarize work data',
  'น้องมั่งมีสอนใช้งานเบื้องต้น',
  'Nong Mangmee will walk you through the basics',
] as const;

/**
 * The receipt→expense-draft claim is NOT derived from a tool. `accounting.capture_receipt_evidence`
 * requires `expense.receipt.upload`, but the path that actually captures a LINE receipt accepts any
 * of the three below (process-line-webhook `canCaptureExpense`), and MANAGER/ACCOUNTANT/MARKETING
 * hold only `expense.receipt.line_upload` — gating on the tool would hide a capability they have.
 * Same list as the menu's camera button, so text and menu cannot disagree.
 */
export const LINE_RECEIPT_CAPTURE_PERMISSIONS = [
  'expense.receipt.line_upload',
  'expense.receipt.upload',
  'expense.create',
] as const;
export const LINE_RECEIPT_CAPTURE_FEATURE_KEY = 'expenses.upload';

/**
 * The capability groups this caller can actually use right now: a group appears only when at least
 * one LINE tool in it passes BOTH runtime gates (permissions ∧ entitlement). `entitled === null` is
 * the legacy fail-open company, same convention as `hasToolFeature`.
 */
export function usableCapabilityGroupIds(
  permissions: readonly string[],
  entitled: ReadonlySet<string> | null,
): LineCapabilityGroupId[] {
  const usable = LINE_TOOL_REGISTRY.filter(
    (tool) => hasToolPermissions(tool, permissions) && hasToolFeature(tool, entitled),
  );
  return LINE_CAPABILITY_GROUPS.filter((group) => usable.some((tool) => inCapabilityGroup(tool, group))).map((group) => group.id);
}

/** A tool belongs to a group when the group owns one of its feature keys, or its whole module. */
export function inCapabilityGroup(
  tool: Pick<ToolMeta, 'featureKeys' | 'sourceModule'>,
  group: { featureKeys: readonly string[]; sourceModules?: readonly string[] },
): boolean {
  return toolFeatureKeys(tool).some((key) => group.featureKeys.includes(key))
    || (group.sourceModules?.includes(tool.sourceModule) ?? false);
}

/** Whether the receipt→expense-draft sentence may be advertised to this caller. */
export function canAdvertiseReceiptCapture(
  permissions: readonly string[],
  entitled: ReadonlySet<string> | null,
): boolean {
  const featureOn = entitled === null || entitled.has(LINE_RECEIPT_CAPTURE_FEATURE_KEY);
  return featureOn && LINE_RECEIPT_CAPTURE_PERMISSIONS.some((permission) => permissions.includes(permission));
}

export const ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS = [
  'accounting.document.read',
  'accounting.document.read_related',
  'accounting.quotation.read',
  'accounting.invoice.read',
  'accounting.billing_note.read',
  'accounting.receipt.read',
  'accounting.tax_invoice.read',
  'accounting.credit_note.read',
  'accounting.debit_note.read',
] as const;

/** Registry of allowlisted read tools for LINE item 07. */
export const LINE_TOOL_REGISTRY: ToolMeta[] = [
  {
    name: 'company.get_current_context',
    description: 'Read current company context.',
    businessSubjects: ['company'],
    questionKinds: ['summary'],
    category: 'read_summary',
    requiredPermissions: ['company.setup.read'],
    sourceModule: 'data-model-core',
    supportedAgents: ['general', 'inventory', 'notifications'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'company.list_branches',
    description: 'List company branches with codes, names, and types.',
    businessSubjects: ['branch'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['company.branch.read'],
    sourceModule: 'data-model-core',
    supportedAgents: ['general', 'accounting', 'notifications'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'dashboard.get_business_health_summary',
    description: 'Read dashboard health summary and business indicators.',
    businessSubjects: ['company', 'report'],
    questionKinds: ['summary'],
    category: 'read_summary',
    requiredPermissions: ['dashboard.read'],
    sourceModule: 'dashboard-notifications',
    supportedAgents: ['general', 'notifications'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'notifications.list_open_alerts',
    description: 'List open alerts and notifications.',
    businessSubjects: ['report'],
    questionKinds: ['list'],
    category: 'read_summary',
    requiredPermissions: ['notification.read'],
    sourceModule: 'dashboard-notifications',
    supportedAgents: ['general', 'notifications'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'notifications.get_daily_summary',
    description: 'Read daily notification summary.',
    businessSubjects: ['report'],
    questionKinds: ['summary'],
    category: 'read_summary',
    requiredPermissions: ['notification.read'],
    sourceModule: 'dashboard-notifications',
    supportedAgents: ['notifications'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'inventory.search_products',
    description: 'Search inventory products.',
    businessSubjects: ['product'],
    questionKinds: ['search', 'list'],
    category: 'read_detail',
    requiredPermissions: ['inventory.product.read'],
    sourceModule: 'inventory',
    featureKeys: ['product_catalog'],
    supportedAgents: ['general', 'inventory'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['search'],
  },
  {
    name: 'inventory.get_product_detail',
    description: 'Read bounded details for one company-scoped product selected by canonical product id.',
    businessSubjects: ['product'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: ['inventory.product.read'],
    sourceModule: 'inventory',
    featureKeys: ['product_catalog'],
    supportedAgents: ['inventory', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['productId'],
  },
  {
    name: 'inventory.get_stock_balance',
    description: 'Read stock balances.',
    businessSubjects: ['inventory', 'product'],
    questionKinds: ['summary', 'detail'],
    category: 'read_detail',
    requiredPermissions: ['inventory.product.read', 'inventory.movement.read'],
    sourceModule: 'inventory',
    supportedAgents: ['inventory'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'inventory.list_low_stock',
    description: 'List low-stock inventory items.',
    businessSubjects: ['inventory', 'product'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['inventory.product.read', 'inventory.report.read'],
    sourceModule: 'inventory',
    supportedAgents: ['general', 'inventory'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'inventory.summarize_stock_movements',
    description: 'Summarize inventory movements.',
    businessSubjects: ['inventory', 'product'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['inventory.movement.read'],
    sourceModule: 'inventory',
    supportedAgents: ['inventory'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate', 'productId'],
  },
  {
    name: 'ledger.get_financial_summary',
    description: 'Read ledger financial summary such as net profit and total assets.',
    businessSubjects: ['ledger'],
    questionKinds: ['summary', 'breakdown'],
    category: 'report',
    requiredPermissions: ['ledger.report.read'],
    sourceModule: 'ledger',
    supportedAgents: ['general', 'cfo'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'expense.list_recent',
    description: 'Read expense totals and bounded records for the current month by default or an explicit date range, including dates, vendors, status, payment status, and web links. Optional branchId scopes one branch and accepts a branch id, exact branch name, or branch code; an unrecognized value returns branchUnresolved with availableBranches to re-pick from (match the user wording to a real name and retry with its id, or ask) instead of records.',
    businessSubjects: ['expense'],
    questionKinds: ['summary', 'list', 'detail'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate', 'branchId'],
  },
  {
    name: 'expense.get_detail',
    description: 'Read one branch- and own-scope-safe expense summary without attachment bytes or internal evidence.',
    businessSubjects: ['expense'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['expenseId'],
  },
  {
    // Spec §5.5 (S-3): the answer to "ทำไมยอดนี้ถึงเป็นแบบนี้" about a record THIS chat captured.
    // It reads one record and returns the header, the line groups, the totals identity as real
    // numbers, what the AI assumed or could not verify, and what may still be changed over LINE —
    // never a period total and never a list, which stay with expense.list_recent.
    name: 'expense.explain_record',
    description: 'Explain ONE expense record this user captured through LINE: vendor, date, document number, status, product lines, additional charges such as service charge, discount, the totals identity as real numbers, the values the reader assumed, and how to change it. Use for a "why/how is this bill made up" question about the user\'s own recent record (ทำไม, บิลเมื่อกี้, ใบเสร็จนี้). Never use it for a period total or a list.',
    businessSubjects: ['expense'],
    questionKinds: ['detail', 'explain'],
    category: 'read_detail',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    // FLAT primitives on purpose: the orchestrator's tool-input sanitizer keeps only whitelisted
    // primitive values, so a nested `recordRef` object from the model wire would be dropped. The
    // API adapter accepts BOTH this pair and the spec's nested `{ recordRef: { kind, value } }`.
    // Every field is optional: with none, the tool explains the newest record of THIS chat.
    optionalInputFields: ['recordType', 'recordRefKind', 'recordRefValue'],
  },
  // ── S-4 draft edit over LINE (spec §5.4) ────────────────────────────────────
  // Five tools, one shape. Each one PREVIEWS a change to the record THIS chat captured and returns
  // a `LineDraftUpdatePreview`; none of them writes. The write is the confirm postback, which no
  // model can send. `requiredPermissions` is exactly what the web PATCH takes
  // (`expense.controller.ts` `updateDraft` → `@RequirePermissions('expense.update')`) — LINE never
  // gets a cheaper way to edit than the web form. Inputs are FLAT primitives because the
  // orchestrator's tool-input sanitizer drops anything else, and every one reserves `recordType`
  // (spec §4: income/receipt drafts join later without a contract break).
  {
    name: 'expense.draft.set_header',
    description: 'Preview a header change on the expense draft this chat just captured: document date, vendor name, document number, or a note to append. Returns what would change and the resulting totals; the user must press ยืนยัน before anything is saved. Never use it on a confirmed record.',
    businessSubjects: ['expense'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: ['expense.update'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['recordType', 'expenseDate', 'vendorName', 'documentNumber', 'noteAppend'],
  },
  {
    name: 'expense.draft.set_line',
    description: 'Preview a change to ONE existing line of the expense draft this chat captured: its description, its amount, its VAT treatment, or moving it into an additional-charge field such as ค่าบริการ (chargeKind). Returns what would change and the resulting totals; the user must press ยืนยัน before anything is saved.',
    businessSubjects: ['expense'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: ['expense.update'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['lineNumber'],
    // `chargeKind` is what turns "the OCR wrote service charge as a product line" into a move
    // rather than a duplicate charge (spec §5.4 / J3.3).
    optionalInputFields: ['recordType', 'description', 'amount', 'vatTreatment', 'chargeKind'],
  },
  {
    name: 'expense.draft.add_charge',
    description: 'Preview adding an additional charge (ค่าบริการ, ค่าส่ง, ค่าบรรจุ, ค่าธรรมเนียม, ทิป, ปัดเศษ, อื่น ๆ) to the expense draft this chat captured, given either an exact amount or a percent of the goods subtotal. Returns the computed amount and the resulting totals; the user must press ยืนยัน before anything is saved.',
    businessSubjects: ['expense'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: ['expense.update'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['kind'],
    optionalInputFields: ['recordType', 'amount', 'percentOfSubtotal', 'vatTreatment'],
  },
  {
    name: 'expense.draft.remove_line',
    description: 'Preview removing ONE line — a product line or an additional charge — from the expense draft this chat captured. Returns the resulting totals; the user must press ยืนยัน before anything is saved.',
    businessSubjects: ['expense'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: ['expense.update'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['lineNumber'],
    optionalInputFields: ['recordType'],
  },
  {
    name: 'expense.draft.set_vat_mode',
    description: 'Preview switching how VAT is read on the expense draft this chat captured (VAT excluded, VAT included, or no VAT) and at which rate. Returns the recomputed VAT and totals; the user must press ยืนยัน before anything is saved.',
    businessSubjects: ['expense', 'tax'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: ['expense.update'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['vatMode'],
    optionalInputFields: ['recordType', 'rate'],
  },
  {
    name: 'expense.get_daily_closing',
    description: 'Read a one-day operational expense-closing checklist only: occurred, paid, outstanding, due, overdue, review, evidence, duplicate, and bounded details by currency. Do not use for week, month, or date-range totals.',
    businessSubjects: ['expense'],
    questionKinds: ['summary', 'list', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['date', 'branchId', 'detailLimit'],
  },
  {
    name: 'sales.get_sales_summary',
    description: 'Read recorded customer receipts for a period as the operational sales and cash-received summary.',
    businessSubjects: ['sale', 'payment'],
    questionKinds: ['summary', 'breakdown'],
    category: 'report',
    requiredPermissions: ['crm.report.read'],
    sourceModule: 'accounting-documents',
    supportedAgents: ['general', 'sales', 'cfo'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate', 'branchId'],
  },
  {
    name: 'crm.get_customer_summary',
    description: 'Read scoped customer counts by active, archived, and new-customer status.',
    businessSubjects: ['customer'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['crm.customer.read'],
    sourceModule: 'crm',
    supportedAgents: ['crm', 'sales', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['newSince'],
  },
  {
    name: 'crm.search_customers',
    description: 'Search scoped customers and return bounded display-safe matches with exact total.',
    businessSubjects: ['customer'],
    questionKinds: ['search', 'list'],
    category: 'read_detail',
    requiredPermissions: ['crm.customer.read'],
    sourceModule: 'crm',
    supportedAgents: ['crm', 'sales', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['search', 'status', 'assignedToMe', 'page', 'limit'],
  },
  {
    name: 'crm.get_customer_360',
    description: 'Read a permission-scoped customer 360 summary for one canonical customer id.',
    businessSubjects: ['customer'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: ['crm.customer.read'],
    sourceModule: 'crm',
    supportedAgents: ['crm', 'sales', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['customerId'],
  },
  {
    name: 'crm.get_report_summary',
    description: 'Read the permission-scoped CRM service, response, retention, and customer report for a preset period.',
    businessSubjects: ['crm_report'],
    questionKinds: ['summary', 'breakdown'],
    category: 'report',
    requiredPermissions: ['crm.report.read'],
    sourceModule: 'crm-inbox',
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['branchId', 'period'],
  },
  {
    name: 'crm.get_pipeline_summary',
    description: 'Read open CRM opportunity counts and amounts grouped by pipeline stage.',
    businessSubjects: ['opportunity'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['crm.opportunity.read'],
    sourceModule: 'crm',
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['assignedToMe'],
  },
  {
    name: 'crm.list_open_followups',
    description: 'List bounded open CRM follow-up tasks using current owner and assignment scope.',
    businessSubjects: ['follow_up', 'customer'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['crm.follow_up.read'],
    sourceModule: 'crm',
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['view', 'customerId', 'opportunityId', 'assignedToMe', 'limit'],
  },
  {
    name: 'crm.get_booking_summary',
    description: 'Read exact booking counts by status for the canonical Bangkok week and scoped branch.',
    businessSubjects: ['booking'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['crm.booking.read'],
    sourceModule: 'crm',
    featureKeys: ['crm.bookings'],
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['weekStart', 'branchId'],
  },
  {
    name: 'crm.list_bookings',
    description: 'List bounded display-safe bookings for the canonical Bangkok week and scoped branch.',
    businessSubjects: ['booking'],
    questionKinds: ['list', 'detail'],
    category: 'read_detail',
    requiredPermissions: ['crm.booking.read'],
    sourceModule: 'crm',
    featureKeys: ['crm.bookings'],
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['weekStart', 'branchId', 'limit'],
  },
  {
    name: 'crm.get_inbox_summary',
    description: 'Read visibility-scoped CRM inbox totals, status counts, overdue, assigned, and unassigned counts.',
    businessSubjects: ['conversation'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['crm.inbox.read'],
    sourceModule: 'crm-inbox',
    featureKeys: ['crm.inbox'],
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'crm.list_conversations',
    description: 'List bounded display-safe CRM conversations using current inbox visibility and assignment scope.',
    businessSubjects: ['conversation'],
    questionKinds: ['search', 'list'],
    category: 'read_detail',
    requiredPermissions: ['crm.inbox.read'],
    sourceModule: 'crm-inbox',
    featureKeys: ['crm.inbox'],
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['status', 'search', 'overdue', 'assignee', 'customerId', 'limit'],
  },
  {
    name: 'crm.get_conversation_summary',
    description: 'Read one scoped CRM conversation summary with bounded customer-visible message previews and no internal notes.',
    businessSubjects: ['conversation'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: ['crm.inbox.read'],
    sourceModule: 'crm-inbox',
    featureKeys: ['crm.inbox'],
    supportedAgents: ['crm', 'sales'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['conversationId'],
  },
  {
    name: 'crm.suggest_sales_followups',
    description: 'Suggest CRM sales follow-ups.',
    businessSubjects: ['follow_up', 'customer'],
    questionKinds: ['list'],
    category: 'suggestion',
    requiredPermissions: ['crm.customer.read'],
    sourceModule: 'crm-sales',
    supportedAgents: ['sales', 'crm'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'accounting.capture_receipt_evidence',
    description: 'Create or review receipt or tax-invoice evidence draft from supplied evidence.',
    businessSubjects: ['expense', 'accounting_document'],
    questionKinds: ['detail'],
    category: 'evidence_capture',
    requiredPermissions: ['expense.receipt.upload'],
    sourceModule: 'expenses',
    featureKeys: ['expenses.upload'],
    supportedAgents: ['accounting'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['attachments'],
  },
  // ── Item 10B receipt / accounting agents ────────────────────────────────────
  // ponytail: these tools are in LINE_TOOL_REGISTRY for routing; ERP endpoints
  //           are not yet implemented – ErpToolClient returns unsupported_module.
  // ponytail: supportedAgents=[] so legacy selectTools (item 07) never returns these;
  //           orchestrator agents find them by name via ALLOWED_TOOLS set.
  {
    name: 'accounting.get_summary',
    description: 'Read accounting document counts and totals.',
    businessSubjects: ['accounting_document'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: [...ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS],
    sourceModule: 'accounting-documents',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate'],
  },
  {
    name: 'accounting.list_recent_documents',
    description: 'List recent issued accounting documents with totals and status.',
    businessSubjects: ['accounting_document'],
    questionKinds: ['list'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: [...ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS],
    sourceModule: 'accounting-documents',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate', 'documentType'],
  },
  {
    name: 'accounting.get_document_detail',
    description: 'Read bounded display-safe details for one company-scoped accounting document.',
    businessSubjects: ['accounting_document'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: [],
    anyOfPermissions: [...ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS],
    sourceModule: 'accounting-documents',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['documentId'],
  },
  {
    name: 'accounting.get_receivable_summary',
    description: 'Read exact open non-void invoice counts and outstanding totals grouped by currency.',
    businessSubjects: ['accounting_document', 'payment'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: [...ACCOUNTING_DOCUMENT_VIEW_PERMISSIONS],
    sourceModule: 'accounting-documents',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'procurement.get_ap_outstanding',
    description: 'Read unpaid supplier amounts and top outstanding suppliers.',
    businessSubjects: ['procurement', 'supplier'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['procurement.ap.report'],
    sourceModule: 'procurement',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'procurement.get_summary',
    description: 'Read exact purchase-order record counts by status for a bounded period and permitted branch; monetary aggregate is explicitly unavailable.',
    businessSubjects: ['procurement'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['procurement.purchase_order.read'],
    sourceModule: 'procurement',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate', 'branchId'],
  },
  {
    name: 'procurement.search_suppliers',
    description: 'Search permission-scoped suppliers and return bounded display-safe matches with exact total.',
    businessSubjects: ['supplier'],
    questionKinds: ['search', 'list'],
    category: 'read_detail',
    requiredPermissions: ['procurement.supplier.read'],
    sourceModule: 'procurement',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['search', 'status', 'supplierType', 'page', 'limit'],
  },
  {
    name: 'procurement.get_purchase_order_detail',
    description: 'Read one company- and branch-scoped purchase order with bounded lines and source currency monetary fields.',
    businessSubjects: ['procurement'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: [],
    anyOfPermissions: ['procurement.purchase_order.read', 'procurement.purchase_order.read_related'],
    sourceModule: 'procurement',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['purchaseOrderId'],
  },
  {
    name: 'ledger.get_period_status',
    description: 'Read the canonical accounting-period status and boundaries for one period key.',
    businessSubjects: ['ledger'],
    questionKinds: ['summary', 'detail'],
    category: 'read_detail',
    requiredPermissions: ['ledger.period.read'],
    sourceModule: 'ledger',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['periodKey'],
  },
  {
    name: 'ledger.get_report_summary',
    description: 'Read canonical trial-balance, profit-and-loss, balance-sheet, or combined totals for one accounting period; currency is explicitly unavailable when absent from the source contract.',
    businessSubjects: ['ledger'],
    questionKinds: ['summary', 'breakdown'],
    category: 'report',
    requiredPermissions: ['ledger.report.read', 'ledger.period.read'],
    sourceModule: 'ledger',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['periodKey'],
    optionalInputFields: ['reportType'],
  },
  {
    name: 'company.get_employee_summary',
    description: 'Read employee headcount and counts per role without personal identifiers.',
    businessSubjects: ['employee'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['access.employee.read'],
    sourceModule: 'employee-access',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    // Owner decision 2026-07-05: named-person lookups are allowed for permission holders.
    name: 'company.get_employee_detail',
    description: 'Look up one employee or member by name.',
    businessSubjects: ['employee'],
    questionKinds: ['search', 'detail'],
    category: 'read_detail',
    requiredPermissions: ['access.employee.read'],
    sourceModule: 'employee-access',
    supportedAgents: ['general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['nameQuery'],
  },
  {
    name: 'expense.get_breakdown',
    description: 'Read expense totals grouped by category and branch for a period.',
    businessSubjects: ['expense'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['fromDate', 'toDate'],
  },
  // ---- Registered-but-waiting (owning module not implemented yet; safe unsupported_module reply) ----
  {
    name: 'bank.get_account_balances',
    description: 'Read bank and cash account balances.',
    businessSubjects: ['bank'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['bank.account.read'],
    sourceModule: 'banking',
    supportedAgents: ['accounting', 'cfo'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'bank.get_reconciliation_status',
    description: 'Read bank reconciliation status.',
    businessSubjects: ['bank'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['bank.reconciliation.read'],
    sourceModule: 'banking',
    supportedAgents: ['accounting'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'reimbursement.list_pending_approvals',
    description: 'List reimbursement requests waiting for approval.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    // The approval queue is approver-scoped, not a company-wide read: the web queue
    // (ListApprovalQueueUseCase) requires `reimbursement.approve`, so anything less here would
    // answer over LINE with rows the same person cannot see on the web.
    requiredPermissions: ['reimbursement.approve'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'reimbursement.get_summary',
    description: 'Read an all-company or own-scope reimbursement status and unpaid summary.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'reimbursement.get_detail',
    description: 'Read one permission-scoped reimbursement without attachment or approver identifiers.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['detail'],
    category: 'read_detail',
    requiredPermissions: [],
    anyOfPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['reimbursementId'],
  },
  {
    name: 'hr.get_leave_summary',
    description: 'Read employee leave-day summary.',
    businessSubjects: ['leave'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['hr.leave.read'],
    sourceModule: 'hr',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['nameQuery'],
  },
  {
    name: 'reports.get_monthly_report_summary',
    description: 'Read monthly business report summary.',
    businessSubjects: ['report'],
    questionKinds: ['summary', 'breakdown'],
    category: 'report',
    requiredPermissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run'],
    sourceModule: 'reports',
    supportedAgents: ['general', 'cfo'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['periodKey', 'fromDate', 'toDate'],
  },
  // Receipt intake is a deterministic, API-owned attachment pipeline (persist bytes →
  // classify → OCR → reviewable draft), NOT a model-selectable ERP tool. The former
  // receipt.get_attachment_metadata / create_or_update_evidence_draft / find_duplicate_by_hash /
  // score_authenticity tools and their gateway agents were removed (RECEIPT-01); this also
  // dropped the non-canonical `expense.receipt.read` permission that only they referenced.
  // ── Item 11 tax read-only tools ─────────────────────────────────────────────
  {
    name: 'tax.get_upcoming_tax_obligations',
    description: 'List upcoming and open tax filing obligations with due dates.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['tax.period.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'tax.get_vat_summary',
    description: 'Read VAT summary for the current open period.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['tax.period.read', 'tax.event.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'tax.get_wht_summary',
    description: 'Read withholding-tax summary for the current open period.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['tax.period.read', 'tax.event.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'tax.get_cit_calendar',
    description: 'Read corporate income-tax calendar and key dates.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['tax.period.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'tax.list_missing_tax_documents',
    description: 'List transactions missing tax documents or evidence.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['tax.period.read', 'tax.review_issue.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  // Item 11B company/branch-scoped, read-only tax adapters.
  {
    name: 'tax.get_tax_code_profile',
    description: 'Read the company and effective-dated SAP Tax Code profile; legacy ERP codes can differ from current S/4HANA definitions.',
    businessSubjects: ['tax'],
    questionKinds: ['detail', 'explain'],
    category: 'read_detail',
    requiredPermissions: ['tax.profile.read', 'tax.config.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['externalCode', 'sourceProfileKey', 'direction', 'effectiveDate'],
  },
  {
    name: 'tax.get_transaction_tax_summary',
    description: 'Read configured transaction-tax components and evidence gaps.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'breakdown', 'explain'],
    category: 'read_summary',
    requiredPermissions: ['tax.profile.read', 'tax.period.read', 'tax.report.read', 'tax.event.read', 'tax.review_issue.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['periodKey', 'formType', 'transactionContext', 'branchId'],
  },
  {
    name: 'tax.get_reconciliation_summary',
    description: 'Read persisted tax reconciliation and blocking issue summary.',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'breakdown', 'explain'],
    category: 'report',
    requiredPermissions: ['tax.profile.read', 'tax.period.read', 'tax.report.read', 'tax.event.read', 'ledger.journal.read', 'tax.review_issue.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['periodKey', 'formType', 'branchId'],
  },
  // ── Item 16 Workflow Automation (read-only explanation/summary tools) ──────
  {
    name: 'workflow.explain_run',
    description: 'Explain one workflow automation run.',
    businessSubjects: ['workflow'],
    questionKinds: ['detail', 'explain'],
    category: 'read_detail',
    requiredPermissions: ['workflow.run.read'],
    sourceModule: 'workflow',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['runId'],
  },
  {
    name: 'workflow.list_assigned_tasks',
    description: 'List workflow tasks assigned to the user.',
    businessSubjects: ['workflow'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['workflow.task.read'],
    sourceModule: 'workflow',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'workflow.list_recent_failures',
    description: 'List recent workflow automation failures.',
    businessSubjects: ['workflow'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['workflow.run.read'],
    sourceModule: 'workflow',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'workflow.summarize_rule_health',
    description: 'Summarize workflow automation rule health.',
    businessSubjects: ['workflow'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['workflow.rule.read'],
    sourceModule: 'workflow',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
];
