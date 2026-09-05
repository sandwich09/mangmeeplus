/**
 * Internal-only controller for AI Gateway to invoke ERP read tools.
 * Requires workload secret plus API-issued, single-use actor delegation.
 */
import { Controller, Post, Body, Headers, UnauthorizedException, Logger, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Public } from '../../../../common/security/public.decorator';
import { assertInternalSecret } from '../../../../common/security/secret-compare';
import { AppConfigService } from '../../../../common/config/app-config.service';
import {
  LINE_ALLOWED_TOOL_CATEGORIES,
  LINE_TOOL_REGISTRY,
  hasToolFeature,
  hasToolPermissions,
  type ToolCategory,
  type ToolMeta,
  type ToolResult,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { AuditService } from '../../../audit/application/audit.service';
import { SECURITY_EVENT, emitSecurityEvent } from '../../../../common/logger/security-event';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import type { AuditLogEntry, AuditResult, AuditRiskLevel } from '../../../audit/domain/models/audit-log.model';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import type { ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import {
  ActorDelegationService,
  type ActorDelegationClaims,
} from '../../infrastructure/actor-delegation.service';
import { CompanyGetCurrentContextTool, CompanyListBranchesTool, DashboardGetHealthSummaryTool, NotificationsListOpenAlertsTool, NotificationsGetDailySummaryTool } from '../../application/use-cases/erp-dashboard-tools.use-case';
import { InventorySearchProductsTool, InventoryListLowStockTool, InventoryGetStockBalanceTool, InventorySummarizeMovementsTool, LedgerFinancialSummaryTool, ExpenseListRecentTool, SalesGetSalesSummaryTool } from '../../application/use-cases/erp-tools.use-case';
import {
  TaxGetCitCalendarTool,
  TaxGetReconciliationSummaryTool,
  TaxGetTaxCodeProfileTool,
  TaxGetTransactionTaxSummaryTool,
  TaxGetUpcomingObligationsTool,
  TaxGetVatSummaryTool,
  TaxGetWhtSummaryTool,
  TaxListMissingDocumentsTool,
} from '../../application/use-cases/erp-tax-tools.use-case';
import { WorkflowExplainRunTool, WorkflowListAssignedTasksTool, WorkflowListRecentFailuresTool, WorkflowSummarizeRuleHealthTool } from '../../application/use-cases/erp-workflow-tools.use-case';
import { AccountingGetSummaryTool, AccountingListRecentDocumentsTool, ProcurementApOutstandingTool, CompanyEmployeeSummaryTool, CompanyEmployeeDetailTool, ExpenseGetBreakdownTool } from '../../application/use-cases/erp-business-tools.use-case';
import { ExpenseGetDailyClosingTool } from '../../application/use-cases/erp-expense-daily-closing.use-case';
import { ReportsMonthlySummaryTool } from '../../application/use-cases/erp-report-tools.use-case';
import { ReimbursementListPendingApprovalsTool } from '../../application/use-cases/erp-reimbursement-tools.use-case';
import { CrmGetCustomerSummaryTool, CrmSearchCustomersTool, CrmGetCustomer360Tool } from '../../application/use-cases/erp-crm-tools.use-case';
import {
  InventoryGetProductDetailTool,
  AccountingGetDocumentDetailTool,
  AccountingGetReceivableSummaryTool,
  ExpenseGetDetailTool,
  ExpenseExplainRecordTool,
  ReimbursementGetSummaryTool,
  ReimbursementGetDetailTool,
} from '../../application/use-cases/erp-core-detail-tools.use-case';
import {
  CrmGetReportSummaryTool,
  CrmGetPipelineSummaryTool,
  CrmListOpenFollowupsTool,
  CrmGetBookingSummaryTool,
  CrmListBookingsTool,
  CrmGetInboxSummaryTool,
  CrmListConversationsTool,
  CrmGetConversationSummaryTool,
} from '../../application/use-cases/erp-crm-operational-tools.use-case';
import {
  ProcurementGetSummaryTool,
  ProcurementSearchSuppliersTool,
  ProcurementGetPurchaseOrderDetailTool,
  LedgerGetPeriodStatusTool,
  LedgerGetReportSummaryTool,
} from '../../application/use-cases/erp-procurement-ledger-tools.use-case';

/**
 * Audit H-23: this was a `type` named `...Dto`, so the global ValidationPipe saw metatype `Object`
 * and skipped it — on the one endpoint the AI gateway calls to execute ERP tools. As classes the
 * body is now whitelisted, and an unknown top-level key is a 400 instead of being carried inward.
 *
 * Only `userId` and `companyId` are required: those two are dereferenced to resolve access, so a
 * body without them cannot mean anything. Everything else stays optional ON PURPOSE — this is a
 * live path, and promoting a field to required here would turn a caller that has always omitted it
 * into a 400 the moment this deploys. Shape is checked; the contract is not tightened.
 *
 * The authoritative values are re-derived anyway: permissions, roles, branch and location scopes
 * come from resolveAccess(), never from this body, which is why validating them is about shape
 * rather than trust.
 */
class InternalToolContextDto {
  @IsString() @IsNotEmpty() @MaxLength(64) companyId!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) userId!: string;
  @IsString() @IsOptional() @MaxLength(128) requestId?: string;
  @IsString() @IsOptional() @MaxLength(64) membershipId?: string;
  @IsString() @IsOptional() @MaxLength(32) locale?: string;
  /** Chat provenance (spec §5.5). Shape-checked only, exactly like `locale`: it selects which of
   *  the CALLER'S OWN records a read tool may resolve as "the one from this chat" and grants
   *  nothing — company, membership, permissions and branch scope are re-derived below. */
  @IsString() @IsOptional() @MaxLength(128) chatKeyHash?: string;
  @IsArray() @IsString({ each: true }) @IsOptional() roles?: string[];
  @IsArray() @IsString({ each: true }) @IsOptional() permissions?: string[];
  @IsArray() @IsString({ each: true }) @IsOptional() branchIds?: string[];
  @IsArray() @IsString({ each: true }) @IsOptional() locationIds?: string[];
}

export class InternalToolCallDto {
  @IsString() @IsNotEmpty() @MaxLength(120) toolName!: string;
  @ValidateNested() @Type(() => InternalToolContextDto) context!: InternalToolContextDto;
  // Free-form by design: every tool declares its own input schema and validates it downstream.
  // Whitelisting the keys here would mean restating each tool's schema in the transport layer.
  @IsObject() @IsOptional() input?: Record<string, unknown>;
}

/**
 * L-08: classification is re-enforced here because this executor — not the AI Gateway — is
 * authoritative. Anything holding the internal secret plus a valid delegation reaches this
 * method directly, so the gateway's ToolPolicyEnforcerService cannot be the only gate.
 * Semantics mirror `toolMetaToPolicy` in the gateway: mutation == final_mutation | approval_request.
 */
const MUTATION_TOOL_CATEGORIES: ReadonlySet<ToolCategory> = new Set<ToolCategory>(['final_mutation', 'approval_request']);
const KNOWN_TOOL_CATEGORIES: ReadonlySet<string> = new Set<ToolCategory>([
  ...LINE_ALLOWED_TOOL_CATEGORIES,
  'draft_create',
  'approval_request',
  'final_mutation',
]);

@ApiTags('internal')
@Controller('internal/ai/tools')
export class InternalToolsController {
  private readonly logger = new Logger(InternalToolsController.name);

  private readonly toolMap: Map<string, { execute(ctx: ErpToolContext, input: Record<string, unknown>): Promise<ToolResult> }> = new Map();

  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly resolver: PermissionResolverService,
    private readonly actorDelegation: ActorDelegationService,
    private readonly companyCtx: CompanyGetCurrentContextTool,
    private readonly companyBranches: CompanyListBranchesTool,
    private readonly dashboardHealth: DashboardGetHealthSummaryTool,
    private readonly notifAlerts: NotificationsListOpenAlertsTool,
    private readonly notifDaily: NotificationsGetDailySummaryTool,
    private readonly invSearch: InventorySearchProductsTool,
    private readonly invLowStock: InventoryListLowStockTool,
    private readonly invBalance: InventoryGetStockBalanceTool,
    private readonly invMovements: InventorySummarizeMovementsTool,
    private readonly ledgerSummary: LedgerFinancialSummaryTool,
    private readonly expenseListRecent: ExpenseListRecentTool,
    private readonly salesSummary: SalesGetSalesSummaryTool,
    private readonly taxUpcomingObligations: TaxGetUpcomingObligationsTool,
    private readonly taxVatSummary: TaxGetVatSummaryTool,
    private readonly taxWhtSummary: TaxGetWhtSummaryTool,
    private readonly taxCitCalendar: TaxGetCitCalendarTool,
    private readonly taxMissingDocs: TaxListMissingDocumentsTool,
    private readonly taxCodeProfile: TaxGetTaxCodeProfileTool,
    private readonly transactionTaxSummary: TaxGetTransactionTaxSummaryTool,
    private readonly taxReconciliationSummary: TaxGetReconciliationSummaryTool,
    private readonly workflowExplainRun: WorkflowExplainRunTool,
    private readonly workflowAssignedTasks: WorkflowListAssignedTasksTool,
    private readonly workflowRecentFailures: WorkflowListRecentFailuresTool,
    private readonly workflowRuleHealth: WorkflowSummarizeRuleHealthTool,
    private readonly reportMonthlySummary: ReportsMonthlySummaryTool,
    private readonly accountingSummary: AccountingGetSummaryTool,
    private readonly accountingRecentDocs: AccountingListRecentDocumentsTool,
    private readonly apOutstanding: ProcurementApOutstandingTool,
    private readonly employeeSummary: CompanyEmployeeSummaryTool,
    private readonly employeeDetail: CompanyEmployeeDetailTool,
    private readonly expenseBreakdown: ExpenseGetBreakdownTool,
    private readonly expenseDailyClosing: ExpenseGetDailyClosingTool,
    private readonly reimbursementPendingApprovals: ReimbursementListPendingApprovalsTool,
    private readonly customerSummary: CrmGetCustomerSummaryTool,
    private readonly customerSearch: CrmSearchCustomersTool,
    private readonly customer360: CrmGetCustomer360Tool,
    private readonly crmReportSummary: CrmGetReportSummaryTool,
    private readonly crmPipelineSummary: CrmGetPipelineSummaryTool,
    private readonly crmOpenFollowups: CrmListOpenFollowupsTool,
    private readonly crmBookingSummary: CrmGetBookingSummaryTool,
    private readonly crmBookings: CrmListBookingsTool,
    private readonly crmInboxSummary: CrmGetInboxSummaryTool,
    private readonly crmConversations: CrmListConversationsTool,
    private readonly crmConversationSummary: CrmGetConversationSummaryTool,
    private readonly invProductDetail: InventoryGetProductDetailTool,
    private readonly expenseDetail: ExpenseGetDetailTool,
    private readonly expenseExplain: ExpenseExplainRecordTool,
    private readonly reimbursementSummary: ReimbursementGetSummaryTool,
    private readonly reimbursementDetail: ReimbursementGetDetailTool,
    private readonly accountingDocumentDetail: AccountingGetDocumentDetailTool,
    private readonly accountingReceivableSummary: AccountingGetReceivableSummaryTool,
    private readonly procurementSummary: ProcurementGetSummaryTool,
    private readonly supplierSearch: ProcurementSearchSuppliersTool,
    private readonly purchaseOrderDetail: ProcurementGetPurchaseOrderDetailTool,
    private readonly ledgerPeriodStatus: LedgerGetPeriodStatusTool,
    private readonly ledgerReportSummary: LedgerGetReportSummaryTool,
  ) {
    this.toolMap.set('company.get_current_context', this.companyCtx);
    this.toolMap.set('company.list_branches', this.companyBranches);
    this.toolMap.set('dashboard.get_business_health_summary', this.dashboardHealth);
    this.toolMap.set('notifications.list_open_alerts', this.notifAlerts);
    this.toolMap.set('notifications.get_daily_summary', this.notifDaily);
    this.toolMap.set('inventory.search_products', this.invSearch);
    this.toolMap.set('inventory.get_product_detail', this.invProductDetail);
    this.toolMap.set('inventory.list_low_stock', this.invLowStock);
    this.toolMap.set('inventory.get_stock_balance', this.invBalance);
    this.toolMap.set('inventory.summarize_stock_movements', this.invMovements);
    this.toolMap.set('ledger.get_financial_summary', this.ledgerSummary);
    this.toolMap.set('expense.list_recent', this.expenseListRecent);
    this.toolMap.set('expense.get_detail', this.expenseDetail);
    this.toolMap.set('expense.explain_record', this.expenseExplain);
    this.toolMap.set('sales.get_sales_summary', this.salesSummary);
    this.toolMap.set('tax.get_upcoming_tax_obligations', this.taxUpcomingObligations);
    this.toolMap.set('tax.get_vat_summary', this.taxVatSummary);
    this.toolMap.set('tax.get_wht_summary', this.taxWhtSummary);
    this.toolMap.set('tax.get_cit_calendar', this.taxCitCalendar);
    this.toolMap.set('tax.list_missing_tax_documents', this.taxMissingDocs);
    this.toolMap.set('tax.get_tax_code_profile', this.taxCodeProfile);
    this.toolMap.set('tax.get_transaction_tax_summary', this.transactionTaxSummary);
    this.toolMap.set('tax.get_reconciliation_summary', this.taxReconciliationSummary);
    this.toolMap.set('workflow.explain_run', this.workflowExplainRun);
    this.toolMap.set('workflow.list_assigned_tasks', this.workflowAssignedTasks);
    this.toolMap.set('workflow.list_recent_failures', this.workflowRecentFailures);
    this.toolMap.set('workflow.summarize_rule_health', this.workflowRuleHealth);
    this.toolMap.set('reports.get_monthly_report_summary', this.reportMonthlySummary);
    this.toolMap.set('accounting.get_summary', this.accountingSummary);
    this.toolMap.set('accounting.list_recent_documents', this.accountingRecentDocs);
    this.toolMap.set('procurement.get_ap_outstanding', this.apOutstanding);
    this.toolMap.set('company.get_employee_summary', this.employeeSummary);
    this.toolMap.set('company.get_employee_detail', this.employeeDetail);
    this.toolMap.set('expense.get_breakdown', this.expenseBreakdown);
    this.toolMap.set('expense.get_daily_closing', this.expenseDailyClosing);
    this.toolMap.set('reimbursement.list_pending_approvals', this.reimbursementPendingApprovals);
    this.toolMap.set('reimbursement.get_summary', this.reimbursementSummary);
    this.toolMap.set('reimbursement.get_detail', this.reimbursementDetail);
    this.toolMap.set('accounting.get_document_detail', this.accountingDocumentDetail);
    this.toolMap.set('accounting.get_receivable_summary', this.accountingReceivableSummary);
    this.toolMap.set('crm.get_customer_summary', this.customerSummary);
    this.toolMap.set('crm.search_customers', this.customerSearch);
    this.toolMap.set('crm.get_customer_360', this.customer360);
    this.toolMap.set('crm.get_report_summary', this.crmReportSummary);
    this.toolMap.set('crm.get_pipeline_summary', this.crmPipelineSummary);
    this.toolMap.set('crm.list_open_followups', this.crmOpenFollowups);
    this.toolMap.set('crm.get_booking_summary', this.crmBookingSummary);
    this.toolMap.set('crm.list_bookings', this.crmBookings);
    this.toolMap.set('crm.get_inbox_summary', this.crmInboxSummary);
    this.toolMap.set('crm.list_conversations', this.crmConversations);
    this.toolMap.set('crm.get_conversation_summary', this.crmConversationSummary);
    this.toolMap.set('procurement.get_summary', this.procurementSummary);
    this.toolMap.set('procurement.search_suppliers', this.supplierSearch);
    this.toolMap.set('procurement.get_purchase_order_detail', this.purchaseOrderDetail);
    this.toolMap.set('ledger.get_period_status', this.ledgerPeriodStatus);
    this.toolMap.set('ledger.get_report_summary', this.ledgerReportSummary);
  }

  @Public()
  @Post('invoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Internal: invoke a read-only ERP tool (AI Gateway only)' })
  async invoke(
    @Headers('x-internal-secret') secret: string | undefined,
    @Headers('x-actor-delegation') delegationToken: string | undefined,
    @Body() dto: InternalToolCallDto,
  ): Promise<ToolResult> {
    const startedAt = Date.now();
    // L-07: one named, constant-time assert instead of an open-coded compare.
    assertInternalSecret(secret, this.config.aiGatewayInternalSecret);

    let delegation: ActorDelegationClaims;
    try {
      delegation = await this.actorDelegation.consume(delegationToken ?? '', {
        userId: dto.context.userId,
        companyId: dto.context.companyId,
        membershipId: dto.context.membershipId ?? '',
        requestId: dto.context.requestId ?? '',
        toolName: dto.toolName,
      });
    } catch {
      // M-02: no durable audit row here on purpose — nothing about the caller is verified yet, so a
      // row keyed to a forged userId/companyId would let an attacker spam the audit trail. The pino
      // -wired security event is the visibility win; durable audits start at the resolver deny below.
      this.emitToolEvent(SECURITY_EVENT.aiToolInvokeDenied, 'MEDIUM', {
        reasonCode: 'INVALID_ACTOR_DELEGATION',
        toolName: dto.toolName,
      });
      throw new UnauthorizedException('Invalid actor delegation.');
    }
    // Delegation claims are API-issued and verified, so they win over the caller-supplied body.
    const auditRequestId = delegation.requestId || dto.context.requestId || `line-ai-tool-${Date.now()}`;

    // SEC-02/SEC-03: never trust caller-supplied authorization. Re-resolve the
    // authoritative permissions/scope from current DB state using only the
    // identity references, then require the AI-tool gate. Caller-supplied
    // permissions/branchIds/roles/membership/company are ignored.
    let access: Awaited<ReturnType<PermissionResolverService['resolveAccess']>>;
    try {
      access = await this.resolver.resolveAccess(dto.context.userId, dto.context.companyId);
    } catch {
      // No verified company yet (resolveAccess failed), so the row stays company-less and keeps the
      // claimed id in metadata only — writing an unverified companyId would also risk an FK reject.
      await this.auditToolOutcome({
        actorUserId: delegation.sub,
        requestId: auditRequestId,
        toolName: dto.toolName,
        reasonCode: 'NO_AUTHORITATIVE_ACCESS',
        riskLevel: 'MEDIUM',
        startedAt,
        extra: { claimedCompanyId: dto.context.companyId },
      });
      return {
        toolName: dto.toolName,
        status: 'forbidden',
        sourceRefs: [],
        asOf: new Date().toISOString(),
        errorCode: 'AI_PERMISSION_DENIED',
      };
    }
    if (access.companyId !== delegation.companyId || access.membershipId !== delegation.membershipId) {
      // The signature already verified the actor and the jti is burned, so this attempt must leave a
      // durable row keyed to the *verified* company — the mismatching claims stay in metadata.
      await this.auditToolOutcome({
        companyId: access.companyId,
        actorUserId: delegation.sub,
        requestId: auditRequestId,
        toolName: dto.toolName,
        reasonCode: 'STALE_ACTOR_DELEGATION',
        riskLevel: 'MEDIUM',
        startedAt,
        extra: {
          delegationCompanyId: delegation.companyId,
          delegationMembershipId: delegation.membershipId,
        },
      });
      throw new UnauthorizedException('Invalid actor delegation.');
    }

    // Fail-closed (M-02): the jti is already burned, so a lost consume row would erase the only
    // durable record that this delegation was spent. `logOrThrow` 500s instead of proceeding.
    await this.audit.logOrThrow({
      companyId: access.companyId,
      actorUserId: delegation.sub,
      action: AuditAction.AI_ACTOR_DELEGATION_CONSUME,
      targetType: 'AiActorDelegation',
      targetId: delegation.jti,
      requestId: delegation.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        workload: delegation.workload,
        audience: delegation.aud,
        membershipId: delegation.membershipId,
        toolName: delegation.toolName,
      },
    });

    if (!access.permissions.includes('ai.tool.invoke')) {
      await this.auditToolOutcome({
        companyId: access.companyId,
        actorUserId: delegation.sub,
        requestId: auditRequestId,
        toolName: dto.toolName,
        reasonCode: 'AI_TOOL_GATE_MISSING',
        riskLevel: 'MEDIUM',
        startedAt,
      });
      return {
        toolName: dto.toolName,
        status: 'forbidden',
        sourceRefs: [],
        asOf: new Date().toISOString(),
        errorCode: 'AI_PERMISSION_DENIED',
      };
    }
    const ctx: ErpToolContext = {
      requestId: dto.context.requestId,
      companyId: access.companyId,
      userId: dto.context.userId,
      membershipId: access.membershipId,
      roles: access.roles,
      permissions: access.permissions,
      branchIds: access.scopes.branchIds,
      locationIds: access.scopes.locationIds,
      // `locale` is optional on the DTO so an existing caller that omits it is not turned into a
      // 400 by this change; ErpToolContext still wants a value, and Thai is what this channel is.
      locale: dto.context.locale ?? 'th',
      ...(dto.context.chatKeyHash ? { chatKeyHash: dto.context.chatKeyHash } : {}),
    };

    // L-08 deny order — registry entry, then classification, then ERP permissions, then company
    // feature entitlement, then wiring.
    // Every branch below is fail-closed: nothing reaches `tool.execute` without a registry entry
    // whose category this phase allows.
    const meta = LINE_TOOL_REGISTRY.find((entry) => entry.name === dto.toolName);
    const deny = async (
      reasonCode: string,
      riskLevel: AuditRiskLevel,
      status: ToolResult['status'],
      errorCode: string,
    ): Promise<ToolResult> => {
      await this.auditToolOutcome({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        requestId: auditRequestId,
        toolName: dto.toolName,
        reasonCode,
        riskLevel,
        startedAt,
      });
      return { toolName: dto.toolName, status, sourceRefs: [], asOf: new Date().toISOString(), errorCode };
    };

    // 1. No registry entry → denied before any permission or dispatch decision. The old
    //    `if (meta && …)` shape skipped the permission check for unregistered names entirely.
    if (!meta) return deny('TOOL_NOT_FOUND', 'LOW', 'unavailable', 'TOOL_NOT_FOUND');

    // 2. Classification, re-enforced on the authoritative side (the gateway is not a gate).
    const categoryDenial = this.classificationDenial(meta);
    if (categoryDenial) return deny(categoryDenial, 'HIGH', 'forbidden', 'AI_TOOL_CATEGORY_DENIED');

    // 3. ERP permissions from the registry entry, now unconditionally.
    if (!hasToolPermissions(meta, ctx.permissions)) {
      // The resolver strips permissions whose owning feature is OFF, so most disabled modules
      // already fail here. Reporting that as a permission denial tells the user "🔒 คุณไม่มีสิทธิ์"
      // and sends them to an admin for a grant they already hold. Put the stripped permissions back:
      // if the tool would then be allowed, the feature switch is the cause, not the role.
      const withoutEntitlementStripping = [
        ...ctx.permissions,
        ...Object.keys(access.entitlementDeniedPermissions ?? {}),
      ];
      return hasToolPermissions(meta, withoutEntitlementStripping)
        ? deny('FEATURE_NOT_ENABLED', 'LOW', 'unsupported_module', 'FEATURE_NOT_ENABLED')
        : deny('ERP_PERMISSION_DENIED', 'MEDIUM', 'forbidden', 'ERP_PERMISSION_DENIED');
    }

    // 4. Permitted, but the company never switched this tool's own module on. Checked AFTER
    //    permissions so only a caller who could otherwise read the data learns which features this
    //    company runs. Catches the tools whose permission belongs to a different feature than the
    //    data they read — `sales.get_sales_summary` reads sales documents while its permission
    //    (`crm.report.read`) is gated by CRM, so a company with sales off still answered.
    if (!hasToolFeature(meta, await loadEntitledFeatureKeys(this.prisma, ctx.companyId))) {
      return deny('FEATURE_NOT_ENABLED', 'LOW', 'unsupported_module', 'FEATURE_NOT_ENABLED');
    }

    // 5. Registered and allowed, but the source module is not wired in this build.
    const tool = this.toolMap.get(dto.toolName);
    if (!tool) return deny('SOURCE_MODULE_NOT_READY', 'LOW', 'unsupported_module', 'SOURCE_MODULE_NOT_READY');

    try {
      const result = await tool.execute(ctx, dto.input ?? {});
      if (meta.sensitiveAudit && result.status === 'ok') {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: AuditAction.AI_TOOL_INVOKE,
          targetType: 'AiReadTool',
          targetId: dto.toolName,
          requestId: auditRequestId,
          result: 'SUCCESS',
          riskLevel: 'MEDIUM',
          metadataJson: {
            toolName: dto.toolName,
            durationMs: Date.now() - startedAt,
            sourceRefs: result.sourceRefs.map((source) => ({
              module: source.module,
              entityType: source.entityType,
              entityId: source.entityId,
              label: source.label,
            })),
          },
        });
      }
      return result;
    } catch (err) {
      await this.auditToolOutcome({
        action: AuditAction.AI_TOOL_INVOKE_FAILED,
        result: 'FAILED',
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        requestId: auditRequestId,
        toolName: dto.toolName,
        reasonCode: 'TOOL_EXECUTION_ERROR',
        riskLevel: meta.sensitiveAudit ? 'HIGH' : 'MEDIUM',
        startedAt,
        error: (err as Error).message,
      });
      return { toolName: dto.toolName, status: 'error', sourceRefs: [], asOf: new Date().toISOString(), errorCode: 'TOOL_EXECUTION_ERROR', errorMessage: 'Tool execution failed' };
    }
  }

  /**
   * L-08: the classification gate. Returns a stable reason code when this executor must refuse,
   * or undefined when the tool's category is executable in the current phase.
   * The mutation gate is checked before the phase allowlist so a kill-switch trip is reported as
   * itself rather than being masked by the (also failing) allowlist check.
   */
  private classificationDenial(meta: ToolMeta): string | undefined {
    const category = meta.category as string;
    if (!KNOWN_TOOL_CATEGORIES.has(category)) return 'TOOL_CATEGORY_UNKNOWN';
    if (MUTATION_TOOL_CATEGORIES.has(meta.category) && !this.config.aiFinalMutationEnabled) {
      return 'AI_FINAL_MUTATION_DISABLED';
    }
    if (!LINE_ALLOWED_TOOL_CATEGORIES.includes(meta.category)) return 'TOOL_CATEGORY_NOT_ALLOWED';
    return undefined;
  }

  /**
   * L-14: mirrors the durable audit reason code into the log stream under the exact event name the
   * production metric filter keys on, with a root-level `riskLevel`. A kill-switch trip must never
   * be log-only, and it must never be free text either — an English sentence cannot be an alarm key.
   *
   * HIGH/CRITICAL denials route through the shared `emitSecurityEvent` so the name comes from the
   * SECURITY_EVENT catalog rather than a string invented here. MEDIUM/LOW outcomes emit the same
   * shape carrying their own accurate risk — the alarm's `$.msg = "ai.tool.invoke.denied"` clause
   * already matches those, and relabelling a not-yet-wired tool as HIGH would only train operators
   * to ignore the alarm. An execution *failure* is not a denial, so it keeps its own name at error.
   */
  private emitToolEvent(event: string, riskLevel: AuditRiskLevel, fields: Record<string, unknown>): void {
    if (event === SECURITY_EVENT.aiToolInvokeDenied && (riskLevel === 'HIGH' || riskLevel === 'CRITICAL')) {
      emitSecurityEvent(this.logger, SECURITY_EVENT.aiToolInvokeDenied, riskLevel, fields);
      return;
    }
    this.logger[event === AuditAction.AI_TOOL_INVOKE_FAILED ? 'error' : 'warn']({ ...fields, msg: event, riskLevel });
  }

  /**
   * M-02 G3: durable, fail-closed AuditLog row for every non-OK outcome at the internal tool
   * boundary. Metadata stays to `{ toolName, reasonCode, durationMs }` — never inputs or refs.
   *
   * A **denial** is decided before anything executes, so it uses the fail-closed `logOrThrow`:
   * no durable row, no request. (L-10 made the post-commit `log()` swallow a doubly-failed
   * insert so a committed financial mutation is never turned into a 500 — right for a
   * post-commit caller, wrong for a gate.) An execution *failure* is post-effect — the tool
   * already ran — so it keeps the non-throwing `log()`.
   *
   * L-08/L-14: the same outcome is also emitted as a named security event, so a denial is visible
   * to CloudWatch (which cannot read a Postgres row) and not only to the audit trail.
   */
  private async auditToolOutcome(input: {
    action?: string;
    result?: AuditResult;
    companyId?: string;
    actorUserId: string;
    requestId: string;
    toolName: string;
    reasonCode: string;
    riskLevel: AuditRiskLevel;
    startedAt: number;
    extra?: Record<string, unknown>;
    error?: string;
  }): Promise<void> {
    const event = input.action ?? AuditAction.AI_TOOL_INVOKE_DENIED;
    this.emitToolEvent(event, input.riskLevel, {
      reasonCode: input.reasonCode,
      toolName: input.toolName,
      requestId: input.requestId,
      ...(input.error ? { error: input.error } : {}),
    });
    const entry: AuditLogEntry = {
      ...(input.companyId ? { companyId: input.companyId } : {}),
      actorUserId: input.actorUserId,
      action: event,
      targetType: 'AiReadTool',
      targetId: input.toolName,
      requestId: input.requestId,
      result: input.result ?? 'DENIED',
      riskLevel: input.riskLevel,
      metadataJson: {
        toolName: input.toolName,
        reasonCode: input.reasonCode,
        durationMs: Date.now() - input.startedAt,
        ...input.extra,
      },
    };
    await (entry.result === 'FAILED' ? this.audit.log(entry) : this.audit.logOrThrow(entry));
  }
}
