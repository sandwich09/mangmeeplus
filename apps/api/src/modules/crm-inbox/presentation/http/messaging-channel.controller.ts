import { Controller, Get, Post, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  ConnectMessagingChannelInput,
  RotateMessagingChannelCredentialInput,
  DisableMessagingChannelInput,
  UpdateMessagingChannelSettingsRequest,
} from '@watchdog-bms/contracts';
import {
  ListMessagingChannelsUseCase,
  ConnectMessagingChannelUseCase,
  TestMessagingChannelUseCase,
  RotateMessagingChannelCredentialUseCase,
  DisableMessagingChannelUseCase,
  RevealMessagingChannelCredentialUseCase,
  UpdateMessagingChannelSettingsUseCase,
} from '../../application/use-cases/messaging-channel.use-case';

@ApiTags('crm-inbox')
@Controller('companies/:companyId/crm/channels')
export class MessagingChannelController {
  constructor(
    private readonly listChannels: ListMessagingChannelsUseCase,
    private readonly connectChannel: ConnectMessagingChannelUseCase,
    private readonly testChannel: TestMessagingChannelUseCase,
    private readonly rotateChannel: RotateMessagingChannelCredentialUseCase,
    private readonly disableChannel: DisableMessagingChannelUseCase,
    private readonly revealChannel: RevealMessagingChannelCredentialUseCase,
    private readonly updateChannelSettings: UpdateMessagingChannelSettingsUseCase,
  ) {}

  @Get()
  @RequirePermissions('crm.channel.read')
  @ApiOperation({ summary: 'List company messaging channels (masked credentials)' })
  list(@ReqCtx() ctx: RequestContext) {
    return this.listChannels.execute(ctx);
  }

  @Post()
  @RequirePermissions('crm.channel.manage')
  @ApiOperation({ summary: 'Connect a company LINE OA channel' })
  connect(@ReqCtx() ctx: RequestContext, @Body() body: ConnectMessagingChannelInput) {
    return this.connectChannel.execute(ctx, body);
  }

  @Patch(':channelId/settings')
  @RequirePermissions('crm.channel.manage')
  @ApiOperation({ summary: 'Update channel autonomy and booking defaults' })
  updateSettings(
    @ReqCtx() ctx: RequestContext,
    @Param('channelId') channelId: string,
    @Body() body: UpdateMessagingChannelSettingsRequest,
  ) {
    return this.updateChannelSettings.execute(ctx, channelId, body);
  }

  @Post(':channelId/test')
  @RequirePermissions('crm.channel.manage')
  @ApiOperation({ summary: 'Test channel connection against the LINE API' })
  test(@ReqCtx() ctx: RequestContext, @Param('channelId') channelId: string) {
    return this.testChannel.execute(ctx, channelId);
  }

  @Post(':channelId/rotate')
  @RequirePermissions('crm.channel.manage')
  @ApiOperation({ summary: 'Rotate channel credentials' })
  rotate(
    @ReqCtx() ctx: RequestContext,
    @Param('channelId') channelId: string,
    @Body() body: RotateMessagingChannelCredentialInput,
  ) {
    return this.rotateChannel.execute(ctx, channelId, body);
  }

  @Post(':channelId/disable')
  @RequirePermissions('crm.channel.manage')
  @ApiOperation({ summary: 'Disable the channel (inbound webhooks are dropped)' })
  disable(
    @ReqCtx() ctx: RequestContext,
    @Param('channelId') channelId: string,
    @Body() body: DisableMessagingChannelInput,
  ) {
    return this.disableChannel.execute(ctx, channelId, body);
  }

  @Post(':channelId/reveal')
  @RequirePermissions('crm.channel.manage')
  @ApiOperation({ summary: 'Reveal channel credentials (audited, high risk)' })
  reveal(@ReqCtx() ctx: RequestContext, @Param('channelId') channelId: string) {
    return this.revealChannel.execute(ctx, channelId);
  }
}
