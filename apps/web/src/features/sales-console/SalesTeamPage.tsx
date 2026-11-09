'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  SALES_CODE_DEFAULT_LENGTH, SALES_DEAL_REASON_MAX,
  type CompanyLegalAddress,
  type SalesAgentCreateBody, type SalesAgentCredentialHandoff, type SalesAgentProfileDto,
  type SalesAgentView, type SalesAttributionFlagRow, type SalesRoleKey,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { SelectField, TextField, TextareaField } from '@/common/components/field';
import { ThaiAddressFields } from '@/common/components/field/ThaiAddressFields';
import { LoadingState } from '@/common/components/state';
import { Modal } from '@/common/components/modal';
import { formatThaiDate } from '@/common/i18n/thai-date';
import {
  createSalesAgent, createSalesTeamMember, getSalesAgentProfile, getSalesTeamProfile, listSalesAgents, listSalesAttributionFlags, listSalesTeam,
  resetSalesAgentCredential, resetSalesTeamCredential, reviewSalesAttributionFlag, SALES_AGENT_CSV_URL, updateSalesAgent,
} from './sales.api';
import {
  agentStatusMeta, emptyAgentForm, formatBaht, normalizeSalesCodeInput, SALES_ATTRIBUTION_SOURCE_LABELS,
  SALES_ROLE_LABELS, SALES_BANK_NAMES, salesAgentAddress, salesFlagConfirmEffect, salesFlagLabel, salesFlagReview, validateAgentForm,
  type SalesAgentFormErrors, type SalesAgentFormValues,
} from './sales-console.logic';
import { SalesCredentialPanel, SalesEmpty, SalesNotice } from './SalesConsoleParts';
import { SalesProfileEditor } from './SalesProfileEditor';
import { SalesDemoLinkDialog } from './SalesDemoLinkDialog';

/**
 * One page, two rights (spec §12 "Sales console" + "Admin console"):
 *  - `scope="lead"` is `/sales/team` — a หัวหน้า creates เซลล์ and reads own-team payroll profiles.
 *  - `scope="admin"` is `/system/sales-team` — SYSTEM_ADMIN can also suspend/reactivate,
 *    read/edit the audited profile and export CSV.
 */
export type SalesTeamScope = 'lead' | 'admin';

const EMPTY_ADDRESS: CompanyLegalAddress = { line1: '', line2: '', subdistrict: '', district: '', province: '', postalCode: '' };

export default function SalesTeamPage({ scope }: { scope: SalesTeamScope }) {
  const admin = scope === 'admin';
  const [agents, setAgents] = useState<SalesAgentView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [values, setValues] = useState<SalesAgentFormValues>(() => emptyAgentForm());
  const [address, setAddress] = useState<CompanyLegalAddress>(() => ({ ...EMPTY_ADDRESS }));
  const [bankSelection, setBankSelection] = useState('');
  const [errors, setErrors] = useState<SalesAgentFormErrors>({});
  const [credential, setCredential] = useState<SalesAgentCredentialHandoff | null>(null);
  const [profile, setProfile] = useState<{ agent: SalesAgentView; data: SalesAgentProfileDto } | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [statusChange, setStatusChange] = useState<SalesAgentView | null>(null);
  const [statusReason, setStatusReason] = useState('');
  // D6 anti-gaming (§17.1). Admin console only: these rows decide whose numbers count, and the
  // decision is the Owner's, never a หัวหน้า's.
  const [flags, setFlags] = useState<SalesAttributionFlagRow[] | null>(null);
  const [flagDecision, setFlagDecision] = useState<{ row: SalesAttributionFlagRow; keep: boolean } | null>(null);
  const [flagReason, setFlagReason] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const result = await (admin ? listSalesAgents({ signal }) : listSalesTeam({ signal }));
      if (!signal?.aborted) setAgents(result.items);
    } catch (cause) {
      if (!signal?.aborted) { setAgents([]); setError(apiErrorMessage(cause)); }
    }
  }, [admin]);

  const loadFlags = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await listSalesAttributionFlags({ signal });
      if (!signal?.aborted) setFlags(result.items);
    } catch {
      // Quiet on purpose: the team list is this page's job, and a flags outage must not replace it
      // with an error. An empty list simply renders nothing.
      if (!signal?.aborted) setFlags([]);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    if (admin) void loadFlags(controller.signal);
    return () => controller.abort();
  }, [admin, load, loadFlags]);

  const set = <K extends keyof SalesAgentFormValues>(key: K, value: SalesAgentFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    if (errors[key]) setErrors((previous) => ({ ...previous, [key]: undefined }));
  };

  const submitCreate = async () => {
    const fullAddress = salesAgentAddress(address);
    const found = validateAgentForm({ ...values, address: fullAddress });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: SalesAgentCreateBody = {
        username: values.username.trim(),
        displayName: values.displayName.trim(),
        ...(values.phoneNumber.replace(/[^0-9]/g, '') ? { phoneNumber: values.phoneNumber.replace(/[^0-9]/g, '') } : {}),
        ...(values.email.trim() ? { email: values.email.trim() } : {}),
        role: values.role,
        ...(values.teamLeadUserId ? { teamLeadUserId: values.teamLeadUserId } : {}),
        ...(values.salesCode.trim() ? { salesCode: values.salesCode.trim() } : {}),
        profile: {
          legalName: values.legalName.trim(),
          nationalId: values.nationalId.replace(/[^0-9]/g, ''),
          taxId: values.taxId.replace(/[^0-9]/g, '') || null,
          address: fullAddress,
          bankName: values.bankName.trim(),
          bankAccount: values.bankAccount.replace(/[^0-9]/g, ''),
          whtRatePercent: Number(values.whtRatePercent.trim()),
        },
      };
      const result = await (admin ? createSalesAgent(body) : createSalesTeamMember(body));
      setCredential(result.credential);
      setCreating(false);
      setValues(emptyAgentForm());
      setAddress({ ...EMPTY_ADDRESS });
      setBankSelection('');
      setNotice(`สร้างบัญชี ${result.agent.displayName} แล้ว รหัสเซลล์ ${result.agent.salesCode}`);
      await load();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (agent: SalesAgentView) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setCredential(await (admin ? resetSalesAgentCredential(agent.userId) : resetSalesTeamCredential(agent.userId)));
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyStatusChange = async () => {
    if (!statusChange || !statusReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await updateSalesAgent(statusChange.userId, {
        status: statusChange.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
        reason: statusReason.trim(),
      });
      setStatusChange(null);
      setStatusReason('');
      setNotice('อัปเดตสถานะเรียบร้อย');
      await load();
    } catch (cause) {
      setStatusChange(null);
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const applyFlagReview = async () => {
    if (!flagDecision || !flagReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // The review answers with the refreshed queue, so the row shows its new standing without a second read.
      const remaining = await reviewSalesAttributionFlag(flagDecision.row.companyId, { keep: flagDecision.keep, reason: flagReason.trim() });
      setFlags(remaining.items);
      setFlagDecision(null);
      setFlagReason('');
      setNotice(flagDecision.keep ? 'ตัดร้านนี้ออกจากยอดแล้ว' : 'ยืนยันว่าไม่ผิดปกติ นับรวมในยอดแล้ว');
    } catch (cause) {
      setFlagDecision(null);
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const openProfile = async (agent: SalesAgentView) => {
    setBusy(true);
    setError(null);
    try {
      setProfile({ agent, data: await (admin ? getSalesAgentProfile(agent.userId) : getSalesTeamProfile(agent.userId)) });
      setProfileEditing(false);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const leads = (agents ?? []).filter((agent) => agent.role === 'MANGMEE_SALES_LEAD');

  return (
    <MangmeePage
      eyebrow={admin ? 'ผู้ดูแลระบบ' : 'ทีมขายมั่งมี'}
      title="ทีมขายมั่งมี"
      description={admin
        ? 'บัญชีเซลล์และหัวหน้าทีมทั้งหมด พร้อมข้อมูลภาษีและบัญชีธนาคารสำหรับจ่ายค่าคอมมิชชัน'
        : 'สร้างบัญชีเซลล์ในทีม ดูข้อมูลของทีม และรีเซ็ตรหัสผ่านให้เมื่อจำเป็น'}
      actions={
        <div className="flex flex-wrap gap-2">
          {admin && <a href={SALES_AGENT_CSV_URL} className="mangmee-btn mangmee-btn-secondary">ส่งออก CSV</a>}
          {/* Owner 2026-11-09: the admin menu had no way to the sales ดีล page, so the admin could not make a demo link. */}
          {admin && <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setDemoOpen(true)}>สร้างลิงก์เดโม่</button>}
          <button type="button" className="mangmee-btn mangmee-btn-primary" onClick={() => { setErrors({}); setCreating(true); }}>เพิ่มบัญชี</button>
        </div>
      }
    >
      {error && <SalesNotice tone="error">{error}</SalesNotice>}
      {notice && <SalesNotice tone="info">{notice}</SalesNotice>}
      {credential && <SalesCredentialPanel credential={credential} onClose={() => setCredential(null)} />}

      {agents === null ? <LoadingState label="กำลังโหลดรายชื่อ…" />
        : agents.length === 0 ? <SalesEmpty>ยังไม่มีบัญชีในทีม</SalesEmpty>
          : (
            <MangmeeCard>
              {agents.map((agent) => {
                const status = agentStatusMeta(agent);
                return (
                  <div key={agent.userId} className="border-t border-gray-100 px-4 py-3 first:border-t-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-bold text-gray-900">{agent.displayName}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {agent.username} · {SALES_ROLE_LABELS[agent.role]} · รหัสเซลล์ {agent.salesCode}
                          {agent.teamLeadDisplayName ? ` · หัวหน้า ${agent.teamLeadDisplayName}` : ''}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-400">
                          เริ่ม {formatThaiDate(agent.createdAt)}{agent.lineLinked ? ' · ผูก LINE แล้ว' : ' · ยังไม่ผูก LINE'}
                        </p>
                      </div>
                      <MangmeeBadge tone={status.tone}>{status.label}</MangmeeBadge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={busy} aria-busy={busy} className="mangmee-btn mangmee-btn-secondary" onClick={() => void resetPassword(agent)}>รีเซ็ตรหัสผ่าน</button>
                      {(admin || agent.role === 'MANGMEE_SALES') && (
                        <button type="button" disabled={busy} aria-busy={busy} className="mangmee-btn mangmee-btn-secondary" onClick={() => void openProfile(agent)}>ดูข้อมูลภาษี</button>
                      )}
                      {admin && (
                        <button type="button" disabled={busy} className={`mangmee-btn ${agent.status === 'ACTIVE' ? 'mangmee-btn-danger' : 'mangmee-btn-secondary'}`}
                          onClick={() => { setStatusReason(''); setStatusChange(agent); }}>
                          {agent.status === 'ACTIVE' ? 'ระงับการใช้งาน' : 'เปิดใช้งานอีกครั้ง'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </MangmeeCard>
          )}

      {admin && flags !== null && flags.length > 0 && (
        <section aria-label="รายการที่ถูกธง" className="grid min-w-0 gap-3">
          <div>
            <h2 className="text-[15px] font-extrabold text-gray-900">รายการที่ถูกธง</h2>
            <p className="mt-0.5 text-sm leading-6 text-gray-600">
              ร้านที่ระบบสงสัยว่าผิดปกติ ยังไม่นับเป็นร้านที่เปิดและยังไม่นับในยอดของเซลล์จนกว่าคุณจะตรวจ ร้านที่คุณตัดออกจะไม่นับให้เซลล์ และยังอยู่ในรายการนี้ให้ตรวจย้อนหลัง
            </p>
          </div>
          {/* min-w-0: a grid item is as wide as its longest unbreakable line unless told otherwise, and
              a long shop name on one line pushed the whole queue past a 390 px screen. */}
          <MangmeeCard className="min-w-0">
            {flags.map((row) => {
              // The queue keeps every row it ever held, so each one says where it stands and
              // offers only the decision that would still change something.
              const review = salesFlagReview(row);
              return (
                <div key={row.companyId} className="border-t border-gray-100 px-4 py-3 first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 truncate text-[15px] font-bold text-gray-900">{row.companyName}</p>
                    <MangmeeBadge tone={review.tone}>{review.label}</MangmeeBadge>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {SALES_ATTRIBUTION_SOURCE_LABELS[row.source]} · {row.salesDisplayName} · {formatBaht(row.amountSatang)}
                    {row.paidAt ? ` · ชำระ ${formatThaiDate(row.paidAt)}` : ''}
                  </p>
                  <ul className="mt-1.5 grid gap-1">
                    {row.flags.map((flag) => (
                      <li key={flag} className="text-sm leading-6 text-warning-700">{salesFlagLabel(flag)}</li>
                    ))}
                  </ul>
                  {review.detail && <p className="mt-1 break-words text-xs text-gray-500">{review.detail}</p>}
                  {(review.canConfirm || review.canExclude) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {review.canConfirm && (
                        <button type="button" disabled={busy} className="mangmee-btn mangmee-btn-secondary"
                          onClick={() => { setFlagReason(''); setFlagDecision({ row, keep: false }); }}>ยืนยันว่าไม่ผิดปกติ</button>
                      )}
                      {review.canExclude && (
                        <button type="button" disabled={busy} className="mangmee-btn mangmee-btn-danger"
                          onClick={() => { setFlagReason(''); setFlagDecision({ row, keep: true }); }}>ตัดออกจากยอด</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </MangmeeCard>
        </section>
      )}

      <Modal open={flagDecision !== null} onClose={() => setFlagDecision(null)}
        title={flagDecision?.keep ? 'ตัดร้านนี้ออกจากยอด' : 'ยืนยันว่าร้านนี้ไม่ผิดปกติ'}>
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-gray-600">
            {flagDecision?.keep
              ? 'ยอดของร้านนี้จะไม่ถูกนับให้เซลล์ และรายการจะยังอยู่ให้ตรวจย้อนหลังได้'
              : salesFlagConfirmEffect(flagDecision?.row.paidAt)}
          </p>
          <p className="text-sm font-semibold text-gray-800">{flagDecision?.row.companyName} · {flagDecision?.row.salesDisplayName}</p>
          <TextareaField label="เหตุผล (จำเป็น)" name="flagReason" maxLength={SALES_DEAL_REASON_MAX}
            value={flagReason} onChange={(event) => setFlagReason(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setFlagDecision(null)}>ปิด</button>
            <button type="button" className={`mangmee-btn ${flagDecision?.keep ? 'mangmee-btn-danger' : 'mangmee-btn-primary'}`}
              disabled={busy || !flagReason.trim()} aria-busy={busy} onClick={() => void applyFlagReview()}>ยืนยัน</button>
          </div>
        </div>
      </Modal>

      <Modal open={creating} onClose={() => setCreating(false)} title="เพิ่มบัญชีทีมขาย" size="lg">
        <div className="grid gap-4">
          <TextField label="ชื่อผู้ใช้" name="username" value={values.username} autoComplete="off"
            onChange={(event) => set('username', event.target.value)} error={errors.username} />
          <TextField label="ชื่อที่แสดง" name="displayName" value={values.displayName}
            onChange={(event) => set('displayName', event.target.value)} error={errors.displayName} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="เบอร์มือถือ (ไม่บังคับ)" name="phoneNumber" inputMode="numeric" value={values.phoneNumber}
              onChange={(event) => set('phoneNumber', event.target.value)} error={errors.phoneNumber} />
            <TextField label="อีเมล (ไม่บังคับ)" name="email" type="email" value={values.email}
              onChange={(event) => set('email', event.target.value)} error={errors.email} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="บทบาท" name="role" value={values.role}
              onChange={(event) => set('role', event.target.value as SalesRoleKey)}
              // A lead may only create เซลล์ in their own team; promoting someone is a SYSTEM_ADMIN act.
              disabled={!admin}>
              {(Object.keys(SALES_ROLE_LABELS) as SalesRoleKey[]).map((role) => (
                <option key={role} value={role} disabled={!admin && role === 'MANGMEE_SALES_LEAD'}>{SALES_ROLE_LABELS[role]}</option>
              ))}
            </SelectField>
            <TextField label="รหัสเซลล์ (ไม่บังคับ)" name="salesCode" value={values.salesCode}
              hint={`เว้นว่างให้ระบบสุ่มให้ ${SALES_CODE_DEFAULT_LENGTH} ตัว · ตัวอักษรอังกฤษตัวใหญ่หรือตัวเลข 3–6 ตัว`}
              onChange={(event) => set('salesCode', normalizeSalesCodeInput(event.target.value))} error={errors.salesCode} />
          </div>
          {admin && values.role === 'MANGMEE_SALES' && leads.length > 0 && (
            <SelectField label="หัวหน้าทีม (ไม่บังคับ)" name="teamLeadUserId" value={values.teamLeadUserId}
              onChange={(event) => set('teamLeadUserId', event.target.value)}>
              <option value="">ยังไม่ระบุ</option>
              {leads.map((lead) => <option key={lead.userId} value={lead.userId}>{lead.displayName}</option>)}
            </SelectField>
          )}

          <div className="grid gap-4 rounded-xl border border-gray-200 p-3.5">
              <p className="text-sm font-semibold text-gray-800">ข้อมูลภาษีและบัญชีธนาคาร</p>
              <p className="-mt-3 text-xs leading-6 text-gray-500">ใช้จ่ายค่าคอมมิชชัน เก็บแบบเข้ารหัส ผู้ดูแลระบบและหัวหน้าทีมที่ดูแลเซลล์เปิดดูได้</p>
              <TextField label="ชื่อ-นามสกุลตามบัตรประชาชน" name="legalName" value={values.legalName} autoComplete="off"
                onChange={(event) => set('legalName', event.target.value)} error={errors.legalName} />
              <TextField label="เลขบัตรประชาชน" name="nationalId" value={values.nationalId} inputMode="numeric" maxLength={13} autoComplete="off"
                onChange={(event) => set('nationalId', event.target.value.replace(/\D/g, '').slice(0, 13))} error={errors.nationalId} />
              <TextField label="เลขประจำตัวผู้เสียภาษี (ถ้ามี)" name="taxId" value={values.taxId} inputMode="numeric" maxLength={13} autoComplete="off"
                onChange={(event) => set('taxId', event.target.value.replace(/\D/g, '').slice(0, 13))} error={errors.taxId} />
              <p className="text-sm font-semibold text-gray-800">ที่อยู่ (ตามบัตรประชาชนหรือบริษัท)</p>
              <ThaiAddressFields addressMasterPath="/v1/system/sales-agents/address-master" required
                value={{ postalCode: address.postalCode, province: address.province, district: address.district, subdistrict: address.subdistrict }}
                onChange={(next) => { setAddress((current) => ({ ...current, ...next })); setErrors((current) => ({ ...current, address: undefined })); }} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="ที่อยู่ (บ้านเลขที่ ถนน)" value={address.line1} required maxLength={250} error={errors.address}
                  onChange={(event) => { setAddress((current) => ({ ...current, line1: event.target.value })); setErrors((current) => ({ ...current, address: undefined })); }} />
                <TextField label="ที่อยู่เพิ่มเติม" value={address.line2 ?? ''} maxLength={150}
                  onChange={(event) => setAddress((current) => ({ ...current, line2: event.target.value }))} />
              </div>
              <SelectField label="ชื่อธนาคาร" name="bankSelection" value={bankSelection} error={errors.bankName}
                onChange={(event) => { setBankSelection(event.target.value); set('bankName', event.target.value === 'other' ? '' : event.target.value); }}>
                <option value="">— เลือกธนาคาร —</option>
                {SALES_BANK_NAMES.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                <option value="other">ธนาคารอื่น ๆ</option>
              </SelectField>
              {bankSelection === 'other' && <TextField label="ระบุชื่อธนาคาร" value={values.bankName} maxLength={120}
                onChange={(event) => set('bankName', event.target.value)} error={errors.bankName} />}
              <TextField label="เลขบัญชีธนาคาร" name="bankAccount" value={values.bankAccount} inputMode="numeric" autoComplete="off"
                onChange={(event) => set('bankAccount', event.target.value)} error={errors.bankAccount} />
              <TextField label="อัตราหัก ณ ที่จ่าย (%)" name="whtRatePercent" value={values.whtRatePercent} inputMode="numeric"
                onChange={(event) => set('whtRatePercent', event.target.value)} error={errors.whtRatePercent} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setCreating(false)}>ยกเลิก</button>
            <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy} aria-busy={busy} onClick={() => void submitCreate()}>สร้างบัญชี</button>
          </div>
        </div>
      </Modal>

      <Modal open={statusChange !== null} onClose={() => setStatusChange(null)}
        title={statusChange?.status === 'ACTIVE' ? 'ระงับการใช้งานบัญชีนี้' : 'เปิดใช้งานบัญชีนี้อีกครั้ง'}>
        <div className="grid gap-3">
          <p className="text-sm leading-6 text-gray-600">
            {statusChange?.status === 'ACTIVE'
              ? 'ระงับแล้วจะเข้าคอนโซลไม่ได้ และรหัสเซลล์จะใช้สมัครไม่ได้ ดีลเดิมยังอยู่ให้หัวหน้าดูต่อ'
              : 'เปิดใช้งานแล้วจะกลับเข้าคอนโซลและใช้รหัสเซลล์ได้ตามเดิม'}
          </p>
          <TextareaField label="เหตุผล (จำเป็น)" name="statusReason" maxLength={SALES_DEAL_REASON_MAX}
            value={statusReason} onChange={(event) => setStatusReason(event.target.value)} />
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setStatusChange(null)}>ปิด</button>
            <button type="button" className="mangmee-btn mangmee-btn-primary" disabled={busy || !statusReason.trim()} aria-busy={busy} onClick={() => void applyStatusChange()}>ยืนยัน</button>
          </div>
        </div>
      </Modal>

      <Modal open={profile !== null} onClose={() => { setProfile(null); setProfileEditing(false); }} title={`ข้อมูลภาษีของ ${profile?.agent.displayName ?? ''}`} size="lg">
        <div className="grid gap-3">
          <SalesNotice tone="warning">ระบบบันทึกการเปิดดูข้อมูลนี้ไว้ทุกครั้ง</SalesNotice>
          {profile && profileEditing ? <SalesProfileEditor key={profile.agent.userId} initial={profile.data} admin
            onCancel={() => setProfileEditing(false)} onSave={async (value) => {
              await updateSalesAgent(profile.agent.userId, { profile: value });
              setProfile({ agent: profile.agent, data: await getSalesAgentProfile(profile.agent.userId) });
              setProfileEditing(false);
              setNotice('บันทึกข้อมูลภาษีเรียบร้อยแล้ว');
            }} /> : profile && (
            <dl className="grid gap-2 text-sm">
              {([
                ['ชื่อ-นามสกุลตามบัตรประชาชน', profile.data.legalName],
                ['เลขบัตรประชาชน', profile.data.nationalId],
                ['เลขประจำตัวผู้เสียภาษี', profile.data.taxId ?? '—'],
                ['ที่อยู่', profile.data.address],
                ['ธนาคาร', profile.data.bankName],
                ['เลขบัญชีธนาคาร', profile.data.bankAccount],
                ['อัตราหัก ณ ที่จ่าย', `${profile.data.whtRatePercent}%`],
              ] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-semibold text-gray-500">{label}</dt>
                  <dd className="break-words font-bold text-gray-900">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          {!profileEditing && <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="mangmee-btn mangmee-btn-secondary" onClick={() => setProfile(null)}>ปิด</button>
            {admin && <button type="button" className="mangmee-btn mangmee-btn-primary" onClick={() => setProfileEditing(true)}>แก้ไขข้อมูล</button>}
          </div>}
        </div>
      </Modal>
      {demoOpen && <SalesDemoLinkDialog onClose={() => setDemoOpen(false)} />}
    </MangmeePage>
  );
}
