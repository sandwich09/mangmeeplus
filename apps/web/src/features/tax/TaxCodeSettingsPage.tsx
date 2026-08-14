'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  TaxCodeDefinitionDto,
  TaxCodeProfileDto,
  TaxRoundingMode,
  TransactionTaxContext,
  TransactionTaxDirection,
  TransactionTaxRegime,
  TransactionTaxTreatment,
} from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import {
  activateTaxCodeProfile,
  applyTaxCodeImport,
  createTaxCodeProfileFromTemplate,
  createTaxCodeProfile,
  listTaxCodeDefinitions,
  listTaxCodeProfileTemplates,
  listTaxCodeProfiles,
  retireTaxCodeProfile,
  previewTaxCodeImport,
  type TaxCodeImportPreview,
  type TaxCodeProfileTemplate,
  upsertTaxCodeDefinition,
} from './transaction-tax.api';
import { TAX_CONTEXT_LABELS, taxCodeImportDiagnosticMessage, transactionTaxCapabilities, transactionTaxErrorMessage } from './transaction-tax.model';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { useConfirm } from '@/common/components/modal';

// SAP-style Tax Codes identify VAT treatment. WHT, CIT, customs and excise remain
// separate tax components/modules and must never be encoded as a VAT Tax Code.
const regimes: TransactionTaxRegime[] = ['VAT', 'IMPORT_VAT'];
const directions: TransactionTaxDirection[] = ['OUTPUT', 'INPUT', 'SELF_ASSESSED'];
const treatments: TransactionTaxTreatment[] = ['STANDARD', 'ZERO_RATED', 'EXEMPT', 'NON_TAXABLE', 'DEFERRED', 'REVERSE_CHARGE', 'CLAIMABLE', 'PENDING_EVIDENCE', 'PARTIALLY_DEDUCTIBLE', 'NONDEDUCTIBLE_EXPENSE', 'NONDEDUCTIBLE_CAPITALIZED', 'OUTSIDE_SCOPE', 'NEEDS_REVIEW'];
const contexts = Object.keys(TAX_CONTEXT_LABELS) as TransactionTaxContext[];

const field = 'mangmee-input w-full';
const button = 'rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50';

export function TaxCodeSettingsPage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const capability = transactionTaxCapabilities(permissions);
  const [profiles, setProfiles] = useState<TaxCodeProfileDto[]>([]);
  const [templates, setTemplates] = useState<TaxCodeProfileTemplate[]>([]);
  const [definitions, setDefinitions] = useState<TaxCodeDefinitionDto[]>([]);
  const [profileId, setProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState<{ id: string; action: 'activate' | 'retire' } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importFormat, setImportFormat] = useState<'CSV' | 'JSON'>('CSV');
  const [importContent, setImportContent] = useState('');
  const [importPreview, setImportPreview] = useState<TaxCodeImportPreview | null>(null);
  const [templateEffectiveFrom, setTemplateEffectiveFrom] = useState(todayCivilDate());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [loadedProfiles, loadedTemplates] = capability.canReadProfiles
        ? await Promise.all([listTaxCodeProfiles(companyId), listTaxCodeProfileTemplates(companyId)])
        : [[], []];
      setProfiles(loadedProfiles);
      setTemplates(loadedTemplates);
      const selected = profileId || loadedProfiles.find((item) => item.status === 'ACTIVE')?.id || loadedProfiles[0]?.id || '';
      setProfileId(selected);
      setDefinitions(capability.canReadConfig ? await listTaxCodeDefinitions(companyId, selected ? { profileId: selected } : undefined) : []);
    } catch (cause) {
      setError(transactionTaxErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [capability.canReadConfig, capability.canReadProfiles, companyId, profileId]);

  useEffect(() => { void load(); }, [load]);

  async function submitProfile(form: FormData) {
    setBusy(true); setError('');
    try {
      await createTaxCodeProfile(companyId, {
        name: String(form.get('name')),
        sourceSystem: String(form.get('sourceSystem')) as 'SAP_ERP' | 'SAP_S4HANA' | 'WATCHDOG' | 'CUSTOM',
        sourceProfileKey: String(form.get('sourceProfileKey')),
        countryCode: 'TH',
        sapClient: String(form.get('sapClient') || '') || undefined,
        sapCompanyCode: String(form.get('sapCompanyCode') || '') || undefined,
        isDefault: form.get('isDefault') === 'on',
        effectiveFrom: String(form.get('effectiveFrom')),
        sourceUrl: String(form.get('sourceUrl') || '') || undefined,
        roundingMode: String(form.get('roundingMode')) as TaxRoundingMode,
        roundingScale: Number(form.get('roundingScale')),
        taxAmountTolerance: String(form.get('taxAmountTolerance')),
      });
      await load();
      toast.success('สร้าง Tax Profile เรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function submitDefinition(form: FormData) {
    const selectedContexts = contexts.filter((context) => form.get(`context:${context}`) === 'on');
    setBusy(true); setError('');
    try {
      await upsertTaxCodeDefinition(companyId, {
        profileId: String(form.get('profileId')),
        externalCode: String(form.get('externalCode')).trim().toUpperCase(),
        displayName: String(form.get('displayName')),
        taxRegime: String(form.get('taxRegime')) as TransactionTaxRegime,
        direction: String(form.get('direction')) as TransactionTaxDirection,
        treatment: String(form.get('treatment')) as TransactionTaxTreatment,
        transactionContexts: selectedContexts,
        rate: String(form.get('rate') || '0'),
        calculationMethod: String(form.get('calculationMethod')) as 'EXCLUSIVE' | 'INCLUSIVE' | 'NONE',
        sapAccountKey: String(form.get('sapAccountKey') || '') || null,
        claimabilityDefault: String(form.get('claimabilityDefault')) as 'NOT_APPLICABLE' | 'CLAIMABLE' | 'PENDING_EVIDENCE' | 'PARTIAL' | 'NONDEDUCTIBLE_EXPENSE' | 'NONDEDUCTIBLE_CAPITALIZED',
        evidenceRuleKey: String(form.get('evidenceRuleKey') || '') || null,
        effectiveFrom: String(form.get('effectiveFrom')),
        effectiveTo: String(form.get('effectiveTo') || '') || null,
      });
      await load();
      toast.success('เพิ่ม Tax Code เรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function bootstrapTemplate(templateKey: TaxCodeProfileTemplate['key']) {
    setBusy(true); setError('');
    try {
      await createTaxCodeProfileFromTemplate(companyId, templateKey, templateEffectiveFrom);
      await load();
      toast.success('สร้างร่างจาก Template เรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function previewImport() {
    if (!profileId || !importContent.trim()) return;
    setBusy(true); setError(''); setImportPreview(null);
    try { setImportPreview(await previewTaxCodeImport(companyId, profileId, { format: importFormat, content: importContent })); }
    catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function applyImport() {
    if (!profileId || !importPreview?.canApply) return;
    setBusy(true); setError('');
    try {
      await applyTaxCodeImport(companyId, profileId, { format: importFormat, content: importContent, expectedChecksum: importPreview.checksum });
      setImportPreview(null); setImportContent(''); await load();
      toast.success('นำเข้า Tax Code เรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function activateProfile(id: string) {
    setBusy(true); setProfileBusy({ id, action: 'activate' }); setError('');
    try {
      await activateTaxCodeProfile(companyId, id);
      await load();
      toast.success('เปิดใช้งาน Tax Profile เรียบร้อยแล้ว');
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setProfileBusy(null); setBusy(false); }
  }

  async function retireProfile(id: string) {
    if (!(await confirm({
      title: 'เลิกใช้งาน Tax Profile',
      message: 'เลิกใช้งาน Tax Profile นี้ใช่หรือไม่',
    }))) return;
    setBusy(true); setProfileBusy({ id, action: 'retire' }); setError('');
    try {
      await retireTaxCodeProfile(companyId, id);
      await load();
      toast.success('ยกเลิกใช้งาน Tax Profile เรียบร้อยแล้ว');
    } catch (cause) {
      setError(transactionTaxErrorMessage(cause));
    } finally {
      setProfileBusy(null);
      setBusy(false);
    }
  }

  if (!capability.canReadProfiles && !capability.canReadConfig) {
    return <MangmeePage title="Tax Code" description="ตั้งค่า SAP-compatible Tax Code"><MangmeeCard className="p-6 text-sm text-red-700">คุณไม่มีสิทธิ์ดูการตั้งค่าภาษี</MangmeeCard></MangmeePage>;
  }

  return (
    <MangmeePage
      title="Tax Code และ Tax Profile"
      description="Tax Code เป็น alias ตาม profile ของ SAP/ERP ไม่ใช่ผังบัญชี การลงบัญชีและช่องรายงานกำหนดแยกใน Account Determination"
      actions={<a className="text-sm font-bold text-brand-700" href={`/companies/${companyId}/settings/tax-accounts`}>ตั้งค่าบัญชีและช่องรายงาน →</a>}
    >
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {loading && <MangmeeCard className="mb-4 p-4 text-sm text-gray-500">กำลังโหลดการตั้งค่า...</MangmeeCard>}
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <MangmeeCard className="overflow-hidden">
            <div className="border-b border-gray-100 p-4"><h2 className="font-bold text-gray-900">Profiles</h2><p className="text-xs text-gray-500">Draft แก้ไขได้; Activate เมื่อกฎบัญชีและรายงานครบ</p></div>
            <div className="divide-y divide-gray-100">
              {profiles.map((profile) => (
                <div key={profile.id} className="flex items-center justify-between gap-3 p-4">
                  <button type="button" className="min-w-0 text-left" onClick={() => setProfileId(profile.id)}>
                    <div className="font-bold text-gray-800">{profile.name} {profile.isDefault ? '· ค่าเริ่มต้น' : ''}</div>
                    <div className="text-xs text-gray-500">{profile.sourceSystem} · {profile.sourceProfileKey} · v{profile.version}</div>
                    <div className="text-xs text-gray-500">Rounding {profile.roundingMode} / {profile.roundingScale} ตำแหน่ง · tolerance {profile.taxAmountTolerance}</div>
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold">{profile.status}</span>
                    {capability.canManageProfiles && capability.canManageConfig && profile.status === 'DRAFT' && <button disabled={busy} className="text-xs font-bold text-emerald-700" onClick={() => void activateProfile(profile.id)}>{profileBusy?.id === profile.id && profileBusy.action === 'activate' ? 'กำลังเปิดใช้งาน...' : 'Activate'}</button>}
                    {capability.canManageProfiles && profile.status === 'ACTIVE' && <button disabled={busy} className="text-xs font-bold text-red-700" onClick={() => void retireProfile(profile.id)}>{profileBusy?.id === profile.id && profileBusy.action === 'retire' ? 'กำลังเลิกใช้งาน...' : 'Retire'}</button>}
                  </div>
                </div>
              ))}
              {!profiles.length && !loading && <div className="p-6 text-center text-sm text-gray-500">ยังไม่มี Tax Profile</div>}
            </div>
          </MangmeeCard>
          {templates.length > 0 && (
            <MangmeeCard className="p-4">
              <h2 className="font-bold text-gray-900">Built-in Tax Code templates</h2>
              <p className="mt-1 text-xs text-gray-500">คัดลอกเป็น DRAFT/REVIEW_REQUIRED เท่านั้น ระบบไม่ activate และไม่ผูกบัญชีให้อัตโนมัติ</p>
              <ThemedDate className={`${field} mt-3`} value={templateEffectiveFrom} onChange={(event) => setTemplateEffectiveFrom(event.target.value)} />
              <div className="mt-3 space-y-3">
                {templates.map((template) => {
                  const installed = profiles.some((profile) => profile.sourceSystem === template.sourceSystem && profile.sourceProfileKey === template.key && profile.status !== 'RETIRED');
                  return <div key={template.key} className="rounded-lg border border-gray-200 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{template.name}</strong><div className="mt-1 text-xs text-gray-500">{template.definitionCount} codes · {template.key}</div></div>{capability.canManageProfiles && capability.canManageConfig && <button type="button" className={button} disabled={busy || installed || !templateEffectiveFrom} onClick={() => void bootstrapTemplate(template.key)}>{installed ? 'ติดตั้งแล้ว' : 'สร้าง Draft จาก template'}</button>}</div><p className="mt-2 text-xs text-amber-700">{template.warning}</p></div>;
                })}
              </div>
            </MangmeeCard>
          )}
          {capability.canManageProfiles && (
            <MangmeeCard className="p-4">
              <h2 className="mb-3 font-bold text-gray-900">สร้าง Profile</h2>
              <form action={submitProfile} className="grid gap-3 sm:grid-cols-2">
                <input required name="name" placeholder="ชื่อ profile" className={field} />
                <ThemedSelect name="sourceSystem" defaultValue="SAP_S4HANA"><option value="SAP_S4HANA">SAP S/4HANA</option><option value="SAP_ERP">SAP ERP</option><option value="WATCHDOG">WatchDog</option><option value="CUSTOM">Custom</option></ThemedSelect>
                <input required name="sourceProfileKey" placeholder="Profile key เช่น TH-S4-2026" className={field} />
                <input name="sapClient" placeholder="SAP Client" className={field} />
                <input name="sapCompanyCode" placeholder="SAP Company Code" className={field} />
                <ThemedDate required name="effectiveFrom" className={field} />
                <ThemedSelect name="roundingMode" defaultValue="HALF_UP"><option value="HALF_UP">Half up</option><option value="HALF_EVEN">Half even</option><option value="DOWN">Down (เข้าหาศูนย์)</option><option value="UP">Up (ออกจากศูนย์)</option></ThemedSelect>
                <input required name="roundingScale" type="number" min="0" max="4" step="1" defaultValue="2" aria-label="Tax rounding decimal places" className={field} />
                <input required name="taxAmountTolerance" type="number" min="0" step="0.000001" defaultValue="0.01" aria-label="Tax amount tolerance" className={`${field} sm:col-span-2`} />
                <p className="text-xs text-gray-500 sm:col-span-2">นโยบายนี้ถูก snapshot ไปกับ source, Tax Event และ journal เพื่อให้การคำนวณและ reconciliation ใช้กติกาเดียวกันย้อนหลัง</p>
                <input name="sourceUrl" type="url" placeholder="แหล่งอ้างอิง" className={`${field} sm:col-span-2`} />
                <label className="flex items-center gap-2 text-sm"><input name="isDefault" type="checkbox" /> ใช้เป็นค่าเริ่มต้น</label>
                <button disabled={busy} className={button}>สร้าง Profile</button>
              </form>
            </MangmeeCard>
          )}
          {capability.canManageConfig && profiles.some((item) => item.id === profileId && item.status === 'DRAFT') && (
            <MangmeeCard className="p-4">
              <h2 className="font-bold text-gray-900">Import SAP / ERP Tax Codes</h2>
              <p className="mt-1 text-xs text-gray-500">รองรับ canonical CSV/JSON สูงสุด 500 แถว ระบบ preview conflict และ checksum ก่อนบันทึกเป็น REVIEW_REQUIRED โดยไม่ activate อัตโนมัติ</p>
              <div className="mt-3 grid gap-3">
                <ThemedSelect value={importFormat} onChange={(event) => { setImportFormat(event.target.value as 'CSV' | 'JSON'); setImportPreview(null); }}><option value="CSV">CSV</option><option value="JSON">JSON</option></ThemedSelect>
                <textarea className={`${field} min-h-40 font-mono text-xs`} value={importContent} onChange={(event) => { setImportContent(event.target.value); setImportPreview(null); }} placeholder="externalCode,displayName,taxRegime,direction,treatment,transactionContexts,rate,calculationMethod,claimabilityDefault,effectiveFrom" />
                <div className="flex gap-2"><button type="button" disabled={busy || !importContent.trim()} onClick={() => void previewImport()} className={button}>Preview import</button><button type="button" disabled={busy || !importPreview?.canApply} onClick={() => void applyImport()} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Apply reviewed rows</button></div>
                {importPreview && <div className={`rounded-lg p-3 text-xs ${importPreview.canApply ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><strong>{importPreview.rows.length} แถว · {importPreview.canApply ? 'พร้อมนำเข้า' : 'ต้องแก้ข้อมูลก่อนนำเข้า'}</strong><div className="mt-2 space-y-1">{importPreview.rows.filter((row) => row.errors.length).map((row) => <div key={row.rowNumber}>แถว {row.rowNumber}: {row.errors.map(taxCodeImportDiagnosticMessage).join('; ')}</div>)}</div><div className="mt-2 break-all font-mono text-[10px]">checksum {importPreview.checksum}</div></div>}
              </div>
            </MangmeeCard>
          )}
        </div>
        <div className="space-y-5">
          <MangmeeCard className="overflow-hidden">
            <div className="border-b border-gray-100 p-4"><h2 className="font-bold text-gray-900">Tax Code Definitions</h2></div>
            <div className="divide-y divide-gray-100">
              {definitions.map((definition) => <div key={definition.id} className="p-4"><div className="flex justify-between gap-2"><strong>{definition.externalCode} · {definition.displayName}</strong><span className="text-xs font-bold">{definition.status}</span></div><div className="mt-1 text-xs text-gray-500">{definition.taxRegime} / {definition.direction} / {definition.treatment} · {definition.rate}% · {definition.transactionContexts.join(', ')}</div></div>)}
              {!definitions.length && !loading && <div className="p-6 text-center text-sm text-gray-500">ยังไม่มี Tax Code ใน profile นี้</div>}
            </div>
          </MangmeeCard>
          {capability.canManageConfig && profiles.some((item) => item.status === 'DRAFT') && (
            <MangmeeCard className="p-4">
              <h2 className="mb-3 font-bold text-gray-900">เพิ่ม Tax Code</h2>
              <form action={submitDefinition} className="grid gap-3 sm:grid-cols-2">
                <ThemedSelect name="profileId" value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.filter((item) => item.status === 'DRAFT').map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</ThemedSelect>
                <input required name="externalCode" placeholder="Tax Code เช่น O7" className={field} />
                <input required name="displayName" placeholder="ชื่อรายการ" className={`${field} sm:col-span-2`} />
                <ThemedSelect name="taxRegime" defaultValue="VAT">{regimes.map((item) => <option key={item} value={item}>{item}</option>)}</ThemedSelect>
                <p className="text-xs text-gray-500 sm:col-span-2">WHT, CIT, ศุลกากร และสรรพสามิตคำนวณเป็นคนละ component/module ไม่สร้างเป็น VAT Tax Code</p>
                <ThemedSelect name="direction" defaultValue="OUTPUT">{directions.map((item) => <option key={item} value={item}>{item}</option>)}</ThemedSelect>
                <ThemedSelect name="treatment" defaultValue="STANDARD">{treatments.map((item) => <option key={item} value={item}>{item}</option>)}</ThemedSelect>
                <ThemedSelect name="calculationMethod" defaultValue="EXCLUSIVE"><option value="EXCLUSIVE">Exclusive</option><option value="INCLUSIVE">Inclusive</option><option value="NONE">No calculation</option></ThemedSelect>
                <input required name="rate" type="number" step="0.0001" defaultValue="7" placeholder="อัตรา %" className={field} />
                <ThemedSelect name="claimabilityDefault" defaultValue="NOT_APPLICABLE"><option value="NOT_APPLICABLE">N/A</option><option value="CLAIMABLE">Claimable</option><option value="PENDING_EVIDENCE">Pending evidence</option><option value="PARTIAL">Partial</option><option value="NONDEDUCTIBLE_EXPENSE">Non-deductible expense</option><option value="NONDEDUCTIBLE_CAPITALIZED">Capitalize</option></ThemedSelect>
                <input name="sapAccountKey" placeholder="SAP account key" className={field} />
                <input name="evidenceRuleKey" placeholder='Evidence policy: CSV หรือ {"mode":"REPLACE","required":[],"oneOf":[],"optional":[]}' className={`${field} sm:col-span-2`} />
                <ThemedDate required name="effectiveFrom" className={field} />
                <ThemedDate name="effectiveTo" className={field} />
                <fieldset className="sm:col-span-2"><legend className="mb-2 text-xs font-bold text-gray-600">บริบทธุรกรรม</legend><div className="grid gap-2 sm:grid-cols-2">{contexts.map((context) => <label key={context} className="flex gap-2 text-sm"><input type="checkbox" name={`context:${context}`} /> {TAX_CONTEXT_LABELS[context]}</label>)}</div></fieldset>
                <button disabled={busy || !profileId} className={`${button} sm:col-span-2`}>บันทึก Tax Code</button>
              </form>
            </MangmeeCard>
          )}
        </div>
      </div>
      {confirmDialog}
    </MangmeePage>
  );
}
