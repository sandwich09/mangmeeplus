import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { assertRouteCompany } from '../../../data-model-core/presentation/http/assert-route-company';
import {
  ListNotificationsUseCase,
  GetUnreadCountUseCase,
  MarkReadUseCase,
  MarkAllReadUseCase,
  DismissNotificationUseCase,
  GetPreferenceUseCase,
  UpdatePreferenceUseCase,
  ListRulesUseCase,
  UpdateRuleUseCase,
  ListDeliveriesUseCase,
  RetryDeliveryUseCase,
} from '../../application/use-cases/notification.use-cases';
import { UpdateNotificationPreferenceDto, UpdateNotificationRuleDto } from './dashboard-notifications.dtos';

@Controller('companies/:companyId/notifications')
export class NotificationController {
  constructor(
    private readonly listNotifications: ListNotificationsUseCase,
    private readonly getUnreadCount: GetUnreadCountUseCase,
    private readonly markRead: MarkReadUseCase,
    private readonly markAllRead: MarkAllReadUseCase,
    private readonly dismissNotification: DismissNotificationUseCase,
  ) {}

  @Get()
  @RequirePermissions('notification.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listNotifications.execute(ctx, companyId, {
      waiting: q['waiting'] === 'true',
      status: q['status'],
      severity: q['severity'],
      triggerKey: q['triggerKey'],
      read: q['read'] !== undefined ? q['read'] === 'true' : undefined,
      cursor: q['cursor'],
      pageSize: q['pageSize'] ? Number(q['pageSize']) : 25,
    });
  }

  @Get('unread-count')
  @RequirePermissions('notification.read')
  async unreadCount(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.getUnreadCount.execute(ctx, companyId);
  }

  @Post(':notificationId/read')
  @RequirePermissions('notification.read')
  async markOneRead(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('notificationId') notificationId: string) {
    assertRouteCompany(ctx, companyId);
    return this.markRead.execute(ctx, companyId, notificationId);
  }

  @Post('read-all')
  @RequirePermissions('notification.read')
  async markAll(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.markAllRead.execute(ctx, companyId);
  }

  @Post(':notificationId/dismiss')
  @RequirePermissions('notification.read')
  async dismiss(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('notificationId') notificationId: string) {
    assertRouteCompany(ctx, companyId);
    return this.dismissNotification.execute(ctx, companyId, notificationId);
  }
}

@Controller('companies/:companyId/notification-preferences')
export class NotificationPreferenceController {
  constructor(private readonly getPref: GetPreferenceUseCase, private readonly updatePref: UpdatePreferenceUseCase) {}

  @Get()
  @RequirePermissions('notification.preference.manage')
  async get(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.getPref.execute(ctx, companyId);
  }

  @Put()
  @RequirePermissions('notification.preference.manage')
  async update(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Body() body: UpdateNotificationPreferenceDto) {
    assertRouteCompany(ctx, companyId);
    return this.updatePref.execute(ctx, companyId, body);
  }
}

@Controller('companies/:companyId/notification-rules')
export class NotificationRuleController {
  constructor(private readonly listRules: ListRulesUseCase, private readonly updateRule: UpdateRuleUseCase) {}

  @Get()
  @RequirePermissions('notification.rule.manage')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string) {
    assertRouteCompany(ctx, companyId);
    return this.listRules.execute(ctx, companyId);
  }

  @Put(':ruleId')
  @RequirePermissions('notification.rule.manage')
  async update(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('ruleId') ruleId: string, @Body() body: UpdateNotificationRuleDto) {
    assertRouteCompany(ctx, companyId);
    return this.updateRule.execute(ctx, companyId, ruleId, body);
  }
}

@Controller('companies/:companyId/notification-deliveries')
export class NotificationDeliveryController {
  constructor(private readonly listDeliveries: ListDeliveriesUseCase, private readonly retryDelivery: RetryDeliveryUseCase) {}

  @Get()
  @RequirePermissions('notification.delivery.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() q: any) {
    assertRouteCompany(ctx, companyId);
    return this.listDeliveries.execute(ctx, companyId, { channel: q['channel'], status: q['status'], cursor: q['cursor'] });
  }

  @Post(':deliveryId/retry')
  @RequirePermissions('notification.delivery.retry')
  async retry(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Param('deliveryId') deliveryId: string) {
    assertRouteCompany(ctx, companyId);
    return this.retryDelivery.execute(ctx, companyId, deliveryId);
  }
}
