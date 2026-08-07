import type { CrmPipelineGroup } from '@watchdog-bms/contracts';

/** Default company-scoped pipeline stages (spec section 10 / plan defaults). */
export const DEFAULT_PIPELINE_STAGES: Array<{
  name: string;
  canonicalGroup: CrmPipelineGroup;
  sortOrder: number;
  probabilityDefault?: number;
  isTerminalWon: boolean;
  isTerminalLost: boolean;
}> = [
  { name: 'New lead', canonicalGroup: 'NEW_LEAD', sortOrder: 0, probabilityDefault: 5, isTerminalWon: false, isTerminalLost: false },
  { name: 'Contacted', canonicalGroup: 'CONTACTED', sortOrder: 1, probabilityDefault: 15, isTerminalWon: false, isTerminalLost: false },
  { name: 'Qualified', canonicalGroup: 'QUALIFIED', sortOrder: 2, probabilityDefault: 40, isTerminalWon: false, isTerminalLost: false },
  { name: 'Quotation sent', canonicalGroup: 'QUOTATION', sortOrder: 3, probabilityDefault: 60, isTerminalWon: false, isTerminalLost: false },
  { name: 'Negotiation', canonicalGroup: 'NEGOTIATION', sortOrder: 4, probabilityDefault: 80, isTerminalWon: false, isTerminalLost: false },
  { name: 'Won', canonicalGroup: 'WON', sortOrder: 5, probabilityDefault: 100, isTerminalWon: true, isTerminalLost: false },
  { name: 'Lost', canonicalGroup: 'LOST', sortOrder: 6, probabilityDefault: 0, isTerminalWon: false, isTerminalLost: true },
];

export const CRM_DEFAULT_CURRENCY = 'THB';
export const CRM_DEFAULT_TIMEZONE = 'Asia/Bangkok';

/** Opportunities with no activity for this many days are "stuck". */
export const CRM_STUCK_OPPORTUNITY_DAYS = 14;
