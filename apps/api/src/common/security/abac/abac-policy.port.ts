import type { RequestContext } from '../../../modules/auth/domain/models/request-context.model';

export interface AbacPolicy<TResource = unknown> {
  /** Returns true if the context has access to the resource */
  can(context: RequestContext, resource: TResource): boolean;
}
