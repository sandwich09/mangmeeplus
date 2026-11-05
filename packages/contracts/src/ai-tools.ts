// AI Tool contracts – shared by API (tool adapters) and AI Gateway (orchestration).

import type { LineAiBusinessSubject } from './line-ai.js';
import { EXPENSE_PAYMENT_STATUSES, EXPENSE_STATUSES } from './expenses.js';

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
export const LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES = [
  'reimbursement.draft.get_options',
  'reimbursement.draft.preview_create',
  'reimbursement.draft.preview_update',
] as const;
const LINE_REIMBURSEMENT_DRAFT_TOOL_NAME_SET: ReadonlySet<string> = new Set(LINE_REIMBURSEMENT_DRAFT_TOOL_NAMES);

export function lineToolRegistryFor(flags: { draftEditEnabled?: boolean; publicLookupEnabled?: boolean; reimbursementDraftWriteEnabled?: boolean } = {}): ToolMeta[] {
  const allowed = new Set(allowedToolCategories(flags));
  return LINE_TOOL_REGISTRY.filter((tool) => tool.executionReady !== false && (tool.name !== 'public.lookup' || flags.publicLookupEnabled === true)
    && (tool.name === 'expense.action.preview' || tool.name === 'counterparty.action.preview' || tool.name === 'company.action.preview' || (LINE_REIMBURSEMENT_DRAFT_TOOL_NAME_SET.has(tool.name)
      ? flags.reimbursementDraftWriteEnabled === true
      : allowed.has(tool.category) || !DYNAMIC_TOOL_CATEGORIES.has(tool.category))));
}

/** Categories whose presence depends on a runtime flag. Everything else keeps its existing
 *  visibility; known unwired entries are metadata only and are not offered for execution. */
const DYNAMIC_TOOL_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>([LINE_DRAFT_UPDATE_TOOL_CATEGORY]);

export type ToolResultStatus = 'ok' | 'forbidden' | 'unsupported_module' | 'unavailable' | 'error';

export type SourceRef = {
  /** Stable API-issued locator used by typed facts; never supplied by the model. */
  id?: string;
  label: string;
  module: string;
  entityType: string;
  entityId?: string;
  asOf?: string;
  permissionChecked: true;
  /** ACTION locators are permission-checked operation receipts, not ERP read evidence. */
  sourceType?: 'ERP_READ' | 'ACTION';
  webPath?: string;
};

export type SourceFact = {
  id: string;
  metric: string;
  /** Canonical decimal/integer string. Null means unknown, never zero. */
  value: string | null;
  unit: 'money' | 'count' | 'percent';
  currency: string | null;
  period: { startDate: string; endDate: string; timezone: string } | null;
  dateBasis: string;
  statusBasis: string;
  sourceRefIds: string[];
  asOf: string;
  state: 'known' | 'empty' | 'unknown' | 'conflict';
};

export type ToolResultCompleteness = {
  aggregate: 'complete' | 'partial' | 'unknown';
  rows: { returned: number; hasMore: boolean; nextCursor: string | null };
  groups: { returned: number; hasMore: boolean; nextCursor: string | null };
  /** A complete source query cannot prove that every real-world record was entered. */
  businessRecording: 'unknown';
};

export type ToolQueryApplied = {
  timezone: string;
  period?: { startDate: string; endDate: string; timezone: string; defaulted: boolean; periodKey?: string };
  branch?: { mode: 'all_authorized' | 'selected' | 'central'; branchId: string | null };
  dateBasis: string;
  statusBasis: string;
  dataset: string;
  filters?: Record<string, string | number | boolean | null | readonly string[]>;
  /** Item 1 (spec R-A1 row 18): the caller's own effective read scope, from the SAME permission
   *  logic that already narrows the query (never inferred downstream) — 'company' when the caller
   *  can read every record, 'related' when narrowed to records tied to the caller's own relation,
   *  'own' when narrowed to only the caller's own records. Omitted keeps existing tools byte-identical. */
  accessScope?: 'own' | 'related' | 'company';
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
  /** Additive v2 source semantics. Legacy consumers may keep reading `data`. */
  queryApplied?: ToolQueryApplied;
  basisVersion?: string;
  facts?: SourceFact[];
  completeness?: ToolResultCompleteness;
};

export type ToolMeta = {
  name: string;
  /** Explicitly false until a callable permission-checked tool handler exists; API intake is separate. */
  executionReady?: boolean;
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
  /** Exact canonical string values accepted for enum fields. Model-facing catalogs expose these
   *  values; Gateway normalization may only choose a unique case-insensitive match from this list. */
  inputEnumValues?: Readonly<Record<string, readonly string[]>>;
  /** Inclusive character-length bounds for free-text input fields (e.g. a name the model copies
   *  from the user's message). Enforced generically by the internal tools executor. */
  inputLengthLimits?: Readonly<Record<string, { min: number; max: number }>>;
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
  // These tools have shared feature gates, but do not grant sales or general tax reporting.
  { id: 'counterparties', featureKeys: [], toolNames: ['counterparty.search', 'counterparty.get_detail', 'counterparty.action.preview'] },
  { id: 'company_management', featureKeys: [], toolNames: ['company.action.preview'] },
  { id: 'team', featureKeys: [], sourceModules: ['employee-access'], requiredPermissions: ['access.employee.read'] },
  { id: 'tax_documents', featureKeys: ['wht_50bis', 'wht_pnd53'], toolNames: ['voucher.list_recent', 'voucher.get_detail', 'wht.get_month_summary', 'wht.calculate_withholding'] },
  // billing.get_package_usage is offered to every assistant user so a non-manager reaches its typed
  // refusal; only someone who manages the package is told the assistant answers it (owner 2026-09-30).
  // billing.get_package_catalog (package prices and contents, for anyone) shares the module and adds no line.
  { id: 'package', featureKeys: [], sourceModules: ['billing'], requiredPermissions: ['company.plan.manage'] },
] as const satisfies ReadonlyArray<{
  id: string;
  featureKeys: readonly string[];
  /** Matched in addition to featureKeys, for modules that are deliberately not feature-gated. */
  sourceModules?: readonly string[];
  /** Explicit ownership prevents shared feature gates from advertising unrelated capabilities. */
  toolNames?: readonly string[];
  /** Advertised only to a caller holding all of these, when the tool itself answers others with a refusal. */
  requiredPermissions?: readonly string[];
}>;

export type LineCapabilityGroupId = (typeof LINE_CAPABILITY_GROUPS)[number]['id'];

/** How-to entries are navigation only. Their commands re-enter the metered intake and normal business guards. */
export const LINE_CHAT_ACTIONS = [
  { id: 'expense_capture', group: 'expenses', title: 'บันทึกค่าใช้จ่าย', command: 'ช่วยบันทึกค่าใช้จ่ายให้หน่อย', sentence: 'ส่งใบเสร็จหรือบอกรายละเอียด แล้วน้องช่วยเตรียมค่าใช้จ่ายให้ตรวจค่ะ', permission: 'expense.create', tool: '', helpTopics: ['expense.start'], responsible: 'ผู้มีสิทธิ์บันทึกค่าใช้จ่าย' },
  { id: 'reimbursement_claim', workflow: true, group: 'expenses', title: 'สร้างใบเบิก', command: 'ช่วยสร้างใบเบิกให้หน่อย', sentence: 'บอกรายการที่สำรองจ่าย แล้วน้องช่วยเตรียมใบเบิกให้ตรวจค่ะ', permission: 'reimbursement.create', tool: 'reimbursement.draft.get_options', helpTopics: ['reimbursement.meaning', 'reimbursement.roles'], responsible: 'ผู้มีสิทธิ์สร้างใบเบิก' },
  { id: 'payment_voucher', workflow: true, group: 'expenses', title: 'สร้างใบเตรียมจ่าย', command: 'ช่วยสร้างใบเตรียมจ่ายให้หน่อย', sentence: 'เลือกรายจ่ายของผู้รับเงินคนเดียวกันที่ยืนยันแล้วเพื่อเตรียมใบให้ตรวจค่ะ', permission: 'expense.disbursement.prepare', tool: 'expense.action.preview', helpTopics: ['voucher.meaning'], responsible: 'ผู้มีสิทธิ์จัดทำใบเตรียมจ่าย' },
  { id: 'wht_certificate', workflow: true, group: 'tax_documents', title: 'ออก 50 ทวิ', command: 'ช่วยออก 50 ทวิให้หน่อย', sentence: 'เลือกรายจ่ายที่หักภาษีไว้ แล้วตรวจชื่อ เลขผู้เสียภาษี และที่อยู่ผู้รับเงินก่อนให้น้องเตรียมหนังสือรับรอง 50 ทวิให้กดยืนยันเองค่ะ', permission: 'wht.certificate.issue', tool: 'expense.action.preview', helpTopics: ['wht.certificate-meaning'], responsible: 'ผู้มีสิทธิ์ออกหนังสือรับรอง' },
  { id: 'pnd53', group: 'tax_documents', title: 'ดูสรุป ภ.ง.ด.53', command: 'ขอสรุป ภ.ง.ด.53 เดือนนี้', sentence: 'น้องช่วยสรุปภาษีหัก ณ ที่จ่ายของเดือนที่ต้องการให้ตรวจได้ค่ะ', permission: 'wht.pnd53.read', tool: 'wht.get_month_summary', helpTopics: ['wht.pnd53-due'], responsible: 'ผู้มีสิทธิ์ดู ภ.ง.ด.53' },
  { id: 'payout_account', group: 'expenses', title: 'เพิ่มบัญชีรับเงินคืนของฉัน', command: '', sentence: 'เพิ่มบัญชีรับเงินคืนของคุณที่หน้าบัญชีรับเงินคืนบนเว็บได้เลยค่ะ', permission: 'reimbursement.create', tool: '', helpTopics: [], responsible: 'ผู้มีสิทธิ์สร้างใบเบิก', webPath: '/companies/{companyId}/reimbursements/payout-account' },
  { id: 'counterparty', group: 'counterparties', title: 'เพิ่มคู่ค้า ผู้ขาย หรือผู้รับเงิน', command: 'ช่วยเพิ่มคู่ค้าให้หน่อย', sentence: 'บอกชื่อคู่ค้าและข้อมูลที่มี แล้วน้องช่วยเตรียมให้ตรวจและกดยืนยันเองค่ะ', permission: 'accounting.counterparty.manage', tool: 'counterparty.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์จัดการคู่ค้า' },
  { id: 'team_member', group: 'company_management', title: 'เพิ่มพนักงาน', command: 'ช่วยเพิ่มพนักงานให้หน่อย', sentence: 'บอกชื่อพนักงานและหน้าที่ แล้วน้องช่วยเตรียมสิทธิ์ให้ตรวจและกดยืนยันเองค่ะ', permission: 'access.employee.create', tool: 'company.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์เพิ่มพนักงาน' },
  { id: 'branch', group: 'company_management', title: 'เพิ่มสาขา', command: 'ช่วยเพิ่มสาขาให้หน่อย', sentence: 'บอกชื่อสาขาและข้อมูลที่มี แล้วน้องช่วยเตรียมสาขาให้ตรวจและกดยืนยันเองค่ะ', permission: 'company.branch.manage', tool: 'company.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์จัดการสาขา' },
  { id: 'branch_edit', group: 'company_management', title: 'แก้ไขข้อมูลสาขา', command: 'ช่วยแก้ไขข้อมูลสาขาให้หน่อย', sentence: 'บอกชื่อสาขาและข้อมูลที่ต้องการแก้ไข แล้วน้องช่วยเตรียมให้ตรวจค่ะ', permission: 'company.branch.manage', tool: 'company.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์จัดการสาขา' },
  { id: 'package_purchase', group: 'package', title: 'ซื้อหรือเปลี่ยนแพ็กเกจ', command: 'ขอเปลี่ยนแพ็กเกจ', sentence: 'เลือกแพ็กเกจ แล้วน้องช่วยเตรียมคำขอซื้อให้ตรวจค่ะ', permission: 'company.plan.manage', tool: 'billing.get_package_usage', helpTopics: [], responsible: 'ผู้มีสิทธิ์จัดการแพ็กเกจ' },
  { id: 'substitute_receipt', workflow: true, group: 'expenses', title: 'ทำใบรับรองแทนใบเสร็จ', command: 'ช่วยทำใบรับรองแทนใบเสร็จให้หน่อย', sentence: 'เลือกรายการ แล้วตรวจข้อมูลก่อนเตรียมใบรับรองแทนใบเสร็จค่ะ', permission: 'expense.review', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์เตรียมใบรับรองแทนใบเสร็จ' },
  { id: 'reimbursement_submit', workflow: true, group: 'expenses', title: 'ส่งใบเบิกอนุมัติ', command: 'ช่วยส่งใบเบิกอนุมัติให้หน่อย', sentence: 'เลือกใบเบิกที่ตรวจครบ แล้วน้องเตรียมปุ่มส่งอนุมัติให้ค่ะ', permission: 'reimbursement.submit', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ส่งใบเบิกอนุมัติ' },
  { id: 'reimbursement_cancel', workflow: true, group: 'expenses', title: 'ยกเลิกใบเบิก', command: 'ช่วยยกเลิกใบเบิกให้หน่อย', sentence: 'เลือกใบเบิกที่ต้องการยกเลิก แล้วตรวจข้อมูลก่อนกดยืนยันค่ะ', permission: 'reimbursement.cancel_own', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ยกเลิกใบเบิก' },
  { id: 'reimbursement_reject', workflow: true, group: 'expenses', title: 'ไม่อนุมัติใบเบิก', command: 'ช่วยไม่อนุมัติใบเบิกให้หน่อย', sentence: 'เลือกใบเบิกและบอกเหตุผล แล้วตรวจข้อมูลก่อนกดไม่อนุมัติค่ะ', permission: 'reimbursement.reject', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ไม่อนุมัติใบเบิก' },
  { id: 'reimbursement_pay', workflow: true, group: 'expenses', title: 'บันทึกจ่ายคืนใบเบิก', command: 'ช่วยบันทึกจ่ายคืนใบเบิกให้หน่อย', sentence: 'เลือกใบเบิกที่พร้อมจ่ายและส่งหลักฐานการจ่าย แล้วตรวจข้อมูลก่อนกดยืนยันค่ะ', permission: 'reimbursement.payment.record', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์บันทึกจ่ายคืนใบเบิก' },
  { id: 'expense_submit', workflow: true, group: 'expenses', title: 'ส่งตรวจค่าใช้จ่าย', command: 'ช่วยส่งตรวจค่าใช้จ่ายให้หน่อย', sentence: 'เลือกค่าใช้จ่ายที่ตรวจครบ แล้วน้องเตรียมปุ่มส่งตรวจให้ค่ะ', permission: 'expense.update', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ส่งตรวจค่าใช้จ่าย' },
  { id: 'expense_confirm', workflow: true, group: 'expenses', title: 'ยืนยันค่าใช้จ่าย', command: 'ช่วยยืนยันรายการค่าใช้จ่ายให้หน่อย', sentence: 'เลือกค่าใช้จ่ายและตรวจหลักฐานให้ครบ แล้วกดยืนยันเอกสารค่ะ', permission: 'expense.confirm', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ยืนยันค่าใช้จ่าย' },
  { id: 'expense_delete', workflow: true, group: 'expenses', title: 'ลบร่างค่าใช้จ่าย', command: 'ช่วยลบร่างค่าใช้จ่ายให้หน่อย', sentence: 'เลือกร่างค่าใช้จ่าย แล้วตรวจรายการก่อนกดยืนยันการลบค่ะ', permission: 'expense.update', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ลบร่างค่าใช้จ่าย' },
  { id: 'expense_void', workflow: true, group: 'expenses', title: 'ยกเลิกค่าใช้จ่าย', command: 'ช่วยยกเลิกรายการค่าใช้จ่ายให้หน่อย', sentence: 'เลือกค่าใช้จ่ายและบอกเหตุผล แล้วตรวจรายการก่อนกดยืนยันการยกเลิกค่ะ', permission: 'expense.void', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์ยกเลิกค่าใช้จ่าย' },
  { id: 'expense_pay', workflow: true, group: 'expenses', title: 'บันทึกจ่ายค่าใช้จ่าย', command: 'ช่วยบันทึกจ่ายค่าใช้จ่ายให้หน่อย', sentence: 'เลือกค่าใช้จ่ายและส่งหลักฐานการจ่าย แล้วตรวจข้อมูลก่อนกดยืนยันค่ะ', permission: 'expense.payment.record', tool: 'expense.action.preview', helpTopics: [], responsible: 'ผู้มีสิทธิ์บันทึกจ่ายค่าใช้จ่าย' },
  { id: 'approvals', workflow: true, group: 'expenses', title: 'อนุมัติใบเบิก', command: 'ขอดูใบเบิกที่รอฉันอนุมัติ', sentence: 'เลือกใบเบิกที่รอคุณอนุมัติ แล้วตรวจรายละเอียดก่อนยืนยันค่ะ', permission: 'reimbursement.approve', tool: 'reimbursement.list_pending_approvals', helpTopics: [], responsible: 'ผู้อนุมัติใบเบิกที่ได้รับมอบหมาย' },
  {"id": "expense_search", "group": "expenses", "title": "ค้นหาค่าใช้จ่ายหรือบิล", "command": "ช่วยค้นหาค่าใช้จ่ายให้หน่อย", "sentence": "บอกบิลหรือช่วงเวลาที่ต้องการ แล้วน้องช่วยค้นให้ตามสิทธิ์ค่ะ", "permission": "expense.read_own", "tool": "expense.list_recent", "helpTopics": ["expense.find"], "responsible": "ผู้มีสิทธิ์ดูค่าใช้จ่าย"},
  {"id": "sales", "group": "sales", "title": "ดูยอดขายหรือเอกสารขาย", "command": "ช่วยดูยอดขายให้หน่อย", "sentence": "บอกช่วงเวลาที่ต้องการ แล้วน้องช่วยดูยอดขายให้ค่ะ", "permission": "crm.report.read", "tool": "sales.get_sales_summary", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูยอดขาย"},
  {"id": "finance", "group": "finance", "title": "ดูรายงานการเงิน", "command": "ช่วยดูรายงานการเงินให้หน่อย", "sentence": "บอกช่วงเวลาที่ต้องการ แล้วน้องช่วยดูรายงานการเงินให้ค่ะ", "permission": "ledger.report.read", "tool": "ledger.get_financial_summary", "helpTopics": ["report.access"], "responsible": "ผู้มีสิทธิ์ดูรายงานการเงิน"},
  {"id": "tax", "group": "tax", "title": "ดูงานภาษีที่ต้องทำ", "command": "ช่วยดูงานภาษีที่ต้องทำให้หน่อย", "sentence": "บอกช่วงเวลาที่ต้องการ แล้วน้องช่วยดูงานภาษีให้ค่ะ", "permission": "tax.period.read", "tool": "tax.get_upcoming_tax_obligations", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูงานภาษี"},
  {"id": "inventory", "group": "inventory", "title": "ค้นหาสินค้าหรือดูสต็อก", "command": "ช่วยค้นหาสินค้าให้หน่อย", "sentence": "บอกชื่อสินค้า แล้วน้องช่วยค้นให้ตามสิทธิ์ค่ะ", "permission": "inventory.product.read", "tool": "inventory.search_products", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูสินค้า"},
  {"id": "customers", "group": "customers", "title": "ค้นหาลูกค้า", "command": "ช่วยค้นหาลูกค้าให้หน่อย", "sentence": "บอกชื่อลูกค้า แล้วน้องช่วยค้นให้ตามสิทธิ์ค่ะ", "permission": "crm.customer.read", "tool": "crm.search_customers", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูลูกค้า"},
  {"id": "bookings", "group": "bookings", "title": "ดูรายการจอง", "command": "ช่วยดูรายการจองให้หน่อย", "sentence": "บอกช่วงเวลาที่ต้องการ แล้วน้องช่วยดูรายการจองให้ค่ะ", "permission": "crm.booking.read", "tool": "crm.list_bookings", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูรายการจอง"},
  {"id": "procurement", "group": "procurement", "title": "ดูงานจัดซื้อ", "command": "ช่วยดูงานจัดซื้อให้หน่อย", "sentence": "บอกช่วงเวลาที่ต้องการ แล้วน้องช่วยดูงานจัดซื้อให้ค่ะ", "permission": "procurement.purchase_order.read", "tool": "procurement.get_summary", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูงานจัดซื้อ"},
  {"id": "alerts", "group": "alerts", "title": "ดูงานแจ้งเตือน", "command": "ช่วยดูงานแจ้งเตือนให้หน่อย", "sentence": "น้องช่วยดูงานแจ้งเตือนที่คุณมีสิทธิ์เปิดได้ค่ะ", "permission": "notification.read", "tool": "notifications.list_open_alerts", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูงานแจ้งเตือน"},
  {"id": "team", "group": "team", "title": "ดูข้อมูลทีมงาน", "command": "ช่วยดูข้อมูลทีมงานให้หน่อย", "sentence": "บอกข้อมูลทีมงานที่ต้องการ แล้วน้องช่วยค้นให้ตามสิทธิ์ค่ะ", "permission": "access.employee.read", "tool": "company.get_employee_summary", "helpTopics": [], "responsible": "ผู้มีสิทธิ์ดูข้อมูลพนักงาน"},
] as const;
export type LineChatActionId = (typeof LINE_CHAT_ACTIONS)[number]['id'];
export function lineChatAction(value: unknown) { return LINE_CHAT_ACTIONS.find(action => action.id === value); }
/** Navigation is offered for an existing action permission or a verified frozen assignment. */
export function mayOfferWorkflow(id: unknown, permissions: readonly string[], entitled: ReadonlySet<string> | null,
  options: { freeExpenseDrafts?: boolean; assignedApprover?: boolean } = {}): boolean {
  const action = lineChatAction(id);
  if (!action || !('workflow' in action) || !action.workflow || options.freeExpenseDrafts
    || entitled !== null && !entitled.has('expenses')) return false;
  const has = (...keys: string[]) => keys.some(key => permissions.includes(key));
  switch (action.id) {
    case 'expense_submit': return has('expense.review', 'expense.update');
    case 'expense_delete': return has('expense.delete', 'expense.update');
    case 'reimbursement_cancel': return has('reimbursement.cancel_own', 'reimbursement.finance_review');
    case 'approvals': return has('reimbursement.approve') || options.assignedApprover === true;
    case 'reimbursement_reject': return has('reimbursement.reject') || options.assignedApprover === true;
    case 'substitute_receipt': return has('expense.read', 'expense.read_own', 'expense.read_related', 'expense.review', 'expense.confirm');
    case 'wht_certificate': return has('wht.certificate.issue') && (entitled === null || entitled.has('wht_50bis'));
    default: return has(action.permission);
  }
}

export function canUseLineChatAction(id: unknown, permissions: readonly string[], entitled: ReadonlySet<string> | null): boolean {
  const action = lineChatAction(id);
  if (!action) return false;
  if (action.id === 'expense_capture') return canAdvertiseReceiptCapture(permissions, entitled);
  if (action.id !== 'expense_search' && !permissions.includes(action.permission)) return false;
  if (action.id === 'payout_account') return true;
  const tool = LINE_TOOL_REGISTRY.find(tool => tool.name === action.tool);
  return !!tool && tool.executionReady !== false && hasToolPermissions(tool, permissions) && hasToolFeature(tool, entitled)
    && (action.id !== 'wht_certificate' || entitled === null || entitled.has('wht_50bis'))
    && (action.id !== 'pnd53' || entitled === null || entitled.has('wht_pnd53'));
}

/**
 * Opening words of every capability self-description the gateway renders — the card and its teaching
 * walkthrough (capability-help spec §8 / §8.1), Thai and English. The API recognises a "ยังไง"/"how"
 * follow-up from the stored reply preview alone, so these openings are a contract between the two apps:
 * the gateway spec pins its copy against this list and the API matches on it.
 */
export const LINE_CAPABILITY_NO_ACCESS_TH = 'ตอนนี้บัญชีของคุณยังไม่มีรายการที่น้องมั่งมีเปิดให้ผ่าน LINE ได้ค่ะ กรุณาให้ผู้มีสิทธิ์จัดการบทบาทตรวจสิทธิ์ของคุณ และให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจเมนูที่ร้านเปิดใช้นะคะ';
export const LINE_FEATURE_DISABLED_HELP_TH = 'หากต้องการใช้ ให้ผู้มีสิทธิ์จัดการแพ็กเกจตรวจแพ็กเกจหรือติดต่อทีมงานนะคะ';

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
    (tool) => tool.executionReady !== false && hasToolPermissions(tool, permissions) && hasToolFeature(tool, entitled),
  );
  return LINE_CAPABILITY_GROUPS.filter((group) => usable.some((tool) => inCapabilityGroup(tool, group, entitled))
    && (!('requiredPermissions' in group) || group.requiredPermissions.every((permission) => permissions.includes(permission))))
    .map((group) => group.id);
}

/** Explicit tool ownership takes precedence over feature/module grouping; only entitled features count. */
export function inCapabilityGroup(
  tool: Pick<ToolMeta, 'name' | 'featureKeys' | 'sourceModule'>,
  group: { featureKeys: readonly string[]; sourceModules?: readonly string[]; toolNames?: readonly string[] },
  entitled: ReadonlySet<string> | null = null,
): boolean {
  if (group.toolNames) return group.toolNames.includes(tool.name)
    && (entitled === null || group.featureKeys.length === 0 || group.featureKeys.some((key) => entitled.has(key)));
  if (LINE_CAPABILITY_GROUPS.some((candidate) => 'toolNames' in candidate && candidate.toolNames.some((name) => name === tool.name))) return false;
  return toolFeatureKeys(tool).some((key) => group.featureKeys.includes(key) && (entitled === null || entitled.has(key)))
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
    description: 'Read expense totals and bounded records for the current month by default or an explicit date range, including dates, vendors, status, payment status, and web links. Optional branchId scopes one branch and accepts a branch id, exact branch name, or branch code; an unrecognized value returns branchUnresolved with availableBranches to re-pick from (match the user wording to a real name and retry with its id, or ask) instead of records. Optional categoryName/vendorName resolve a free-text category or vendor name the same way: exactly one match filters by it, several matches return categoryAmbiguous/vendorAmbiguous with availableCategories/availableVendors to disambiguate, and no match returns categoryUnresolved/vendorUnresolved with the available names, instead of records.',
    businessSubjects: ['expense'],
    questionKinds: ['summary', 'list', 'detail'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId', 'categoryId', 'vendorId', 'categoryName', 'vendorName', 'documentStatus', 'paymentStatus', 'limit', 'cursor'],
    inputEnumValues: { documentStatus: EXPENSE_STATUSES, paymentStatus: EXPENSE_PAYMENT_STATUSES },
    inputLengthLimits: { categoryName: { min: 1, max: 80 }, vendorName: { min: 1, max: 80 } },
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
    description: 'Explain ONE expense record this user captured through LINE: vendor, date, document number, status, product lines, additional charges such as service charge, discount, the totals identity as real numbers, the values the reader assumed, and how to change it. Use for a "why/how is this bill made up" question about the user\'s own recent record (ทำไม, บิลเมื่อกี้, ใบเสร็จนี้), and for whether that record was saved, what state it is in now, or seeing it again (บันทึกไปยัง, สรุปบันทึกไหม, ขอดูข้อมูลเดิม, อันเมื่อกี้เป็นยังไง) — with no input it reads the newest record of THIS chat. Never use it for a period total or a list.',
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
  {
    // Capture appendix §10.1 (spec §17.5): "ไฟล์เมื่อกี้ทำไมส่งไม่ได้" about a file that may never
    // have become an expense at all. `expense.explain_record` cannot answer it — a rejection
    // BEFORE capture has no expense to explain. Read-only, no OCR, no mutation: it returns the
    // recorded attempts and the API composes every sentence from its own templates.
    name: 'line.explain_file_attempt',
    description: 'Explain what happened to a file or photo this user sent in THIS LINE chat — whether it was received, rejected before it could be stored (too large, unsupported type, security, download failure), stored and being read, or read and finished. Use for "ไฟล์เมื่อกี้ส่งไม่ได้เพราะอะไร", "ใหญ่ไปหรือเปล่า", "รองรับ PDF ไหม", "ต้องส่งใหม่ไหม", "บันทึกไปหรือยัง". Never use it for a period total, a list of expenses, or a document that was never sent over LINE.',
    businessSubjects: ['expense'],
    questionKinds: ['detail', 'explain'],
    category: 'read_detail',
    requiredPermissions: [],
    anyOfPermissions: ['expense.receipt.line_upload', 'expense.receipt.upload', 'expense.create'],
    sourceModule: 'line-ai',
    // `line-ai` has no module default, and an ungated tool is not what this reads: every attempt it
    // explains is evidence for an expense, so the expenses feature is the honest gate.
    featureKeys: ['expenses'],
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    // Flat primitives, like `expense.explain_record`: with none, it answers for this chat's
    // most recent attempts. `attemptRef` picks one out of an ambiguity list already shown.
    optionalInputFields: ['attemptRef'],
  },
  {
    name: 'counterparty.search',
    description: 'Search คู่ค้า/ผู้รับเงิน by a name or tax-ID fragment (at most 10). This is the accounting counterparty registry available to starter shops, independent of procurement suppliers. Use the exact returned id for detail or an update preview.',
    businessSubjects: ['supplier', 'expense', 'accounting_document'], questionKinds: ['search', 'list'], category: 'read_detail',
    requiredPermissions: ['accounting.counterparty.read'], sourceModule: 'accounting-documents', featureKeys: ['expenses', 'sales_documents'],
    supportedAgents: ['accounting', 'cfo', 'general'], sensitiveAudit: true, requiresErpPermissionCheck: true, optionalInputFields: ['search'],
  },
  {
    name: 'counterparty.get_detail',
    description: 'Read a counterparty/payee name, tax ID, address, tax branch code and entity kind using the web permission guards. No bank account is exposed by this registry. Copy counterpartyId from counterparty.search or a shown expense vendorCounterpartyId.',
    businessSubjects: ['supplier', 'expense', 'accounting_document'], questionKinds: ['detail'], category: 'read_detail', requiredPermissions: [],
    anyOfPermissions: ['accounting.counterparty.read', 'accounting.counterparty.manage', 'expense.read_related', 'accounting.document.read_related', 'expense.create', 'expense.update', 'expense.review', 'expense.receipt.upload', 'expense.receipt.line_upload'],
    sourceModule: 'accounting-documents', featureKeys: ['expenses', 'sales_documents'], supportedAgents: ['accounting', 'cfo', 'general'], sensitiveAudit: true, requiresErpPermissionCheck: true, requiredInputFields: ['counterpartyId'],
  },
  {
    name: 'counterparty.action.preview',
    description: 'Prepare a human confirm card to CREATE or UPDATE คู่ค้า/ผู้รับเงิน. เพิ่มผู้ขาย/เพิ่มคู่ค้า/แก้ไขผู้รับเงิน/อัปเดตซัพพลายเออร์ are registry commands even after a capabilities question or an expense turn; never create an expense for them. Nothing is saved until the user presses its signed button. CREATE needs displayName and accounting.counterparty.manage. UPDATE needs counterpartyId from a read; the web use-case allows a manager or the creator/receipt uploader. Fields: displayName, legalName, taxId, addressText, branchCode (five-digit payee tax branch), entityKind. Show old → new. Ask only for missing values. For a later 50 ทวิ, offer this card to save a missing payee tax ID/address; never change expense draft rules.',
    businessSubjects: ['supplier', 'expense', 'accounting_document'], questionKinds: ['detail'], category: 'draft_update', requiredPermissions: [],
    anyOfPermissions: ['accounting.counterparty.read', 'accounting.counterparty.manage', 'expense.read_related', 'accounting.document.read_related', 'expense.create', 'expense.update', 'expense.review', 'expense.receipt.upload', 'expense.receipt.line_upload'],
    sourceModule: 'accounting-documents', featureKeys: ['expenses', 'sales_documents'], supportedAgents: ['accounting', 'cfo', 'general'], sensitiveAudit: true, requiresErpPermissionCheck: true,
    requiredInputFields: ['action'], optionalInputFields: ['counterpartyId', 'displayName', 'legalName', 'taxId', 'addressText', 'branchCode', 'entityKind'],
    inputLengthLimits: { displayName: { min: 1, max: 255 }, legalName: { min: 0, max: 255 }, addressText: { min: 0, max: 500 }, taxId: { min: 0, max: 32 }, branchCode: { min: 0, max: 16 } },
    inputEnumValues: { action: ['CREATE', 'UPDATE'], entityKind: ['JURISTIC', 'INDIVIDUAL'] },
  },
  {
    name: 'expense.action.preview',
    description: 'For payment vouchers use VOUCHER_CREATE with expenseId (or comma-separated expenseIds, at most 30) from shown expense records; all must be confirmed. Use voucherId ONLY from shownItems of any voucher.* read tool for VOUCHER_SUBMIT, VOUCHER_APPROVE, VOUCHER_RETURN, VOUCHER_PAY, VOUCHER_CANCEL or WHT_CERTIFICATE_ISSUE (paid voucher only). RETURN/CANCEL ask for a reason when missing; certificate asks for the missing payee address in one question. paidAt/paymentMethod describe voucher payment. Existing web use-cases and feature entitlements apply. For reimbursements use reimbursementId and REIMBURSEMENT_SUBMIT, REIMBURSEMENT_CANCEL, REIMBURSEMENT_APPROVE, REIMBURSEMENT_REJECT (ask one short reason question if absent). For claim payment use REIMBURSEMENT_RECORD_PAYMENT: send slip first, then the API prepares the guarded payment card. Copy reimbursementId ONLY from reimbursement.get_summary/get_detail/list_pending_approvals/get_approval_backlog returned items or shownItems. For confirmed expense payment use expenseId and RECORD_PAYMENT; omit paidAmount to use outstanding and paidAt to use Bangkok today, method is optional. A recent slip in this private chat is attached in the same confirmation. Prepare a LINE confirm card for ส่งตรวจ (MARK_READY), ยืนยันรายการ (CONFIRM), ลบร่าง (DELETE_DRAFT), or ยกเลิกรายการ (VOID). Preview only: nothing changes until the user presses the button. Copy expenseId only from conversationContext.recentReads shownItems, activeExpenseDrafts or recentCapturedExpenses. Ask which record if ambiguous. VOID requires the user’s reason; ask why when absent. The API checks the same permissions and status as the web.',
    businessSubjects: ['expense', 'reimbursement', 'tax'], questionKinds: ['detail'], category: 'draft_update',
    requiredPermissions: [],
    anyOfPermissions: ['expense.update', 'expense.review', 'expense.confirm', 'expense.delete', 'expense.void', 'expense.payment.record', 'reimbursement.submit', 'reimbursement.cancel_own', 'reimbursement.finance_review', 'reimbursement.approve', 'reimbursement.reject', 'reimbursement.payment.record', 'reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own', 'expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay', 'wht.certificate.issue'],
    sourceModule: 'expenses', featureKeys: ['expenses'], supportedAgents: ['accounting', 'cfo', 'tax', 'general'],
    sensitiveAudit: true, requiresErpPermissionCheck: true,
    requiredInputFields: ['action'], optionalInputFields: ['expenseId', 'expenseIds', 'voucherId', 'reimbursementId', 'reason', 'paidAmount', 'paidAt', 'paymentMethod'],
    inputEnumValues: { action: ['MARK_READY', 'CONFIRM', 'DELETE_DRAFT', 'VOID', 'RECORD_PAYMENT', 'REIMBURSEMENT_SUBMIT', 'REIMBURSEMENT_CANCEL', 'REIMBURSEMENT_APPROVE', 'REIMBURSEMENT_REJECT', 'REIMBURSEMENT_RECORD_PAYMENT', 'VOUCHER_CREATE', 'VOUCHER_SUBMIT', 'VOUCHER_APPROVE', 'VOUCHER_RETURN', 'VOUCHER_PAY', 'VOUCHER_CANCEL', 'WHT_CERTIFICATE_ISSUE'], paymentMethod: ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'] },
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
    description: 'Preview a header change on the expense draft this chat just captured: document date, vendor name, document number, a note to append, or categoryName for all uncategorized item lines. Returns what would change and the resulting totals; the user must press ยืนยัน before anything is saved. Never use it on a confirmed record.',
    businessSubjects: ['expense'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: ['expense.update'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['recordType', 'expenseDate', 'vendorName', 'documentNumber', 'noteAppend', 'categoryName'],
  },
  {
    name: 'expense.draft.set_line',
    description: 'Preview a change to ONE existing line of the expense draft this chat captured: its description, amount, categoryName, VAT treatment, or moving it into an additional-charge field such as ค่าบริการ (chargeKind). Returns what would change and the resulting totals; the user must press ยืนยัน before anything is saved.',
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
    optionalInputFields: ['recordType', 'description', 'amount', 'vatTreatment', 'chargeKind', 'categoryName'],
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
    description: 'Read a one-day operational expense-closing checklist only: occurred, paid, outstanding, due, overdue, review, evidence, duplicate, and bounded details by currency. Do not use for week, month, or date-range totals. This alone already answers a general "what do I need to do/check today" ("วันนี้มีอะไรต้องทำบ้าง"), "สรุปวันนี้", or "closing วันนี้" question — never also call notifications.list_open_alerts, dashboard.get_business_health_summary, expense.list_substitute_receipts_to_sign, or reimbursement.list_pending_approvals for that same question. Call reimbursement.list_pending_approvals as a separate, additional read only when the user explicitly names pending/รออนุมัติ approvals. Only the caller\'s OWN pending work — a message that says the work is left pending (ค้าง): "มีอะไรค้างที่ฉันต้องทำ", "งานค้างของฉัน" — also reads expense.list_substitute_receipts_to_sign and, when offered, reimbursement.list_pending_approvals.',
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
    // Advisor spec §5.2 (slice S1): the caller's OWN signature queue — never a company-wide list.
    name: 'expense.list_substitute_receipts_to_sign',
    description: 'List substitute receipts (ใบรับรองแทนใบเสร็จรับเงิน) waiting for THIS user\'s own signature: as the named actual payer who must certify, or as an eligible approver who must approve (paper copies waiting to be accepted included). Returns counts per step and up to 10 items each (document number, payee name, amount, date). Signing and approving happen only on the web. Never another person\'s queue and never a company-wide list. A question about this queue ("ใบรับรองที่ฉันต้องเซ็นมีกี่ใบ", "มีใบรับรองรอฉันอนุมัติไหม") is a read, never a request to make a new substitute receipt; a follow-up about the receipts it just listed (which one, whose, how much) reads it again. Never for a general today\'s to-do ("วันนี้มีอะไรต้องทำบ้าง"), which expense.get_daily_closing alone answers.',
    businessSubjects: ['expense'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    // Payer half: the same permissions as the web certify route (expense.controller.ts
    // @RequireAnyPermission('expense.read_related', 'expense.read_own')), so it never lists a receipt the
    // caller cannot open on the web. Approver half: expense.confirm plus eligibility, checked inside the tool.
    requiredPermissions: [],
    anyOfPermissions: ['expense.read_related', 'expense.read_own', 'expense.confirm'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['role', 'limit'],
    inputEnumValues: { role: ['payer', 'approver'] },
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
    optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId'],
  },
  {
    name: 'crm.get_customer_summary',
    description: 'Read scoped customer counts by active, archived, and new-customer status. The new-customer window is [newSince, newUntil] inclusive; it defaults to the current month.',
    businessSubjects: ['customer'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['crm.customer.read'],
    sourceModule: 'crm',
    supportedAgents: ['crm', 'sales', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    // `newUntil` closes the window (period-resolution spec §3.3): with a start only, "ลูกค้าใหม่
    // เดือนที่แล้ว" counted this month's customers too.
    optionalInputFields: ['newSince', 'newUntil'],
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
    executionReady: false,
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
    executionReady: false,
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
    optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId'],
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
    optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId', 'documentType', 'limit'],
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
    description: 'Read exact purchase-order counts and source-currency monetary totals by status for a bounded period and permitted branch.',
    businessSubjects: ['procurement'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['procurement.purchase_order.read'],
    sourceModule: 'procurement',
    supportedAgents: ['accounting', 'cfo', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId'],
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
    name: 'company.get_roles',
    description: 'Read company/system roles and their exact feature-filtered permissions using the web role and menu registry labels. Optional roleName selects a role; employeeName answers what a named employee may do; permissionKey (for example reimbursement.approve) lists active people holding that permission. People reads require access.employee.read too. Explain permissions in plain Thai; never show internal ids or permission codes, and approval still depends on the assigned workflow step.',
    businessSubjects: ['employee', 'company'], questionKinds: ['list', 'detail', 'search', 'explain'], category: 'read_detail',
    requiredPermissions: [], anyOfPermissions: ['access.role.read', 'access.role.manage', 'access.employee.create', 'access.employee.update'],
    sourceModule: 'employee-access', featureKeys: [], supportedAgents: ['general'], sensitiveAudit: true, requiresErpPermissionCheck: true,
    optionalInputFields: ['roleName', 'employeeName', 'permissionKey'],
  },
  {
    name: 'company.action.preview',
    description: 'Prepare a private LINE confirm card only; the user must press to save. EMPLOYEE_CREATE needs displayName, username, dateOfBirth (ISO), identityType, identityNumber, phoneNumber, roleName and branchName (oversight roles use all branches), optional email. Ask only missing web-required fields; never invent identity/date/contact data. EMPLOYEE_UPDATE takes employeeName and roleName and/or branchName. EMPLOYEE_DISABLE/EMPLOYEE_ENABLE take employeeName. BRANCH_CREATE needs name, code, type and optional address; BRANCH_UPDATE takes branchName and new name/address (code/type are immutable). Resolve names uniquely in the API; never send internal ids. Same web permissions, plan limits, self-role and owner guards apply at press time.',
    businessSubjects: ['employee', 'company'], questionKinds: ['detail'], category: 'draft_update',
    requiredPermissions: [], anyOfPermissions: ['access.employee.create', 'access.employee.update', 'access.employee.disable', 'company.branch.manage'],
    sourceModule: 'employee-access', featureKeys: [], supportedAgents: ['general'], sensitiveAudit: true, requiresErpPermissionCheck: true,
    requiredInputFields: ['action'], optionalInputFields: ['employeeName', 'displayName', 'username', 'dateOfBirth', 'identityType', 'identityNumber', 'phoneNumber', 'email', 'roleName', 'branchName', 'name', 'code', 'type', 'address'],
    inputEnumValues: { action: ['EMPLOYEE_CREATE', 'EMPLOYEE_UPDATE', 'EMPLOYEE_DISABLE', 'EMPLOYEE_ENABLE', 'BRANCH_CREATE', 'BRANCH_UPDATE'], identityType: ['THAI_NATIONAL_ID', 'PASSPORT'], type: ['HEAD_OFFICE', 'BRANCH', 'ONLINE', 'WAREHOUSE'] },
  },
  {
    name: 'expense.get_breakdown',
    description: 'Read expense totals grouped by category, branch, and vendor (byVendor, top 10 by amount descending) for a period. Optional categoryName/vendorName resolve a free-text category or vendor name: exactly one match filters by it, several matches return categoryAmbiguous/vendorAmbiguous with availableCategories/availableVendors to disambiguate, and no match returns categoryUnresolved/vendorUnresolved with the available names, instead of a breakdown. Optional groupBy (category, branch, or vendor; default category) is a presentation hint only — it selects which grouping the answer features first; all three groupings are still returned regardless of its value.',
    businessSubjects: ['expense'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['expense.read', 'expense.review', 'expense.read_related', 'expense.read_own'],
    sourceModule: 'expenses',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['periodKey', 'fromDate', 'toDate', 'branchId', 'categoryId', 'vendorId', 'categoryName', 'vendorName', 'documentStatus', 'paymentStatus', 'groupBy'],
    inputEnumValues: { documentStatus: EXPENSE_STATUSES, paymentStatus: EXPENSE_PAYMENT_STATUSES, groupBy: ['category', 'branch', 'vendor'] },
    inputLengthLimits: { categoryName: { min: 1, max: 80 }, vendorName: { min: 1, max: 80 } },
  },
  {
    name: 'public.lookup',
    description: 'Admit a public-only question under an approved source policy; admission is not searched facts.',
    businessSubjects: [],
    questionKinds: [],
    category: 'read_summary',
    requiredPermissions: ['ai.tool.invoke'],
    sourceModule: 'public',
    supportedAgents: ['general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['publicQuestion', 'topic', 'locale', 'temporalIntent', 'sourcePolicyId'],
  },
  {
    name: 'billing.get_package_usage',
    description: "Read THIS company's current package: its name, the date it runs until, branch and member room used/limit, and receipt reads used/limit/remaining in the current allowance with an API-computed straight-line projection to the allowance's end. Also the tool for a question about upgrading, changing or buying this company's package: it decides who may be sent to the package page. Only a caller who manages the package gets figures; anyone else gets a typed refusal. Never prices and never another package. Use for 'แพ็กเกจพอไหม', 'เหลือใบเสร็จกี่ใบ', 'เพิ่มสาขาได้อีกไหม', 'อัปเกรดแพ็กเกจ'. Package prices and what each package includes are billing.get_package_catalog.",
    businessSubjects: ['company', 'expense'],
    questionKinds: ['summary'],
    category: 'read_summary',
    // Offered to every assistant user so a non-manager reaches the typed PACKAGE_MANAGER_REQUIRED refusal
    // (owner decision 2026-09-30, advisor spec §10 item 2); the tool itself checks company.plan.manage,
    // the permission canManagePlan/assertOwner use. Same pattern as public.lookup.
    requiredPermissions: ['ai.tool.invoke'],
    // `billing` is deliberately absent from TOOL_MODULE_FEATURE_KEYS: every company that reaches the
    // assistant has a working package (locked companies are answered before any AI turn).
    sourceModule: 'billing',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'billing.get_package_catalog',
    description: "Read the packages MangmeePlus sells, the same for every shop and every caller: each package's name, monthly and yearly selling price, the amount payable with VAT when VAT applies, branch and user limits, receipt reads, and the menus it includes. Selling prices only, never a cost. Use for 'แพ็กเกจเริ่มต้นราคาเท่าไหร่', 'แต่ละแพ็กเกจต่างกันยังไง', 'รายปีราคาเท่าไหร่', 'แพ็กเกจธุรกิจได้อะไรบ้าง'. Never this shop's own package, its dates or its usage (billing.get_package_usage).",
    businessSubjects: ['company'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    // Owner 2026-09-30 (advisor spec §10 item 1 as amended): anyone who talks to the assistant may ask
    // package prices and contents. The same public data as GET /v1/billing/catalog (@Public).
    requiredPermissions: ['ai.tool.invoke'],
    sourceModule: 'billing',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'bank.get_account_balances',
    description: 'Read last reconciled bank-account balances and dates; these are not live bank balances.',
    businessSubjects: ['bank'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: ['bank.account.read', 'bank.cash.read'],
    sourceModule: 'banking',
    supportedAgents: ['accounting', 'cfo'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
  },
  {
    name: 'bank.get_reconciliation_status',
    description: 'Read last completed reconciliation and current pending/unmatched counts for permitted accounts.',
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
    name: 'reimbursement.draft.get_options',
    description: 'Get bounded API-issued opaque choices for one explicitly admitted reimbursement DRAFT create/update task. This never creates a reimbursement request and never confirms, submits, approves, pays, or posts. Echo only the returned task/action/choice locators; ask the user when a list has more results.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['search', 'list', 'detail'],
    category: 'draft_create',
    requiredPermissions: [],
    anyOfPermissions: ['reimbursement.create', 'reimbursement.update_own_draft', 'reimbursement.finance_review'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['operation', 'subrequestIndex'],
    optionalInputFields: ['taskId', 'actionId', 'branchChoiceId', 'requesterChoiceId', 'targetRef', 'query', 'continuation'],
  },
  {
    name: 'reimbursement.draft.preview_create',
    description: 'Validate an explicit reimbursement-write proposal against the complete admitted input and API-issued choices, then create or replace only a confirmation preview. No reimbursement request is saved until the user presses the exact server-rendered confirm control; there is no model confirm/apply tool.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['detail'],
    category: 'draft_create',
    requiredPermissions: ['reimbursement.create'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['action', 'proposal'], optionalInputFields: ['suggestedCategoryChoiceId'],
  },
  {
    name: 'reimbursement.draft.preview_update',
    description: 'Validate changes to one exact permission-scoped DRAFT reimbursement and return the full replacement preview while preserving untouched lines/evidence. No newest-record fallback and no model confirm/apply/submit tool.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['detail'],
    category: LINE_DRAFT_UPDATE_TOOL_CATEGORY,
    requiredPermissions: [],
    anyOfPermissions: ['reimbursement.update_own_draft', 'reimbursement.finance_review'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['action', 'proposal'], optionalInputFields: ['suggestedCategoryChoiceId'],
  },
  {
    name: 'reimbursement.list_pending_approvals',
    description: 'List claims waiting for approval within the same company/related/own and branch scope as the web claim list. Read permission is sufficient; never describe these as waiting for the caller to approve. Use approver "me" ONLY for an explicit request for claims waiting for the caller to approve; that narrows to their actionable approval queue. Reading never grants approval or rejection rights.',
    businessSubjects: ['reimbursement'],
    questionKinds: ['summary', 'list'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['approver'],
    inputEnumValues: { approver: ['me'] },
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
    name: 'reimbursement.get_approval_backlog',
    description: 'Who or what each still-waiting reimbursement claim waits on right now, within the claims the caller may read: one named approver (byApprover counts only claims exactly one active person can approve), a shared pile of claims several people can approve (sharedPile, never counted toward any one person), no active approver, finance review, or payment. Returns count, totals by currency, the oldest date and longest wait in days per group, and up to 10 claims longest-waiting first with the desk each waits at. Use for "ใบเบิกค้างที่ใคร", "กองอยู่ที่ใครเยอะ", "ใครยังไม่อนุมัติ", "ใบไหนรอนานที่สุด"; requester "me" only when the user asks about their OWN claims ("ใบเบิกของฉันค้างที่ใคร"). Claims waiting for the caller to approve are reimbursement.list_pending_approvals. Approving and paying happen only on the web.',
    businessSubjects: ['reimbursement', 'employee'],
    questionKinds: ['summary', 'breakdown', 'list'],
    category: 'read_summary',
    requiredPermissions: [],
    anyOfPermissions: ['reimbursement.read', 'reimbursement.read_related', 'reimbursement.read_own'],
    sourceModule: 'reimbursements',
    supportedAgents: ['accounting', 'general'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    optionalInputFields: ['requester'],
    inputEnumValues: { requester: ['me'] },
  },
  {
    name: 'hr.get_leave_summary',
    executionReady: false,
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
    description: 'Read one explicitly selected operational_sales, posted_ledger, or operational_dashboard dataset.',
    businessSubjects: ['report'],
    questionKinds: ['summary', 'breakdown'],
    category: 'report',
    requiredPermissions: ['report.catalog.read', 'report.dataset.read', 'report.query.run'],
    sourceModule: 'reports',
    supportedAgents: ['general', 'cfo'],
    sensitiveAudit: false,
    requiresErpPermissionCheck: true,
    requiredInputFields: ['dataset'],
    optionalInputFields: ['periodKey', 'fromDate', 'toDate'],
  },
  // Receipt intake is a deterministic, API-owned attachment pipeline (persist bytes →
  // classify → OCR → reviewable draft), NOT a model-selectable ERP tool. The former
  // receipt.get_attachment_metadata / create_or_update_evidence_draft / find_duplicate_by_hash /
  // score_authenticity tools and their gateway agents were removed (RECEIPT-01); this also
  // dropped the non-canonical `expense.receipt.read` permission that only they referenced.
  // Sold document reads stay separate from the full, unsold thai_tax workspace.
  {
    name: 'voucher.list_recent', description: 'Read recent payment vouchers and preparation status; never create, approve or pay.',
    businessSubjects: ['expense', 'payment'], questionKinds: ['list', 'summary'], category: 'read_summary',
    requiredPermissions: ['expense.disbursement.read'], featureKeys: ['expenses'], sourceModule: 'expenses',
    supportedAgents: ['accounting', 'general'], sensitiveAudit: true, requiresErpPermissionCheck: true,
    optionalInputFields: ['q', 'branchId'],
  },
  {
    name: 'voucher.get_detail', description: 'Read one payment voucher already selected from voucher.list_recent.',
    businessSubjects: ['expense', 'payment'], questionKinds: ['detail'], category: 'read_detail',
    requiredPermissions: ['expense.disbursement.read'], featureKeys: ['expenses'], sourceModule: 'expenses',
    supportedAgents: ['accounting', 'general'], sensitiveAudit: true, requiresErpPermissionCheck: true,
    requiredInputFields: ['voucherId'],
  },
  {
    name: 'wht.get_month_summary', description: 'Read the 50 bis certificate worklist (issued, recorded outside, and still required — confirmed unpaid expenses included) with income bases and document withholding by income type for periodKey YYYY-MM (current month by default). With wht.pnd53.read also read the PND53 period remittance, its system deadline and e-WHT bank-remitted totals by currency. No other tax forms or mutations.',
    businessSubjects: ['tax', 'payment'], questionKinds: ['summary', 'list', 'breakdown'], category: 'read_summary',
    requiredPermissions: [], anyOfPermissions: ['wht.certificate.read', 'wht.pnd53.read'],
    featureKeys: ['wht_50bis', 'wht_pnd53'], sourceModule: 'tax', supportedAgents: ['accounting', 'tax', 'general'],
    sensitiveAudit: true, requiresErpPermissionCheck: true, optionalInputFields: ['periodKey', 'branchId', 'dueDateOnly'],
  },
  {
    name: 'wht.calculate_withholding', description: 'Explain a hypothetical payment using only the ACTIVE system income-category catalog and existing money rounding. Pass baseAmount copied from user amount. Select incomeCategoryCode ONLY when the user explicitly chose the exact catalog income name; never infer from ค่าจ้าง or a generic payment description. With unknown income type call with no category to ask with catalog buttons. The amount is explicitly a conditional pre-VAT base; never guess a VAT rate.',
    businessSubjects: ['tax', 'payment'], questionKinds: ['explain', 'summary'], category: 'read_summary',
    requiredPermissions: [], anyOfPermissions: ['expense.create', 'procurement.supplier_payment.read'],
    featureKeys: ['wht_50bis', 'wht_pnd53'], sourceModule: 'tax', supportedAgents: ['accounting', 'tax', 'general'],
    sensitiveAudit: false, requiresErpPermissionCheck: true, optionalInputFields: ['incomeCategoryCode', 'baseAmount'],
  },
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
    description: 'Read the VAT summary for one monthly period (periodKey YYYY-MM; defaults to the current period).',
    businessSubjects: ['tax'],
    questionKinds: ['summary', 'breakdown'],
    category: 'read_summary',
    requiredPermissions: ['tax.period.read', 'tax.event.read'],
    sourceModule: 'tax',
    supportedAgents: ['accounting', 'tax'],
    sensitiveAudit: true,
    requiresErpPermissionCheck: true,
    // Period-resolution spec §3.3: the tool has always accepted a period key, but with no whitelisted
    // input neither lane could ask for one, so "ภาษีเดือนที่แล้ว" was answered for the current period.
    optionalInputFields: ['periodKey'],
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
