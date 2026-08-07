/**
 * Tenant business category — the input to the PDPA tenant tripwire.
 *
 * The M-05 lawful-basis register (§5, §6) defers the s.41 limb (b) "large scale" question
 * and the controller/processor question on the stated assumption that the tenant base stays
 * general retail/trading/service. A health-adjacent tenant breaks that assumption on its own,
 * because `CrmBooking.serviceName` is chosen by the tenant: for a clinic the service name
 * alone is s.26 health data. Onboarding one must alert the dev team, not pass unnoticed.
 *
 * Deliberately short: the only distinction this list has to carry is health-adjacent vs not.
 * It is not a market-segmentation taxonomy — do not grow it into one.
 *
 * Mirrors `enum CompanyBusinessCategory` in apps/api/prisma/schema.prisma. It lives in
 * contracts because the reuse crosses the api↔web boundary (the API validates and classifies,
 * the web onboarding form renders the options), which is where the shared-constants guideline
 * says a value stops being module-local.
 */
export const COMPANY_BUSINESS_CATEGORIES = [
  'RETAIL',
  'TRADING',
  'SERVICE',
  'CLINIC',
  'WELLNESS_SPA',
  'MEDICAL_RETAIL',
  'OTHER',
] as const;

export type CompanyBusinessCategory = (typeof COMPANY_BUSINESS_CATEGORIES)[number];

/**
 * The categories for which `CrmBooking.serviceName` alone can be health data — exactly the
 * business types the register names (spa and wellness share one value because the PDPA
 * consequence is identical).
 */
export const HEALTH_ADJACENT_BUSINESS_CATEGORIES = [
  'CLINIC',
  'WELLNESS_SPA',
  'MEDICAL_RETAIL',
] as const satisfies readonly CompanyBusinessCategory[];

/**
 * Takes the loose type on purpose: the caller is usually a nullable DB column or an
 * unvalidated request field, and an uncategorised company must read as "not health-adjacent"
 * rather than crash the onboarding it is observing.
 */
export function isHealthAdjacentBusinessCategory(value: string | null | undefined): boolean {
  return (HEALTH_ADJACENT_BUSINESS_CATEGORIES as readonly string[]).includes(value ?? '');
}
