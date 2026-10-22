import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFactory, HttpAdapterHost } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import type { Request } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { createLogger, NestPinoLoggerBridge } from './common/logger/logger.service';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TrimStringsPipe } from './common/pipes/trim-strings.pipe';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from './common/pipes/validation-pipe.options';
import { ApiRateLimitGuard } from './common/security/api-rate-limit.guard';
import { RedisRateLimitService } from './common/security/redis-rate-limit.service';
import { apiCacheControl } from './common/middleware/api-cache-control.middleware';
import { PROVIDER_EVENTS_PATH, providerEventsJson } from './common/middleware/provider-events-body.middleware';

type RawBodyRequest = Request & { rawBody?: Buffer };

function getAllowedOrigins(config: AppConfigService): string[] {
  if (config.corsAllowedOrigins.length > 0) {
    return config.corsAllowedOrigins;
  }
  if (config.isProduction) {
    throw new Error('CORS_ALLOWED_ORIGINS must be set in production.');
  }

  return ['http://localhost:3000', 'http://127.0.0.1:3000'];
}

function isAllowedCorsOrigin(origin: string, allowedOrigins: string[], config: AppConfigService): boolean {
  if (allowedOrigins.includes(origin)) return true;
  if (!config.isProduction) {
    try {
      return new URL(origin).hostname.endsWith('.trycloudflare.com');
    } catch {
      return false;
    }
  }
  return false;
}

async function bootstrap() {
  const config = new AppConfigService();
  const logger = createLogger({
    level: config.logLevel,
    redactionEnabled: config.logRedactionEnabled,
    serviceName: config.serviceName,
  });

  const isProduction = config.isProduction;
  // M-02: module `new Logger()` output goes to pino (redacted JSON) instead of being dropped.
  const app = await NestFactory.create(AppModule, { abortOnError: false, bodyParser: false, logger: new NestPinoLoggerBridge(logger) });
  // L-13: explicit, not inherited from helmet's default — a future helmet option change must not
  // silently start advertising the framework again.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.disable('x-powered-by');
  // Contextual API JSON must never turn an old representation into a browser-side 304. Static
  // Next assets are served by the separate web process and keep their immutable cache policy.
  expressApp.disable('etag');
  const allowedOrigins = getAllowedOrigins(config);
  const bodyLimit = config.bodyLimit;
  const saveRawBody = (req: RawBodyRequest, _res: unknown, buf: Buffer) => {
    if (buf.length > 0) req.rawBody = Buffer.from(buf);
  };

  // Express-level boundary covers controller responses, parser failures, 404s, and Swagger when
  // enabled. A controller may still replace the header for an intentionally public asset.
  app.use(apiCacheControl);
  app.use(
    helmet({
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );
  // ponytail: parse cookies so AuthGuard's watchdog_token cookie fallback works for the web BFF
  app.use(cookieParser());
  // Statement PDF/photo extraction posts base64 up to UPLOAD_MAX_BYTES; scope the
  // bigger limit to that one route instead of raising the global body limit.
  app.use(
    /^\/v1\/companies\/[^/]+\/banking\/bank-accounts\/[^/]+\/statement-imports\/extract$/,
    json({ limit: Math.ceil(config.uploadMaxBytes * 1.5), inflate: false, verify: saveRawBody }),
  );
  // Amazon SNS posts its notification envelope as `text/plain`, which the JSON parser below skips,
  // leaving the SES-events controller an empty body. Give that one path a parser that accepts any
  // content type, capped at SNS's own 256 KB maximum message size — a tighter ceiling than the
  // global limit, applied before parsing, which is this public endpoint's body-size guard.
  app.use(/^\/v1\/public\/ses-events$/, json({ limit: '256kb', inflate: false, type: () => true }));
  app.use(PROVIDER_EVENTS_PATH, providerEventsJson);
  // No caller compresses request bodies: inflate:false refuses Content-Encoding before any decoder runs.
  app.use(json({ limit: bodyLimit, inflate: false, verify: saveRawBody }));
  app.use(urlencoded({ extended: true, limit: bodyLimit, inflate: false, verify: saveRawBody }));
  app.enableCors({
    origin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
      if (!origin || isAllowedCorsOrigin(origin, allowedOrigins, config)) {
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
    new TrimStringsPipe(),
    new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS),
  );
  app.setGlobalPrefix('v1', {
    exclude: [{ path: 'local-storage/(.*)', method: RequestMethod.ALL }],
  });
  // SIGTERM (every ECS deploy) must drain the LINE message buffer before exit
  // (docs/specs/line-ai-message-buffering-spec.md §11).
  app.enableShutdownHooks();

  app.useGlobalGuards(
    new ApiRateLimitGuard(
      config,
      (error) => logger.error({ err: error }, 'API rate limiter failed closed'),
      app.get(RedisRateLimitService),
    ),
  );
  // Adds requestId/method/path context to 5xx stacks that Nest's default handler does not carry.
  app.useGlobalFilters(new AllExceptionsFilter(logger, app.get(HttpAdapterHost).httpAdapter));
  // L-13: gated on the explicit flag in *every* environment. `!isProduction ||` published the full
  // route and DTO surface from every non-production deployment.
  if (config.swaggerEnabled) {
    const openApiConfig = new DocumentBuilder()
      .setTitle('WatchDog-BMS ERP Core API')
      .setDescription('Permission-checked ERP source-of-truth API.')
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, openApiConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.port;
  const host = config.host;
  await app.listen(port, host);

  logger.info({ port, host, env: config.appEnv, service: config.serviceName }, 'server started');
}

void bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
