'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ForbiddenState, LoadingState } from '@/common/components/state';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { listSuppliers, listPurchaseRequests, listPurchaseOrders, listGoodsReceipts, submitPurchaseRequest, approvePurchaseRequest, rejectPurchaseRequest, issuePurchaseOrder, postGoodsReceipt, voidGoodsReceipt } from './procurement.api';
import { parseProcurementTab, visibleProcurementTabs, type ProcurementTab } from './procurement.logic';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useToast } from '@/common/components/toast';
import { useInputPrompt } from '@/common/components/modal';

function err(e: unknown) { return apiErrorMessage(e); }
const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:opacity-50';
const ghostClass = 'rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50';
const dangerClass = 'rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50';

const PR_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ', CANCELLED: 'ยกเลิก', CONVERTED: 'แปลงเป็น PO' };
const PO_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ', ISSUED: 'ออกแล้ว', PARTIALLY_RECEIVED: 'รับบางส่วน', RECEIVED: 'รับครบ', PARTIALLY_BILLED: 'วางบิลบางส่วน', BILLED: 'วางบิลครบ', CLOSED: 'ปิด', CANCELLED: 'ยกเลิก' };
const GR_STATUS_LABELS: Record<string, string> = { DRAFT: 'ร่าง', POSTED: 'บันทึกแล้ว', VOIDED: 'ยกเลิก' };

function StatusBadge({ status, map }: { status: string; map: Record<string, string> }) {
  const colorMap: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700', PENDING_APPROVAL: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700', ISSUED: 'bg-blue-100 text-blue-700',
    REJECTED: 'bg-red-100 text-red-700', CANCELLED: 'bg-red-50 text-red-400',
    POSTED: 'bg-green-100 text-green-700', VOIDED: 'bg-red-50 text-red-400',
    CONVERTED: 'bg-purple-100 text-purple-700', RECEIVED: 'bg-green-100 text-green-700',
    PARTIALLY_RECEIVED: 'bg-blue-50 text-blue-700', CLOSED: 'bg-gray-200 text-gray-500',
  };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${colorMap[status] ?? 'bg-gray-100 text-gray-600'}`}>{map[status] ?? status}</span>;
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{message}</div>;
}

// ── Supplier List ─────────────────────────────────────────────────────────────
function SupplierList({ companyId }: { companyId: string }) {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listSuppliers(companyId, { search: search || undefined }); setData(r.data ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input className={inputClass + ' max-w-sm'} placeholder="ค้นหาผู้จำหน่าย..." value={search} onChange={e => setSearch(e.target.value)} />
        <button className={ghostClass} onClick={load}>ค้นหา</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-4 py-3">ชื่อ</th><th className="px-4 py-3">เลขประจำตัวผู้เสียภาษี</th><th className="px-4 py-3">ประเภท</th><th className="px-4 py-3">สถานะ</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((s: any) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.displayNameSnapshot}</td>
                  <td className="px-4 py-3 text-gray-500">{s.taxId ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.supplierType}</td>
                  <td className="px-4 py-3"><StatusBadge status={s.status} map={{ ACTIVE: 'ใช้งาน', ON_HOLD: 'พัก', ARCHIVED: 'เก็บถาวร' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Purchase Request List ─────────────────────────────────────────────────────
function PurchaseRequestList({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listPurchaseRequests(companyId, { status: statusFilter || undefined }); setData(r.data ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); if (successMessage) toast.success(successMessage); await load(); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  const reject = async (id: string) => {
    const note = await promptInput({ title: 'ปฏิเสธใบขอซื้อ', label: 'เหตุผลปฏิเสธ' });
    if (!note) return;
    await action(id, () => rejectPurchaseRequest(companyId, id, note), 'ปฏิเสธใบขอซื้อเรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <ThemedSelect className={inputClass + ' max-w-xs'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(PR_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </ThemedSelect>
        <button className={ghostClass} onClick={load}>กรอง</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-4 py-3">เลขที่</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">ยอดรวม</th><th className="px-4 py-3">วันที่</th><th className="px-4 py-3">การกระทำ</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((pr: any) => (
                <tr key={pr.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{pr.requestNumber ?? pr.id.slice(0, 8)}</td>
                  <td className="px-4 py-3"><StatusBadge status={pr.status} map={PR_STATUS_LABELS} /></td>
                  <td className="px-4 py-3">{Number(pr.grandTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</td>
                  <td className="px-4 py-3 text-gray-500">{formatThaiDate(pr.createdAt)}</td>
                  <td className="px-4 py-3 flex gap-1">
                    {pr.status === 'DRAFT' && <button className={btnClass + ' text-xs py-1 px-2'} disabled={actionLoading === pr.id} onClick={() => action(pr.id, () => submitPurchaseRequest(companyId, pr.id), 'ส่งขออนุมัติเรียบร้อยแล้ว')}>ส่งขออนุมัติ</button>}
                    {pr.status === 'PENDING_APPROVAL' && <>
                      <button className={btnClass + ' text-xs py-1 px-2 bg-green-600 hover:bg-green-700'} disabled={actionLoading === pr.id} onClick={() => action(pr.id, () => approvePurchaseRequest(companyId, pr.id), 'อนุมัติใบขอซื้อเรียบร้อยแล้ว')}>อนุมัติ</button>
                      <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === pr.id} onClick={() => void reject(pr.id)}>ปฏิเสธ</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inputPromptDialog}
    </div>
  );
}

// ── Purchase Order List ───────────────────────────────────────────────────────
function PurchaseOrderList({ companyId }: { companyId: string }) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listPurchaseOrders(companyId, { status: statusFilter || undefined }); setData(r.data ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); if (successMessage) toast.success(successMessage); await load(); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <ThemedSelect className={inputClass + ' max-w-xs'} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">ทุกสถานะ</option>
          {Object.entries(PO_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </ThemedSelect>
        <button className={ghostClass} onClick={load}>กรอง</button>
      </div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-4 py-3">เลขที่ PO</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">ยอดรวม</th><th className="px-4 py-3">วันสั่งซื้อ</th><th className="px-4 py-3">การกระทำ</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((po: any) => (
                <tr key={po.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{po.purchaseOrderNumber ?? po.id.slice(0, 8)}</td>
                  <td className="px-4 py-3"><StatusBadge status={po.status} map={PO_STATUS_LABELS} /></td>
                  <td className="px-4 py-3">{Number(po.grandTotalAmount).toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท</td>
                  <td className="px-4 py-3 text-gray-500">{formatThaiDate(po.orderDate ?? po.createdAt)}</td>
                  <td className="px-4 py-3 flex gap-1">
                    {po.status === 'APPROVED' && <button className={btnClass + ' text-xs py-1 px-2'} disabled={actionLoading === po.id} onClick={() => action(po.id, () => issuePurchaseOrder(companyId, po.id), 'ออกใบสั่งซื้อเรียบร้อยแล้ว')}>ออก PO</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Goods Receipt List ────────────────────────────────────────────────────────
function GoodsReceiptList({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const r = await listGoodsReceipts(companyId); setData(r.data ?? []); }
    catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(id); setError(null);
    try { await fn(); if (successMessage) toast.success(successMessage); await load(); } catch (e) { setError(err(e)); } finally { setActionLoading(null); }
  };

  const voidReceipt = async (id: string) => {
    const reason = await promptInput({ title: 'ยกเลิกใบรับสินค้า', label: 'เหตุผลยกเลิก' });
    if (!reason) return;
    await action(id, () => voidGoodsReceipt(companyId, id, reason), 'ยกเลิกใบรับสินค้าเรียบร้อยแล้ว');
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className={ghostClass} onClick={load}>รีเฟรช</button></div>
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
              <tr><th className="px-4 py-3">เลขที่ใบรับ</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">วันรับของ</th><th className="px-4 py-3">การกระทำ</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">ไม่พบข้อมูล</td></tr> : data.map((gr: any) => (
                <tr key={gr.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{gr.goodsReceiptNumber ?? gr.id.slice(0, 8)}</td>
                  <td className="px-4 py-3"><StatusBadge status={gr.status} map={GR_STATUS_LABELS} /></td>
                  <td className="px-4 py-3 text-gray-500">{formatThaiDate(gr.receivedAt)}</td>
                  <td className="px-4 py-3 flex gap-1">
                    {gr.status === 'DRAFT' && <button className={btnClass + ' text-xs py-1 px-2'} disabled={actionLoading === gr.id} onClick={() => action(gr.id, () => postGoodsReceipt(companyId, gr.id), 'บันทึกรับสินค้าเรียบร้อยแล้ว')}>บันทึกรับสินค้า</button>}
                    {gr.status === 'POSTED' && <button className={dangerClass + ' text-xs py-1 px-2'} disabled={actionLoading === gr.id} onClick={() => void voidReceipt(gr.id)}>ยกเลิก</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inputPromptDialog}
    </div>
  );
}

const PROCUREMENT_TAB_LABELS: Record<ProcurementTab, string> = {
  suppliers: 'ผู้จำหน่าย',
  pr: 'ใบขอซื้อ (PR)',
  po: 'ใบสั่งซื้อ (PO)',
  gr: 'ใบรับสินค้า (GR)',
};

// ── Hub Page ──────────────────────────────────────────────────────────────────
export function ProcurementHubPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const searchParams = useSearchParams();
  const tabs = useMemo(() => visibleProcurementTabs(permissions), [permissions]);
  // Initial tab only: later clicks remain local, matching the reimbursement hub.
  const [tab, setTab] = useState<ProcurementTab>(() => parseProcurementTab(searchParams.get('tab'), tabs));

  if (tabs.length === 0) {
    return <div className="p-6"><ForbiddenState /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">จัดซื้อ</h1>
      <div className="flex w-full items-center overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:overflow-x-visible">
        {tabs.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{PROCUREMENT_TAB_LABELS[t]}</button>
        ))}
      </div>
      <div>
        {tab === 'suppliers' && <SupplierList companyId={companyId} />}
        {tab === 'pr' && <PurchaseRequestList companyId={companyId} />}
        {tab === 'po' && <PurchaseOrderList companyId={companyId} />}
        {tab === 'gr' && <GoodsReceiptList companyId={companyId} />}
      </div>
    </div>
  );
}
