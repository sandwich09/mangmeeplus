import { UnauthorizedException } from '@nestjs/common';
import { Router, json, urlencoded } from 'express';
import helmet from 'helmet';
import type { AiGatewayConfigService } from '../config/ai-gateway-config.service';
import { assertInternalSecret } from '../security/internal-secret';
import { BASE64_MEDIA_ROUTES, DOCUMENT_QA_MEDIA_ROUTE } from '../../modules/line-ai/presentation/http/line-ai-internal.controller';
import { productionMaintenanceMiddleware, type ProductionServingMode } from './production-maintenance.middleware';

export function gatewayHttpMiddleware(
  config: Pick<AiGatewayConfigService, 'isProduction' | 'bodyLimit' | 'aiGatewayInternalSecret'>,
  servingMode: ProductionServingMode,
): Router {
  const router = Router();
  router.use(productionMaintenanceMiddleware(servingMode));
  router.use((req, res, next) => {
    // Express routes are case-insensitive by default; protect the same paths they accept.
    if (!req.path.toLowerCase().startsWith('/v1/internal/')) {
      next();
      return;
    }
    try {
      assertInternalSecret(req.get('x-internal-secret'), config.aiGatewayInternalSecret);
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) {
        next(error);
        return;
      }
      // Do not consume the upload or allow it to drain on a kept-alive connection.
      res.setHeader('Connection', 'close');
      res.status(error.getStatus()).json(error.getResponse());
      return;
    }
    next();
  });
  router.use(helmet({ contentSecurityPolicy: config.isProduction ? undefined : false }));
  // Base64 media needs 16 MB; document QA admits 20 rasterized pages plus its manifest.
  router.use(BASE64_MEDIA_ROUTES, json({ limit: '16mb' }));
  router.use(DOCUMENT_QA_MEDIA_ROUTE, json({ limit: '96mb' }));
  router.use(json({ limit: config.bodyLimit }));
  router.use(urlencoded({ extended: true, limit: config.bodyLimit }));
  return router;
}
