import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AiGatewayConfigService } from './common/config/ai-gateway-config.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { gatewayHttpMiddleware } from './common/http/gateway-http.middleware';
import { parseProductionServingMode } from './common/http/production-maintenance.middleware';
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
  const servingMode = parseProductionServingMode(process.env.PRODUCTION_SERVING_MODE, isProduction);

  // Maintenance stays first; internal authentication runs before helmet and every body parser.
  app.use(gatewayHttpMiddleware(config, servingMode));
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

  // Hold-reconciliation spec §3: SIGTERM must close the listener and then let
  // `AiBudgetShutdownService` finish the guarded provider calls already running and post their
  // settle evidence. Without the hooks Nest ignores the signal and the runtime kills the process
  // with money held and no way for anyone to know what it cost.
  app.enableShutdownHooks();

  const port = config.port;
  const host = config.host;
  await app.listen(port, host);

  logger.info({ port, host, env: config.appEnv, service: config.serviceName }, 'ai-gateway started');
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
