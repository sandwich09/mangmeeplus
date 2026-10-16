import { ArgumentsHost, Body, Catch, Controller, Delete, ExceptionFilter, ForbiddenException, Get, HttpCode, Param, Post, Put, Query, Res, StreamableFile, UseFilters } from '@nestjs/common';
import type { Response } from 'express';
import type { RequestContext } from '@watchdog-bms/contracts';
import { disbursementVoucherError } from '@watchdog-bms/contracts';
import { RequireAnyPermission, RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import { ReadDisbursementVoucherSourcesUseCase } from '../../application/use-cases/disbursement-voucher-read.use-case';
import { DisbursementVoucherUseCase } from '../../application/use-cases/disbursement-voucher.use-case';
import { RevealDisbursementVoucherAccountQueryDto, DisbursementVoucherListQueryDto, CreateDisbursementVoucherDraftDto, UpdateDisbursementVoucherDraftDto, DisbursementVoucherCommandDto, SubmitDisbursementVoucherDto, EndDisbursementVoucherDto, PayDisbursementVoucherDto, IssueDisbursementVoucherDto, ReissueDisbursementVoucherDto,
  RemindDisbursementVoucherDto, InitDisbursementVoucherSlipUploadDto, CompleteDisbursementVoucherSlipUploadDto, AttachDisbursementVoucherSlipDto } from './disbursement-voucher.dtos';

/** The global permission guard runs before the document visibility check. Files conceal both. */
@Catch(ForbiddenException)
export class DisbursementVoucherPdfReadFilter implements ExceptionFilter {
  catch(error: ForbiddenException, host: ArgumentsHost) {
    const body = error.getResponse();
    const line = typeof body === 'object' && 'code' in body && body.code === 'disbursement_line_session_denied';
    host.switchToHttp().getResponse<Response>().status(line ? 403 : 404).json(line ? body : disbursementVoucherError('disbursement_not_found'));
  }
}

@Controller('companies/:companyId/disbursement-vouchers')
export class DisbursementVoucherController {
  constructor(private readonly read: ReadDisbursementVoucherSourcesUseCase, private readonly vouchers: DisbursementVoucherUseCase) {}

  @Get('payee-account')
  @RequirePermissions('expense.disbursement.prepare')
  payeeAccount(@ReqCtx() ctx: RequestContext, @Query('payeeKey') payeeKey: string, @Query('branchId') branchId?: string) {
    return this.vouchers.payeeAccount(ctx, payeeKey, branchId);
  }

  @Get('payees')
  @RequirePermissions('expense.disbursement.prepare')
  payees(@ReqCtx() ctx: RequestContext, @Query() query: Record<string, string | undefined>) {
    return this.read.payees(ctx, { search: query.search, branchId: query.branchId,
      page: query.page ? Number(query.page) : undefined, pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get('payable-expenses')
  @RequirePermissions('expense.disbursement.prepare')
  payableExpenses(@ReqCtx() ctx: RequestContext, @Query() query: Record<string, string | undefined>) {
    return this.read.payableExpenses(ctx, { payeeKey: query.payeeKey, search: query.search, branchId: query.branchId });
  }

  @Get('approvers')
  @RequirePermissions('expense.disbursement.prepare')
  approvers(@ReqCtx() ctx: RequestContext, @Query('branchId') branchId?: string) { return this.vouchers.approvers(ctx, branchId); }

  @Post('from-payment')
  @RequirePermissions('expense.disbursement.issue')
  fromPayment(@ReqCtx() ctx: RequestContext, @Body() body: IssueDisbursementVoucherDto) { return this.vouchers.fromPayment(ctx, body); }

  @Post(':id/reissue')
  @RequirePermissions('expense.disbursement.issue')
  reissue(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReissueDisbursementVoucherDto) { return this.vouchers.reissue(ctx, id, body); }

  @Post()
  @RequirePermissions('expense.disbursement.prepare')
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateDisbursementVoucherDraftDto) {
    return this.vouchers.create(ctx, body);
  }

  @Put(':id')
  @RequirePermissions('expense.disbursement.prepare')
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: UpdateDisbursementVoucherDraftDto) {
    return this.vouchers.update(ctx, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('expense.disbursement.prepare')
  delete(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.vouchers.delete(ctx, id);
  }

  @Get()
  @RequirePermissions('expense.disbursement.read')
  list(@ReqCtx() ctx: RequestContext, @Query() query: DisbursementVoucherListQueryDto) {
    return this.vouchers.list(ctx, { ...(query.q !== undefined ? { q: query.q } : {}), status: query.status, branchId: query.branchId, order: query.order ?? 'newest',
      page: query.page ? Number(query.page) : undefined, pageSize: query.pageSize ? Number(query.pageSize) : undefined });
  }

  @Get(':id')
  @RequirePermissions('expense.disbursement.read')
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.vouchers.get(ctx, id);
  }

  @Post(':id/submit')
  @RequirePermissions('expense.disbursement.prepare')
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SubmitDisbursementVoucherDto) { return this.vouchers.submit(ctx, id, body); }

  @Post(':id/remind')
  @RequirePermissions('expense.disbursement.prepare')
  remind(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RemindDisbursementVoucherDto) { return this.vouchers.remind(ctx, id, body); }

  @Post(':id/approve')
  @RequirePermissions('expense.disbursement.approve')
  approve(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DisbursementVoucherCommandDto) { return this.vouchers.approve(ctx, id, body); }

  @Post(':id/return')
  @RequirePermissions('expense.disbursement.approve')
  return(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: EndDisbursementVoucherDto) { return this.vouchers.return(ctx, id, body); }

  @Post(':id/withdraw')
  @RequireAnyPermission('expense.disbursement.prepare', 'expense.disbursement.approve')
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: EndDisbursementVoucherDto) { return this.vouchers.withdraw(ctx, id, body); }

  @Post(':id/cancel')
  @RequireAnyPermission('expense.disbursement.prepare', 'expense.disbursement.approve')
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: EndDisbursementVoucherDto) { return this.vouchers.cancel(ctx, id, body); }

  @Post(':id/payee-account/reveal')
  @RequireAnyPermission('expense.disbursement.prepare', 'expense.disbursement.approve', 'expense.disbursement.pay')
  revealAccount(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() query: RevealDisbursementVoucherAccountQueryDto) { return this.vouchers.revealAccount(ctx, id, query.purpose); }

  @Get(':id/document.pdf')
  @RequirePermissions('expense.disbursement.read')
  @UseFilters(new DisbursementVoucherPdfReadFilter())
  async documentPdf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const { data, fileName } = await this.vouchers.documentPdf(ctx, id);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return new StreamableFile(data, { type: 'application/pdf', disposition: `attachment; filename="disbursement-voucher.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}` });
  }

  @Post(':id/pay')
  @RequirePermissions('expense.disbursement.pay')
  pay(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: PayDisbursementVoucherDto) { return this.vouchers.pay(ctx, id, body); }

  @Get(':id/supporting-files')
  @RequirePermissions('expense.disbursement.read')
  @UseFilters(new DisbursementVoucherPdfReadFilter())
  supportingFiles(@ReqCtx() ctx: RequestContext, @Param('id') id: string) { return this.vouchers.supportingFiles(ctx, id); }

  @Post(':id/supporting-files/slip-upload-intent')
  @RequirePermissions('expense.disbursement.prepare')
  startSupportingUpload(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: InitDisbursementVoucherSlipUploadDto) { return this.vouchers.startSupportingUpload(ctx, id, body); }

  @Post(':id/supporting-files/slip-uploads/:attachmentId/complete')
  @RequirePermissions('expense.disbursement.prepare')
  completeSupportingUpload(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('attachmentId') attachmentId: string, @Body() body: CompleteDisbursementVoucherSlipUploadDto) { return this.vouchers.completeSupportingUpload(ctx, id, attachmentId, body); }

  @Post(':id/supporting-files')
  @RequirePermissions('expense.disbursement.prepare')
  attachSupportingFile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AttachDisbursementVoucherSlipDto) { return this.vouchers.changeSupportingFile(ctx, id, body.attachmentId, false); }

  @Delete(':id/supporting-files/:attachmentId')
  @RequirePermissions('expense.disbursement.prepare')
  removeSupportingFile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('attachmentId') attachmentId: string) { return this.vouchers.changeSupportingFile(ctx, id, attachmentId, true); }

  @Get(':id/supporting-files/:attachmentId')
  @RequirePermissions('expense.disbursement.read')
  @UseFilters(new DisbursementVoucherPdfReadFilter())
  openSupportingFile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('attachmentId') attachmentId: string) { return this.vouchers.openSupportingFile(ctx, id, attachmentId); }

  @Post(':id/slip-upload-intent')
  @RequirePermissions('expense.disbursement.pay')
  startSlipUpload(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: InitDisbursementVoucherSlipUploadDto) { return this.vouchers.startSlipUpload(ctx, id, body); }

  @Post(':id/slip-uploads/:attachmentId/complete')
  @HttpCode(200)
  @RequirePermissions('expense.disbursement.pay')
  completeSlipUpload(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('attachmentId') attachmentId: string, @Body() body: CompleteDisbursementVoucherSlipUploadDto) { return this.vouchers.completeSlipUpload(ctx, id, attachmentId, body); }

  @Post(':id/slip')
  @HttpCode(200)
  @RequirePermissions('expense.disbursement.pay')
  attachSlip(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: AttachDisbursementVoucherSlipDto) { return this.vouchers.attachSlip(ctx, id, body.attachmentId); }

  @Get(':id/slip')
  @RequirePermissions('expense.disbursement.read')
  @UseFilters(new DisbursementVoucherPdfReadFilter())
  slip(@ReqCtx() ctx: RequestContext, @Param('id') id: string) { return this.vouchers.slip(ctx, id); }
}
