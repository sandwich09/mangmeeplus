import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  TaxClaimability,
  TransactionTaxContext,
  TransactionTaxDirection,
  TransactionTaxRegime,
  TransactionTaxTreatment,
  UpsertTaxCodeDefinitionInput,
} from '@watchdog-bms/contracts';
import {
  TRANSACTION_TAX_CONTEXTS,
  TRANSACTION_TAX_DIRECTIONS,
  TRANSACTION_TAX_REGIMES,
  TRANSACTION_TAX_TREATMENTS,
} from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { validateTaxCodeDefinition } from '../../domain/logic/tax-configuration.logic';
import { PrismaTransactionTaxRepository } from '../../infrastructure/repositories/prisma-transaction-tax.repository';

export type TaxCodeImportInput = {
  profileId: string;
  format: 'CSV' | 'JSON';
  content: string;
  expectedChecksum?: string;
};

type ImportRow = {
  rowNumber: number;
  definition: UpsertTaxCodeDefinitionInput | null;
  errors: string[];
  conflict: boolean;
};

export type TaxCodeImportPreview = {
  profileId: string;
  checksum: string;
  canApply: boolean;
  rows: ImportRow[];
};

const CLAIMABILITIES = ['NOT_APPLICABLE', 'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIAL', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED'] as const;
const CALCULATION_METHODS = ['EXCLUSIVE', 'INCLUSIVE', 'NONE'] as const;

function csvRows(content: string): Record<string, unknown>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;
    if (quoted && char === '"' && content[index + 1] === '"') { field += '"'; index++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ',') { row.push(field.trim()); field = ''; continue; }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && content[index + 1] === '\n') index++;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (quoted) throw new BadRequestException('CSV contains an unclosed quoted field');
  const [headers, ...values] = rows;
  if (!headers?.length) return [];
  return values.map((items) => Object.fromEntries(headers.map((header, index) => [header.trim(), items[index] ?? ''])));
}

export function parseTaxCodeImportContent(format: 'CSV' | 'JSON', content: string): Record<string, unknown>[] {
  if (!content.trim()) throw new BadRequestException('Import content is required');
  if (Buffer.byteLength(content, 'utf8') > 1_000_000) throw new BadRequestException('Import content exceeds 1 MB');
  let rows: unknown;
  try { rows = format === 'JSON' ? JSON.parse(content) : csvRows(content); }
  catch (error) { if (error instanceof BadRequestException) throw error; throw new BadRequestException('Import content is not valid CSV/JSON'); }
  if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('Import must contain at least one row');
  if (rows.length > 500) throw new BadRequestException('Import is limited to 500 rows');
  if (rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new BadRequestException('Every import row must be an object');
  return rows as Record<string, unknown>[];
}

function text(value: unknown): string { return String(value ?? '').trim(); }

function normalizeRow(profileId: string, raw: Record<string, unknown>, rowNumber: number): ImportRow {
  const errors: string[] = [];
  const contexts = Array.isArray(raw.transactionContexts)
    ? raw.transactionContexts.map(text)
    : text(raw.transactionContexts).split(/[|;]/).map((value) => value.trim()).filter(Boolean);
  const externalCode = text(raw.externalCode).toUpperCase();
  const taxRegime = text(raw.taxRegime).toUpperCase() as TransactionTaxRegime;
  const direction = text(raw.direction).toUpperCase() as TransactionTaxDirection;
  const treatment = text(raw.treatment).toUpperCase() as TransactionTaxTreatment;
  const calculationMethod = text(raw.calculationMethod).toUpperCase() as (typeof CALCULATION_METHODS)[number];
  const claimabilityDefault = (text(raw.claimabilityDefault).toUpperCase() || 'NOT_APPLICABLE') as TaxClaimability;
  if (!externalCode) errors.push('externalCode is required');
  if (!text(raw.displayName)) errors.push('displayName is required');
  if (!TRANSACTION_TAX_REGIMES.includes(taxRegime)) errors.push('taxRegime is invalid');
  if (!['VAT', 'IMPORT_VAT'].includes(taxRegime)) errors.push('SAP Tax Code import supports VAT and IMPORT_VAT only');
  if (!TRANSACTION_TAX_DIRECTIONS.includes(direction)) errors.push('direction is invalid');
  if (!TRANSACTION_TAX_TREATMENTS.includes(treatment)) errors.push('treatment is invalid');
  if (!CALCULATION_METHODS.includes(calculationMethod)) errors.push('calculationMethod is invalid');
  if (!CLAIMABILITIES.includes(claimabilityDefault as (typeof CLAIMABILITIES)[number])) errors.push('claimabilityDefault is invalid');
  if (contexts.some((context) => !TRANSACTION_TAX_CONTEXTS.includes(context as TransactionTaxContext))) errors.push('transactionContexts contains an invalid value');
  const definition: UpsertTaxCodeDefinitionInput = {
    profileId,
    externalCode,
    displayName: text(raw.displayName),
    taxRegime,
    direction,
    treatment,
    transactionContexts: contexts as TransactionTaxContext[],
    rate: text(raw.rate),
    calculationMethod,
    sapAccountKey: text(raw.sapAccountKey) || null,
    claimabilityDefault,
    evidenceRuleKey: text(raw.evidenceRuleKey) || null,
    effectiveFrom: text(raw.effectiveFrom),
    effectiveTo: text(raw.effectiveTo) || null,
  };
  errors.push(...validateTaxCodeDefinition(definition));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(definition.effectiveFrom)) errors.push('effectiveFrom must be YYYY-MM-DD');
  return { rowNumber, definition: errors.length ? definition : definition, errors: [...new Set(errors)], conflict: false };
}

function overlaps(left: UpsertTaxCodeDefinitionInput, right: { externalCode: string; direction: string; effectiveFrom: string; effectiveTo: string | null }): boolean {
  if (left.externalCode !== right.externalCode || left.direction !== right.direction) return false;
  const leftFrom = new Date(left.effectiveFrom).getTime();
  const leftTo = left.effectiveTo ? new Date(left.effectiveTo).getTime() : Infinity;
  const rightFrom = new Date(right.effectiveFrom).getTime();
  const rightTo = right.effectiveTo ? new Date(right.effectiveTo).getTime() : Infinity;
  return leftFrom <= rightTo && leftTo >= rightFrom;
}

@Injectable()
export class TaxCodeImportUseCase {
  constructor(
    private readonly repo: PrismaTransactionTaxRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async preview(ctx: RequestContext, input: TaxCodeImportInput): Promise<TaxCodeImportPreview> {
    if (!ctx.permissions.includes('tax.config.manage')) throw new ForbiddenException('Missing permission: tax.config.manage');
    const profile = await this.repo.findProfile(ctx.companyId, input.profileId);
    if (!profile) throw new NotFoundException('Tax code profile not found');
    if (profile.status !== 'DRAFT') throw new ConflictException('Tax Code imports are allowed only for DRAFT profiles');
    const rawRows = parseTaxCodeImportContent(input.format, input.content);
    const rows = rawRows.map((raw, index) => normalizeRow(profile.id, raw, index + 2));
    const existing = await this.repo.listDefinitions(ctx.companyId, { profileId: profile.id });
    for (const row of rows) {
      if (!row.definition) continue;
      const peers = rows.filter((candidate) => candidate !== row && candidate.definition).map((candidate) => candidate.definition!);
      row.conflict = existing.some((definition) => overlaps(row.definition!, definition)) || peers.some((definition) => overlaps(row.definition!, definition));
      if (row.conflict) row.errors.push('Tax Code/direction effective window conflicts with another row or existing definition');
    }
    const checksum = createHash('sha256').update(JSON.stringify({
      profile: [profile.id, profile.version, profile.updatedAt],
      existing: existing.map((definition) => [definition.id, definition.version, definition.externalCode, definition.direction, definition.effectiveFrom, definition.effectiveTo]).sort(),
      rows: rows.map((row) => row.definition),
    })).digest('hex');
    return { profileId: profile.id, checksum, canApply: rows.length > 0 && rows.every((row) => row.errors.length === 0), rows };
  }

  async apply(ctx: RequestContext, input: TaxCodeImportInput): Promise<{ checksum: string; imported: number }> {
    if (!input.expectedChecksum) throw new BadRequestException('expectedChecksum from preview is required');
    const preview = await this.preview(ctx, input);
    if (preview.checksum !== input.expectedChecksum) throw new ConflictException('Tax Code import preview is stale; preview again');
    if (!preview.canApply) throw new UnprocessableEntityException({ code: 'tax_code_import_blocked', preview });
    const definitions = preview.rows.map((row) => row.definition!);
    try {
      await (this.repo.prisma.client as any).$transaction(async (tx: any) => {
        const profile = await tx.companyTaxCodeProfile.findFirst({ where: { id: input.profileId, companyId: ctx.companyId, status: 'DRAFT' } });
        if (!profile) throw new ConflictException('Tax Code profile changed; preview again');
        for (const definition of definitions) {
          await tx.taxCodeDefinition.create({ data: {
            companyId: ctx.companyId, profileId: profile.id, externalCode: definition.externalCode, displayName: definition.displayName,
            taxRegime: definition.taxRegime, direction: definition.direction, treatment: definition.treatment,
            transactionContextsJson: definition.transactionContexts, rate: definition.rate, calculationMethod: definition.calculationMethod,
            sapAccountKey: definition.sapAccountKey, claimabilityDefault: definition.claimabilityDefault,
            evidenceRuleKey: definition.evidenceRuleKey, effectiveFrom: new Date(definition.effectiveFrom),
            effectiveTo: definition.effectiveTo ? new Date(definition.effectiveTo) : null,
            status: 'REVIEW_REQUIRED', sourceMetadataJson: { importChecksum: preview.checksum }, createdByUserId: ctx.userId,
          } });
        }
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ConflictException('Tax Code import conflicted with a concurrent change; preview again');
    }
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.code_definition.import', targetType: 'tax_code_profile', targetId: input.profileId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { checksum: preview.checksum, imported: definitions.length } });
    await this.outbox.append('tax.code_definitions.imported', 'tax_code_profile', input.profileId, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'tax_code_profile', aggregateId: input.profileId, occurredAt: new Date().toISOString(), data: { checksum: preview.checksum, imported: definitions.length } });
    return { checksum: preview.checksum, imported: definitions.length };
  }
}
