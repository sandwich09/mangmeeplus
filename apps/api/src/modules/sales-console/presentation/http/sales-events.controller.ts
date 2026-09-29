/**
 * `/v1/sales/events/*` — ส่วนลดจากงาน in the sales console (sales-event-discounts spec §7.1, §9).
 *
 * Same two locks as every sales route: the permission says what the role may do, and
 * `assertPlatformTenant` says the caller really is มั่งมี staff, not a shop role that happens to share
 * a name. The service then narrows to the batches the caller may see or manage.
 */
import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  SalesEventAgentSearch,
  SalesEventBatchList,
  SalesEventBatchView,
  SalesEventQr,
  SalesEventTicketList,
  SalesEventTicketView,
} from '@watchdog-bms/contracts';
import { trustedPublicApiBase } from '../../../../common/http/public-api-base';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertPlatformTenant } from '../../application/sales-context';
import { SalesEventsService } from '../../application/sales-events.service';
import {
  SalesEventBatchDto, SalesEventBatchStateDto, SalesEventBatchUpdateDto, SalesEventTicketRevokeDto,
} from './sales-events.dto';

type SalesRequest = Request & { context: RequestContext };

@Controller('sales/events')
export class SalesEventsController {
  constructor(private readonly events: SalesEventsService) {}

  @Post('batches')
  @HttpCode(201)
  @RequirePermissions('sales.event.manage')
  @ApiOperation({ summary: 'Create a batch and open it at once (no server-side draft)' })
  @ApiResponse({ status: 400, description: 'SALES_EVENT_BATCH_INVALID / SALES_EVENT_REWARD_REQUIRED / SALES_EVENT_DISCOUNT_TOO_HIGH / SALES_AGENT_NOT_FOUND' })
  create(@Body() dto: SalesEventBatchDto, @Req() req: SalesRequest): Promise<SalesEventBatchView> {
    assertPlatformTenant(req.context);
    return this.events.create(req.context, dto);
  }

  @Get('batches')
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'Batches the caller may see: all (admin), own and team (lead), assigned (agent)' })
  list(@Query('cursor') cursor: string | undefined, @Req() req: SalesRequest): Promise<SalesEventBatchList> {
    assertPlatformTenant(req.context);
    return this.events.list(req.context, cursor);
  }

  @Get('batches/:batchId')
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'One batch with its ticket figures' })
  @ApiResponse({ status: 404, description: 'SALES_EVENT_NOT_FOUND' })
  get(@Param('batchId') batchId: string, @Req() req: SalesRequest): Promise<SalesEventBatchView> {
    assertPlatformTenant(req.context);
    return this.events.get(req.context, batchId);
  }

  @Patch('batches/:batchId')
  @RequirePermissions('sales.event.manage')
  @ApiOperation({ summary: 'Save a new revision; tickets already issued keep what they were issued with' })
  @ApiResponse({ status: 409, description: 'SALES_EVENT_BATCH_STALE' })
  update(@Param('batchId') batchId: string, @Body() dto: SalesEventBatchUpdateDto, @Req() req: SalesRequest): Promise<SalesEventBatchView> {
    assertPlatformTenant(req.context);
    return this.events.update(req.context, batchId, dto);
  }

  @Post('batches/:batchId/state')
  @HttpCode(200)
  @RequirePermissions('sales.event.manage')
  @ApiOperation({ summary: 'PAUSE / RESUME / SUSPEND / LIFT; SUSPEND and LIFT need a reason' })
  @ApiResponse({ status: 409, description: 'SALES_EVENT_BATCH_STALE' })
  changeState(@Param('batchId') batchId: string, @Body() dto: SalesEventBatchStateDto, @Req() req: SalesRequest): Promise<SalesEventBatchView> {
    assertPlatformTenant(req.context);
    return this.events.changeState(req.context, batchId, dto);
  }

  @Get('agents')
  @RequirePermissions('sales.event.manage')
  @ApiOperation({ summary: 'Sellers a batch may be handed to: own team (lead) or everyone (admin), 50 a page' })
  searchAgents(
    @Query('q') q: string | undefined, @Query('cursor') cursor: string | undefined, @Req() req: SalesRequest,
  ): Promise<SalesEventAgentSearch> {
    assertPlatformTenant(req.context);
    return this.events.searchAgents(req.context, q, cursor);
  }

  @Post('batches/:batchId/qr')
  @HttpCode(200)
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'A QR for an active distributor of an open batch; it works until the batch closes (SD-O11)' })
  @ApiResponse({ status: 403, description: 'SALES_EVENT_AGENT_INACTIVE' })
  @ApiResponse({ status: 409, description: 'SALES_EVENT_CLAIM_CLOSED / SALES_EVENT_ISSUE_FULL' })
  issueQr(@Param('batchId') batchId: string, @Req() req: SalesRequest): Promise<SalesEventQr> {
    assertPlatformTenant(req.context);
    return this.events.issueQr(req.context, batchId, trustedPublicApiBase(req));
  }

  @Get('batches/:batchId/tickets')
  @RequirePermissions('sales.console.read')
  @ApiOperation({ summary: 'Tickets of a batch, newest first; an agent sees only the ones they handed out' })
  tickets(
    @Param('batchId') batchId: string, @Query('cursor') cursor: string | undefined, @Req() req: SalesRequest,
  ): Promise<SalesEventTicketList> {
    assertPlatformTenant(req.context);
    return this.events.tickets(req.context, batchId, cursor);
  }

  @Post('tickets/:ticketId/revoke')
  @HttpCode(200)
  @RequirePermissions('sales.event.manage')
  @ApiOperation({ summary: 'Revoke an unused ticket, with a reason' })
  @ApiResponse({ status: 409, description: 'SALES_EVENT_TICKET_NOT_REVOCABLE / SALES_EVENT_BATCH_STALE' })
  revoke(@Param('ticketId') ticketId: string, @Body() dto: SalesEventTicketRevokeDto, @Req() req: SalesRequest): Promise<SalesEventTicketView> {
    assertPlatformTenant(req.context);
    return this.events.revoke(req.context, ticketId, dto);
  }
}
