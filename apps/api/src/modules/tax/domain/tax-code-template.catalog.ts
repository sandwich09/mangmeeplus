import type { TaxCodeProfileTemplateKey, TaxSourceSystem, UpsertTaxCodeDefinitionInput } from '@watchdog-bms/contracts';

export type TaxCodeTemplateDefinition = Omit<UpsertTaxCodeDefinitionInput, 'id' | 'profileId' | 'effectiveFrom' | 'effectiveTo'>;

export type TaxCodeProfileTemplate = {
  key: TaxCodeProfileTemplateKey;
  name: string;
  sourceSystem: Extract<TaxSourceSystem, 'WATCHDOG' | 'SAP_ERP' | 'SAP_S4HANA'>;
  sourceUrl: string | null;
  warning: string;
  definitions: TaxCodeTemplateDefinition[];
};

const output = (
  externalCode: string,
  displayName: string,
  treatment: TaxCodeTemplateDefinition['treatment'],
  rate: string,
  transactionContexts: TaxCodeTemplateDefinition['transactionContexts'],
): TaxCodeTemplateDefinition => ({
  externalCode, displayName, taxRegime: 'VAT', direction: 'OUTPUT', treatment,
  transactionContexts, rate, calculationMethod: Number(rate) > 0 ? 'EXCLUSIVE' : 'NONE',
  sapAccountKey: null, claimabilityDefault: 'NOT_APPLICABLE', evidenceRuleKey: null,
});

const input = (
  externalCode: string,
  displayName: string,
  treatment: TaxCodeTemplateDefinition['treatment'],
  rate: string,
  claimabilityDefault: TaxCodeTemplateDefinition['claimabilityDefault'],
  transactionContexts: TaxCodeTemplateDefinition['transactionContexts'] = ['DOMESTIC_PURCHASE'],
): TaxCodeTemplateDefinition => ({
  externalCode, displayName, taxRegime: 'VAT', direction: 'INPUT', treatment,
  transactionContexts, rate, calculationMethod: Number(rate) > 0 ? 'EXCLUSIVE' : 'NONE',
  sapAccountKey: null, claimabilityDefault, evidenceRuleKey: null,
});

export const TAX_CODE_PROFILE_TEMPLATES: readonly TaxCodeProfileTemplate[] = [
  {
    key: 'WATCHDOG_TH_DOMESTIC_EXPENSE_V1',
    name: 'WatchDog ภาษีซื้อในประเทศ',
    sourceSystem: 'WATCHDOG',
    sourceUrl: null,
    warning: 'สำหรับค่าใช้จ่ายในประเทศเท่านั้น โปรดตรวจประเภทเอกสาร สิทธิขอคืนภาษี และการผูกบัญชีก่อนเปิดใช้งาน',
    definitions: [
      input('V7', 'ภาษีซื้อขอคืนได้ 7%', 'CLAIMABLE', '7', 'CLAIMABLE'),
      input('ND', 'ภาษีซื้อขอคืนไม่ได้ 7%', 'NONDEDUCTIBLE_EXPENSE', '7', 'NONDEDUCTIBLE_EXPENSE'),
    ],
  },
  {
    key: 'SAP_ERP_TH_LEGACY',
    name: 'SAP ERP Thailand legacy template',
    sourceSystem: 'SAP_ERP',
    sourceUrl: 'https://help.sap.com/docs/SAP_ERP/a70c5fce76eb44adb0c86a9d3059e4dd/ec83d0531d8b4208e10000000a174cb4.html',
    warning: 'Compatibility template only. Compare with the productive SAP client/company code and complete account/report mappings before activation.',
    definitions: [
      output('O7', 'Output VAT 7% (legacy)', 'STANDARD', '7', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('O0', 'Zero-rated output VAT (legacy)', 'ZERO_RATED', '0', ['EXPORT_GOODS', 'EXPORT_SERVICE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('OX', 'VAT-exempt output (legacy)', 'EXEMPT', '0', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('O1', 'Output VAT 10% (legacy)', 'STANDARD', '10', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('DS', 'Deferred output VAT 7% (legacy)', 'DEFERRED', '7', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('DT', 'Deferred output VAT 10% (legacy)', 'DEFERRED', '10', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
    ],
  },
  {
    key: 'SAP_S4_TH_CURRENT',
    name: 'SAP S/4HANA Thailand current template',
    sourceSystem: 'SAP_S4HANA',
    sourceUrl: 'https://help.sap.com/docs/SAP_S4HANA_CLOUD/88d44bce214447bcb7cbbdc03eb16aa1/a61fac05630a468294f029928d8d6bc2.html',
    warning: 'Reference template only. Productive SAP configuration is authoritative; review every code, rate, evidence rule, account and report mapping before activation.',
    definitions: [
      output('O0', 'Output VAT 0%', 'ZERO_RATED', '0', ['EXPORT_GOODS', 'EXPORT_SERVICE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('O1', 'Output VAT 7%', 'STANDARD', '7', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('O2', 'Output VAT 10%', 'STANDARD', '10', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('OX', 'VAT-exempt output', 'EXEMPT', '0', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('WS', 'Non-taxable output', 'NON_TAXABLE', '0', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('DL', 'Deferred output VAT 0%', 'DEFERRED', '0', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('DM', 'Deferred output VAT 7%', 'DEFERRED', '7', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      output('DN', 'Deferred output VAT 10%', 'DEFERRED', '10', ['DOMESTIC_SALE', 'RETURN_OR_CREDIT', 'DEBIT_ADJUSTMENT']),
      input('V0', 'Input VAT 0%', 'ZERO_RATED', '0', 'CLAIMABLE'),
      input('V1', 'Input VAT 7%', 'CLAIMABLE', '7', 'CLAIMABLE'),
      input('V2', 'Input VAT 10%', 'CLAIMABLE', '10', 'CLAIMABLE'),
      input('VX', 'VAT-exempt input', 'EXEMPT', '0', 'NOT_APPLICABLE'),
      input('WP', 'Non-taxable input', 'NON_TAXABLE', '0', 'NOT_APPLICABLE'),
      { ...input('V3', 'Imported-service self-assessed VAT 7%', 'REVERSE_CHARGE', '7', 'PENDING_EVIDENCE', ['IMPORT_SERVICE']), direction: 'SELF_ASSESSED', evidenceRuleKey: 'PAYMENT_EVIDENCE' },
      { ...input('V4', 'Imported-service self-assessed VAT 10%', 'REVERSE_CHARGE', '10', 'PENDING_EVIDENCE', ['IMPORT_SERVICE']), direction: 'SELF_ASSESSED', evidenceRuleKey: 'PAYMENT_EVIDENCE' },
      input('D0', 'Deferred input VAT 0%', 'DEFERRED', '0', 'PENDING_EVIDENCE'),
      input('D1', 'Deferred input VAT 7%', 'DEFERRED', '7', 'PENDING_EVIDENCE'),
      input('D2', 'Deferred input VAT 10%', 'DEFERRED', '10', 'PENDING_EVIDENCE'),
      input('N1', 'Non-deductible input VAT 7%', 'NONDEDUCTIBLE_EXPENSE', '7', 'NONDEDUCTIBLE_EXPENSE'),
      input('N2', 'Non-deductible input VAT 10%', 'NONDEDUCTIBLE_EXPENSE', '10', 'NONDEDUCTIBLE_EXPENSE'),
      input('U1', 'Unclaimed input VAT 7% — company review required', 'NEEDS_REVIEW', '7', 'PENDING_EVIDENCE'),
      input('U2', 'Unclaimed input VAT 10% — company review required', 'NEEDS_REVIEW', '10', 'PENDING_EVIDENCE'),
    ],
  },
] as const;

export function findTaxCodeProfileTemplate(key: string): TaxCodeProfileTemplate | undefined {
  return TAX_CODE_PROFILE_TEMPLATES.find((template) => template.key === key);
}
