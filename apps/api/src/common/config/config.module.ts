import { Global, Module } from '@nestjs/common';
import { AppConfigService } from './app-config.service';
import { RedisRateLimitService } from '../security/redis-rate-limit.service';

@Global()
@Module({
  providers: [AppConfigService, RedisRateLimitService],
  exports: [AppConfigService, RedisRateLimitService],
})
export class ConfigModule {}
