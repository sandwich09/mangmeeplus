import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  IsIn, IsISO8601, IsNumberString, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf,
} from 'class-validator';
import type { Request, Response } from 'express';
import {
  PARTNER_LINE_MESSAGE_MAX_LENGTH,
  type SupportRequestActionDto,
  type SupportRequestCountDto,
  type SupportRequestQueueDto,
  type SupportRequestReclaimBody,
  type SupportRequestReplyBody,
  type SupportRequestReplyResultDto,
  type SupportRequestResolveBody,
  type SupportRequestStatus,
  type SupportRequestThreadDto,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  SUPPORT_RESOLUTION_NOTE_MAX_LENGTH, SupportRequestAdminUseCase,
} from '../../application/support-request-admin.use-case';

export class SupportRequestQueryDto {
  // A class, not an inline type: only a DTO class reaches the global ValidationPipe (audit H-23).
  @IsIn(['OPEN', 'ANSWERED', 'CLOSED']) @IsOptional() status?: SupportRequestStatus;
  @IsString() @MaxLength(128) @Matches(/^[A-Za-z0-9_-]+$/) @IsOptional() cursor?: string;
  @IsNumberString() @IsOptional() limit?: string;
}

export class SupportRequestReplyDto implements SupportRequestReplyBody {
  @IsString() @MaxLength(PARTNER_LINE_MESSAGE_MAX_LENGTH) text!: string;
  @IsUUID('4') operationId!: string;
  @ValidateIf((_object, value) => value !== null) @IsUUID('4') previousReplyOperationId!: string | null;
}

export class SupportRequestResolveDto implements SupportRequestResolveBody {
  @IsString() @MaxLength(SUPPORT_RESOLUTION_NOTE_MAX_LENGTH) note!: string;
}

export class SupportRequestReclaimDto implements SupportRequestReclaimBody {
  @IsISO8601({ strict: true }) expectedAssignedAt!: string;
  @IsString() @MaxLength(SUPPORT_RESOLUTION_NOTE_MAX_LENGTH) reason!: string;
}

/**
 * line-support-request-spec-th §2.3. The inbox for "ติดต่อเจ้าหน้าที่".
 *
 * Gated on `system.partner_company.update` — the SAME key as the partner page's "ส่งข้อความถึงร้าน"
 * box, deliberately, including the read. Answering is the only thing an operator does here, so an
 * operator who cannot answer has no business reading which customers are waiting; and a page whose
 * list and whose buttons check different keys is a page that renders rows it will 403 on.
 *
 * Route params avoid the name `companyId`: the auth guard treats that param as tenant scope and
 * would demand membership in the customer company, which system admins never have.
 */
@Controller('system/support-requests')
export class SystemSupportRequestController {
  constructor(private readonly requests: SupportRequestAdminUseCase) {}

  @Get()
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Customers waiting for a person, OPEN first' })
  @ApiResponse({ status: 200 })
  list(
    @Query() query: SupportRequestQueryDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestQueueDto> {
    return this.requests.list(req.context.userId, {
      ...(query.status ? { status: query.status } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: Number(query.limit) } : {}),
    });
  }

  // Declared before the `:supportRequestId` routes below so `count` can never be read as an id.
  @Get('count')
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'How many customers are still waiting — the system nav badge' })
  @ApiResponse({ status: 200 })
  count(): Promise<SupportRequestCountDto> {
    return this.requests.openCount();
  }

  @Get(':supportRequestId/thread')
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'The request and everything said on it, oldest first (สัญญา v3)' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  thread(
    @Param('supportRequestId') id: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestThreadDto> {
    return this.requests.thread(id, req.context.userId);
  }

  // Same-origin <img>/<a> tags hit this directly — the cookie session authenticates them, exactly as
  // the CRM inbox's content route already relies on. `no-store`: a customer's photo must not outlive
  // the page in a shared browser cache.
  @Get(':supportRequestId/messages/:messageId/content')
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Stream the stored bytes of one customer photo/file on this request' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  async content(
    @Param('supportRequestId') id: string,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { data, mimeType, fileName } = await this.requests.messageContent(id, messageId);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const disposition = mimeType.startsWith('image/') ? 'inline' : 'attachment';
    return new StreamableFile(data, {
      type: mimeType,
      disposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Post(':supportRequestId/claim')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Claim this live support request for the current operator' })
  claim(
    @Param('supportRequestId') id: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.claim(id, req.context.userId, req.context.requestId);
  }

  @Post(':supportRequestId/release')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Release a support request owned by the current operator' })
  release(
    @Param('supportRequestId') id: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.release(id, req.context.userId, req.context.requestId);
  }

  @Post(':supportRequestId/reclaim')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Explicitly take over a currently assigned case at the shown version' })
  reclaim(
    @Param('supportRequestId') id: string,
    @Body() dto: SupportRequestReclaimDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.reclaim(
      id, dto.expectedAssignedAt, dto.reason, req.context.userId, req.context.requestId,
    );
  }

  @Post(':supportRequestId/reply')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Send a request-bound LINE reply without exposing the LINE recipient id' })
  reply(
    @Param('supportRequestId') id: string,
    @Body() dto: SupportRequestReplyDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestReplyResultDto> {
    return this.requests.reply(
      id, dto.text, dto.operationId, dto.previousReplyOperationId,
      req.context.userId, req.context.requestId,
    );
  }

  @Post(':supportRequestId/resolve')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Close a support request with an explicit resolution note' })
  resolve(
    @Param('supportRequestId') id: string,
    @Body() dto: SupportRequestResolveDto,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.resolve(id, dto.note, req.context.userId, req.context.requestId);
  }

  @Post(':supportRequestId/answered')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Mark this request answered (idempotent); records who answered' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  markAnswered(
    @Param('supportRequestId') id: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.markAnswered(id, req.context.userId, req.context.requestId);
  }

  @Post(':supportRequestId/resume-ai')
  @HttpCode(200)
  @RequirePermissions('system.partner_company.update')
  @ApiOperation({ summary: 'Clear the assistant pause without changing the managed case outcome' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  resumeAssistant(
    @Param('supportRequestId') id: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.resumeAssistant(id, req.context.userId, req.context.requestId);
  }
}
