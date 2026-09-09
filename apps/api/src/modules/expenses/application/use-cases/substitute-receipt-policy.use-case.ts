import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  RequestContext,
  SubstituteReceiptPolicySettings,
  SubstituteReceiptRuntimePolicy,
  UpdateSubstituteReceiptPolicyInput,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { PrismaExpenseRepository } from '../../infrastructure/prisma-expense.repository';
import { signatureInlineUrl } from './signature-asset.use-case';

const CASH_POLICIES = new Set(['REQUIRE_SEPARATE_PAYMENT_EVIDENCE', 'ALLOW_SUPPORTING_EVIDENCE_ONLY']);
const APPROVAL_MODES = new Set(['OWNER_SELF', 'DESIGNATED_APPROVERS']);

function parseInstructions(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('cashEvidenceInstructions must be text.');
  const text = value.trim();
  if (text.length > 500) throw new BadRequestException('cashEvidenceInstructions must be at most 500 characters.');
  return text || null;
}

@Injectable()
export class GetSubstituteReceiptPolicyUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext): Promise<SubstituteReceiptPolicySettings> {
    const [policy, candidates] = await Promise.all([
      this.repo.getSubstituteReceiptPolicy(ctx.companyId),
      this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId),
    ]);
    const approverUserIds = policy?.approverUserIds ?? [];
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    const candidateIds = new Set(candidates.map((candidate) => candidate.userId));
    return {
      configured: Boolean(policy),
      ready: approvalMode === 'OWNER_SELF' || approverUserIds.length > 0,
      approvalMode,
      approverUserIds,
      invalidApproverUserIds: approverUserIds.filter((userId) => !candidateIds.has(userId)),
      cashEvidencePolicy: policy?.cashEvidencePolicy ?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY',
      cashEvidenceInstructions: policy?.cashEvidenceInstructions ?? null,
      approverCandidates: candidates,
      updatedByUserId: policy?.updatedByUserId ?? null,
      updatedAt: policy?.updatedAt.toISOString() ?? null,
    };
  }

  async executeRuntime(ctx: RequestContext): Promise<SubstituteReceiptRuntimePolicy> {
    // R9: the signing UI asks for an upload only when this caller has no reusable signature yet.
    const [policy, reusableSignature, signerJobTitle, company] = await Promise.all([
      this.repo.getSubstituteReceiptPolicy(ctx.companyId),
      this.repo.findReusableSignatureAsset(ctx.companyId, ctx.userId),
      this.repo.getSignerJobTitle(ctx.companyId, ctx.userId),
      this.repo.getSubstituteCompanyContext(ctx.companyId, null),
    ]);
    const approvalMode = policy?.approvalMode ?? 'OWNER_SELF';
    return {
      configured: Boolean(policy),
      ready: approvalMode === 'OWNER_SELF' || (policy?.approverUserIds.length ?? 0) > 0,
      approvalMode,
      cashEvidencePolicy: policy?.cashEvidencePolicy ?? 'ALLOW_SUPPORTING_EVIDENCE_ONLY',
      cashEvidenceInstructions: policy?.cashEvidenceInstructions ?? null,
      hasReusableSignature: Boolean(reusableSignature),
      canApproveForCompany: ctx.permissions.includes('expense.confirm') && (approvalMode === 'OWNER_SELF' || Boolean(policy?.approverUserIds.includes(ctx.userId))),
      signerJobTitle, companyName: company.name, companyNameSource: company.nameSource,
      // A8: “ใช้ลายเซ็นที่บันทึกไว้” asked the signer to certify a legal document with an image they
      // had never seen. This is that image — resolved for THIS caller only, by the same
      // derived-first lookup that will certify with it, so no permission question arises.
      reusableSignaturePreviewUrl: reusableSignature
        ? signatureInlineUrl(this.audit, ctx, reusableSignature)
        : null,
    };
  }
}

@Injectable()
export class UpdateSubstituteReceiptPolicyUseCase {
  constructor(
    private readonly repo: PrismaExpenseRepository,
    private readonly getPolicy: GetSubstituteReceiptPolicyUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, input: UpdateSubstituteReceiptPolicyInput): Promise<SubstituteReceiptPolicySettings> {
    if (!APPROVAL_MODES.has(input.approvalMode)) {
      throw new BadRequestException('Invalid approvalMode.');
    }
    if (!Array.isArray(input.approverUserIds)
      || (input.approvalMode === 'DESIGNATED_APPROVERS' && input.approverUserIds.length === 0)
      || input.approverUserIds.length > 20
      || input.approverUserIds.some((userId) => typeof userId !== 'string' || !userId.trim())) {
      throw new BadRequestException('Select between 1 and 20 authorized approvers.');
    }
    const approverUserIds = input.approverUserIds.map((userId) => userId.trim());
    if (new Set(approverUserIds).size !== approverUserIds.length) {
      throw new BadRequestException('Approver users must be unique.');
    }
    if (!CASH_POLICIES.has(input.cashEvidencePolicy)) {
      throw new BadRequestException('Invalid cashEvidencePolicy.');
    }
    const candidates = await this.repo.listEligibleSubstituteReceiptApprovers(ctx.companyId);
    const candidateIds = new Set(candidates.map((candidate) => candidate.userId));
    if (approverUserIds.some((userId) => !candidateIds.has(userId))) {
      throw new BadRequestException('Every approver must be an active company member with expense.confirm.');
    }
    const previous = await this.repo.getSubstituteReceiptPolicy(ctx.companyId);
    const saved = await this.repo.upsertSubstituteReceiptPolicy({
      companyId: ctx.companyId,
      approvalMode: input.approvalMode,
      approverUserIds,
      cashEvidencePolicy: input.cashEvidencePolicy,
      cashEvidenceInstructions: parseInstructions(input.cashEvidenceInstructions),
      actorUserId: ctx.userId,
    });
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'expense.substitute_receipt.policy.update',
      targetType: 'expense_substitute_receipt_policy',
      targetId: saved.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: {
        previousApprovalMode: previous?.approvalMode ?? 'OWNER_SELF',
        approvalMode: input.approvalMode,
        previousApproverUserIds: previous?.approverUserIds ?? [],
        approverUserIds,
        previousCashEvidencePolicy: previous?.cashEvidencePolicy ?? null,
        cashEvidencePolicy: input.cashEvidencePolicy,
      },
    });
    return this.getPolicy.execute(ctx);
  }
}
