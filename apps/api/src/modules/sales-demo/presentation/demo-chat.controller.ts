import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { DemoChatService, DEMO_UPLOAD_MAX_BYTES, type DemoUpload } from '../application/demo-chat.service';

type DemoRequest = Request & { context: RequestContext };

/** Either `text`, or `postbackData` (+ optional `displayText`); the service checks the combination. */
export class DemoChatMessageDto {
  @IsOptional() @IsString() @MaxLength(1000) text?: string;
  @IsOptional() @IsString() @MaxLength(1000) postbackData?: string;
  @IsOptional() @IsString() @MaxLength(1000) displayText?: string;
}

@Controller('companies/:companyId/demo-chat')
@RequirePermissions('account.session.read')
export class DemoChatController {
  constructor(private readonly chat: DemoChatService) {}

  @Post('messages') @HttpCode(202) @Header('Cache-Control', 'no-store')
  message(@Param('companyId') companyId: string, @Body() body: DemoChatMessageDto, @Req() req: DemoRequest) {
    return this.chat.message(req.context, companyId, body);
  }

  @Post('files') @HttpCode(202) @Header('Cache-Control', 'no-store')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DEMO_UPLOAD_MAX_BYTES, files: 1, fields: 0 } }))
  file(@Param('companyId') companyId: string, @UploadedFile() file: DemoUpload | undefined, @Req() req: DemoRequest) {
    return this.chat.file(req.context, companyId, file);
  }

  @Get('messages') @Header('Cache-Control', 'no-store')
  messages(@Param('companyId') companyId: string, @Query('after') after: string | undefined, @Req() req: DemoRequest) {
    return this.chat.messages(req.context, companyId, after);
  }
}
