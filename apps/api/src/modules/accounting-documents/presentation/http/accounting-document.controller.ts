import { Controller, Get, Post, Patch, Param, Body, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext, AccountingDocumentType } from '@watchdog-bms/contracts';
import { CreateAccountingDocumentDto, UpdateAccountingDocumentDto } from './accounting-money.dtos';
import {
  CreateDocumentUseCase,
  UpdateDocumentUseCase,
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

const DOCUMENT_READ_PERMISSIONS = [
  'accounting.document.read', 'accounting.document.read_related', 'accounting.quotation.read', 'accounting.invoice.read', 'accounting.billing_note.read',
  'accounting.receipt.read', 'accounting.tax_invoice.read', 'accounting.credit_note.read', 'accounting.debit_note.read',
];
const DOCUMENT_CREATE_PERMISSIONS = [
  'accounting.document.create', 'accounting.quotation.create', 'accounting.invoice.create', 'accounting.billing_note.create',
  'accounting.receipt.create', 'accounting.credit_note.create', 'accounting.debit_note.create',
];
const DOCUMENT_ISSUE_PERMISSIONS = [
  'accounting.document.issue', 'accounting.quotation.issue', 'accounting.invoice.issue', 'accounting.billing_note.issue',
  'accounting.receipt.issue', 'accounting.tax_invoice.issue', 'accounting.credit_note.issue', 'accounting.debit_note.issue',
];
const DOCUMENT_VOID_PERMISSIONS = [
  'accounting.document.void', 'accounting.quotation.void', 'accounting.invoice.void', 'accounting.billing_note.void',
  'accounting.receipt.void', 'accounting.tax_invoice.void', 'accounting.credit_note.void', 'accounting.debit_note.void',
];

@ApiTags('accounting')
@Controller('companies/:companyId/accounting/documents')
export class AccountingDocumentController {
  constructor(
    private readonly createDoc: CreateDocumentUseCase,
    private readonly updateDoc: UpdateDocumentUseCase,
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
  @RequireAnyPermission(...DOCUMENT_READ_PERMISSIONS)
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
  @RequireAnyPermission(...DOCUMENT_READ_PERMISSIONS)
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
  @RequireAnyPermission(...DOCUMENT_CREATE_PERMISSIONS)
  @ApiOperation({ summary: 'Create accounting document draft' })
  async create(@ReqCtx() ctx: RequestContext, @Body() body: CreateAccountingDocumentDto) {
    return this.createDoc.execute(ctx, body);
  }

  @Patch(':documentId')
  @RequireAnyPermission(
    'accounting.document.update',
    'accounting.quotation.update',
    'accounting.invoice.update',
    'accounting.billing_note.update',
    'accounting.receipt.update',
  )
  @ApiOperation({ summary: 'Update an accounting document draft' })
  async update(
    @ReqCtx() ctx: RequestContext,
    @Param('documentId') documentId: string,
    @Body() body: UpdateAccountingDocumentDto,
  ) {
    return this.updateDoc.execute(ctx, {
      ...body,
      documentId,
      expectedUpdatedAt: new Date(body.expectedUpdatedAt),
    });
  }

  @Post(':documentId/issue')
  @RequireAnyPermission(...DOCUMENT_ISSUE_PERMISSIONS)
  @HttpCode(200)
  @ApiOperation({ summary: 'Issue accounting document' })
  async issue(@ReqCtx() ctx: RequestContext, @Param('documentId') documentId: string) {
    return this.issueDoc.execute(ctx, documentId);
  }

  @Post(':documentId/void')
  @RequireAnyPermission(...DOCUMENT_VOID_PERMISSIONS)
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
  @RequireAnyPermission(...DOCUMENT_CREATE_PERMISSIONS)
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
