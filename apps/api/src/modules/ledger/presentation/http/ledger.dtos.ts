// HTTP-boundary validation for chart-of-account bodies (H-02). The
// @watchdog-bms/contracts types are compile-time only; these classes give the
// global ValidationPipe runtime metadata so tenant/system fields (companyId,
// isSystem, isControlled, code/class/balance on update) are rejected at the
// edge (whitelist + forbidNonWhitelisted) instead of being spread into Prisma.
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty,
  IsOptional, IsString, Matches, MaxLength, ValidateIf, ValidateNested,
} from 'class-validator';
import { LEDGER_ACCOUNT_CLASS_LABELS } from '@watchdog-bms/contracts';
import type {
  ApplyChartTemplateInput,
  ChartTemplateApplyMode,
  CreateChartOfAccountInput,
  CreateManualJournalInput,
  LedgerAccountClass,
  ManualJournalLineInput,
  LedgerNormalBalance,
  UpdateChartOfAccountInput,
} from '@watchdog-bms/contracts';

// Derived from the Record<LedgerAccountClass, string> so a new class cannot
// silently drift past this list (the Record forces exhaustiveness at compile time).
const ACCOUNT_CLASSES = Object.keys(LEDGER_ACCOUNT_CLASS_LABELS) as LedgerAccountClass[];
const NORMAL_BALANCES: LedgerNormalBalance[] = ['DEBIT', 'CREDIT'];
const CHART_TEMPLATE_APPLY_MODES: ChartTemplateApplyMode[] = ['MISSING_ONLY', 'REPLACE_UNUSED'];

// For optional fields backed by NOT NULL columns: @IsOptional would let explicit
// null through to Prisma (500); this runs the validators unless the key is absent.
const unlessOmitted = ValidateIf((_object, value) => value !== undefined);

export class CreateChartOfAccountDto implements CreateChartOfAccountInput {
  @IsString() @IsNotEmpty() @MaxLength(20) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(160) nameTh!: string;
  @IsString() @IsOptional() @MaxLength(160) nameEn?: string;
  @IsIn(ACCOUNT_CLASSES) accountClass!: LedgerAccountClass;
  @IsString() @IsOptional() @MaxLength(80) reportGroup?: string;
  @IsIn(NORMAL_BALANCES) normalBalance!: LedgerNormalBalance;
  @IsString() @IsOptional() @MaxLength(64) parentAccountId?: string;
  @IsBoolean() @IsOptional() isPosting?: boolean;
  @IsString() @IsOptional() @MaxLength(80) taxCategory?: string;
  @IsString() @IsOptional() @MaxLength(80) cashFlowCategory?: string;
}

export class UpdateChartOfAccountDto implements UpdateChartOfAccountInput {
  @IsString() @unlessOmitted @IsNotEmpty() @MaxLength(160) nameTh?: string;
  @IsString() @IsOptional() @MaxLength(160) nameEn?: string;
  @IsString() @IsOptional() @MaxLength(80) reportGroup?: string;
  @IsString() @IsOptional() @MaxLength(80) taxCategory?: string;
  @IsString() @IsOptional() @MaxLength(80) cashFlowCategory?: string;
  @IsIn(['ACTIVE', 'INACTIVE']) @unlessOmitted status?: string;
}

export class ApplyChartTemplateDto implements ApplyChartTemplateInput {
  @IsString() @Matches(/^[a-f0-9]{64}$/) expectedTemplateChecksum!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) expectedPreviewChecksum!: string;
  @IsIn(CHART_TEMPLATE_APPLY_MODES) @IsOptional() mode?: ChartTemplateApplyMode;
  @IsBoolean() @IsOptional() acknowledgeConflicts?: boolean;
}

class ManualJournalLineDto implements ManualJournalLineInput {
  @IsString() @IsNotEmpty() @MaxLength(64) accountId!: string;
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(64) branchId?: string;
  @IsString() @IsOptional() @MaxLength(500) description?: string;
  @Matches(/^\d{1,14}(?:\.\d{1,4})?$/) @IsOptional() debitAmount?: string;
  @Matches(/^\d{1,14}(?:\.\d{1,4})?$/) @IsOptional() creditAmount?: string;
  @IsString() @IsOptional() @MaxLength(3) currency?: string;
}

// POST /posting/generate. GenerateJournalFromSourceUseCase rebuilds the whole
// posting input from the database for every recognized sourceType and throws
// `unsupported_posting_source` otherwise, so these three fields are the only ones
// it ever reads — anything else a caller sent was silently discarded. Narrowing
// the body to them makes that explicit at the edge.
export class GenerateJournalFromSourceDto {
  @IsString() @IsNotEmpty() @MaxLength(80) sourceType!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) sourceId!: string;
  @IsString() @IsOptional() @MaxLength(120) sourceEventType?: string;
}

// PUT /posting/expense-account-bindings/:categoryId (audit CR-2). `null` is a meaningful value —
// it clears the binding — so the field is required-but-nullable rather than optional: an omitted
// key would otherwise be indistinguishable from an explicit clear.
export class SetExpenseAccountBindingDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString() @IsNotEmpty() @MaxLength(20)
  // Same code shape the chart template and posting engine use (e.g. 5320-01). Bounding it here
  // keeps a free-text body out of the account lookup.
  @Matches(/^[0-9]{4}-[0-9]{2}$/, { message: 'ledgerAccountCode must look like 5320-01' })
  ledgerAccountCode!: string | null;
}

export class CreateManualJournalDto implements CreateManualJournalInput {
  @IsDateString({ strict: true }) entryDate!: string;
  @IsString() @IsOptional() @MaxLength(500) memo?: string;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => ManualJournalLineDto)
  lines!: ManualJournalLineDto[];
}
