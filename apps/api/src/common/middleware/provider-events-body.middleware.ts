import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { json, type Request, type RequestHandler } from 'express';

// Match the same case/trailing-slash variants as the controller, before the larger ERP parser.
export const PROVIDER_EVENTS_PATH = /^\/v1\/public\/(postmark-events|stripe-events)\/?$/i;
const parseProviderEvent = json({
  limit: '256kb',
  inflate: false,
  verify(request: Request & { rawBody?: Buffer }, _response, body) {
    if (body.length) request.rawBody = Buffer.from(body);
  },
});

export const providerEventsJson: RequestHandler = (request, response, next) => {
  parseProviderEvent(request, response, (error?: { status?: number }) => {
    // Parser errors can quote raw message content. Return and log only fixed diagnostics.
    if (error) return next(error.status === 413
      ? new PayloadTooLargeException('Provider event body is too large')
      : new BadRequestException('Invalid provider event body'));
    next();
  });
};
