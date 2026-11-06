import { LineAiModule } from '../line-ai/line-ai.module';
import { DataModelCoreModule } from '../data-model-core/data-model-core.module';
import { DemoChatController } from './presentation/demo-chat.controller';
import { DemoChatService } from './application/demo-chat.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SystemOnboardingModule } from '../system-onboarding/system-onboarding.module';
import { SalesAgentActiveGuard } from '../sales-console/application/sales-context';
import { SalesDemoService } from './application/sales-demo.service';
import { DemoAuthController, SalesDemoLinksController } from './presentation/sales-demo.controller';

@Module({
  imports: [AuthModule, SystemOnboardingModule, LineAiModule, DataModelCoreModule],
  controllers: [SalesDemoLinksController, DemoAuthController, DemoChatController],
  providers: [SalesDemoService, SalesAgentActiveGuard, DemoChatService],
})
export class SalesDemoModule {}
