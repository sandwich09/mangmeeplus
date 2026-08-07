// HTTP-boundary validation for the attachment, branch, and document-sequence
// bodies (G1). Same rule as the other modules: the field list is the union of the
// use-case command type and what real callers send.
//
// Attachments are the widest surface here — the upload-intent/complete pair is
// called from expenses, reimbursements, transaction-tax evidence, and the LINE
// flows, all of which post the same
// `{ originalFileName, mimeType, byteSize, visibility, branchId? }` shape.
import {
  IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min,
} from 'class-validator';

const ATTACHMENT_VISIBILITIES = ['INTERNAL', 'ACCOUNTING', 'AUDIT', 'CUSTOMER_VISIBLE'] as const;
const BRANCH_TYPES = ['HEAD_OFFICE', 'BRANCH', 'ONLINE', 'WAREHOUSE'] as const;
const BRANCH_STATUSES = ['ACTIVE', 'DISABLED', 'ARCHIVED'] as const;
// Uppercase, matching the Prisma enum and the domain model. The contracts copy of
// this union used to be lowercase, which no caller could have used — see
// DOCUMENT_RESET_POLICIES in packages/contracts.
const RESET_POLICIES = ['NONE', 'MONTHLY', 'YEARLY'] as const;

// 5 GB — well above the storage adapter's own limit, which stays the real gate.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export class CreateUploadIntentDto {
  @IsString() @IsNotEmpty() @MaxLength(500) originalFileName!: string;
  @IsString() @IsNotEmpty() @MaxLength(255) mimeType!: string;
  @IsInt() @Min(0) @Max(MAX_UPLOAD_BYTES) byteSize!: number;
  @IsIn(ATTACHMENT_VISIBILITIES) @IsOptional() visibility?: (typeof ATTACHMENT_VISIBILITIES)[number];
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsObject() @IsOptional() metadataJson?: Record<string, unknown>;
}

export class CompleteAttachmentUploadDto {
  // Hex SHA-256 when the caller computed one; the use case verifies it against storage.
  @Matches(/^[a-fA-F0-9]{64}$/) @IsOptional() checksumSha256?: string;
  @IsInt() @Min(0) @Max(MAX_UPLOAD_BYTES) @IsOptional() byteSize?: number;
}

export class LinkAttachmentDto {
  @IsString() @IsNotEmpty() @MaxLength(80) targetType!: string;
  @IsString() @IsNotEmpty() @MaxLength(64) targetId!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) purpose!: string;
}

export class CreateBranchDto {
  @IsString() @IsNotEmpty() @MaxLength(40) code!: string;
  @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsIn(BRANCH_TYPES) type!: (typeof BRANCH_TYPES)[number];
  @IsString() @IsOptional() @MaxLength(10) taxBranchCode?: string | null;
  @IsString() @IsOptional() @MaxLength(40) phone?: string;
  @IsString() @IsOptional() @MaxLength(320) email?: string;
  @IsObject() @IsOptional() addressJson?: Record<string, unknown>;
}

export class UpdateBranchDto {
  @IsString() @IsOptional() @IsNotEmpty() @MaxLength(200) name?: string;
  @IsString() @IsOptional() @MaxLength(10) taxBranchCode?: string | null;
  @IsString() @IsOptional() @MaxLength(40) phone?: string;
  @IsString() @IsOptional() @MaxLength(320) email?: string;
  @IsObject() @IsOptional() addressJson?: Record<string, unknown>;
  @IsIn(BRANCH_STATUSES) @IsOptional() status?: (typeof BRANCH_STATUSES)[number];
}

export class UpsertDocumentSequenceDto {
  @IsString() @IsOptional() @MaxLength(64) branchId?: string;
  @IsString() @IsNotEmpty() @MaxLength(20) periodKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(80) prefixTemplate!: string;
  @IsInt() @Min(1) @Max(12) @IsOptional() padding?: number;
  @IsIn(RESET_POLICIES) @IsOptional() resetPolicy?: (typeof RESET_POLICIES)[number];
}
