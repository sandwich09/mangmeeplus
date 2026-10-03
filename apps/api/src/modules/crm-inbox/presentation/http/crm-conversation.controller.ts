import { Body, Controller, Get, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CrmConversationStatus,
  ListCrmConversationsFilter,
  SendCrmMessageInput,
  SetCrmConversationStatusInput,
  UpdateCrmConversationAutoReplyRequest,
  SetCrmConversationPriorityInput,
  SetCrmConversationTagsInput,
  AssignCrmConversationInput,
} from '@watchdog-bms/contracts';
import {
  ListCrmConversationsUseCase,
  GetCrmConversationUseCase,
  GetCrmMessageContentUseCase,
  SendCrmInboxMessageUseCase,
  SetCrmConversationStatusUseCase,
  UpdateCrmConversationAutoReplyUseCase,
  SetCrmConversationPriorityUseCase,
  SetCrmConversationTagsUseCase,
  AssignCrmConversationUseCase,
  MarkCrmConversationReadUseCase,
} from '../../application/use-cases/crm-conversation.use-case';

@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/conversations')
export class CrmConversationController {
  constructor(
    private readonly listConversations: ListCrmConversationsUseCase,
    private readonly getConversation: GetCrmConversationUseCase,
    private readonly getMessageContent: GetCrmMessageContentUseCase,
    private readonly sendMessage: SendCrmInboxMessageUseCase,
    private readonly setStatus: SetCrmConversationStatusUseCase,
    private readonly updateAutoReply: UpdateCrmConversationAutoReplyUseCase,
    private readonly setPriority: SetCrmConversationPriorityUseCase,
    private readonly setTags: SetCrmConversationTagsUseCase,
    private readonly assignConversation: AssignCrmConversationUseCase,
    private readonly markRead: MarkCrmConversationReadUseCase,
  ) {}

  @Get()
  @RequirePermissions('crm.inbox.read')
  @ApiOperation({ summary: 'List CRM inbox conversations (with chip counts)' })
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('status') status?: CrmConversationStatus,
    @Query('search') search?: string,
    @Query('overdue') overdue?: string,
    @Query('unanswered') unanswered?: string,
    @Query('tag') tag?: string,
    @Query('assignee') assignee?: string,
    @Query('customerId') customerId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListCrmConversationsFilter = {
      status,
      search,
      overdue: overdue === 'true',
      unanswered: unanswered === 'true',
      tag,
      assignee: assignee as ListCrmConversationsFilter['assignee'],
      customerId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    };
    return this.listConversations.execute(ctx, filter);
  }

  @Get(':conversationId')
  @RequirePermissions('crm.inbox.read')
  @ApiOperation({ summary: 'Get conversation detail with messages' })
  get(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string) {
    return this.getConversation.execute(ctx, conversationId);
  }

  // Media bytes for one message (image/file bubbles). Same-origin <img>/<a>
  // tags hit this directly — the cookie session authenticates them.
  @Get(':conversationId/messages/:messageId/content')
  @RequirePermissions('crm.inbox.read')
  @ApiOperation({ summary: 'Stream stored media content of a message' })
  async content(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { data, mimeType, fileName } = await this.getMessageContent.execute(ctx, conversationId, messageId);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    const disposition = mimeType.startsWith('image/') ? 'inline' : 'attachment';
    return new StreamableFile(data, {
      type: mimeType,
      disposition: `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Post(':conversationId/messages')
  @RequirePermissions('crm.inbox.reply')
  @ApiOperation({ summary: 'Send a text reply to the customer via LINE' })
  send(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: SendCrmMessageInput,
  ) {
    return this.sendMessage.execute(ctx, conversationId, { text: body?.text, visibility: 'CUSTOMER' });
  }

  // Separate route + permission from /messages: an internal note is structurally
  // unable to reach LINE, so note-only roles never hold a send-capable grant.
  @Post(':conversationId/notes')
  @RequirePermissions('crm.inbox.note')
  @ApiOperation({ summary: 'Append a staff-only internal note (never sent to the customer)' })
  note(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: SendCrmMessageInput,
  ) {
    return this.sendMessage.execute(ctx, conversationId, { text: body?.text, visibility: 'INTERNAL_NOTE' });
  }

  @Put(':conversationId/status')
  @RequirePermissions('crm.inbox.resolve')
  @ApiOperation({ summary: 'Change conversation triage status' })
  status(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: SetCrmConversationStatusInput,
  ) {
    return this.setStatus.execute(ctx, conversationId, body);
  }

  @Put(':conversationId/priority')
  @RequirePermissions('crm.inbox.resolve')
  @ApiOperation({ summary: 'Change conversation priority' })
  priority(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: SetCrmConversationPriorityInput,
  ) {
    return this.setPriority.execute(ctx, conversationId, body);
  }

  @Put(':conversationId/auto-reply')
  @RequirePermissions('crm.inbox.reply')
  @ApiOperation({ summary: 'Enable or disable autonomous AI for one conversation' })
  autoReply(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: UpdateCrmConversationAutoReplyRequest,
  ) {
    return this.updateAutoReply.execute(ctx, conversationId, body);
  }

  @Put(':conversationId/tags')
  @RequirePermissions('crm.inbox.resolve')
  @ApiOperation({ summary: 'Replace conversation tags' })
  tags(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: SetCrmConversationTagsInput,
  ) {
    return this.setTags.execute(ctx, conversationId, body);
  }

  // Route gate is read-level: the use case allows full reassignment only with
  // crm.inbox.assign, and self pickup/release for reply-capable staff (spec §13).
  @Put(':conversationId/assign')
  @RequirePermissions('crm.inbox.read')
  @ApiOperation({ summary: 'Assign or unassign the conversation (self pickup/release without assign permission)' })
  assign(
    @ReqCtx() ctx: RequestContext,
    @Param('conversationId') conversationId: string,
    @Body() body: AssignCrmConversationInput,
  ) {
    return this.assignConversation.execute(ctx, conversationId, body);
  }

  @Post(':conversationId/read')
  @RequirePermissions('crm.inbox.read')
  @ApiOperation({ summary: 'Mark the conversation as read' })
  read(@ReqCtx() ctx: RequestContext, @Param('conversationId') conversationId: string) {
    return this.markRead.execute(ctx, conversationId);
  }
}
