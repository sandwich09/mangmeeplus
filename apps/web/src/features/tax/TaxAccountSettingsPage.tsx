'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaxAccountDeterminationRuleDto, TaxAccountRole, TaxCodeDefinitionDto, TaxReportMappingRuleDto, TransactionTaxRegime } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { listLedgerAccounts, type LedgerAccount } from '@/features/ledger/ledger.api';
import {
  listTaxAccountRules, listTaxCodeDefinitions, listTaxReportMappings,
  upsertTaxAccountRule, upsertTaxReportMapping,
} from './transaction-tax.api';
import { TransactionTaxLineSelector } from './TransactionTaxLineSelector';
import { TAX_CONTEXT_LABELS, transactionTaxCapabilities, transactionTaxErrorMessage } from './transaction-tax.model';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

const accountRoles: TaxAccountRole[] = ['OUTPUT_VAT_PAYABLE', 'OUTPUT_VAT_DEFERRED', 'INPUT_VAT_CLAIMABLE', 'INPUT_VAT_PENDING', 'INPUT_VAT_DEFERRED', 'IMPORT_VAT_CLAIMABLE', 'IMPORT_VAT_PENDING', 'PP36_OUTPUT_VAT_PAYABLE', 'PP36_INPUT_VAT_CLAIMABLE', 'NONDEDUCTIBLE_VAT_EXPENSE', 'NONDEDUCTIBLE_VAT_CAPITALIZED', 'CUSTOMS_DUTY_PAYABLE', 'CUSTOMS_DUTY_EXPENSE', 'CUSTOMS_DUTY_CAPITALIZED', 'EXCISE_TAX_PAYABLE', 'EXCISE_TAX_EXPENSE_OR_COST', 'IMPORT_TAX_SETTLEMENT_PAYABLE', 'WHT_PAYABLE', 'WHT_RECEIVABLE'];
type ImportComponentRegime = 'DEFINITION' | Extract<TransactionTaxRegime, 'CUSTOMS_DUTY' | 'EXCISE_TAX' | 'MUNICIPAL_OR_OTHER_IMPORT_TAX'>;
const importComponentRoles: Record<Exclude<ImportComponentRegime, 'DEFINITION'>, TaxAccountRole[]> = {
  CUSTOMS_DUTY: ['CUSTOMS_DUTY_CAPITALIZED', 'CUSTOMS_DUTY_PAYABLE'],
  EXCISE_TAX: ['EXCISE_TAX_EXPENSE_OR_COST', 'EXCISE_TAX_PAYABLE'],
  MUNICIPAL_OR_OTHER_IMPORT_TAX: ['CUSTOMS_DUTY_CAPITALIZED', 'IMPORT_TAX_SETTLEMENT_PAYABLE'],
};
const field = 'mangmee-input w-full';
const button = 'rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50';

export function TaxAccountSettingsPage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const toast = useToast();
  const capability = transactionTaxCapabilities(permissions);
  const [definitions, setDefinitions] = useState<TaxCodeDefinitionDto[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [rules, setRules] = useState<TaxAccountDeterminationRuleDto[]>([]);
  const [mappings, setMappings] = useState<TaxReportMappingRuleDto[]>([]);
  const [definitionId, setDefinitionId] = useState('');
  const [previewDefinitionId, setPreviewDefinitionId] = useState('');
  const [componentRegime, setComponentRegime] = useState<ImportComponentRegime>('DEFINITION');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [nextDefinitions, nextAccounts, nextRules, nextMappings] = await Promise.all([
        capability.canReadConfig ? listTaxCodeDefinitions(companyId) : Promise.resolve([]),
        capability.canReadAccountRules ? listLedgerAccounts(companyId) : Promise.resolve([]),
        capability.canReadAccountRules ? listTaxAccountRules(companyId) : Promise.resolve([]),
        capability.canReadConfig ? listTaxReportMappings(companyId) : Promise.resolve([]),
      ]);
      setDefinitions(nextDefinitions); setAccounts(nextAccounts); setRules(nextRules); setMappings(nextMappings);
      setDefinitionId((current) => current || nextDefinitions[0]?.id || '');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setLoading(false); }
  }, [capability.canReadAccountRules, capability.canReadConfig, companyId]);
  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => definitions.find((item) => item.id === definitionId), [definitionId, definitions]);
  async function saveAccount(form: FormData) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await upsertTaxAccountRule(companyId, {
        // Statutory import components are separate regimes, but they still belong
        // to the selected import-VAT definition/effective profile.
        taxCodeDefinitionId: selected.id,
        taxRegime: componentRegime === 'DEFINITION' ? selected.taxRegime : componentRegime,
        direction: componentRegime === 'DEFINITION' ? selected.direction : 'INPUT',
        treatment: componentRegime === 'DEFINITION' ? selected.treatment : 'NONDEDUCTIBLE_CAPITALIZED',
        transactionContext: componentRegime === 'DEFINITION' ? (String(form.get('transactionContext') || '') || null) as TaxAccountDeterminationRuleDto['transactionContext'] : 'IMPORT_GOODS',
        sourceModule: String(form.get('sourceModule') || '') || null,
        accountRole: String(form.get('accountRole')) as TaxAccountRole,
        accountId: String(form.get('accountId')),
        postingSide: String(form.get('postingSide')) as 'DEBIT' | 'CREDIT',
        priority: Number(form.get('priority') || 100),
        effectiveFrom: String(form.get('effectiveFrom')),
        effectiveTo: String(form.get('effectiveTo') || '') || null,
      });
      await load();
      toast.success('บันทึกกฎบัญชีเรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }
  const importGoodsDefinition = selected?.transactionContexts.includes('IMPORT_GOODS') ?? false;
  const selectableRoles = componentRegime === 'DEFINITION' ? accountRoles : importComponentRoles[componentRegime];
  async function saveMapping(form: FormData) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await upsertTaxReportMapping(companyId, {
        taxCodeDefinitionId: selected.id,
        formType: String(form.get('formType')) as 'PP30' | 'PP36' | 'TAX_LEDGER' | 'CUSTOMS_SUPPORT',
        boxKey: String(form.get('boxKey')),
        amountSource: String(form.get('amountSource')) as 'TAX_BASE' | 'TAX_AMOUNT' | 'GROSS' | 'DUTY' | 'OTHER',
        signRule: String(form.get('signRule')) as 'NORMAL' | 'INVERT',
        effectiveFrom: String(form.get('effectiveFrom')),
        effectiveTo: String(form.get('effectiveTo') || '') || null,
      });
      await load();
      toast.success('บันทึกกฎรายงานเรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  if (!capability.canReadConfig && !capability.canReadAccountRules) return <MangmeePage title="Tax Account Determination"><MangmeeCard className="p-6 text-sm text-red-700">คุณไม่มีสิทธิ์ดูการตั้งค่าบัญชีภาษี</MangmeeCard></MangmeePage>;
  return (
    <MangmeePage title="Tax Account Determination" description="แยก SAP Tax Code ออกจากผังบัญชี แล้วกำหนดบัญชีและช่องรายงานตามบทบาท/บริบท/ช่วงวันที่">
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && <MangmeeCard className="mb-4 p-4 text-sm text-gray-500">กำลังโหลดผังบัญชีและกฎภาษี...</MangmeeCard>}
      {capability.canManageAccountRules && <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <MangmeeCard className="p-4">
          <h2 className="mb-3 font-bold">เพิ่มกฎลงบัญชี</h2>
          <form action={saveAccount} className="grid gap-3 sm:grid-cols-2">
            <ThemedSelect value={definitionId} onChange={(event) => { setDefinitionId(event.target.value); setComponentRegime('DEFINITION'); }}>{definitions.map((item) => <option key={item.id} value={item.id}>{item.externalCode} · {item.displayName}</option>)}</ThemedSelect>
            <ThemedSelect value={componentRegime} onChange={(event) => setComponentRegime(event.target.value as ImportComponentRegime)}><option value="DEFINITION">VAT/Import VAT ตาม Tax Code</option>{importGoodsDefinition && <><option value="CUSTOMS_DUTY">Import component: ศุลกากร</option><option value="EXCISE_TAX">Import component: สรรพสามิต</option><option value="MUNICIPAL_OR_OTHER_IMPORT_TAX">Import component: ภาษีนำเข้าอื่น</option></>}</ThemedSelect>
            <ThemedSelect name="accountRole">{selectableRoles.map((item) => <option key={item} value={item}>{item}</option>)}</ThemedSelect>
            <ThemedSelect name="accountId">{accounts.filter((item) => item.status === 'ACTIVE').map((item) => <option key={item.id} value={item.id}>{item.code} · {item.nameTh}</option>)}</ThemedSelect>
            <ThemedSelect name="postingSide" defaultValue="CREDIT"><option value="DEBIT">Debit</option><option value="CREDIT">Credit</option></ThemedSelect>
            <ThemedSelect name="transactionContext" defaultValue="" disabled={componentRegime !== 'DEFINITION'}><option value="">ทุกบริบท</option>{selected?.transactionContexts.map((context) => <option key={context} value={context}>{TAX_CONTEXT_LABELS[context]}</option>)}</ThemedSelect>
            <input name="sourceModule" placeholder="โมดูล เช่น accounting" className={field} />
            <input required name="priority" type="number" defaultValue="100" className={field} />
            <ThemedDate required name="effectiveFrom" className={field} />
            <ThemedDate name="effectiveTo" className={field} />
            <button disabled={busy || !selected || !accounts.length} aria-busy={Boolean(busy)} className={button}>บันทึกกฎบัญชี</button>
          </form>
          {importGoodsDefinition && <p className="mt-3 text-xs text-gray-500">Import Goods ต้องมี paired debit/credit rules แยกสำหรับ Import VAT, ศุลกากร, สรรพสามิต และภาษีนำเข้าอื่น; component rules ไม่สร้าง Tax Code เพิ่ม</p>}
        </MangmeeCard>
        <MangmeeCard className="p-4">
          <h2 className="mb-3 font-bold">เพิ่มกฎช่องรายงาน</h2>
          <form action={saveMapping} className="grid gap-3 sm:grid-cols-2">
            <ThemedSelect value={definitionId} onChange={(event) => setDefinitionId(event.target.value)}>{definitions.map((item) => <option key={item.id} value={item.id}>{item.externalCode} · {item.displayName}</option>)}</ThemedSelect>
            <ThemedSelect name="formType" defaultValue="PP30"><option value="PP30">ภ.พ.30</option><option value="PP36">ภ.พ.36</option><option value="TAX_LEDGER">Tax ledger</option><option value="CUSTOMS_SUPPORT">Customs support</option></ThemedSelect>
            <input required name="boxKey" placeholder="Box key เช่น BOX_5_OUTPUT_TAX" className={field} />
            <ThemedSelect name="amountSource" defaultValue="TAX_AMOUNT"><option value="TAX_BASE">Tax base</option><option value="TAX_AMOUNT">Tax amount</option><option value="GROSS">Gross</option><option value="DUTY">Duty</option><option value="OTHER">Other</option></ThemedSelect>
            <ThemedSelect name="signRule" defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="INVERT">Invert</option></ThemedSelect>
            <ThemedDate required name="effectiveFrom" className={field} />
            <ThemedDate name="effectiveTo" className={field} />
            <button disabled={busy || !selected} aria-busy={Boolean(busy)} className={button}>บันทึกกฎรายงาน</button>
          </form>
        </MangmeeCard>
      </div>}
      <MangmeeCard className="mb-5 p-4">
        <h2 className="mb-3 font-bold">Preview การ resolve</h2>
        {selected ? <TransactionTaxLineSelector companyId={companyId} sourceType="tax.configuration" sourceId="preview" sourceLineId="preview-line" transactionContext={selected.transactionContexts[0] ?? 'MANUAL_TAX_ADJUSTMENT'} direction={selected.direction} documentDate={todayCivilDate()} netAmount="1000" grossAmount="1070" value={previewDefinitionId} onChange={setPreviewDefinitionId} /> : <p className="text-sm text-gray-500">ยังไม่มี Tax Code สำหรับ preview</p>}
      </MangmeeCard>
      <div className="grid gap-5 xl:grid-cols-2">
        <MangmeeCard className="overflow-hidden"><div className="border-b p-4 font-bold">กฎบัญชี ({rules.length})</div><div className="divide-y">{rules.map((rule) => { const account = accounts.find((item) => item.id === rule.accountId); return <div key={rule.id} className="p-4 text-sm"><strong>{rule.accountRole}</strong> → {account ? `${account.code} ${account.nameTh}` : rule.accountId}<div className="text-xs text-gray-500">{rule.postingSide} · priority {rule.priority} · {rule.status} · v{rule.version}</div></div>; })}{!rules.length && <div className="p-6 text-center text-sm text-gray-500">ยังไม่มีกฎบัญชี</div>}</div></MangmeeCard>
        <MangmeeCard className="overflow-hidden"><div className="border-b p-4 font-bold">กฎรายงาน ({mappings.length})</div><div className="divide-y">{mappings.map((mapping) => <div key={mapping.id} className="p-4 text-sm"><strong>{mapping.formType} · {mapping.boxKey}</strong><div className="text-xs text-gray-500">{mapping.amountSource} · {mapping.signRule} · {mapping.status} · v{mapping.version}</div></div>)}{!mappings.length && <div className="p-6 text-center text-sm text-gray-500">ยังไม่มีกฎรายงาน</div>}</div></MangmeeCard>
      </div>
    </MangmeePage>
  );
}
