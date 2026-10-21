import { Body, Controller, Get, Header, Put, Req } from '@nestjs/common';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { HOME_EVENTS, HOME_THEME_MANAGE_PERMISSION, type HomeEvent, type PublicHomeTheme } from '@watchdog-bms/contracts';
import { Public } from '../../common/security/public.decorator';
import { RequirePermissions } from '../../common/security/permissions.decorator';
import type { RequestContext } from '../auth/domain/models/request-context.model';
import { HomeThemeService } from './home-theme.service';

class SetHomeThemeBody {
  @IsIn(Object.keys(HOME_EVENTS)) event!: HomeEvent;
  @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) expectedVersion!: number;
}

@Controller('public/home-theme')
export class PublicHomeThemeController {
  constructor(private readonly themes: HomeThemeService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async get(): Promise<PublicHomeTheme> {
    return { event: (await this.themes.read()).event };
  }
}

@Controller('system/home-theme')
@RequirePermissions(HOME_THEME_MANAGE_PERMISSION)
export class SystemHomeThemeController {
  constructor(private readonly themes: HomeThemeService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  get(@Req() req: { context: RequestContext }) {
    this.themes.assertAdmin(req.context);
    return this.themes.read();
  }

  @Put()
  @Header('Cache-Control', 'no-store')
  set(@Body() body: SetHomeThemeBody, @Req() req: { context: RequestContext }) {
    return this.themes.set(body, req.context);
  }
}
