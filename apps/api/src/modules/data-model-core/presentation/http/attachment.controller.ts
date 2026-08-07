import { Controller, Post, Get, Delete, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { CreateUploadIntentUseCase } from '../../application/use-cases/create-upload-intent.use-case';
import { CompleteAttachmentUploadUseCase } from '../../application/use-cases/complete-attachment-upload.use-case';
import { CreateDownloadUrlUseCase } from '../../application/use-cases/create-download-url.use-case';
import { LinkAttachmentUseCase } from '../../application/use-cases/link-attachment.use-case';
import { DeleteAttachmentUseCase } from '../../application/use-cases/delete-attachment.use-case';
import { assertRouteCompany } from './assert-route-company';
import { CompleteAttachmentUploadDto, CreateUploadIntentDto, LinkAttachmentDto } from './data-model-core.dtos';

@Controller('companies/:companyId/attachments')
export class AttachmentController {
  constructor(
    private readonly createUploadIntent: CreateUploadIntentUseCase,
    private readonly completeUpload: CompleteAttachmentUploadUseCase,
    private readonly createDownloadUrl: CreateDownloadUrlUseCase,
    private readonly linkAttachment: LinkAttachmentUseCase,
    private readonly deleteAttachment: DeleteAttachmentUseCase,
  ) {}

  @Post('upload-intent')
  @RequirePermissions('attachment.create')
  async uploadIntent(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: CreateUploadIntentDto) {
    assertRouteCompany(ctx, companyId);
    return this.createUploadIntent.execute(ctx, body);
  }

  @Post(':attachmentId/complete')
  @RequirePermissions('attachment.create')
  async complete(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: CompleteAttachmentUploadDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.completeUpload.execute(ctx, { attachmentId, ...body });
  }

  // `?disposition=inline` is the preview ask; anything else (including absent) stays a download.
  @Get(':attachmentId/download-url')
  @RequirePermissions('attachment.read')
  async downloadUrl(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('disposition') disposition?: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.createDownloadUrl.execute(ctx, {
      attachmentId,
      ...(disposition === 'inline' ? { disposition: 'inline' as const } : {}),
    });
  }

  @Post(':attachmentId/links')
  @RequirePermissions('attachment.create')
  async link(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('attachmentId') attachmentId: string,
    @Body() body: LinkAttachmentDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.linkAttachment.execute(ctx, { attachmentId, ...body });
  }

  @Delete(':attachmentId')
  @RequirePermissions('attachment.delete')
  async remove(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.deleteAttachment.execute(ctx, { attachmentId });
  }
}
