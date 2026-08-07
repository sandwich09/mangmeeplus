import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ApplyChartTemplateInput,
  ApplyChartTemplateResult,
  ChartOfAccountsReadiness,
  ChartTemplateMetadata,
  ChartTemplatePreviewResult,
  RequestContext,
} from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service.js';
import { AuditService } from '../../../audit/application/audit.service.js';
import {
  TH_SME_COA_V1,
  TH_SME_COA_V1_MAPPING_MANIFEST,
} from '../../domain/catalog/th-sme-chart-of-accounts-v1.js';
import {
  validateChartTemplate,
  type ChartTemplatePreview,
} from '../../domain/logic/chart-template.logic.js';
import { chartTemplateAccountWriteData } from './chart-template-bootstrap.service.js';
import { loadChartReadiness, loadChartTemplatePreview } from './chart-template-query.service.js';

const MAX_CONFLICT_DETAILS = 20;

function requirePermission(ctx: RequestContext, permission: string): void {
  if (!ctx.permissions.includes(permission)) throw new ForbiddenException(`Missing permission: ${permission}`);
}

function templateMetadata(): ChartTemplateMetadata {
  return {
    templateKey: TH_SME_COA_V1.key,
    templateVersion: TH_SME_COA_V1.version,
    accountsChecksum: TH_SME_COA_V1.accountsChecksum,
    mappingManifestVersion: TH_SME_COA_V1_MAPPING_MANIFEST.version,
    mappingManifestChecksum: TH_SME_COA_V1.mappingManifestChecksum,
    accountCount: TH_SME_COA_V1.accounts.length,
    mappingSuggestions: [...TH_SME_COA_V1_MAPPING_MANIFEST.suggestions],
  };
}

function templateNotFound(templateKey: string): NotFoundException {
  return new NotFoundException({
    code: 'coa_template_not_found',
    message: `Chart template "${templateKey}" was not found.`,
  });
}

function responseCode(error: unknown): string {
  const response = error && typeof error === 'object' && 'getResponse' in error
    ? (error as { getResponse(): unknown }).getResponse()
    : null;
  return response && typeof response === 'object' && 'code' in response
    ? String((response as { code: unknown }).code)
    : 'coa_postcondition_failed';
}

function isSerializationFailure(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate?.code === 'P2034' || /40001|serialization/i.test(String(candidate?.message ?? ''));
}

function globalShadowCodes(preview: ChartTemplatePreview): string[] {
  return preview.rows
    .filter((row) => (row.dependencies.GLOBAL_ACCOUNT ?? 0) > 0)
    .map((row) => row.code);
}

@Injectable()
export class ChartTemplateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: RequestContext): ChartTemplateMetadata[] {
    requirePermission(ctx, 'ledger.account.read');
    return [templateMetadata()];
  }

  async preview(ctx: RequestContext, templateKey: string): Promise<ChartTemplatePreviewResult> {
    requirePermission(ctx, 'ledger.account.read');
    if (templateKey !== TH_SME_COA_V1.key) throw templateNotFound(templateKey);
    const preview = await loadChartTemplatePreview(this.prisma.client as any, ctx.companyId);
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'ledger.chart_template.preview',
      targetType: 'chart_template',
      targetId: templateKey,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'MEDIUM',
      metadataJson: {
        templateVersion: preview.templateVersion,
        templateChecksum: preview.templateChecksum,
        exact: preview.exact,
        missing: preview.missing,
        unusedConflicts: preview.unusedConflicts,
        inUseConflicts: preview.inUseConflicts,
        conflictCodes: preview.rows
          .filter((row) => row.classification.endsWith('CONFLICT'))
          .slice(0, MAX_CONFLICT_DETAILS)
          .map((row) => row.code),
      },
    });
    return preview;
  }

  async readiness(ctx: RequestContext): Promise<ChartOfAccountsReadiness> {
    requirePermission(ctx, 'ledger.account.read');
    const readiness = await loadChartReadiness(this.prisma.client as any, ctx.companyId);
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'ledger.readiness.view',
      targetType: 'company',
      targetId: ctx.companyId,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'LOW',
      metadataJson: {
        chartAccountCount: readiness.chartAccountCount,
        chartConflicts: readiness.chartConflicts,
        readyForManualLedger: readiness.readyForManualLedger,
        readyForAutomaticPosting: readiness.readyForAutomaticPosting,
      },
    });
    return readiness;
  }

  async apply(
    ctx: RequestContext,
    templateKey: string,
    input: ApplyChartTemplateInput,
  ): Promise<ApplyChartTemplateResult> {
    requirePermission(ctx, 'ledger.account.manage');
    const mode = input.mode ?? 'MISSING_ONLY';
    const acknowledgeConflicts = input.acknowledgeConflicts === true;
    try {
      if (templateKey !== TH_SME_COA_V1.key) throw templateNotFound(templateKey);
      const validationErrors = validateChartTemplate();
      if (validationErrors.length > 0) {
        throw new UnprocessableEntityException({
          code: 'coa_template_invalid',
          message: 'Chart template validation failed.',
          errors: validationErrors.slice(0, MAX_CONFLICT_DETAILS),
        });
      }
      if (input.expectedTemplateChecksum !== TH_SME_COA_V1.accountsChecksum) {
        throw new ConflictException({
          code: 'coa_template_checksum_mismatch',
          message: 'The chart template changed. Preview it again before applying.',
        });
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await this.applyTransaction(ctx, input, mode, acknowledgeConflicts);
        } catch (error) {
          if (isSerializationFailure(error) && attempt === 0) continue;
          if (isSerializationFailure(error)) {
            throw new ConflictException({
              code: 'coa_preview_changed',
              message: 'The chart changed while it was being applied. Preview it again.',
            });
          }
          throw error;
        }
      }
      throw new ConflictException({ code: 'coa_preview_changed', message: 'The chart preview changed.' });
    } catch (error) {
      const stableError = error && typeof error === 'object' && 'getResponse' in error
        ? error
        : new UnprocessableEntityException({
          code: 'coa_postcondition_failed',
          message: 'Chart template apply could not be completed.',
        });
      await this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'ledger.chart_template.apply_failed',
        targetType: 'chart_template',
        targetId: templateKey,
        requestId: ctx.requestId,
        result: 'FAILED',
        riskLevel: 'HIGH',
        metadataJson: {
          templateVersion: TH_SME_COA_V1.version,
          templateChecksum: TH_SME_COA_V1.accountsChecksum,
          mode,
          acknowledgeConflicts,
          error: responseCode(stableError),
        },
      });
      throw stableError;
    }
  }

  private async applyTransaction(
    ctx: RequestContext,
    input: ApplyChartTemplateInput,
    mode: 'MISSING_ONLY' | 'REPLACE_UNUSED',
    acknowledgeConflicts: boolean,
  ): Promise<ApplyChartTemplateResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const preview = await loadChartTemplatePreview(tx, ctx.companyId);
      if (preview.previewChecksum !== input.expectedPreviewChecksum) {
        throw new ConflictException({
          code: 'coa_preview_changed',
          message: 'The company chart changed after preview. No rows were written.',
        });
      }

      const shadows = globalShadowCodes(preview);
      if (shadows.length > 0) {
        throw new ConflictException({
          code: 'coa_semantic_conflict',
          message: 'A global system account shadows one or more template codes.',
          conflicts: shadows.slice(0, MAX_CONFLICT_DETAILS),
        });
      }
      const unusedConflicts = preview.rows.filter((row) => row.classification === 'UNUSED_CONFLICT');
      const inUseConflicts = preview.rows.filter((row) => row.classification === 'IN_USE_CONFLICT');
      const allConflicts = [...unusedConflicts, ...inUseConflicts];
      if (mode === 'MISSING_ONLY' && allConflicts.length > 0 && !acknowledgeConflicts) {
        throw new ConflictException({
          code: inUseConflicts.length > 0 ? 'coa_account_in_use_conflict' : 'coa_semantic_conflict',
          message: 'Chart conflicts must be reviewed before applying missing accounts.',
          conflicts: allConflicts.slice(0, MAX_CONFLICT_DETAILS),
        });
      }
      if (mode === 'REPLACE_UNUSED' && inUseConflicts.length > 0) {
        throw new ConflictException({
          code: 'coa_account_in_use_conflict',
          message: 'Accounts with dependencies cannot be replaced.',
          conflicts: inUseConflicts.slice(0, MAX_CONFLICT_DETAILS),
        });
      }

      const missingCodes = new Set(
        preview.rows.filter((row) => row.classification === 'MISSING').map((row) => row.code),
      );
      const missingAccounts = TH_SME_COA_V1.accounts.filter((account) => missingCodes.has(account.code));
      const created = missingAccounts.length > 0
        ? await tx.chartOfAccount.createMany({
          data: missingAccounts.map((account) => ({
            ...chartTemplateAccountWriteData(account, ctx.userId),
            companyId: ctx.companyId,
            createdByUserId: ctx.userId,
          })) as any,
        })
        : { count: 0 };
      if (created.count !== missingAccounts.length) {
        throw new UnprocessableEntityException({
          code: 'coa_postcondition_failed',
          message: 'Not every missing chart account was created.',
        });
      }

      const replacements = mode === 'REPLACE_UNUSED' ? unusedConflicts : [];
      const replacementIds = replacements
        .map((row) => row.existingAccountId)
        .filter((id): id is string => id !== null);
      const replacementBefore = replacementIds.length > 0
        ? await tx.chartOfAccount.findMany({
          where: { companyId: ctx.companyId, id: { in: replacementIds } },
          select: {
            id: true,
            code: true,
            nameTh: true,
            accountClass: true,
            reportGroup: true,
            normalBalance: true,
            isPosting: true,
            isSystem: true,
            isControlled: true,
          },
        })
        : [];
      if (replacementBefore.length !== replacements.length) {
        throw new ConflictException({
          code: 'coa_preview_changed',
          message: 'One or more chart conflicts changed after preview.',
        });
      }
      for (const conflict of replacements) {
        const account = TH_SME_COA_V1.accounts.find((candidate) => candidate.code === conflict.code)!;
        await tx.chartOfAccount.update({
          where: {
            companyId_id: {
              companyId: ctx.companyId,
              id: conflict.existingAccountId!,
            },
          },
          data: chartTemplateAccountWriteData(account, ctx.userId) as any,
        });
      }

      const appliedAt = new Date();
      await tx.company.update({
        where: { id: ctx.companyId },
        data: {
          chartOfAccountsTemplateKey: TH_SME_COA_V1.key,
          chartOfAccountsTemplateVersion: TH_SME_COA_V1.version,
          chartOfAccountsTemplateChecksum: TH_SME_COA_V1.accountsChecksum,
          chartOfAccountsTemplateAppliedAt: appliedAt,
        },
      });

      const postPreview = await loadChartTemplatePreview(tx, ctx.companyId);
      const allowedConflicts = mode === 'MISSING_ONLY' && acknowledgeConflicts
        ? allConflicts.length
        : 0;
      if (
        postPreview.missing !== 0
        || globalShadowCodes(postPreview).length > 0
        || postPreview.unusedConflicts + postPreview.inUseConflicts !== allowedConflicts
      ) {
        throw new UnprocessableEntityException({
          code: 'coa_postcondition_failed',
          message: 'The chart did not match the confirmed apply result.',
        });
      }
      const readiness = await loadChartReadiness(tx, ctx.companyId, postPreview);

      if (replacementBefore.length > 0) {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'ledger.chart_template.unused_conflict_replace',
          targetType: 'chart_template',
          targetId: TH_SME_COA_V1.key,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            replaced: replacementBefore.slice(0, MAX_CONFLICT_DETAILS),
          },
        }, tx);
      }
      await this.audit.log({
        companyId: ctx.companyId,
        actorUserId: ctx.userId,
        action: 'ledger.chart_template.apply',
        targetType: 'chart_template',
        targetId: TH_SME_COA_V1.key,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'HIGH',
        metadataJson: {
          templateVersion: TH_SME_COA_V1.version,
          templateChecksum: TH_SME_COA_V1.accountsChecksum,
          mode,
          acknowledgeConflicts,
          created: created.count,
          updated: replacements.length,
          acknowledgedConflicts: mode === 'MISSING_ONLY' && acknowledgeConflicts ? allConflicts.length : 0,
          conflictCodes: allConflicts.slice(0, MAX_CONFLICT_DETAILS).map((row) => row.code),
        },
      }, tx);

      return {
        templateKey: TH_SME_COA_V1.key,
        templateVersion: TH_SME_COA_V1.version,
        templateChecksum: TH_SME_COA_V1.accountsChecksum,
        created: created.count,
        updated: replacements.length,
        skipped: preview.exact + (mode === 'MISSING_ONLY' ? allConflicts.length : 0),
        acknowledgedConflicts: mode === 'MISSING_ONLY' && acknowledgeConflicts ? allConflicts.length : 0,
        accountCount: readiness.chartAccountCount,
        readiness,
      };
    }, { isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000 });
  }
}
