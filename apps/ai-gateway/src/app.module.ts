import { Module } from '@nestjs/common';
import { AiAuthModule } from './auth/ai-auth.module';
import { AiModule } from './common/ai/ai.module';
import { SecurityModule } from './common/security/security.module';
import { HealthModule } from './modules/health/health.module';
import { LineAiModule } from './modules/line-ai/line-ai.module';
import { AiDraftModule } from './modules/ai-draft/ai-draft.module';
import { CrmCustomerAiModule } from './modules/crm-customer-ai/crm-customer-ai.module';

// Guard order: AiToolGuard (AiAuthModule) runs first to authenticate + check ai.tool.invoke,
// then DenyByDefaultGuard (SecurityModule) enforces route-level @RequirePermissions.
@Module({
  imports: [AiAuthModule, AiModule, SecurityModule, HealthModule, LineAiModule, AiDraftModule, CrmCustomerAiModule],
})
export class AppModule {}
