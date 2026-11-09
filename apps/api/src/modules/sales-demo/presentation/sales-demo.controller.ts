import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../../common/security/public.decorator';
import { RequirePermissions } from '../../../common/security/permissions.decorator';
import { trustedClientIp } from '../../../common/security/trusted-client-ip';
import type { RequestContext } from '../../auth/domain/models/request-context.model';
import { SalesAgentActiveGuard } from '../../sales-console/application/sales-context';
import { SalesDemoService } from '../application/sales-demo.service';

export class MintDemoLinkDto {
  @IsOptional() @IsInt() @Min(1) @Max(300) aiCredit?: number;
}

export class OpenDemoDto {
  @IsString() @IsNotEmpty() @MaxLength(128) token!: string;
}

@Controller('sales/demo-links')
@UseGuards(SalesAgentActiveGuard)
export class SalesDemoLinksController {
  constructor(private readonly demo: SalesDemoService) {}

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('sales.demo_link.create')
  mint(@Body() body: MintDemoLinkDto, @Req() req: Request & { context: RequestContext }) {
    // The validated DTO instance keeps `aiCredit` as an own key even when it was not sent.
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'aiCredit')
      || (body.aiCredit !== undefined && (!Number.isInteger(body.aiCredit) || body.aiCredit < 1 || body.aiCredit > 300))) throw new BadRequestException('เครดิตทดลองต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 300 ลองใส่ใหม่อีกครั้ง');
    return this.demo.mint(req.context, body.aiCredit);
  }

  // Owner 2026-11-09 (spec §11): manage links. Bodies are validated by hand: the global pipe would strip
  // unknown keys, and a typo must refuse instead of saving nothing.
  @Get()
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('sales.demo_link.create')
  list(@Req() req: Request & { context: RequestContext }) {
    return this.demo.links.list(req.context);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('sales.demo_link.create')
  update(@Param('id') id: string, @Req() req: Request & { context: RequestContext }) {
    return this.demo.links.update(req.context, id, req.body);
  }

  @Post(':id/reset')
  @HttpCode(204)
  @RequirePermissions('sales.demo_link.create')
  async reset(@Param('id') id: string, @Req() req: Request & { context: RequestContext }) {
    await this.demo.links.reset(req.context, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('sales.demo_link.create')
  async remove(@Param('id') id: string, @Req() req: Request & { context: RequestContext }) {
    await this.demo.links.remove(req.context, id);
  }
}

@Controller('auth/demo')
export class DemoAuthController {
  constructor(private readonly demo: SalesDemoService) {}

  @Public()
  @Post('open')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  open(@Body() body: OpenDemoDto, @Req() req: Request) {
    return this.demo.open(body.token, trustedClientIp(req));
  }
}
