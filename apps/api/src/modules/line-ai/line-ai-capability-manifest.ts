import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import * as ts from 'typescript';
import { LINE_AI_RUNTIME_CONTRACT_VERSION } from '@watchdog-bms/contracts';
import {
  LINE_CAPABILITY_GROUPS,
  LINE_RECEIPT_CAPTURE_FEATURE_KEY,
  LINE_RECEIPT_CAPTURE_PERMISSIONS,
  LINE_TOOL_REGISTRY,
  TOOL_MODULE_FEATURE_KEYS,
  lineToolRegistryFor,
  toolFeatureKeys,
} from '@watchdog-bms/contracts';
import { FEATURE_CATALOG, ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import { MENU_ENTITLEMENT_BINDINGS } from '@watchdog-bms/contracts';
import { apiConfigSchema } from '../../../../../packages/config/src/index';
import { LineWebhookController } from '../auth/presentation/line-webhook.controller';
import { isLineEvidenceRead } from './application/line-read-evidence.service';
import { ERP_READ_TOOL_REGISTRY } from './domain/ports/erp-read-tool.port';
import { InternalAiBudgetController } from './presentation/http/internal-ai-budget.controller';
import { InternalToolsController } from './presentation/http/internal-tools.controller';
import { LineAiLedgerInternalController } from './presentation/http/line-ai-ledger-internal.controller';
import { LineCaptureResultsInternalController } from './presentation/http/line-capture-results-internal.controller';
import { LineDocumentQaInternalController } from './presentation/http/line-document-qa-internal.controller';
import { LineAiModule } from './line-ai.module';

const REGISTRY_PATH = 'packages/contracts/src/ai-tools.ts';
const FEATURE_CATALOG_PATH = 'packages/contracts/src/feature-entitlements.ts';
const MENU_CATALOG_PATH = 'packages/contracts/src/menu-entitlements.ts';
const CONFIG_PATH = 'packages/config/src/index.ts';
const MODULE_PATH = 'apps/api/src/modules/line-ai/line-ai.module.ts';
const TOOL_HANDLER_PATH = 'apps/api/src/modules/line-ai/presentation/http/internal-tools.controller.ts';
const HELPER_PATH = 'apps/api/src/modules/line-ai/line-ai-capability-manifest.ts';
const ARTIFACT_PATH = 'docs/research/mangmee-ai-capability-manifest-2026-09-27.json';
const WEBHOOK_PATH = 'apps/api/src/modules/auth/presentation/line-webhook.controller.ts';
const PROCESS_WEBHOOK_PATH = 'apps/api/src/modules/line-ai/application/use-cases/process-line-webhook.use-case.ts';
const QA_SERVICE_PATH = 'apps/api/src/modules/line-ai/application/line-document-qa.service.ts';
const QA_WORKER_PATH = 'apps/api/src/modules/line-ai/application/line-document-qa.worker.ts';
const QA_CONTROLLER_PATH = 'apps/api/src/modules/line-ai/presentation/http/line-document-qa-internal.controller.ts';
const CAPTURE_CONTROLLER_PATH = 'apps/api/src/modules/line-ai/presentation/http/line-capture-results-internal.controller.ts';
const BUDGET_CONTROLLER_PATH = 'apps/api/src/modules/line-ai/presentation/http/internal-ai-budget.controller.ts';
const LEDGER_CONTROLLER_PATH = 'apps/api/src/modules/line-ai/presentation/http/line-ai-ledger-internal.controller.ts';
const REIMBURSEMENT_PATH = 'apps/api/src/modules/line-ai/application/line-reimbursement-draft.service.ts';
const PREFERENCES_PATH = 'apps/api/src/modules/line-ai/domain/logic/line-preference-command.logic.ts';
const CORE_SPEC_PATH = 'docs/specs/mangmee-ai-core-capability-contract-2026-09-27.md';
const IMPLEMENTATION_INDEX_PATH = 'docs/plans/mangmee-ai-implementation-index-2026-09-27.md';

const REGISTERED_UNWIRED_REASONS: Record<string, string> = {
  'crm.suggest_sales_followups': 'Registry entry has no API tool adapter or InternalToolsController handler in this checkout.',
  'accounting.capture_receipt_evidence': 'This registry name has no toolMap handler; actual receipt capture is the separate signed LINE webhook intake operation line.receipt_capture.',
  'hr.get_leave_summary': 'Registry entry has no API tool adapter or InternalToolsController handler in this checkout.',
};

const RUNTIME_FLAG_NAMES = [
  'LINE_AI_DRAFT_EDIT_ENABLED',
  'LINE_AI_RELIABILITY_V2_MODE',
  'LINE_AI_RELIABILITY_V2_COMPANY_IDS',
  'LINE_AI_DELIVERY_PLAN_V2_ENABLED',
  'LINE_AI_DELIVERY_PLAN_V2_WRITE_COMPANY_IDS',
  'LINE_AI_DELIVERY_PLAN_V2_PUBLIC_CHANNEL_IDS',
  'LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED',
  'LINE_AI_DOCUMENT_QA_ENABLED',
  'LINE_AI_APPROVED_KNOWLEDGE_ENABLED',
  'LINE_AI_PUBLIC_LOOKUP_ENABLED',
  'LINE_AI_PREFERENCES_ENABLED',
] as const;

const W00_FAMILIES = [
  { id: 'dashboard_company', featureKeys: ['dashboard_notifications'], match: (name: string) => /^(company|dashboard|notifications)\./u.test(name) },
  { id: 'sales', featureKeys: ['sales_documents'], match: (name: string) => name.startsWith('sales.') },
  { id: 'expenses', featureKeys: ['expenses'], match: (name: string) => (name.startsWith('expense.') || name.startsWith('voucher.')) },
  { id: 'accounting_ledger', featureKeys: ['double_entry_ledger'], match: (name: string) => name.startsWith('accounting.') || name.startsWith('ledger.') || name.startsWith('reports.') },
  { id: 'tax', featureKeys: ['thai_tax', 'wht_50bis', 'wht_pnd53'], match: (name: string) => name.startsWith('tax.') || name.startsWith('wht.') },
  { id: 'workflow', featureKeys: ['workflow_automation'], match: (name: string) => name.startsWith('workflow.') },
  { id: 'inventory', featureKeys: ['inventory', 'product_catalog'], match: (name: string) => name.startsWith('inventory.') },
  { id: 'procurement_ap', featureKeys: ['procurement'], match: (name: string) => name.startsWith('procurement.') },
  { id: 'accounts_receivable', featureKeys: ['sales_documents'], match: (name: string) => name === 'accounting.get_receivable_summary' },
  { id: 'banking', featureKeys: ['bank_reconciliation'], match: (name: string) => name.startsWith('bank.') },
  { id: 'reimbursement', featureKeys: ['reimbursement'], match: (name: string) => name.startsWith('reimbursement.') },
  { id: 'crm', featureKeys: ['crm', 'crm.inbox', 'crm.bookings'], match: (name: string) => name.startsWith('crm.') },
  { id: 'attachment_evidence', featureKeys: ['expenses.upload'], match: (name: string) => name === 'accounting.capture_receipt_evidence' || name === 'line.explain_file_attempt' },
] as const;

const INTAKE_DEFINITIONS = [
  {
    operation: 'line.message_webhook', release: 'R1', enabledByDefault: true,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'line-messaging-webhook-unversioned',
    supportedFields: ['destination', 'events[].type', 'events[].webhookEventId', 'events[].replyToken', 'events[].timestamp', 'events[].source.type', 'events[].source.userId', 'events[].source.groupId', 'events[].source.roomId', 'events[].message.id', 'events[].message.type', 'events[].message.text', 'events[].message.fileName', 'events[].message.fileSize', 'events[].postback.data'],
    featureKeys: ['ai_line_assistant'], requiredPermissions: [], anyOfPermissions: [], runtimeFlagNames: [],
    channelKinds: ['USER', 'GROUP', 'ROOM'],
    dataBasis: 'Signature-verified LINE event is buffered and routed. This intake record proves API routing only; it does not claim the downstream business read/write result.',
    sourceReferences: [
      { path: WEBHOOK_PATH, symbol: 'LineWebhookController.lineWebhook/legacyLineWebhook' },
      { path: PROCESS_WEBHOOK_PATH, symbol: 'ProcessLineWebhookUseCase' },
      { path: MODULE_PATH, symbol: 'LineAiModule.controllers/providers' },
    ],
  },
  {
    operation: 'line.workflow_control', release: 'R2', enabledByDefault: true,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'LineWorkflowControl/v1',
    supportedFields: ['postback.data.action', 'postback.data.id', 'postback.data.act', 'postback.data.sig', 'postback.data.pm', 'postback.data.pd', 'postback.data.pa', 'postback.data.token', 'postback.data.pick'],
    featureKeys: ['expenses', 'reimbursement', 'wht_50bis'], requiredPermissions: [], anyOfPermissions: [], runtimeFlagNames: [],
    channelKinds: ['USER', 'GROUP', 'ROOM'],
    dataBasis: 'Signature-verified wf_open/wf_choice/chat-action/fixed-read controls use exact-key parsing and ordered worker buffering. Action handlers recheck current owner, action-specific permission, feature and source state; target and payment fields on wf_open are HMAC-bound to company and user. Workflow navigation collects conversation state or prepares a preview, and fixed-read uses the server-owned expense-month read plan. Business writes retain their existing signed confirmation boundary. Free shops return through their model-free access gates. This entry proves API routing only, not downstream business results.',
    sourceReferences: [
      { path: WEBHOOK_PATH, symbol: 'LineWebhookController.handleLineWebhook postback parsing' },
      { path: 'apps/api/src/modules/line-ai/domain/logic/line-reimbursement-approval-control.logic.ts', symbol: 'parseLineWorkflowControl/lineWorkflowOpenSig/verifyLineWorkflowOpenSig' },
      { path: 'apps/api/src/modules/line-ai/domain/logic/line-staff-menu.logic.ts', symbol: 'parseLineFixedReadControl/linePostbackCommandText' },
      { path: 'apps/api/src/modules/line-ai/application/line-message-buffer.service.ts', symbol: 'LineMessageBufferService ordered control dispatch and replay' },
      { path: PROCESS_WEBHOOK_PATH, symbol: 'handleWorkflowControl/handleFixedRead' },
    ],
  },
  {
    operation: 'line.receipt_capture', release: 'R1', enabledByDefault: true,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'line-messaging-webhook-unversioned',
    supportedFields: ['events[].source.userId', 'events[].source.type', 'events[].message.id', 'events[].message.type=image|file', 'events[].message.fileName', 'events[].message.fileSize', 'events[].message.text (caption)'],
    featureKeys: [LINE_RECEIPT_CAPTURE_FEATURE_KEY], requiredPermissions: [], anyOfPermissions: [...LINE_RECEIPT_CAPTURE_PERMISSIONS], runtimeFlagNames: [],
    channelKinds: ['USER', 'GROUP', 'ROOM'],
    dataBasis: 'LINE media enters the existing expense capture path; permission and feature checks occur in the API. Receipt OCR/source evidence and business write correctness require the expense-domain tests and are not asserted by this wiring manifest.',
    sourceReferences: [
      { path: WEBHOOK_PATH, symbol: 'LineWebhookController.handleLineWebhook' },
      { path: PROCESS_WEBHOOK_PATH, symbol: 'ProcessLineWebhookUseCase media/capture flow' },
      { path: REGISTRY_PATH, symbol: 'LINE_RECEIPT_CAPTURE_FEATURE_KEY/LINE_RECEIPT_CAPTURE_PERMISSIONS' },
    ],
  },
  {
    operation: 'line.document_qa', release: 'R2', enabledByDefault: false,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'LineDocumentQaAdmissionInput/v1',
    supportedFields: ['question', 'attachments[].attachmentId', 'attachments[].requestedPages[]', 'originalBudgetGrantV2', 'originalInputDigest', 'requestId', 'turnId', 'ownerEpoch', 'channelKind=USER', 'messagingChannelId', 'chatKeyHash'],
    featureKeys: ['ai_line_assistant'], requiredPermissions: ['line.ai.query'], anyOfPermissions: [],
    channelKinds: ['USER'],
    runtimeFlagNames: ['LINE_AI_DOCUMENT_QA_ENABLED'],
    dataBasis: 'Question-only read job over owner-checked active attachment bytes and requested PDF pages. It must remain separate from expense capture; manifest parity does not assert extracted document facts.',
    sourceReferences: [
      { path: PROCESS_WEBHOOK_PATH, symbol: 'routeDocumentQuestionBeforeCapture' },
      { path: QA_SERVICE_PATH, symbol: 'LineDocumentQaService.admit' },
      { path: QA_WORKER_PATH, symbol: 'LineDocumentQaWorker.drain' },
      { path: QA_CONTROLLER_PATH, symbol: 'LineDocumentQaInternalController.drain' },
    ],
  },
  {
    operation: 'line.reimbursement_draft_confirmation', release: 'R2', enabledByDefault: false,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'LineReimbursementDraftControl/v1',
    supportedFields: ['postback.data.action', 'postback.data.actionId', 'postback.data.previewRevision', 'postback.data.confirmationDigest'],
    featureKeys: ['reimbursement'], requiredPermissions: [], anyOfPermissions: [],
    channelKinds: ['USER', 'GROUP', 'ROOM'], runtimeFlagNames: ['LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED'],
    dataBasis: 'A signed LINE postback carries a server-issued action ID, preview revision and confirmation digest; API service re-reads current owner/source before applying a DRAFT action.',
    sourceReferences: [
      { path: WEBHOOK_PATH, symbol: 'LineWebhookController.handleLineWebhook' },
      { path: REIMBURSEMENT_PATH, symbol: 'parseLineReimbursementDraftControl/LineReimbursementDraftService' },
      { path: PROCESS_WEBHOOK_PATH, symbol: 'ProcessLineWebhookUseCase.handleReimbursementDraftControl' },
    ],
  },
  {
    operation: 'line.approved_product_help', release: 'R2', enabledByDefault: false,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'LINE_AI_HELP_REQUEST/v1', supportedFields: ['messageText', 'approvedKnowledge', 'selectedKnowledgeCardIds[]'],
    featureKeys: ['ai_line_assistant'], requiredPermissions: [], anyOfPermissions: [],
    channelKinds: ['USER'], runtimeFlagNames: ['LINE_AI_APPROVED_KNOWLEDGE_ENABLED'],
    dataBasis: 'API only enables and forwards approved-knowledge selectors for a bound private conversation. Knowledge-pack content/approval and retrieval grounding are Gateway-owned and not proven by API wiring.',
    sourceReferences: [
      { path: PROCESS_WEBHOOK_PATH, symbol: 'reliabilityContext/approvedKnowledge request forwarding' },
      { path: 'apps/api/src/modules/line-ai/domain/logic/line-public-policy.logic.ts', symbol: 'reviewed public signup instructions and linked-member question recognition' },
      { path: 'apps/ai-gateway/src/modules/line-ai/agents/approved-product-help.ts', symbol: 'approved v4, draft v6 and activeProductHelpPack approval gate' },
      { path: 'apps/ai-gateway/src/modules/line-ai/agents/product-help-draft-cards.ts', symbol: 'source-pinned draft card inventory' },
      { path: 'apps/ai-gateway/src/modules/line-ai/agents/approved-knowledge.ts', symbol: 'approval, source hash and access validation' },
      { path: 'apps/web/src/features/user-guide/getting-started-guide.content.ts', symbol: 'role/package-scoped help source' },
      { path: CONFIG_PATH, symbol: 'LINE_AI_APPROVED_KNOWLEDGE_ENABLED' },
    ],
  },
  {
    operation: 'line.response_preferences', release: 'R3', enabledByDefault: false,
    controller: LineWebhookController, handler: ['lineWebhook', 'legacyLineWebhook'],
    inputSchemaVersion: 'LinePreferenceCommand/v1', supportedFields: ['messageText'],
    featureKeys: ['ai_line_assistant'], requiredPermissions: [], anyOfPermissions: [],
    channelKinds: ['USER'], runtimeFlagNames: ['LINE_AI_PREFERENCES_ENABLED'],
    dataBasis: 'Explicit list/set/delete commands are private owner-bound preferences with version/epoch checks; no preference is inferred from general text.',
    sourceReferences: [
      { path: PREFERENCES_PATH, symbol: 'parseLinePreferenceCommand' },
      { path: PROCESS_WEBHOOK_PATH, symbol: 'handlePreferenceCommand' },
      { path: CONFIG_PATH, symbol: 'LINE_AI_PREFERENCES_ENABLED' },
    ],
  },
] as const;

const ROUTE_INPUTS: Record<string, { operation: string; category: string; bodyFields: string[]; notes: string[] }> = {
  'InternalToolsController.invoke': {
    operation: 'internal_ai_tool_invoke', category: 'tool_executor',
    bodyFields: ['toolName', 'context.companyId', 'context.userId', 'context.requestId?', 'context.membershipId?', 'context.locale?', 'context.chatKeyHash?', 'context.groundingText?', 'context.inputEvidence?', 'context.valueCandidatesV2?', 'context.budgetGrantV2?', 'context.roles?', 'context.permissions?', 'context.branchIds?', 'context.locationIds?', 'input?'],
    notes: ['Internal secret and actor delegation are required.', 'Permissions, roles and scopes are re-resolved by API; body roles/permissions/scopes do not grant access.', 'Nested input must match requiredInputFields/optionalInputFields from LINE_TOOL_REGISTRY.'],
  },
  'LineWebhookController.lineWebhook': {
    operation: 'line.message_webhook', category: 'public_signed_webhook',
    bodyFields: ['destination?', 'events[]', 'events[].type', 'events[].webhookEventId?', 'events[].replyToken?', 'events[].timestamp?', 'events[].source.type?', 'events[].source.userId?', 'events[].source.groupId?', 'events[].source.roomId?', 'events[].message.id?', 'events[].message.type?', 'events[].message.text?', 'events[].message.fileName?', 'events[].message.fileSize?', 'events[].postback.data?'],
    notes: ['x-line-signature over rawBody is mandatory.', 'Events without replyToken or source.userId are ignored by this assistant intake.'],
  },
  'LineWebhookController.legacyLineWebhook': {
    operation: 'line.message_webhook', category: 'public_signed_webhook',
    bodyFields: ['destination?', 'events[] (same LineMessageEvent shape as /line/webhook)'], notes: ['Legacy route delegates to the same signature-verified handler.'],
  },
  'LineDocumentQaInternalController.drain': {
    operation: 'line_document_qa_worker_drain', category: 'internal_worker', bodyFields: ['batchSize?'], notes: ['x-worker-token required; batchSize is an integer from 1 to 2.'],
  },
  'LineCaptureResultsInternalController.drain': {
    operation: 'line_capture_results_worker_drain', category: 'internal_worker', bodyFields: ['batchSize?'], notes: ['x-worker-token required; batchSize is an integer from 1 to 25.'],
  },
  'InternalAiBudgetController.budgetStep': {
    operation: 'line_ai_budget_step', category: 'internal_budget', bodyFields: ['version?', 'invocation?', 'repair?', 'companyId?', 'attemptKey?', 'stepKind?', 'ordinal?', 'monthKey?'], notes: ['x-internal-secret required; v2 and legacy bodies are mutually exclusive.'],
  },
  'InternalAiBudgetController.budgetSettle': {
    operation: 'line_ai_budget_settle', category: 'internal_budget', bodyFields: ['invocationKey', 'sourceRoute', 'requestId?', 'externalUnits?', 'usage.modelId', 'usage.tag', 'usage.ok', 'usage.inputTokens', 'usage.outputTokens', 'usage.cacheReadInputTokens', 'usage.cacheWriteInputTokens', 'usage.usageBasis?'], notes: ['x-internal-secret required; usage basis is an evidence field, not an authorization claim.'],
  },
  'LineAiLedgerInternalController.drainLedger': {
    operation: 'line_ai_ledger_drain', category: 'internal_worker', bodyFields: ['batchSize?'], notes: ['x-worker-token required.'],
  },
  'LineAiLedgerInternalController.sweepOrphanEvents': {
    operation: 'line_ai_orphan_event_sweep', category: 'internal_worker', bodyFields: ['batchSize?'], notes: ['x-worker-token required.'],
  },
};

const API_ROUTES = [
  LineWebhookController,
  InternalToolsController,
  LineDocumentQaInternalController,
  LineCaptureResultsInternalController,
  InternalAiBudgetController,
  LineAiLedgerInternalController,
] as const;

const SOURCE_REFERENCES = [
  { path: REGISTRY_PATH, symbol: 'LINE_TOOL_REGISTRY/ToolMeta/lineToolRegistryFor' },
  { path: FEATURE_CATALOG_PATH, symbol: 'FEATURE_CATALOG/ALL_FEATURE_ENTITLEMENT_KEYS' },
  { path: MENU_CATALOG_PATH, symbol: 'MENU_ENTITLEMENT_BINDINGS' },
  { path: CONFIG_PATH, symbol: 'apiConfigSchema reliability flags' },
  { path: MODULE_PATH, symbol: 'LineAiModule controllers/providers/exports and ERP_READ_TOOL_REGISTRY factory' },
  { path: TOOL_HANDLER_PATH, symbol: 'InternalToolsController constructor/toolMap/invoke' },
  { path: HELPER_PATH, symbol: 'buildLineAiCapabilityManifest' },
  { path: WEBHOOK_PATH, symbol: 'LineWebhookController' },
  { path: PROCESS_WEBHOOK_PATH, symbol: 'ProcessLineWebhookUseCase intake/routing' },
  { path: QA_SERVICE_PATH, symbol: 'LineDocumentQaService.admit' },
  { path: QA_WORKER_PATH, symbol: 'LineDocumentQaWorker' },
  { path: QA_CONTROLLER_PATH, symbol: 'LineDocumentQaInternalController' },
  { path: CAPTURE_CONTROLLER_PATH, symbol: 'LineCaptureResultsInternalController' },
  { path: BUDGET_CONTROLLER_PATH, symbol: 'InternalAiBudgetController' },
  { path: LEDGER_CONTROLLER_PATH, symbol: 'LineAiLedgerInternalController' },
  { path: REIMBURSEMENT_PATH, symbol: 'LineReimbursementDraftControl/LineReimbursementDraftService' },
  { path: 'apps/api/src/modules/line-ai/application/line-expense-action.service.ts', symbol: 'signed expense, reimbursement, voucher and certificate action lifecycle' },
  { path: 'apps/api/src/modules/line-ai/application/line-counterparty.service.ts', symbol: 'web-authorized counterparty tools and signed human confirmation' },
  { path: 'apps/api/src/modules/line-ai/application/line-quoted-message.service.ts', symbol: 'retained provider message IDs and owner-bound record grounding' },
  { path: 'apps/api/src/modules/line-ai/application/line-voucher-action.service.ts', symbol: 'voucher and certificate web use-case adapter, entitlement and source boundaries' },
  { path: PREFERENCES_PATH, symbol: 'LinePreferenceCommand' },
  { path: CORE_SPEC_PATH, symbol: '§2 executable manifest and effective capabilities; sold-family checklist' },
  { path: IMPLEMENTATION_INDEX_PATH, symbol: 'W00 inputs, acceptance, deferred voice and implementation checkpoint' },
  { path: 'packages/contracts/src/line-ai.ts', symbol: 'LineAiTurnRequest/LineIntakeRouteRequest versioned input and task contracts' },
  { path: 'apps/ai-gateway/src/common/usage/ai-budget-provider.ts', symbol: 'AI_BUDGET_V2_SUPPORTED and sealed provider dispatch' },
  { path: 'apps/ai-gateway/src/modules/line-ai/presentation/http/line-reliability-capabilities.controller.ts', symbol: 'actual runtime/model protocol handshake' },
  { path: 'apps/api/src/modules/line-ai/application/line-conversation-context.service.ts', symbol: 'owner epoch, task CAS and scope invalidation' },
  { path: 'apps/api/src/modules/line-ai/application/line-read-evidence.service.ts', symbol: 'exact typed facts and delivery source revalidation' },
  { path: 'apps/api/src/modules/reports/application/report-source-adapters.ts', symbol: 'shared API/web/export Decimal and scoped dataset sources' },
  { path: 'apps/api/src/modules/reports/domain/report-query-validator.logic.ts', symbol: 'shared civil-date and report filter validation' },
  { path: 'apps/web/src/features/reports/ReportsWorkspacePage.tsx', symbol: 'exact monetary report label consumer' },
  { path: 'apps/web/src/features/reimbursements/ReimbursementDraftActionPage.tsx', symbol: 'bound preview confirmation, revision and applied receipt' },

] as const;

function workspaceRoot(): string {
  let candidate = process.cwd();
  while (true) {
    if (existsSync(resolve(candidate, REGISTRY_PATH))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('Cannot locate workspace root for W00 capability manifest');
    candidate = parent;
  }
}

const ROOT = workspaceRoot();

function git(args: string[]): string | null {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; }
  catch { return null; }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}

export function lineAiCapabilityManifestDigestFor(value: Record<string, unknown>): string {
  // Checkout observations identify the generation run; sourceHashes identify executable parity.
  // A commit/merge or detached CI checkout must not change the digest of identical source bytes.
  const { generatedAt: _generatedAt, manifestDigest: _manifestDigest, baseRevision: _baseRevision,
    sourceRevision: _sourceRevision, checkoutBranch: _checkoutBranch, checkoutDirty: _checkoutDirty, ...content } = value;
  return createHash('sha256').update(stableJson(content)).digest('hex');
}

function sourceHash(path: string): string {
  return createHash('sha256').update(readFileSync(resolve(ROOT, path))).digest('hex');
}

function metadata<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

function providerToken(provider: unknown): unknown {
  return typeof provider === 'function' ? provider : (provider as { provide?: unknown })?.provide;
}

function importedSourceMap(path: string): Map<string, string> {
  const source = ts.createSourceFile(path, readFileSync(resolve(ROOT, path), 'utf8'), ts.ScriptTarget.Latest, true);
  const out = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const binding = statement.importClause?.namedBindings;
    if (!binding || !ts.isNamedImports(binding)) continue;
    const modulePath = resolve(dirname(resolve(ROOT, path)), `${statement.moduleSpecifier.text}.ts`);
    for (const imported of binding.elements) out.set(imported.name.text, existsSync(modulePath) ? relative(ROOT, modulePath).replaceAll('\\', '/') : `unresolved:${statement.moduleSpecifier.text}`);
  }
  return out;
}

function internalToolControllerDependencies() {
  const source = ts.createSourceFile(TOOL_HANDLER_PATH, readFileSync(resolve(ROOT, TOOL_HANDLER_PATH), 'utf8'), ts.ScriptTarget.Latest, true);
  const controller = source.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'InternalToolsController');
  if (!controller || !ts.isClassDeclaration(controller)) throw new Error('InternalToolsController declaration is unavailable');
  const constructor = controller.members.find(member => ts.isConstructorDeclaration(member));
  if (!constructor || !ts.isConstructorDeclaration(constructor)) throw new Error('InternalToolsController constructor is unavailable');
  return constructor.parameters.map((parameter, index) => {
    const parameterName = ts.isIdentifier(parameter.name) ? parameter.name.text : `parameter_${index}`;
    const typeName = parameter.type && ts.isTypeReferenceNode(parameter.type)
      ? parameter.type.typeName.getText(source).replace(/^.*\./u, '')
      : 'unknown';
    return { index, parameterName, typeName };
  });
}

export function instantiateInternalToolsController(overrides: Record<string, unknown> = {}) {
  const dependencies = internalToolControllerDependencies();
  const moduleProviders = metadata<unknown[]>('providers', LineAiModule) ?? [];
  const moduleProviderTokens = moduleProviders.map(providerToken);
  const providerByName = new Map(moduleProviderTokens.filter((token): token is Function => typeof token === 'function').map(token => [token.name, token]));
  const args = dependencies.map(dependency => overrides[dependency.parameterName] ?? overrides[dependency.typeName]
    ?? { __manifestDependencyIndex: dependency.index });
  const controller = new (InternalToolsController as any)(...args) as { toolMap: Map<string, object> };
  return { controller, dependencies, args, providerByName, moduleProviders, moduleProviderTokens };
}

function routeInventory(controllers: readonly Function[]) {
  const results: Array<Record<string, unknown>> = [];
  for (const controller of controllers) {
    const prefix = metadata<string | string[]>('path', controller) ?? '';
    const prototype = controller.prototype as Record<string, unknown>;
    for (const methodName of Object.getOwnPropertyNames(prototype)) {
      const method = prototype[methodName];
      if (typeof method !== 'function') continue;
      const routePath = metadata<string | string[]>('path', method);
      const requestMethod = metadata<RequestMethod>('method', method);
      if (routePath === undefined || requestMethod === undefined) continue;
      const item = ROUTE_INPUTS[`${controller.name}.${methodName}`];
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      const prefixes = Array.isArray(prefix) ? prefix : [prefix];
      for (const route of paths) for (const base of prefixes) {
        const path = `/${[base, route].map(part => String(part).replace(/^\/+|\/+$/gu, '')).filter(Boolean).join('/')}`;
        results.push({
          operation: item?.operation ?? `${controller.name}.${methodName}`,
          method: requestMethod === RequestMethod.POST ? 'POST' : `RequestMethod(${requestMethod})`,
          path,
          controller: controller.name,
          handler: methodName,
          category: item?.category ?? 'unknown',
          bodyFields: item?.bodyFields ?? [],
          bodyShapeStatus: item ? 'documented' : 'unknown',
          notes: item?.notes ?? ['No W00 body-field catalog is present for this registered route.'],
        });
      }
    }
  }
  return results.sort((a, b) => String(a.path).localeCompare(String(b.path)) || String(a.handler).localeCompare(String(b.handler)));
}

function buildExecutableWiring() {
  const probe = instantiateInternalToolsController();
  const { controller, dependencies, args, providerByName, moduleProviders, moduleProviderTokens } = probe;
  const controllerHandlers = [...controller.toolMap].map(([operation, instance]) => {
    const dependencyIndex = args.indexOf(instance);
    const dependency = dependencies[dependencyIndex];
    const adapterType = dependency ? providerByName.get(dependency.typeName) : undefined;
    return {
      operation,
      adapterType,
      adapterTypeName: dependency?.typeName,
      adapterParameter: dependency?.parameterName,
      instanceProperty: dependency ? (controller as any)[dependency.parameterName] === instance : false,
    };
  });
  const moduleControllers = metadata<Function[]>('controllers', LineAiModule) ?? [];
  const moduleExports = metadata<unknown[]>('exports', LineAiModule) ?? [];
  const registryProvider = moduleProviders.find(provider => typeof provider === 'object' && provider !== null
    && (provider as { provide?: unknown }).provide === ERP_READ_TOOL_REGISTRY) as {
      inject?: Function[];
      useFactory?: (...values: Array<{ toolName: string }>) => Map<string, object>;
    } | undefined;
  if (!registryProvider?.inject || typeof registryProvider.useFactory !== 'function') throw new Error('ERP_READ_TOOL_REGISTRY factory metadata is unavailable');

  const operationByAdapter = new Map<Function, string[]>();
  for (const binding of controllerHandlers) {
    if (!binding.adapterType) continue;
    operationByAdapter.set(binding.adapterType, [...(operationByAdapter.get(binding.adapterType) ?? []), binding.operation]);
  }
  const registryArguments = registryProvider.inject.map(token => ({
    toolName: operationByAdapter.get(token)?.[0] ?? `unmapped:${token.name}`,
  }));
  const evidenceRegistry = registryProvider.useFactory(...registryArguments) as Map<string, object>;

  return {
    controller,
    controllerHandlers,
    dependencies,
    moduleProviders,
    moduleProviderTokens,
    moduleControllers,
    moduleExports,
    registryProvider,
    evidenceRegistry,
    operationByAdapter,
  };
}

function defaultFlagValues(): Record<string, unknown> {
  const shape = apiConfigSchema.shape as Record<string, { parse(value: unknown): unknown }>;
  return Object.fromEntries(RUNTIME_FLAG_NAMES.map(name => [name, shape[name]?.parse(undefined) ?? null]));
}

function operationRelease(meta: (typeof LINE_TOOL_REGISTRY)[number]): string {
  if (meta.name === 'company.action.preview') return 'R7';
  if (meta.name === 'counterparty.action.preview' || meta.name === 'expense.action.preview' || meta.name === 'public.lookup' || meta.name.startsWith('reimbursement.draft.')) return 'R2';
  return 'R1';
}

function operationFlagNames(name: string, category: string): string[] {
  if (name === 'public.lookup') return ['LINE_AI_PUBLIC_LOOKUP_ENABLED', 'LINE_AI_RELIABILITY_V2_MODE', 'LINE_AI_RELIABILITY_V2_COMPANY_IDS'];
  if (name.startsWith('reimbursement.draft.')) return ['LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED'];
  if (name === 'expense.action.preview' || name === 'counterparty.action.preview' || name === 'company.action.preview') return [];
  if (category === 'draft_update') return ['LINE_AI_DRAFT_EDIT_ENABLED'];
  return [];
}

export function buildLineAiCapabilityManifest(generatedAt = new Date().toISOString()) {
  const wiring = buildExecutableWiring();
  const sourceImports = importedSourceMap(TOOL_HANDLER_PATH);
  const handlerByName = new Map(wiring.controllerHandlers.map(binding => [binding.operation, binding]));
  const allRegistryNames = new Set(LINE_TOOL_REGISTRY.map(tool => tool.name));
  const currentFlags = defaultFlagValues();
  const defaultVisibleNames = new Set(lineToolRegistryFor({
    draftEditEnabled: currentFlags['LINE_AI_DRAFT_EDIT_ENABLED'] === true,
    reimbursementDraftWriteEnabled: currentFlags['LINE_AI_REIMBURSEMENT_DRAFT_WRITE_ENABLED'] === true,
    publicLookupEnabled: currentFlags['LINE_AI_PUBLIC_LOOKUP_ENABLED'] === true,
  }).map(tool => tool.name));

  const operations = LINE_TOOL_REGISTRY.map(meta => {
    const binding = handlerByName.get(meta.name);
    const adapterType = binding?.adapterType;
    const adapterTypeName = binding?.adapterTypeName;
    const providerRegistered = !!adapterType && wiring.moduleProviderTokens.includes(adapterType);
    const toolRegistryInjected = !!adapterType && wiring.registryProvider.inject?.includes(adapterType) === true;
    const toolRegistryMapped = wiring.evidenceRegistry.has(meta.name);
    const fields = [...new Set([...(meta.requiredInputFields ?? []), ...(meta.optionalInputFields ?? [])])].sort();
    const intakeRef = meta.category === 'evidence_capture' ? 'line.receipt_capture' : null;
    const evidenceRegistryExpected = isLineEvidenceRead(meta.name);
    const evidenceRegistryReady = !evidenceRegistryExpected || (toolRegistryInjected && toolRegistryMapped);
    const handlerWired = !!binding && binding.instanceProperty && providerRegistered && evidenceRegistryReady;
    const inputFields = {
      required: [...(meta.requiredInputFields ?? [])].sort(),
      optional: [...(meta.optionalInputFields ?? [])].sort(),
      allowed: fields,
    };
    const refs = [
      { path: REGISTRY_PATH, symbol: `LINE_TOOL_REGISTRY[${JSON.stringify(meta.name)}]` },
      { path: TOOL_HANDLER_PATH, symbol: `InternalToolsController.toolMap → ${adapterTypeName ?? 'no handler'}` },
      { path: MODULE_PATH, symbol: `LineAiModule.providers/${adapterTypeName ?? 'provider missing'}` },
      ...(adapterTypeName ? [{ path: sourceImports.get(adapterTypeName) ?? 'unknown', symbol: adapterTypeName }] : []),
      ...(intakeRef ? [
        { path: WEBHOOK_PATH, symbol: 'LineWebhookController.handleLineWebhook' },
        { path: PROCESS_WEBHOOK_PATH, symbol: 'ProcessLineWebhookUseCase receipt capture intake' },
      ] : []),
    ];
    return {
      operation: meta.name,
      execution: meta.category === 'evidence_capture' ? 'api_intake' : 'read_tool',
      implementation: handlerWired ? 'wired' : 'registered_unwired',
      apiIntakeRef: intakeRef,
      inputSchemaVersion: 'LINE_TOOL_REGISTRY/v1 (no explicit registry schema version declared)',
      supportedFields: inputFields,
      permissionPolicyRef: 'LINE_TOOL_REGISTRY ToolMeta; InternalToolsController.invoke re-resolves actor access',
      authorization: {
        requiredPermissionsAllOf: [...meta.requiredPermissions].sort(),
        anyOfPermissions: [...(meta.anyOfPermissions ?? [])].sort(),
        requiredRoles: [],
        roleRestrictions: 'not declared per operation; roles are re-resolved with permissions and caller-supplied roles are ignored',
        featureKeys: [...toolFeatureKeys(meta)].sort(),
        featureMatch: 'any declared feature key; an empty list is ungated; entitlement null preserves legacy fail-open behavior',
        requiresErpPermissionCheck: meta.requiresErpPermissionCheck,
        actorDelegationRequired: true,
      },
      channelKinds: ['USER', 'GROUP', 'ROOM'],
      channelPolicyEvidence: 'LINE webhook carries these chat kinds; ToolMeta has no operation-specific channel allowlist, so per-operation channel authorization is unknown here.',
      supportedAgents: [...meta.supportedAgents].sort(),
      questionKinds: [...meta.questionKinds].sort(),
      runtimeFlagNames: operationFlagNames(meta.name, meta.category),
      defaultVisible: defaultVisibleNames.has(meta.name),
      dataBasis: {
        sourceModule: meta.sourceModule,
        businessSubjects: [...meta.businessSubjects].sort(),
        adapterClass: adapterType?.name ?? null,
        resultBasisVersion: 'runtime ToolResult.basisVersion; not declared statically in ToolMeta',
        queryBasis: 'API adapter result may provide queryApplied/dateBasis/statusBasis/dataset; this manifest proves wiring and permission boundary only, not database query or business-record completeness.',
      },
      runtimeContractVersion: LINE_AI_RUNTIME_CONTRACT_VERSION,
      release: operationRelease(meta),
      wiringEvidence: {
        controllerHandler: !!binding,
        moduleProvider: providerRegistered,
        evidenceRegistryInjected: toolRegistryInjected,
        evidenceRegistryFactoryMapped: toolRegistryMapped,
        evidenceRegistryExpected,
        nonReadyReason: !binding ? REGISTERED_UNWIRED_REASONS[meta.name] ?? 'No InternalToolsController.toolMap handler.'
          : !providerRegistered ? `Adapter ${adapterTypeName ?? 'unknown'} is not a LineAiModule provider.`
            : !evidenceRegistryReady ? `Read evidence replay requires ERP_READ_TOOL_REGISTRY injection for ${adapterType?.name ?? 'unknown'}.`
              : null,
      },
      sourceReferences: refs,
    };
  });

  const registryOrphanHandlers = wiring.controllerHandlers.filter(binding => !allRegistryNames.has(binding.operation)).map(binding => binding.operation).sort();
  const duplicateRegistryNames = [...new Set(LINE_TOOL_REGISTRY.filter((meta, index, all) => all.findIndex(other => other.name === meta.name) !== index).map(meta => meta.name))].sort();
  const routeControllers = API_ROUTES.filter(controller => wiring.moduleControllers.includes(controller));
  const apiRoutes = routeInventory(routeControllers);

  const apiIntakes = INTAKE_DEFINITIONS.map(definition => {
    const routes = apiRoutes.filter(route => route.controller === definition.controller.name && (definition.handler as readonly string[]).includes(String(route.handler)));
    const enabledByDefault = definition.enabledByDefault && (!definition.runtimeFlagNames || definition.runtimeFlagNames.every(name => currentFlags[name] === true));
    return {
      operation: definition.operation,
      execution: 'api_intake',
      implementation: routes.length > 0 ? 'wired' : 'registered_unwired',
      inputSchemaVersion: definition.inputSchemaVersion,
      supportedFields: [...definition.supportedFields],
      permissionPolicyRef: definition.sourceReferences.find(ref => ref.path === REGISTRY_PATH)?.symbol ?? 'current ProcessLineWebhookUseCase access/feature gates; operation-specific permission rule is documented below',
      authorization: {
        requiredPermissionsAllOf: [...definition.requiredPermissions],
        anyOfPermissions: [...definition.anyOfPermissions],
        requiredRoles: [],
        roleRestrictions: 'permission resolver and owner-bound handler; no role override from LINE event body',
        featureKeys: [...definition.featureKeys],
        actorDelegationRequired: definition.operation === 'line.message_webhook' ? false : 'downstream private tools require API-resolved owner/access',
      },
      channelKinds: [...definition.channelKinds],
      runtimeFlagNames: [...(definition.runtimeFlagNames ?? [])],
      enabledByDefault,
      dataBasis: definition.dataBasis,
      runtimeContractVersion: LINE_AI_RUNTIME_CONTRACT_VERSION,
      release: definition.release,
      routeRefs: routes.map(route => `${route.method} ${route.path}`),
      sourceReferences: [...definition.sourceReferences],
    };
  });

  const featureCoverage = FEATURE_CATALOG.filter(feature => feature.sellable).map(feature => {
    const matchingOperations = operations.filter(operation => operation.authorization.featureKeys.some(key => key === feature.key || key.startsWith(`${feature.key}.`)));
    const matchingIntakes = apiIntakes.filter(intake => intake.authorization.featureKeys.some(key => key === feature.key || key.startsWith(`${feature.key}.`)));
    const menuBindings = MENU_ENTITLEMENT_BINDINGS.filter(binding => binding.parentFeatureKey === feature.key || binding.entitlementKeys.some(key => key === feature.key || key.startsWith(`${feature.key}.`)));
    const capabilityGroups = LINE_CAPABILITY_GROUPS.filter(group => group.featureKeys.some(key => key === feature.key || key.startsWith(`${feature.key}.`))).map(group => group.id);
    return {
      featureKey: feature.key,
      description: feature.descriptionTh,
      sellable: feature.sellable,
      entitlementKeys: [feature.key, ...feature.submenus.map(submenu => submenu.key)],
      menuBindingIds: menuBindings.map(binding => binding.navKey).sort(),
      menuGatePermissions: [...new Set(menuBindings.flatMap(binding => binding.gatePermissions))].sort(),
      lineCapabilityGroups: capabilityGroups.sort(),
      registryOperations: matchingOperations.map(operation => operation.operation).sort(),
      apiIntakes: matchingIntakes.map(intake => intake.operation).sort(),
      assistantCoverage: matchingOperations.some(operation => operation.implementation === 'wired') || matchingIntakes.some(intake => intake.enabledByDefault)
        ? 'partial_or_scoped'
        : matchingOperations.length || matchingIntakes.length ? 'registered_unwired_or_flagged_off' : 'web_only_no_line_ai_operation_declared',
      sourceReferences: [
        { path: FEATURE_CATALOG_PATH, symbol: `FEATURE_CATALOG[${JSON.stringify(feature.key)}]` },
        ...menuBindings.map(binding => ({ path: MENU_CATALOG_PATH, symbol: `MENU_ENTITLEMENT_BINDINGS[${JSON.stringify(binding.navKey)}]` })),
      ],
    };
  });

  const familyCoverage = W00_FAMILIES.map(family => {
    const registryOperations = operations.filter(operation => family.match(operation.operation));
    const apiOperations = apiIntakes.filter(intake => family.featureKeys.some(key => intake.authorization.featureKeys.some(found => found === key || found.startsWith(`${key}.`))));
    const catalogFeatures = FEATURE_CATALOG.filter(feature => family.featureKeys.some(key => key === feature.key || key.startsWith(`${feature.key}.`) || feature.key === key));
    return {
      family: family.id,
      featureKeys: [...family.featureKeys],
      featureCatalogRefs: catalogFeatures.map(feature => feature.key),
      registryOperations: registryOperations.map(operation => operation.operation).sort(),
      apiIntakes: apiOperations.map(operation => operation.operation).sort(),
      status: registryOperations.some(operation => operation.implementation === 'wired') || apiOperations.some(operation => operation.enabledByDefault)
        ? 'assistant_wired_or_intake'
        : registryOperations.length || apiOperations.length ? 'registered_unwired_or_flagged_off' : 'web_only_or_no_line_path',
      note: family.id === 'accounts_receivable'
        ? 'Shares the sales_documents entitlement; separated here because receivables are a distinct W00 family.'
        : family.id === 'attachment_evidence'
          ? 'LINE capture intake is separate from registry toolMap; tool registration alone does not establish receipt OCR or document-QA fact correctness.'
          : 'Family mapping is a capability-coverage index, not a data-completeness claim.',
    };
  });

  const runtimeFlags = RUNTIME_FLAG_NAMES.map(name => ({
    name,
    defaultValue: currentFlags[name],
    sourceReference: { path: CONFIG_PATH, symbol: `apiConfigSchema.${name}` },
  }));
  const sourceHashes = [...new Set([...SOURCE_REFERENCES.map(ref => ref.path), ...operations.flatMap(operation => operation.sourceReferences.map(ref => ref.path)).filter(path => path !== 'unknown'), ...apiIntakes.flatMap(intake => intake.sourceReferences.map(ref => ref.path))])]
    .sort().map(path => ({ path, sha256: sourceHash(path) }));
  const content = {
    schemaVersion: 'line-ai-capability-manifest/v1',
    manifestVersion: 'W00-2026-09-27.1',
    baseBranch: 'origin/main',
    baseRevision: git(['merge-base', 'HEAD', 'origin/main']),
    sourceRevision: git(['rev-parse', 'HEAD']),
    checkoutBranch: git(['branch', '--show-current']),
    checkoutDirty: !!git(['status', '--porcelain']),
    sourceHashes,
    featureEntitlementKeys: [...ALL_FEATURE_ENTITLEMENT_KEYS].sort(),
    menuEntitlementKeysMissingFromFeatureCatalog: [...new Set(MENU_ENTITLEMENT_BINDINGS.flatMap(binding => binding.entitlementKeys))]
      .filter(key => !ALL_FEATURE_ENTITLEMENT_KEYS.includes(key)).sort(),
    declaredRegisteredUnwiredOperations: REGISTERED_UNWIRED_REASONS,
    baseline: {
      runtimeContractVersion: LINE_AI_RUNTIME_CONTRACT_VERSION,
      inputSchemaVersion: 'LINE_TOOL_REGISTRY/v1 (registry has no explicit version field)',
      scope: 'Executable API capability wiring and source catalog parity. No DB oracle, live provider, or customer entitlement state is asserted.',
    },
    runtimeFlags,
    registryVisibility: {
      defaultVisibleOperations: [...defaultVisibleNames].sort(),
      defaultHiddenDynamicOperations: LINE_TOOL_REGISTRY.filter(meta => !defaultVisibleNames.has(meta.name)).map(meta => meta.name).sort(),
      note: 'Visibility is lineToolRegistryFor() under API config schema defaults. Company entitlement, effective permissions, per-company allowlists and downstream Gateway providers remain runtime checks.',
    },
    defaultVisibleButNonReady: operations.filter(operation => operation.defaultVisible && operation.implementation !== 'wired')
      .map(operation => ({ operation: operation.operation, execution: operation.execution, nonReadyReason: operation.wiringEvidence.nonReadyReason })),
    moduleFeatureDefaults: TOOL_MODULE_FEATURE_KEYS,
    operations,
    apiIntakes,
    apiRoutes,
    soldFeatureCoverage: featureCoverage,
    w00FamilyCoverage: familyCoverage,
    deferred: [
      {
        capability: 'voice_input_and_transcription', execution: 'deferred', implementation: 'deferred', release: 'DEFERRED',
        status: 'no current API tool, intake handler, or activation flag inventoried for voice; W10/C13/E18/E19 remain deferred per implementation index',
        sourceReferences: [{ path: 'docs/plans/mangmee-ai-implementation-index-2026-09-27.md', symbol: '§1 deferred C13/W10/E18/E19' }],
      },
    ],
    moduleWiring: {
      lineAiModuleControllers: wiring.moduleControllers.map(controller => controller.name).sort(),
      lineAiModuleExports: wiring.moduleExports.map(token => typeof token === 'function' ? token.name : String(token)).sort(),
      internalToolConstructorDependencies: wiring.dependencies.map(dependency => ({ parameter: dependency.parameterName, provider: dependency.typeName })),
      internalToolsControllerInModule: wiring.moduleControllers.includes(InternalToolsController),
      erpReadToolRegistryProvider: ERP_READ_TOOL_REGISTRY,
      erpReadToolRegistryInjectedAdapters: wiring.registryProvider.inject?.map(token => token.name).sort() ?? [],
      erpReadToolRegistryFactoryMappedOperations: [...wiring.evidenceRegistry.keys()].sort(),
      registryOrphanHandlers,
      duplicateRegistryNames,
    },
  };
  const manifestDigest = lineAiCapabilityManifestDigestFor(content);
  return { ...content, generatedAt, manifestDigest };
}

export function lineAiCapabilityManifestArtifactPath(): string {
  return resolve(ROOT, ARTIFACT_PATH);
}
