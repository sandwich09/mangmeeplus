import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_ROUTE_KEY } from './public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';

type RequestWithAuthContext = Request & {
  user?: {
    permissions?: string[];
  };
};

@Injectable()
export class DenyByDefaultGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      throw new ForbiddenException('Route permission metadata is required.');
    }

    const request = context.switchToHttp().getRequest<RequestWithAuthContext>();

    if (!request.user) {
      throw new UnauthorizedException('Authentication is required.');
    }

    const userPermissions = new Set(request.user.permissions ?? []);
    const hasRequiredPermissions = requiredPermissions.every((permission) => userPermissions.has(permission));

    if (!hasRequiredPermissions) {
      throw new ForbiddenException('Missing required permission.');
    }

    return true;
  }
}
