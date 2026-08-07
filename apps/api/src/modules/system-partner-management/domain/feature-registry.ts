// The hardcoded list moved into FEATURE_CATALOG (packages/contracts) when sub-menu entitlements
// landed, so parents and their children come from one source. expense_auto_post was added to the
// catalog as part of this merge — dropping it here would leave the toggle with no way to be set.
import { ALL_FEATURE_ENTITLEMENT_KEYS, FEATURE_KEYS } from '@watchdog-bms/contracts';

export const APPROVED_FEATURE_KEYS = FEATURE_KEYS;
export const APPROVED_FEATURE_ENTITLEMENT_KEYS = ALL_FEATURE_ENTITLEMENT_KEYS;

export type FeatureKey = typeof APPROVED_FEATURE_KEYS[number];

// Standard package enabled for newly onboarded companies (the Mangmee baseline). Every approved
// key gets an explicit row at onboarding, so new companies are deny-by-default instead of the
// legacy no-rows fail-open.
//
// `employee_access` and `company_settings` are foundation administration, not part of the paid
// package. Existing tenants keep them via DEFAULT_ON_FEATURE_KEYS (absent row = on), but onboarding
// writes an EXPLICIT row for every approved key and explicit false wins — so leaving them out here
// would ship a new company that cannot add its first employee or see its own branches until the
// platform operator flips two switches by hand. They are enabled by default and are NOT disableable
// afterwards — the entitlement command refuses an explicit false on them and on their submenus.
// `thai_tax`, `double_entry_ledger` and `workflow_automation` are ON from onboarding (owner
// decision 2026-08-04): a Thai SME buys the tax/accounting journey. NOTHING here is a one-way door —
// the same 2026-08-04 decision makes a post-onboarding disable of any sellable family succeed with
// freeze-in-place semantics (decoupling-spec §1); the family stops working and its data stays
// dormant. `expense_auto_post` stays OFF on purpose — postings accumulate as pending and the
// enable-later path runs a guarded backfill.
export const DEFAULT_ENABLED_FEATURE_KEYS: readonly FeatureKey[] = [
  'expenses',
  'reimbursement',
  'product_catalog',
  'crm',
  'line_oa',
  'dashboard_notifications',
  'ai_line_assistant',
  'employee_access',
  'company_settings',
  'thai_tax',
  'double_entry_ledger',
  'workflow_automation',
];
