import { Module } from '@nestjs/common';
import { createLogger, LOGGER_TOKEN } from './logger.service';
import { RequestLoggerMiddleware } from '../middleware/request-logger.middleware';
import { AppConfigService } from '../config/app-config.service';

@Module({
  providers: [
    {
      provide: LOGGER_TOKEN,
      useFactory: (config: AppConfigService) =>
        createLogger({
          level: config.logLevel,
          redactionEnabled: config.logRedactionEnabled,
          serviceName: config.serviceName,
        }),
      inject: [AppConfigService],
    },
    RequestLoggerMiddleware,
  ],
  exports: [LOGGER_TOKEN, RequestLoggerMiddleware],
})
export class LoggerModule {}
