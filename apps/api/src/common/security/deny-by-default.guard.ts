import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_ROUTE_KEY } from './public.decorator';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from './permissions.decorator';
import type { RequestContext } from '../../modules/auth/domain/models/request-context.model';
import { PermissionSet } from '../../modules/access-control/domain/models/resolved-access.model';

type RequestWithContext = Request & {
  context?: RequestContext;
};

@Injectable()
export class DenyByDefaultGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithContext>();

    if (!request.context) {
      throw new UnauthorizedException('Authentication is required.');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAnyPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!requiredPermissions || requiredPermissions.length === 0)
      && (!requiredAnyPermissions || requiredAnyPermissions.length === 0)) {
      throw new ForbiddenException('Permission metadata is required.');
    }

    const permissionSet = new PermissionSet(request.context.permissions);
    const hasAll = !requiredPermissions?.length || permissionSet.hasAll(requiredPermissions);
    const hasAny = !requiredAnyPermissions?.length || requiredAnyPermissions.some((permission) => permissionSet.has(permission));

    if (!hasAll || !hasAny) {
      const missing = [
        ...(requiredPermissions ?? []).filter((permission) => !permissionSet.has(permission)),
        ...(!hasAny ? requiredAnyPermissions ?? [] : []),
      ];
      const denied = request.context.entitlementDeniedPermissions ?? {};
      // Preserve deny-by-default: only call this an entitlement failure when EVERY missing
      // permission was genuinely granted and then removed by the feature gate. A partial role
      // grant remains an ordinary permission denial and never learns feature configuration.
      if (missing.length > 0 && missing.every((permission) => denied[permission])) {
        throw new ForbiddenException({ code: 'feature_not_enabled', featureKey: denied[missing[0]!] });
      }
      throw new ForbiddenException('Insufficient permissions.');
    }

    return true;
  }
}
