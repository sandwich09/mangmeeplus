import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '../domain/models/request-context.model';

export const ReqCtx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestContext => {
  const req = ctx.switchToHttp().getRequest<Request & { context: RequestContext }>();
  return req.context;
});
