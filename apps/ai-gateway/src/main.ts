import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AiGatewayConfigService } from './common/config/ai-gateway-config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { parseProductionServingMode, productionMaintenanceMiddleware } from './common/http/production-maintenance.middleware';
import { NestPinoLoggerBridge, createLogger } from './common/logger/logger.service';

function getAllowedOrigins(config: AiGatewayConfigService): string[] {
  if (config.corsAllowedOrigins.length > 0) {
    return config.corsAllowedOrigins;
  }
  if (config.isProduction) {
    throw new Error('CORS_ALLOWED_ORIGINS must be set in production.');
  }

  return ['http://localhost:3000', 'http://127.0.0.1:3000'];
}

async function bootstrap() {
  const config = new AiGatewayConfigService();
  const logger = createLogger({
    level: config.logLevel,
    redactionEnabled: config.logRedactionEnabled,
    serviceName: config.serviceName,
  });

  const isProduction = config.isProduction;
  // Module `new Logger()` output goes through the pino bridge (redacted JSON) instead of being dropped.
  const app = await NestFactory.create(AppModule, { abortOnError: false, bodyParser: false, logger: new NestPinoLoggerBridge(logger) });
  // L-13: explicit, not inherited from helmet's default — a future helmet option change must not
  // silently start advertising the framework again.
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  const allowedOrigins = getAllowedOrigins(config);
  const bodyLimit = config.bodyLimit;
  const servingMode = parseProductionServingMode(process.env.PRODUCTION_SERVING_MODE, isProduction);

  // This runs before helmet and every body parser. In maintenance mode the public gateway can
  // still satisfy its exact health check, but it cannot read or process an AI/customer payload.
  app.use(productionMaintenanceMiddleware(servingMode));

  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );
  // Internal OCR endpoints carry base64 media (receipts, bank statements) that can
  // exceed the global limit; scope a larger limit to those routes only.
  app.use(/^\/v1\/internal\/ai\/(receipt-ocr|bank-statement-extract)$/, json({ limit: '16mb' }));
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS.'));
    },
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Company-Id', 'X-Request-Id'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.setGlobalPrefix('v1');
  // Adds requestId/method/path + stack to 5xx so gateway failures are correlatable in CloudWatch.
  app.useGlobalFilters(new AllExceptionsFilter(logger, app.get(HttpAdapterHost).httpAdapter));

  // L-13: gated on the explicit flag in *every* environment. `!isProduction ||` published the full
  // route and DTO surface from every non-production deployment.
  if (config.swaggerEnabled) {
    const openApiConfig = new DocumentBuilder()
      .setTitle('WatchDog-BMS AI Gateway API')
      .setDescription('Agent routing and permission-checked tool orchestration.')
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.port;
  const host = config.host;
  await app.listen(port, host);

  logger.info({ port, host, env: config.appEnv, service: config.serviceName }, 'ai-gateway started');
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
