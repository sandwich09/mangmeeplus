import { Controller, Get, Post, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type {
  RequestContext,
  CreateCrmCustomerInput,
  UpdateCrmCustomerInput,
  ArchiveCrmCustomerInput,
  AssignCrmCustomerInput,
  ListCrmCustomersFilter,
  CreateCrmContactInput,
  UpdateCrmContactInput,
  CrmCustomerStatus,
  CrmCustomerTier,
  MergeCrmCustomersInput,
  LinkCrmCustomerLineIdentityInput,
} from '@watchdog-bms/contracts';
import {
  CreateCrmCustomerUseCase,
  UpdateCrmCustomerUseCase,
  GetCrmCustomerUseCase,
  ListCrmCustomersUseCase,
  ArchiveCrmCustomerUseCase,
  AssignCrmCustomerUseCase,
  ListCrmContactsUseCase,
  CreateCrmContactUseCase,
  UpdateCrmContactUseCase,
  PreviewCrmCustomerMergeUseCase,
  MergeCrmCustomersUseCase,
  LinkCrmCustomerLineIdentityUseCase,
} from '../../application/use-cases/crm-customer.use-case';

@ApiTags('crm')
@Controller('companies/:companyId/crm')
export class CrmCustomerController {
  constructor(
    private readonly createCustomer: CreateCrmCustomerUseCase,
    private readonly updateCustomer: UpdateCrmCustomerUseCase,
    private readonly getCustomer: GetCrmCustomerUseCase,
    private readonly listCustomers: ListCrmCustomersUseCase,
    private readonly archiveCustomer: ArchiveCrmCustomerUseCase,
    private readonly assignCustomer: AssignCrmCustomerUseCase,
    private readonly listContacts: ListCrmContactsUseCase,
    private readonly createContact: CreateCrmContactUseCase,
    private readonly updateContact: UpdateCrmContactUseCase,
    private readonly previewMerge: PreviewCrmCustomerMergeUseCase,
    private readonly mergeCustomers: MergeCrmCustomersUseCase,
    private readonly linkLineIdentity: LinkCrmCustomerLineIdentityUseCase,
  ) {}

  @Get('customers')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({ summary: 'List CRM customers' })
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('scope') scope?: 'own' | 'all',
    @Query('status') status?: CrmCustomerStatus,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('tier') tier?: CrmCustomerTier,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: 'updatedAt' | 'ltv',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const filter: ListCrmCustomersFilter = { scope, status, ownerUserId, tier, search, sortBy, page: page ? Number(page) : undefined, pageSize: pageSize ? Number(pageSize) : undefined };
    return this.listCustomers.execute(ctx, filter);
  }

  @Post('customers')
  @RequirePermissions('crm.customer.create')
  @ApiOperation({ summary: 'Create CRM customer' })
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateCrmCustomerInput) {
    return this.createCustomer.execute(ctx, body);
  }

  @Post('customers/merge/preview')
  @RequirePermissions('crm.customer.merge')
  @ApiOperation({ summary: 'Preview customer merge impact and conflicts' })
  previewCustomerMerge(@ReqCtx() ctx: RequestContext, @Body() body: MergeCrmCustomersInput) {
    return this.previewMerge.execute(ctx, body);
  }

  @Post('customers/merge')
  @RequirePermissions('crm.customer.merge')
  @ApiOperation({ summary: 'Merge a secondary customer into a canonical primary customer' })
  mergeCustomer(@ReqCtx() ctx: RequestContext, @Body() body: MergeCrmCustomersInput) {
    return this.mergeCustomers.execute(ctx, body);
  }

  @Get('customers/:customerId')
  @RequirePermissions('crm.customer.read')
  @ApiOperation({ summary: 'Get CRM customer detail' })
  get(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string) {
    return this.getCustomer.execute(ctx, customerId);
  }

  @Patch('customers/:customerId')
  @RequirePermissions('crm.customer.update')
  @ApiOperation({ summary: 'Update CRM customer' })
  update(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string, @Body() body: UpdateCrmCustomerInput) {
    return this.updateCustomer.execute(ctx, customerId, body);
  }

  @Post('customers/:customerId/line-identities/:identityId/link')
  @RequirePermissions('crm.customer.merge')
  @ApiOperation({ summary: 'Explicitly re-point and verify a LINE identity for a canonical customer' })
  linkCustomerLineIdentity(
    @ReqCtx() ctx: RequestContext,
    @Param('customerId') customerId: string,
    @Param('identityId') identityId: string,
    @Body() body: LinkCrmCustomerLineIdentityInput,
  ) {
    return this.linkLineIdentity.execute(ctx, customerId, identityId, body);
  }

  @Post('customers/:customerId/archive')
  @RequirePermissions('crm.customer.archive')
  @ApiOperation({ summary: 'Archive CRM customer' })
  archive(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string, @Body() body: ArchiveCrmCustomerInput) {
    return this.archiveCustomer.execute(ctx, customerId, body);
  }

  @Post('customers/:customerId/assign')
  @RequirePermissions('crm.customer.assign')
  @ApiOperation({ summary: 'Assign CRM customer owner' })
  assign(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string, @Body() body: AssignCrmCustomerInput) {
    return this.assignCustomer.execute(ctx, customerId, body);
  }

  @Get('customers/:customerId/contacts')
  @RequirePermissions('crm.contact.read')
  @ApiOperation({ summary: 'List customer contacts' })
  contacts(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string) {
    return this.listContacts.execute(ctx, customerId);
  }

  @Post('customers/:customerId/contacts')
  @RequirePermissions('crm.contact.manage')
  @ApiOperation({ summary: 'Create customer contact' })
  addContact(@ReqCtx() ctx: RequestContext, @Param('customerId') customerId: string, @Body() body: CreateCrmContactInput) {
    return this.createContact.execute(ctx, customerId, body);
  }

  @Patch('contacts/:contactId')
  @RequirePermissions('crm.contact.manage')
  @ApiOperation({ summary: 'Update customer contact' })
  editContact(@ReqCtx() ctx: RequestContext, @Param('contactId') contactId: string, @Body() body: UpdateCrmContactInput) {
    return this.updateContact.execute(ctx, contactId, body);
  }
}
