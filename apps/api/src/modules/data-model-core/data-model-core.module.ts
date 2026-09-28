import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { PrismaBranchRepository } from './infrastructure/repositories/prisma-branch.repository';
import { PrismaOutboxRepository } from './infrastructure/repositories/prisma-outbox.repository';
import { OutboxAppendService } from './application/services/outbox-append.service';
import { ObjectVersionCleanupService } from './application/services/object-version-cleanup.service';
import { PrismaAttachmentRepository } from './infrastructure/repositories/prisma-attachment.repository';
import { PrismaDocumentSequenceRepository } from './infrastructure/repositories/prisma-document-sequence.repository';
import { LocalStorageAdapter } from './infrastructure/storage/local-storage.adapter';
import { S3StorageAdapter } from './infrastructure/storage/s3-storage.adapter';
import { AppConfigService } from '../../common/config/app-config.service';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from './domain/ports/attachment-storage.port';
import { ListBranchesUseCase } from './application/use-cases/list-branches.use-case';
import { CreateBranchUseCase } from './application/use-cases/create-branch.use-case';
import { UpdateBranchUseCase } from './application/use-cases/update-branch.use-case';
import { CreateUploadIntentUseCase } from './application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from './application/use-cases/complete-attachment-upload.use-case';
import { CreateDownloadUrlUseCase } from './application/use-cases/create-download-url.use-case';
import { LinkAttachmentUseCase } from './application/use-cases/link-attachment.use-case';
import { DeleteAttachmentUseCase } from './application/use-cases/delete-attachment.use-case';
import { ListDocumentSequencesUseCase } from './application/use-cases/list-document-sequences.use-case';
import { UpsertDocumentSequenceUseCase } from './application/use-cases/upsert-document-sequence.use-case';
import { ReserveDocumentNumberUseCase } from './application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from './application/use-cases/commit-document-number.use-case';
import { CancelDocumentNumberUseCase } from './application/use-cases/cancel-document-number.use-case';
import { VoidDocumentNumberUseCase } from './application/use-cases/void-document-number.use-case';
import { BranchController } from './presentation/http/branch.controller';
import { CompanyIdentityController } from './presentation/http/company-identity.controller';
import { CompanyIdentityUseCase } from './application/use-cases/company-identity.use-case';
import { CompanyVatRegistrationController } from './presentation/http/company-vat-registration.controller';
import { CompanyVatRegistrationUseCase } from './application/use-cases/company-vat-registration.use-case';
import { AttachmentController } from './presentation/http/attachment.controller';
import { DocumentSequenceController } from './presentation/http/document-sequence.controller';
import { LocalStorageController } from './presentation/http/local-storage.controller';
import { ObjectVersionCleanupInternalController } from './presentation/http/object-version-cleanup-internal.controller';
import { AttachmentMalwareScanner } from './infrastructure/attachment-malware-scanner';

@Module({
  // LoggerModule supplies LOGGER_TOKEN for the outbox.append.failed event (L-10).
  imports: [AuditModule, LoggerModule],
  controllers: [
    BranchController,
    CompanyIdentityController,
    CompanyVatRegistrationController,
    AttachmentController,
    DocumentSequenceController,
    LocalStorageController,
    ObjectVersionCleanupInternalController,
  ],
  providers: [
    CompanyIdentityUseCase,
    CompanyVatRegistrationUseCase,
    PrismaBranchRepository,
    PrismaOutboxRepository,
    OutboxAppendService,
    ObjectVersionCleanupService,
    PrismaAttachmentRepository,
    PrismaDocumentSequenceRepository,
    LocalStorageAdapter,
    S3StorageAdapter,
    AttachmentMalwareScanner,
    {
      provide: ATTACHMENT_STORAGE,
      inject: [AppConfigService, LocalStorageAdapter, S3StorageAdapter],
      useFactory: selectAttachmentStorage,
    },
    ListBranchesUseCase,
    CreateBranchUseCase,
    UpdateBranchUseCase,
    CreateUploadIntentUseCase,
    CompleteAttachmentUploadUseCase,
    CreateDownloadUrlUseCase,
    LinkAttachmentUseCase,
    DeleteAttachmentUseCase,
    ListDocumentSequencesUseCase,
    UpsertDocumentSequenceUseCase,
    ReserveDocumentNumberUseCase,
    CommitDocumentNumberUseCase,
    CancelDocumentNumberUseCase,
    VoidDocumentNumberUseCase,
  ],
  exports: [
    ATTACHMENT_STORAGE,
    AttachmentMalwareScanner,
    ReserveDocumentNumberUseCase,
    CommitDocumentNumberUseCase,
    CancelDocumentNumberUseCase,
    VoidDocumentNumberUseCase,
    CreateUploadIntentUseCase,
    CompleteAttachmentUploadUseCase,
    CreateDownloadUrlUseCase,
    PrismaAttachmentRepository,
    PrismaDocumentSequenceRepository,
    OutboxAppendService,
    ObjectVersionCleanupService,
    PrismaOutboxRepository,
    // Read by the expenses capture policy, so both sides answer from the same interval accessor.
    CompanyVatRegistrationUseCase,
    // Purchase without setup PR E (R-E3): the partner console's admin identity route reuses this
    // single legal-identity writer (CAS/revision/CRITICAL audit) rather than a second path.
    CompanyIdentityUseCase,
  ],
})
export class DataModelCoreModule {}

export function selectAttachmentStorage(
  config: Pick<AppConfigService, 's3Bucket'>,
  localStorage: LocalStorageAdapter,
  s3Storage: S3StorageAdapter,
): AttachmentStoragePort {
  return config.s3Bucket ? s3Storage : localStorage;
}
