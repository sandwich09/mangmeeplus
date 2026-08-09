import { Module } from '@nestjs/common';
import { DataRightsController } from './data-rights.controller';
import { DataRightsService } from './data-rights.service';

@Module({
  controllers: [DataRightsController],
  providers: [DataRightsService],
})
export class DataRightsModule {}
