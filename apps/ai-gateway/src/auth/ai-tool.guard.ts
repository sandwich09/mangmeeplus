import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_ROUTE_KEY } from '../common/security/public.decorator';
import { WatchdogContextVerifier } from './watchdog-context-verifier';

type RequestWithContext = Request & {
  user?: {
    userId: string;
    sessionId: string;
    permissions: string[];
  };
};

@Injectable()
export class AiToolGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: WatchdogContextVerifier,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token required.');
    }

    const token = authHeader.slice(7);
    const ctx = this.verifier.verify(token); // throws UnauthorizedException on failure

    if (!ctx.permissions.includes('ai.tool.invoke')) {
      throw new ForbiddenException('AI tool access not permitted.');
    }

    req.user = ctx;
    return true;
  }
}
