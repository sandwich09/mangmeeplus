import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequireAnyPermission } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  AddExpenseCaptureFileUseCase,
  CloseExpenseCaptureGroupUseCase,
  CompleteExpenseCaptureFileUseCase,
  ConvertExpenseToCaptureGroupUseCase,
  CreateExpenseCaptureGroupUseCase,
  DetachExpenseCaptureFileUseCase,
  GetExpenseCaptureCapabilityUseCase,
  GetExpenseCaptureGroupUseCase,
  GetExpenseReadStatusUseCase,
  ListExpenseCaptureGroupsUseCase,
} from '../../application/use-cases/expense-capture-group.use-case';
import {
  AddExpenseCaptureFileDto,
  CloseExpenseCaptureGroupDto,
  CompleteExpenseCaptureFileDto,
  ConvertExpenseToCaptureGroupDto,
  CreateExpenseCaptureGroupDto,
  DetachExpenseCaptureFileDto,
} from './expense-capture.dtos';

/**
 * Capture group HTTP surface (appendix §9), on the expenses path because a capture group is part
 * of the expenses journey and reuses its launch gate and permission keys.
 *
 * REGISTERED BEFORE `ExpenseController` in `expenses.module.ts`: that controller declares
 * `@Get(':expenseId')`, and Express matches in registration order, so a later `capture-groups`
 * literal would be swallowed by the parameter route.
 *
 * The decorators are the coarse gate (any of the expense authorities); the use case decides the
 * real answer per group — creator vs reviewer, branch scope, flag, revision. A decorator cannot
 * know whose group it is.
 */
@Controller('companies/:companyId/expenses')
export class ExpenseCaptureController {
  constructor(
    private readonly capability: GetExpenseCaptureCapabilityUseCase,
    private readonly createGroup: CreateExpenseCaptureGroupUseCase,
    private readonly listGroups: ListExpenseCaptureGroupsUseCase,
    private readonly getGroup: GetExpenseCaptureGroupUseCase,
    private readonly addFile: AddExpenseCaptureFileUseCase,
    private readonly completeFile: CompleteExpenseCaptureFileUseCase,
    private readonly detachFile: DetachExpenseCaptureFileUseCase,
    private readonly closeGroup: CloseExpenseCaptureGroupUseCase,
    private readonly convert: ConvertExpenseToCaptureGroupUseCase,
    private readonly readStatusUseCase: GetExpenseReadStatusUseCase,
  ) {}

  @Get('capture-capability')
  @RequireAnyPermission('expense.read', 'expense.read_related', 'expense.read_own', 'expense.review', 'expense.create', 'expense.receipt.upload', 'expense.receipt.line_upload')
  getCapability(@ReqCtx() ctx: RequestContext) {
    return this.capability.execute(ctx);
  }

  @Post('capture-groups')
  @RequireAnyPermission('expense.receipt.upload', 'expense.receipt.line_upload', 'expense.create')
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateExpenseCaptureGroupDto) {
    return this.createGroup.execute(ctx, body ?? {});
  }

  @Get('capture-groups')
  @RequireAnyPermission('expense.read', 'expense.read_own', 'expense.review')
  list(
    @ReqCtx() ctx: RequestContext,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.listGroups.execute(ctx, {
      ...(status ? { status } : {}),
      ...(page ? { page: Number.parseInt(page, 10) } : {}),
      ...(pageSize ? { pageSize: Number.parseInt(pageSize, 10) } : {}),
    });
  }

  @Get('capture-groups/:groupId')
  @RequireAnyPermission('expense.read', 'expense.read_own', 'expense.review')
  get(@ReqCtx() ctx: RequestContext, @Param('groupId') groupId: string) {
    return this.getGroup.execute(ctx, groupId);
  }

  @Post('capture-groups/:groupId/files')
  @RequireAnyPermission('expense.receipt.upload', 'expense.receipt.line_upload', 'expense.create', 'expense.review')
  add(@ReqCtx() ctx: RequestContext, @Param('groupId') groupId: string, @Body() body: AddExpenseCaptureFileDto) {
    return this.addFile.execute(ctx, groupId, body);
  }

  @Post('capture-groups/:groupId/files/:fileId/complete')
  @RequireAnyPermission('expense.receipt.upload', 'expense.receipt.line_upload', 'expense.create', 'expense.review')
  complete(
    @ReqCtx() ctx: RequestContext,
    @Param('groupId') groupId: string,
    @Param('fileId') fileId: string,
    @Body() body: CompleteExpenseCaptureFileDto,
  ) {
    return this.completeFile.execute(ctx, groupId, fileId, body);
  }

  @Post('capture-groups/:groupId/files/:fileId/detach')
  @RequireAnyPermission('expense.update', 'expense.review')
  detach(
    @ReqCtx() ctx: RequestContext,
    @Param('groupId') groupId: string,
    @Param('fileId') fileId: string,
    @Body() body: DetachExpenseCaptureFileDto,
  ) {
    return this.detachFile.execute(ctx, groupId, fileId, body);
  }

  @Post('capture-groups/:groupId/close')
  @RequireAnyPermission('expense.update', 'expense.review')
  close(@ReqCtx() ctx: RequestContext, @Param('groupId') groupId: string, @Body() body: CloseExpenseCaptureGroupDto) {
    return this.closeGroup.execute(ctx, groupId, body);
  }

  /**
   * The PDF read of one expense (§9). Polled by the review page — read-only, and it never starts
   * a read: an endpoint that re-queued on every poll would read a 20-page file once a second.
   */
  @Get(':expenseId/read-status')
  @RequireAnyPermission('expense.read', 'expense.read_own', 'expense.review')
  readStatus(@ReqCtx() ctx: RequestContext, @Param('expenseId') expenseId: string) {
    return this.readStatusUseCase.execute(ctx, expenseId);
  }

  /** §3.1 "แยกเป็นกลุ่มหลักฐาน": the expense keeps its id, its link and every amount. */
  @Post(':expenseId/capture-group')
  @RequireAnyPermission('expense.receipt.upload', 'expense.receipt.line_upload', 'expense.create')
  convertExpense(
    @ReqCtx() ctx: RequestContext,
    @Param('expenseId') expenseId: string,
    @Body() body: ConvertExpenseToCaptureGroupDto,
  ) {
    return this.convert.execute(ctx, expenseId, body);
  }
}
