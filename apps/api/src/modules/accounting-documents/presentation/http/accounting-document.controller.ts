import { Controller, Get, Post, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, AccountingDocumentType } from '@watchdog-bms/contracts';
import { CreateAccountingDocumentDto } from './accounting-money.dtos';
import {
  CreateDocumentUseCase,
  GetDocumentUseCase,
  ListDocumentsUseCase,
  IssueDocumentUseCase,
  VoidDocumentUseCase,
  SubmitQuotationApprovalUseCase,
  ApproveQuotationUseCase,
  RejectQuotationUseCase,
  ConvertDocumentUseCase,
} from '../../application/use-cases/document.use-case';
import { GetDocumentPostingSourceUseCase } from '../../application/use-cases/posting-source.use-case';

@ApiTags('accounting')
@Controller('companies/:companyId/accounting/documents')
export class AccountingDocumentController {
  constructor(
    private readonly createDoc: CreateDocumentUseCase,
    private readonly getDoc: GetDocumentUseCase,
    private readonly listDocs: ListDocumentsUseCase,
    private readonly issueDoc: IssueDocumentUseCase,
    private readonly voidDoc: VoidDocumentUseCase,
    private readonly submitApproval: SubmitQuotationApprovalUseCase,
    private readonly approveQuotation: ApproveQuotationUseCase,
    private readonly rejectQuotation: RejectQuotationUseCase,
    private readonly convertDoc: ConvertDocumentUseCase,
    private readonly postingSource: GetDocumentPostingSourceUseCase,
  ) {}

  @Get()
  @RequirePermissions('accounting.document.read')
  @ApiOperation({ summary: 'List accounting documents' })
  async list(
    @ReqCtx() ctx: RequestContext,
    @Query('documentType') documentType?: AccountingDocumentType,
    @Query('status') status?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('counterpartyId') counterpartyId?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.listDocs.execute(ctx, {
      documentType,
      status: status as any,
      paymentStatus: paymentStatus as any,
      counterpartyId,
      fromDate,
      toDate,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get(':documentId')
  @RequirePermissions('accounting.document.read')
  @ApiOperation({ summary: 'Get accounting document by id' })
  async getOne(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string) {
    return this.getDoc.execute(ctx, documentId);
  }

  @Get(':documentId/posting-source')
  @RequirePermissions('accounting.document.read')
  @ApiOperation({ summary: 'Get ledger-ready posting source for finalized document' })
  async getPostingSource(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string) {
    return this.postingSource.execute(ctx, documentId);
  }

  @Post()
  @RequirePermissions('accounting.document.create')
  @ApiOperation({ summary: 'Create accounting document draft' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateAccountingDocumentDto) {
    return this.createDoc.execute(ctx, body);
  }

  @Post(':documentId/issue')
  @RequirePermissions('accounting.document.issue')
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue accounting document' })
  async issue(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string) {
    return this.issueDoc.execute(ctx, documentId);
  }

  @Post(':documentId/void')
  @RequirePermissions('accounting.document.void')
  @HttpCode(200)
  @ApiOperation({ summary: 'Void accounting document' })
  async void(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string, @Body() body: { reason: string }) {
    return this.voidDoc.execute(ctx, documentId, body.reason);
  }

  @Post(':documentId/submit-approval')
  @RequirePermissions('accounting.quotation.submit_approval')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit quotation for approval' })
  async submitApprovalAction(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string) {
    return this.submitApproval.execute(ctx, documentId);
  }

  @Post(':documentId/approve')
  @RequirePermissions('accounting.quotation.approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve quotation issue' })
  async approve(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string, @Body() body: { note?: string }) {
    return this.approveQuotation.execute(ctx, documentId, body.note);
  }

  @Post(':documentId/reject')
  @RequirePermissions('accounting.quotation.approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject quotation issue' })
  async reject(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string, @Body() body: { note: string }) {
    return this.rejectQuotation.execute(ctx, documentId, body.note);
  }

  @Post(':documentId/convert')
  @RequirePermissions('accounting.document.create')
  @HttpCode(200)
  @ApiOperation({ summary: 'Convert issued quotation to invoice or billing note' })
  async convert(
    @ReqCtx() ctx: RequestContext,
    @Param('documentId') documentId: string,
    @Body() body: { targetType: AccountingDocumentType },
  ) {
    return this.convertDoc.execute(ctx, documentId, body.targetType);
  }
}
