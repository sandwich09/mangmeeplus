import { BillingProviderScanDto, BillingVersionDto, BillingEventPreviewDto, BillingScopePreviewDto, BillingCommandDto, BillingReauthenticateDto, BillingConfigurationDto, BillingCloseDto, BillingRepairPreviewDto, BillingSubmitDto, BillingIssueDto, BillingCollectionPreviewDto, BillingCapacityRepairDto, BillingQuoteDto, BillingCheckoutDto, BillingPortalDto, BillingDocumentDto } from './billing.dto';
import { BadRequestException, Body, Controller, Get, Header, Headers, HttpCode, HttpException, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { BillingCheckoutBody, BillingConfigurationInput, BillingConfigurationDraftInput } from '@watchdog-bms/contracts';
import { Public } from '../../../common/security/public.decorator';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { assertWorkerToken } from '../../../common/security/worker-token';
import { RedisRateLimitService } from '../../../common/security/redis-rate-limit.service';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { BillingService } from '../application/billing.service';
import { BillingReconcilerService } from '../application/billing-reconciler.service';
import { BillingAdminService } from '../application/billing-admin.service';
import { BillingOperationsService } from '../application/billing-operations.service';
import { BillingScopesService } from '../application/billing-scopes.service';
import { BillingConfigurationService } from '../application/billing-configuration.service';
import { BillingNotificationsService } from '../application/billing-notifications.service';
import { BillingProviderScansService } from '../application/billing-provider-scans.service';

type AuthedRequest = Request & { context: RequestContext; rawBody?: Buffer };
function bodyFields(value: unknown, fields: string[]): Record<string, unknown> {
  // Runtime DTO constructors declare optional fields with undefined values. JSON callers
  // cannot send undefined; unknown submitted fields still fail the global whitelist/parser.
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key =>
    (value as Record<string, unknown>)[key] !== undefined && !fields.includes(key))) invalid();
  return value as Record<string, unknown>;
}
function invalid(): never { throw new BadRequestException({ code: 'BILLING_INPUT_INVALID', message: 'กรุณาตรวจสอบข้อมูลรายการ' }); }
function textField(value: unknown, max = 120): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) invalid();
  return value;
}
function uuid(value: unknown): string {
  const text = textField(value);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(text)) invalid();
  return text;
}

@Controller('billing')
export class BillingCatalogController {
  constructor(private readonly billing: BillingService) {}
  @Public() @Get('catalog') @Header('Cache-Control', 'no-store, max-age=0') catalog() { return this.billing.catalog(); }
}

@Controller('system/billing')
export class BillingAdminController {
  constructor(private readonly admin: BillingAdminService, private readonly limits: RedisRateLimitService, private readonly operations: BillingOperationsService,
    private readonly configuration: BillingConfigurationService, private readonly scopes: BillingScopesService,private readonly notifications:BillingNotificationsService, private readonly scans: BillingProviderScansService) {}
  @Get('provider-scans') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  providerScans(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields=bodyFields(query,['cursor']);return this.scans.list(req.context,fields.cursor===undefined?undefined:uuid(fields.cursor));
  }
  @Get('provider-scans/:id') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  providerScan(@Req() req: AuthedRequest, @Param('id') id: string) { return this.scans.get(req.context,uuid(id)); }
  @Post('provider-scans') @RequirePermissions('system.billing.reconcile.run')
  async createProviderScan(@Req() req: AuthedRequest, @Body() body: BillingProviderScanDto, @Headers('idempotency-key') key?: string) {
    bodyFields(body,['windowStart','windowEnd','reason']);await this.operationLimit(req);return this.scans.create(req.context,body,key??'');
  }
  @Post('provider-scans/:id/:action') @HttpCode(200) @RequirePermissions('system.billing.reconcile.run')
  async providerScanAction(@Req() req: AuthedRequest, @Param('id') id: string, @Param('action') action: string, @Body() body: BillingVersionDto) {
    bodyFields(body,['expectedVersion']);await this.operationLimit(req);return this.scans.act(req.context,uuid(id),action,body.expectedVersion);
  }
  @Get('provider-events') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  providerEvents(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields=bodyFields(query,['cursor','all']);if(fields.all!==undefined&&fields.all!=='true')invalid();
    return this.admin.providerEvents(req.context,fields.cursor===undefined?undefined:uuid(fields.cursor),fields.all==='true');
  }
  @Get('provider-events/:id') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  providerEvent(@Req() req: AuthedRequest, @Param('id') id: string) { return this.admin.providerEvent(req.context,uuid(id)); }
  @Post('provider-events/:id/preview') @HttpCode(200) @RequirePermissions('system.billing.reconcile.run')
  async previewEvent(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: BillingEventPreviewDto) {
    const fields=bodyFields(body,['sourceHash','reason']);await this.operationLimit(req);
    return this.operations.previewEvent(req.context,{referenceId:uuid(id),sourceHash:textField(fields.sourceHash,64),reason:textField(fields.reason,500)});
  }
  @Get('companies/:id/deliveries') @RequirePermissions('system.billing.read') @Header('Cache-Control','no-store')
  deliveries(@Req() req:AuthedRequest,@Param('id') id:string,@Query() query:unknown){
    const fields=bodyFields(query,['cursor']);return this.notifications.deliveries(req.context,textField(id,128),fields.cursor===undefined?undefined:textField(fields.cursor,128));
  }
  @Get('companies/:id/deliveries/:deliveryId') @RequirePermissions('system.billing.read') @Header('Cache-Control','no-store')
  delivery(@Req() req:AuthedRequest,@Param('id') id:string,@Param('deliveryId') deliveryId:string){return this.notifications.delivery(req.context,textField(id,128),textField(deliveryId,128));}
  @Get('operator-scopes') @RequirePermissions('admin.role.manage') @Header('Cache-Control', 'no-store')
  scopesList(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['cursor']); return this.scopes.list(req.context, fields.cursor === undefined ? undefined : uuid(fields.cursor));
  }
  @Get('scope-directory/:kind') @RequirePermissions('admin.role.manage') @Header('Cache-Control', 'no-store')
  scopeDirectory(@Req() req: AuthedRequest, @Param('kind') kind: string, @Query() query: unknown) {
    const fields = bodyFields(query, ['search','cursor']); return this.scopes.directory(req.context,kind,
      fields.search === undefined || fields.search === '' ? '' : textField(fields.search,100), fields.cursor === undefined ? undefined : textField(fields.cursor,128));
  }
  @Get('scope-changes') @RequirePermissions('admin.role.manage') @Header('Cache-Control', 'no-store')
  scopeChanges(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['cursor']); return this.scopes.changes(req.context,fields.cursor === undefined ? undefined : uuid(fields.cursor));
  }
  @Get('scope-changes/:id') @RequirePermissions('admin.role.manage') @Header('Cache-Control', 'no-store')
  scopeChange(@Req() req: AuthedRequest, @Param('id') id: string) { return this.scopes.get(req.context,uuid(id)); }
  @Post('scope-changes/preview') @HttpCode(200) @RequirePermissions('admin.role.manage')
  async scopePreview(@Req() req: AuthedRequest, @Body() body: BillingScopePreviewDto) {
    const fields = bodyFields(body,['type','userId','companyId','expiresAt','reason']);
    await this.operationLimit(req); return this.scopes.preview(req.context,{type:textField(fields.type),userId:textField(fields.userId,128),companyId:textField(fields.companyId,128),
      expiresAt:fields.expiresAt === null ? null : textField(fields.expiresAt,40),reason:textField(fields.reason,500)});
  }
  @Post('scope-changes/:id/:action') @HttpCode(200) @RequirePermissions('admin.role.manage')
  async scopeAction(@Req() req: AuthedRequest, @Param('id') id: string, @Param('action') action: string, @Body() body: BillingCommandDto, @Headers('idempotency-key') key?: string) {
    const fields=bodyFields(body,['expectedVersion','previewHash']);
    if (!Number.isInteger(fields.expectedVersion) || !['submit','approve','cancel'].includes(action)) invalid();
    await this.operationLimit(req);return this.scopes.act(req.context,uuid(id),action as 'submit'|'approve'|'cancel',fields.expectedVersion as number,textField(fields.previewHash),key);
  }
  @Get('settings') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  settings(@Req() req: AuthedRequest) { return this.configuration.settings(req.context); }
  @Post('reauthenticate') @HttpCode(200) @RequirePermissions('system.billing.read')
  async reauthenticate(@Req() req: AuthedRequest, @Body() body: BillingReauthenticateDto) {
    const fields = bodyFields(body, ['password']);
    await this.admin.access(req.context, 'system.billing.read');
    const limit = await this.limits.consume('billing-reauthenticate', req.context.userId, 5, 300);
    if (!limit.allowed) throw new HttpException({ code: 'BILLING_RATE_LIMIT', retryAfterSeconds: limit.retryAfterSeconds }, 429);
    return this.configuration.reauthenticate(req.context, textField(fields.password, 1024));
  }
  @Get('configuration-changes') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  configurationList(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['cursor']);
    return this.configuration.list(req.context, fields.cursor === undefined ? undefined : uuid(fields.cursor));
  }
  @Get('configuration-changes/:id') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  configurationGet(@Req() req: AuthedRequest, @Param('id') id: string) { return this.configuration.get(req.context, uuid(id)); }
  @Get('configuration-changes/:id/affected') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  configurationAffected(@Req() req: AuthedRequest,@Param('id') id: string,@Query() query: unknown) {
    const fields=bodyFields(query,['kind','cursor','sourceHash']);
    return this.configuration.affected(req.context,uuid(id),textField(fields.kind,40),fields.cursor===undefined?undefined:textField(fields.cursor,180),
      fields.sourceHash===undefined?undefined:textField(fields.sourceHash,64));
  }
  @Post('configuration-changes/preview') @HttpCode(200) @RequirePermissions('system.billing.read')
  async configurationPreview(@Req() req: AuthedRequest, @Body() body: BillingConfigurationDto) {
    const fields = bodyFields(body, ['type', 'expectedVersion', 'policy', 'gates', 'reason','draftId','draftVersion']);
    if(fields.draftId!==undefined)uuid(fields.draftId);
    if(fields.draftVersion!==undefined&&(!Number.isInteger(fields.draftVersion)||Number(fields.draftVersion)<0))invalid();
    await this.operationLimit(req);
    return this.configuration.preview(req.context, fields as unknown as BillingConfigurationInput);
  }
  @Post('configuration-drafts') @HttpCode(200) @RequirePermissions('system.billing.read')
  async configurationDraft(@Req() req:AuthedRequest,@Body() body: BillingConfigurationDto,@Headers('idempotency-key') key?:string){
    const fields=bodyFields(body,['type','expectedVersion','policy','gates','reason','draftId']);if(fields.draftId!==undefined)uuid(fields.draftId);
    await this.operationLimit(req);return this.configuration.saveDraft(req.context,fields as unknown as BillingConfigurationDraftInput,key??'');
  }
  @Post('configuration-changes/:id/:action') @HttpCode(200) @RequirePermissions('system.billing.read')
  async configurationAction(@Req() req: AuthedRequest, @Param('id') id: string, @Param('action') action: string, @Body() body: BillingCommandDto,
    @Headers('idempotency-key') key?: string) {
    const fields = bodyFields(body, ['expectedVersion', 'previewHash']);
    if (!Number.isInteger(fields.expectedVersion) || !['submit', 'approve', 'cancel'].includes(action)) invalid();
    await this.operationLimit(req);
    if (action === 'cancel') return this.configuration.cancel(req.context, uuid(id), fields.expectedVersion as number);
    if (action === 'approve') return this.configuration.approve(req.context, uuid(id), fields.expectedVersion as number, textField(fields.previewHash));
    return this.configuration.submit(req.context, uuid(id), fields.expectedVersion as number, textField(fields.previewHash), key ?? '');
  }
  @Post('settings/emergency-close') @HttpCode(200) @RequirePermissions('system.billing.gate.manage')
  async configurationClose(@Req() req: AuthedRequest, @Body() body: BillingCloseDto, @Headers('idempotency-key') key?: string) {
    const fields = bodyFields(body, ['expectedVersion', 'gates', 'reason']);
    await this.operationLimit(req);
    return this.configuration.close(req.context, { expectedVersion: fields.expectedVersion as number, gates: fields.gates,
      reason: textField(fields.reason, 500) }, key ?? '');
  }
  private async operationLimit(req: AuthedRequest) {
    await this.admin.access(req.context, 'system.billing.read');
    const result = await this.limits.consume('billing-operator-commands', req.context.userId, 30, 60);
    if (!result.allowed) throw new HttpException({ code: 'BILLING_RATE_LIMIT', retryAfterSeconds: result.retryAfterSeconds }, 429);
  }
  @Get('operations') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  operationsList(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['companyId', 'cursor','referenceId']);
    return this.operations.list(req.context, fields.companyId===undefined?null:textField(fields.companyId, 128), fields.cursor === undefined ? undefined : uuid(fields.cursor),fields.referenceId===undefined?undefined:textField(fields.referenceId,128));
  }
  @Get('operations/:id') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  operation(@Req() req: AuthedRequest, @Param('id') id: string) { return this.operations.get(req.context, uuid(id)); }
  @Post('operations/preview') @HttpCode(200) @RequirePermissions('system.billing.read')
  async preview(@Req() req: AuthedRequest, @Body() body: BillingRepairPreviewDto) {
    const fields = bodyFields(body, ['type', 'companyId', 'reason', 'expectedVersion','referenceId']);
    if ((fields.type!=='RECONCILE'&&fields.type!=='RETRY_APPLY'&&fields.type!=='RETRY_NOTIFICATION'&&fields.type!=='RECONCILE_NOTIFICATION') || !Number.isInteger(fields.expectedVersion)) invalid();
    await this.operationLimit(req);
    return this.operations.preview(req.context, { type: fields.type, companyId: textField(fields.companyId, 128),
      reason: textField(fields.reason, 500), expectedVersion: fields.expectedVersion as number,...fields.referenceId===undefined?{}:{referenceId:textField(fields.referenceId,128)} });
  }
  @Post('operations') @HttpCode(202) @RequirePermissions('system.billing.read')
  async submit(@Req() req: AuthedRequest, @Body() body: BillingSubmitDto, @Headers('idempotency-key') key: string | undefined) {
    const fields = bodyFields(body, ['previewId', 'previewHash', 'expectedVersion']);
    if (!Number.isInteger(fields.expectedVersion)) invalid();
    await this.operationLimit(req);
    return this.operations.submit(req.context, { previewId: uuid(fields.previewId), previewHash: textField(fields.previewHash),
      expectedVersion: fields.expectedVersion as number }, key ?? '');
  }
  @Post('operations/:id/:action') @HttpCode(200) @RequirePermissions('system.billing.read')
  async transition(@Req() req: AuthedRequest, @Param('id') id: string, @Param('action') action: string, @Body() body: BillingVersionDto) {
    const fields = bodyFields(body, ['expectedVersion']);
    if ((action !== 'retry' && action !== 'cancel') || !Number.isInteger(fields.expectedVersion)) invalid();
    await this.operationLimit(req);
    return this.operations.transition(req.context, uuid(id), fields.expectedVersion as number, action);
  }
  @Get('overview') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  overview(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['cursor','search']);
    return this.admin.overview(req.context, fields.cursor === undefined ? undefined : textField(fields.cursor,128), fields.search === undefined || fields.search === '' ? '' : textField(fields.search,100));
  }
  @Get('companies/:id/timeline') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  timeline(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const fields = bodyFields(query,['cursor']);
    return this.admin.timeline(req.context,textField(id,128),fields.cursor === undefined ? undefined : textField(fields.cursor,180));
  }
  @Get('companies/:id') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  company(@Req() req: AuthedRequest, @Param('id') id: string, @Query() query: unknown) {
    const fields = bodyFields(query, ['invoiceCursor']);
    return this.admin.company(req.context, textField(id, 128), fields.invoiceCursor === undefined ? undefined : uuid(fields.invoiceCursor));
  }
  @Get('issues') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  issues(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['cursor', 'companyId', 'state','queue']);
    if(fields.queue!==undefined&&!['UNASSIGNED','OVERDUE'].includes(String(fields.queue)))invalid();
    return this.admin.issues(req.context, { ...(fields.cursor === undefined ? {} : { cursor: uuid(fields.cursor) }),
      ...(fields.companyId === undefined ? {} : { companyId: textField(fields.companyId, 128) }),
      ...(fields.state === undefined ? {} : { state: textField(fields.state, 40) }),...(fields.queue===undefined?{}:{queue:fields.queue as 'UNASSIGNED'|'OVERDUE'}) });
  }
  @Get('issues/:id/operators') @RequirePermissions('system.billing.issue.manage') @Header('Cache-Control','no-store')
  assignees(@Req() req:AuthedRequest,@Param('id') id:string,@Query() query:unknown) {
    const fields=bodyFields(query,['search','cursor']);
    return this.admin.assignees(req.context,uuid(id),fields.search===undefined||fields.search===''?'':textField(fields.search,100),fields.cursor===undefined?undefined:textField(fields.cursor,128));
  }
  @Get('issues/:id') @RequirePermissions('system.billing.read') @Header('Cache-Control', 'no-store')
  issue(@Req() req: AuthedRequest, @Param('id') id: string) { return this.admin.issue(req.context, uuid(id)); }
  @Patch('issues/:id') @RequirePermissions('system.billing.issue.manage')
  async updateIssue(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: BillingIssueDto) {
    const fields = bodyFields(body, ['expectedVersion', 'state', 'note', 'assigneeUserId','backupUserId','priority','followUpAt']);
    if (!Number.isInteger(fields.expectedVersion) || (fields.assigneeUserId !== null && typeof fields.assigneeUserId !== 'string')) invalid();
    await this.admin.access(req.context, 'system.billing.issue.manage');
    const limit = await this.limits.consume('billing-issue-update', req.context.userId, 30, 60);
    if (!limit.allowed) throw new HttpException({ code: 'BILLING_RATE_LIMIT', retryAfterSeconds: limit.retryAfterSeconds }, 429);
    return this.admin.updateIssue(req.context, uuid(id), { expectedVersion: fields.expectedVersion as number,
      state: textField(fields.state, 40), note: textField(fields.note, 1000), assigneeUserId: fields.assigneeUserId as string | null,
      ...(fields.backupUserId===undefined?{}:{backupUserId:fields.backupUserId===null?null:textField(fields.backupUserId,128)}),
      ...(fields.priority===undefined?{}:{priority:textField(fields.priority,20)}),...(fields.followUpAt===undefined?{}:{followUpAt:fields.followUpAt===null?null:textField(fields.followUpAt,40)}) });
  }
}

@RequirePermissions('account.session.read')
@Controller('companies/:companyId/billing')
export class BillingController {
  constructor(private readonly billing: BillingService, private readonly limits: RedisRateLimitService) {}

  private async limit(req: AuthedRequest): Promise<void> {
    await this.billing.assertOwner(req.context);
    const result = await this.limits.consume('billing-command', `${req.context.companyId}:${req.context.userId}`, 30, 60);
    if (!result.allowed) throw new HttpException({ code: 'BILLING_RATE_LIMIT', message: 'กรุณารอสักครู่แล้วลองใหม่', retryAfterSeconds: result.retryAfterSeconds }, 429);
  }

  @Get() status(@Req() req: AuthedRequest) { return this.billing.status(req.context); }
  @Get('collection/:id')
  collectionGet(@Req() req: AuthedRequest, @Param('id') id: string) { return this.billing.collection.get(req.context, uuid(id)); }
  @Post('collection/preview') @HttpCode(200)
  async collectionPreview(@Req() req: AuthedRequest, @Body() body: BillingCollectionPreviewDto) {
    const fields = bodyFields(body, ['action', 'offerKey', 'interval', 'capacity']);
    if (!['CANCEL_RENEWAL', 'RESUME_RENEWAL', 'SCHEDULE_DOWNGRADE', 'CANCEL_DOWNGRADE'].includes(fields.action as string)) invalid();
    await this.limit(req); return this.billing.collection.preview(req.context, fields.action as import('@watchdog-bms/contracts').BillingCollectionAction,
      fields.action === 'SCHEDULE_DOWNGRADE' ? { offerKey: textField(fields.offerKey), interval: textField(fields.interval), capacity: fields.capacity } : undefined);
  }
  @Post('collection/:id/capacity') @HttpCode(200)
  async planCapacityRepair(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: BillingCapacityRepairDto, @Headers('idempotency-key') key?: string) {
    const fields = bodyFields(body, ['expectedVersion', 'selection', 'accepted']);
    if (!Number.isInteger(fields.expectedVersion) || fields.accepted !== true) invalid();
    await this.limit(req); return this.billing.repairPlanCapacity(req.context, uuid(id), fields.expectedVersion as number, fields.selection, key ?? '');
  }
  @Post('collection/:id/:action') @HttpCode(200)
  async collectionCommand(@Req() req: AuthedRequest, @Param('id') id: string, @Param('action') action: string, @Body() body: BillingCommandDto,
    @Headers('idempotency-key') key?: string) {
    const fields = bodyFields(body, ['expectedVersion', 'previewHash', 'accepted']);
    if (!Number.isInteger(fields.expectedVersion) || !['submit', 'withdraw'].includes(action)) invalid();
    await this.limit(req);
    if (action === 'withdraw') return this.billing.collection.withdraw(req.context, uuid(id), fields.expectedVersion as number);
    if (fields.accepted !== true) invalid();
    return this.billing.collection.submit(req.context, uuid(id), fields.expectedVersion as number, textField(fields.previewHash), key ?? '');
  }
  @Post('quote') @HttpCode(200)
  async quote(@Req() req: AuthedRequest, @Body() body: BillingQuoteDto) {
    const fields = bodyFields(body, ['offerKey', 'interval', 'billingEmail', 'capacity']);
    const input = { offerKey: textField(fields.offerKey, 40), interval: textField(fields.interval, 10), billingEmail: textField(fields.billingEmail, 320), capacity: fields.capacity };
    await this.limit(req);
    return this.billing.quote(req.context, input);
  }
  @Get('capacity') @Header('Cache-Control', 'no-store')
  capacity(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['offerKey', 'interval']);
    return this.billing.capacity(req.context, textField(fields.offerKey, 40), textField(fields.interval, 10));
  }
  @Post('attempts/:attemptId/capacity') @HttpCode(202)
  async repairCapacity(@Req() req: AuthedRequest, @Param('attemptId') attemptId: string, @Body() body: BillingCapacityRepairDto, @Headers('idempotency-key') key?: string) {
    const fields = bodyFields(body, ['expectedVersion', 'selection', 'accepted']);
    if (!Number.isInteger(fields.expectedVersion) || fields.accepted !== true) invalid();
    await this.limit(req);
    return this.billing.repairCapacity(req.context, uuid(attemptId), fields.expectedVersion as number, fields.selection, key ?? '');
  }
  @Post('checkout') @HttpCode(200)
  async checkout(@Req() req: AuthedRequest, @Body() body: BillingCheckoutDto, @Headers('idempotency-key') key: string | undefined) {
    const fields = bodyFields(body, ['quoteId', 'consentRevision', 'accepted', 'channel']);
    if (fields.accepted !== true || (fields.channel !== 'web' && fields.channel !== 'line')) invalid();
    const input: BillingCheckoutBody = { quoteId: uuid(fields.quoteId), consentRevision: textField(fields.consentRevision), accepted: true as const, channel: fields.channel };
    await this.limit(req);
    return this.billing.checkout(req.context, input, key ?? '');
  }
  @Get('attempts/:attemptId')
  attempt(@Req() req: AuthedRequest, @Param('attemptId') id: string) { return this.billing.attempt(req.context, id); }
  @Post('attempts/:attemptId/resume') @HttpCode(200)
  async resume(@Req() req: AuthedRequest, @Param('attemptId') id: string) {
    await this.limit(req); return this.billing.resume(req.context, id);
  }
  @Post('refresh') @HttpCode(202)
  async refresh(@Req() req: AuthedRequest) { await this.limit(req); return this.billing.refresh(req.context); }
  @Post('portal') @HttpCode(200)
  async portal(@Req() req: AuthedRequest, @Body() body: BillingPortalDto) {
    if (bodyFields(body, ['action']).action !== 'portal_payment_method') invalid();
    await this.limit(req); return this.billing.portal(req.context);
  }
  @Get('history')
  history(@Req() req: AuthedRequest, @Query() query: unknown) {
    const fields = bodyFields(query, ['cursor', 'limit']);
    if (fields.limit !== undefined && (typeof fields.limit !== 'string' || !/^[0-9]{1,2}$/.test(fields.limit))) invalid();
    const limit = fields.limit === undefined ? 20 : Number(fields.limit);
    if (limit < 1 || limit > 50) invalid();
    const input = { limit, ...(fields.cursor === undefined ? {} : { cursor: uuid(fields.cursor) }) };
    return this.billing.history(req.context, input);
  }
  @Post('documents/:documentId/open') @HttpCode(200)
  async document(@Req() req: AuthedRequest, @Param('documentId') id: string, @Body() body: BillingDocumentDto) {
    const { kind } = bodyFields(body, ['kind']);
    if (kind !== 'invoice' && kind !== 'receipt' && kind !== 'pdf') invalid();
    await this.limit(req); return this.billing.document(req.context, id, kind);
  }
}

@Public() @Controller('public/stripe-events')
export class StripeEventsController {
  constructor(private readonly reconciler: BillingReconcilerService) {}
  @Post() @HttpCode(200)
  receive(@Req() req: AuthedRequest, @Headers('stripe-signature') signature: string | undefined) {
    return this.reconciler.receive(req.rawBody, signature);
  }
}

@Public() @Controller('internal/billing')
export class BillingInternalController {
  constructor(private readonly reconciler: BillingReconcilerService, private readonly operations: BillingOperationsService,
    private readonly notifications: BillingNotificationsService, private readonly scans: BillingProviderScansService) {}
  @Post('provider-scans/drain') @HttpCode(200)
  drainProviderScans(@Headers('x-worker-token') token: string | undefined) { assertWorkerToken(token); return this.scans.drain(); }
  @Post('drain') @HttpCode(200)
  async drain(@Headers('x-worker-token') token: string | undefined) {
    assertWorkerToken(token);
    const provider = await this.reconciler.drain(), operations = await this.operations.drain();
    return { processed: provider.processed + operations.processed, failed: provider.failed + operations.failed };
  }
  @Post('notifications/drain') @HttpCode(200)
  drainNotifications(@Headers('x-worker-token') token: string | undefined) { assertWorkerToken(token); return this.notifications.drain(); }
  @Post('scan') @HttpCode(200)
  scan(@Headers('x-worker-token') token: string | undefined) { assertWorkerToken(token); return this.reconciler.scan(); }
}
