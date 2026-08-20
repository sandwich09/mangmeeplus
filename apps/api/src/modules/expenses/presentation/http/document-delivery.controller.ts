import { Controller, Delete, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../../common/security/public.decorator';
import { RequirePermissions } from '../../../../common/security/permissions.decorator';
import { trustedClientIp } from '../../../../common/security/trusted-client-ip';
import { ReqCtx } from '../../../auth/presentation/request-context.decorator';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import {
  ResolveDocumentDeliveryLinkUseCase,
  RevokeDocumentDeliveryLinkUseCase,
} from '../../application/use-cases/document-delivery-link.use-case';

/**
 * §12.4/§12.5 — the token IS the credential, so this route is `@Public()` and takes no context. It
 * answers the web's public `/d/{token}` page, which issues the 302 itself: the link the chat is
 * given lives on the WEB origin, so the redirect has to be the web's to make. This endpoint returns
 * the resolution and nothing else — never the document, never a reason, never any document data.
 */
@Controller('document-delivery')
export class PublicDocumentDeliveryController {
  constructor(private readonly resolve: ResolveDocumentDeliveryLinkUseCase) {}

  @Public()
  @Get(':token')
  open(@Param('token') token: string, @Req() req: Request) {
    return this.resolve.execute({
      token,
      clientIp: trustedClientIp(req),
      requestId: (req.headers['x-request-id'] as string | undefined) ?? 'document-delivery-open',
    });
  }
}

/** §12.6/§14 — the operator kill switch for a link that reached the wrong person. */
@Controller('companies/:companyId/document-delivery-links')
export class DocumentDeliveryLinkController {
  constructor(private readonly revoke: RevokeDocumentDeliveryLinkUseCase) {}

  @Delete(':linkId')
  @RequirePermissions('expense.review')
  revokeLink(@ReqCtx() ctx: RequestContext, @Param('linkId') linkId: string) {
    return this.revoke.execute(ctx, linkId);
  }
}
