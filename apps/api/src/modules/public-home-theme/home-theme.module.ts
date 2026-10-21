import { Module } from '@nestjs/common';
import { HomeThemeService } from './home-theme.service';
import { PublicHomeThemeController, SystemHomeThemeController } from './home-theme.controller';

@Module({ controllers: [PublicHomeThemeController, SystemHomeThemeController], providers: [HomeThemeService] })
export class HomeThemeModule {}
