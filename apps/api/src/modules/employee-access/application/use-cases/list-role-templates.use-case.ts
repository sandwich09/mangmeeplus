import { Injectable } from '@nestjs/common';
import type { RoleTemplate } from '@watchdog-bms/contracts';
import { ROLE_TEMPLATES } from '../../domain/registries/role-template.registry';

@Injectable()
export class ListRoleTemplatesUseCase {
  // ponytail: Phase 1 ships system presets only (code registry). Company-authored presets (a RoleTemplate
  // table) are deferred to a later phase — add when a company actually needs to save its own preset.
  execute(): RoleTemplate[] {
    return ROLE_TEMPLATES;
  }
}
