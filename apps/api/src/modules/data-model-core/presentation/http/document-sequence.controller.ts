import { Controller, Get, Put, Param, Body, Query } from '@nestjs/common';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListDocumentSequencesUseCase } from '../../application/use-cases/list-document-sequences.use-case';
import { UpsertDocumentSequenceUseCase } from '../../application/use-cases/upsert-document-sequence.use-case';
import { assertRouteCompany } from './assert-route-company';
import { UpsertDocumentSequenceDto } from './data-model-core.dtos';

@Controller('companies/:companyId/document-sequences')
export class DocumentSequenceController {
  constructor(
    private readonly listSequences: ListDocumentSequencesUseCase,
    private readonly upsertSequence: UpsertDocumentSequenceUseCase,
  ) {}

  @Get()
  @RequirePermissions('document.sequence.read')
  async list(@ReqCtx() ctx: RequestContext, @Param('companyId') companyId: string, @Query() query: any) {
    assertRouteCompany(ctx, companyId);
    return this.listSequences.execute(ctx, {
      documentType: query['documentType'],
      branchId: query['branchId'],
      page: query['page'] ? Number(query['page']) : undefined,
      pageSize: query['pageSize'] ? Number(query['pageSize']) : undefined,
    });
  }

  @Put(':documentType')
  @RequirePermissions('document.sequence.manage')
  async upsert(
    @ReqCtx() ctx: RequestContext,
    @Param('companyId') companyId: string,
    @Param('documentType') documentType: string,
    @Body() body: UpsertDocumentSequenceDto,
  ) {
    assertRouteCompany(ctx, companyId);
    return this.upsertSequence.execute(ctx, { documentType, ...body });
  }
}
