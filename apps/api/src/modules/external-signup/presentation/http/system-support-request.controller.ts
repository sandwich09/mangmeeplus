import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import type { Request } from 'express';
import type {
  SupportRequestActionDto, SupportRequestQueueDto, SupportRequestStatus,
} from '@watchdog-bms/contracts';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { SupportRequestAdminUseCase } from '../../application/support-request-admin.use-case';

export class SupportRequestQueryDto {
  // A class, not an inline type: only a DTO class reaches the global ValidationPipe (audit H-23).
  @IsIn(['OPEN', 'ANSWERED', 'CLOSED']) @IsOptional() status?: SupportRequestStatus;
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
  list(@Query() query: SupportRequestQueryDto): Promise<SupportRequestQueueDto> {
    return this.requests.list(query?.status);
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
  @ApiOperation({ summary: 'Clear the assistant pause for this customer and close the request' })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404 })
  resumeAssistant(
    @Param('supportRequestId') id: string,
    @Req() req: Request & { context: RequestContext },
  ): Promise<SupportRequestActionDto> {
    return this.requests.resumeAssistant(id, req.context.userId, req.context.requestId);
  }
}
