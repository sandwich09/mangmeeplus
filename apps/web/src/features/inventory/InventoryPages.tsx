'use client';

import { formatThaiDateTime } from '@/common/i18n/thai-date';

import Link from 'next/link';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx, type MangmeeTone } from '@/common/components/mangmee';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/common/components/button/Button';
import { SelectField, SwitchField, TextareaField, TextField } from '@/common/components/field/Field';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ForbiddenState, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage } from '@/common/api/api-error-message';
import {
  addProductBarcode,
  createLocation,
  createMovement,
  createProduct,
  generateLocationQr,
  generateProductQr,
  getProduct,
  getStockBalance,
  getStockReport,
  listLocations,
  listMovements,
  listProducts,
  resolveQrScan,
  stockCount,
  transferStock,
  updateProduct,
} from './inventory.api';
import { LOCATION_TYPE_LABELS, MOVEMENT_TYPE_LABELS } from './inventory.constants';
import { formatQty } from './inventory.logic';
import type {
  InventoryLocationType,
  InventoryRecordStatus,
  LocationSummary,
  ProductDetail,
  ProductKind,
  ProductSummary,
  StockBalance,
  StockMovementSummary,
  StockMovementType,
} from './inventory.model';

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const inputClass = 'mangmee-input';
const buttonClass = 'inline-flex h-10 items-center justify-center rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-medium text-white hover:from-brand-600 hover:to-brand-800 disabled:opacity-50';
const ghostButtonClass = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:border-brand-200 hover:bg-brand-25 hover:text-brand-700 disabled:opacity-50';

function StatusPill({ status }: { status: InventoryRecordStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === 'ACTIVE' ? 'bg-brand-25 text-brand-700' : 'bg-gray-100 text-gray-600'}`}>
      {status === 'ACTIVE' ? 'ใช้งาน' : 'เก็บถาวร'}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{message}</div>;
}

function EmptyRow({ colSpan, text = 'ไม่มีข้อมูล' }: { colSpan: number; text?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-8 text-center text-gray-400">
        {text}
      </td>
    </tr>
  );
}

export function ProductsPageClient({ companyId, basePath = `/companies/${companyId}/inventory/products`, canManage = false }: { companyId: string; basePath?: string; canManage?: boolean }) {
  const [status, setStatus] = useState<InventoryRecordStatus | ''>('ACTIVE');
  const [kind, setKind] = useState<ProductKind | ''>('');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<LoadState<ProductSummary[]>>({ data: null, loading: true, error: null });

  async function load() {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await listProducts(companyId, { status: status || undefined, kind: kind || undefined, search, pageSize: 50 });
      setState({ data: result.items, loading: false, error: null });
    } catch (error) {
      setState({ data: [], loading: false, error: apiErrorMessage(error) });
    }
  }

  useEffect(() => {
    void load();
  }, [companyId, status, kind]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load();
  }

  return (
    <MangmeePage
      title="สินค้าและบริการ / Products & Services"
      description="รายการที่เปิดให้ลูกค้าเห็นจะเป็นฐานข้อมูลให้ CRM AI และหน้าจองของพนักงาน"
      actions={canManage && <Link href={`${basePath}/new`} className={buttonClass}>เพิ่มสินค้า / บริการ</Link>}
    >
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[minmax(16rem,1fr)_12rem_12rem_auto]">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา SKU ชื่อ หรือบาร์โค้ด" aria-label="ค้นหาสินค้า" className={inputClass} />
        <ThemedSelect value={status} onChange={(event) => setStatus(event.target.value as InventoryRecordStatus | '')} className={inputClass}>
          <option value="">ทั้งหมด / All</option>
          <option value="ACTIVE">ใช้งาน / Active</option>
          <option value="ARCHIVED">เก็บถาวร / Archived</option>
        </ThemedSelect>
        <ThemedSelect value={kind} onChange={(event) => setKind(event.target.value as ProductKind | '')} className={inputClass}>
          <option value="">ทุกประเภท</option>
          <option value="STOCKABLE">สินค้าในสต็อก</option>
          <option value="NON_STOCK">สินค้าไม่ตัดสต็อก</option>
          <option value="SERVICE">บริการ</option>
        </ThemedSelect>
        <button type="submit" className={ghostButtonClass} disabled={state.loading}>ค้นหา / Search</button>
      </form>

      {state.error && <ErrorBanner message={state.error} />}
      <MangmeeCard className="overflow-hidden">
        <div className="mangmee-table-scroll">
          <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">SKU</th>
              <th className="px-4 py-3 text-left">ชื่อสินค้า / Name</th>
              <th className="px-4 py-3 text-left">ชนิด / Kind</th>
              <th className="px-4 py-3 text-left">หน่วย / Unit</th>
              <th className="px-4 py-3 text-left">ราคา</th>
              <th className="px-4 py-3 text-left">ลูกค้าเห็น</th>
              <th className="px-4 py-3 text-left">สถานะ / Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {state.loading && <EmptyRow colSpan={8} text="กำลังโหลด..." />}
            {!state.loading && state.data?.length === 0 && <EmptyRow colSpan={8} />}
            {state.data?.map((product) => (
              <tr key={product.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs">{product.sku}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{product.name}</td>
                <td className="px-4 py-3">{product.kind}</td>
                <td className="px-4 py-3">{product.unit}</td>
                <td className="px-4 py-3">{product.salePrice ? `${Number(product.salePrice).toLocaleString('th-TH')} บาท` : '—'}</td>
                <td className="px-4 py-3">{product.customerVisible ? 'เปิด' : 'ปิด'}</td>
                <td className="px-4 py-3"><StatusPill status={product.status} /></td>
                <td className="px-4 py-3 text-right">
                  <Link href={`${basePath}/${product.id}`} className="font-semibold text-brand-600 hover:text-brand-700">เปิด / Open</Link>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </MangmeeCard>
    </MangmeePage>
  );
}

export function ProductCreatePageClient({ companyId, basePath = `/companies/${companyId}/inventory/products`, canManage = false }: { companyId: string; basePath?: string; canManage?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<ProductKind>('STOCKABLE');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const product = await createProduct(companyId, {
        sku: form.get('sku'),
        name: form.get('name'),
        unit: form.get('unit'),
        kind: form.get('kind') as ProductKind,
        description: form.get('description') || undefined,
        category: form.get('category') || undefined,
        reorderPoint: form.get('reorderPoint') || undefined,
        salePrice: form.get('salePrice') || undefined,
        bookingDurationMinutes: form.get('bookingDurationMinutes') ? Number(form.get('bookingDurationMinutes')) : undefined,
        customerVisible: form.get('customerVisible') === 'on',
      });
      router.push(`${basePath}/${product.id}`);
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  if (!canManage) return <ForbiddenState />;

  return (
    <MangmeePage
      title="เพิ่มสินค้า / บริการ"
      description="บันทึกข้อมูลครั้งเดียวเพื่อใช้ร่วมกันในคลังสินค้า หน้าจอง และ CRM AI"
      className="max-w-3xl"
    >
      {error && <ErrorBanner message={error} />}
      <MangmeeCard>
        <form onSubmit={submit} className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="sku" label="SKU *" placeholder="เช่น SKU-001" required />
            <TextField name="name" label="ชื่อสินค้า / Name *" placeholder="ชื่อที่พนักงานและลูกค้าเห็น" required />
          </div>
          <TextareaField name="description" label="รายละเอียด" hint="ข้อมูลนี้ช่วยให้พนักงานและ CRM AI ตอบลูกค้าได้ถูกต้อง" placeholder="รายละเอียดสินค้า หรือบริการ" rows={3} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="unit" label="หน่วย / Unit *" placeholder="เช่น ชิ้น, ครั้ง" required />
            <SelectField name="kind" label="ประเภท *" value={kind} onChange={(event) => setKind(event.target.value as ProductKind)}>
              <option value="STOCKABLE">สินค้าในสต็อก</option>
              <option value="SERVICE">บริการ</option>
              <option value="NON_STOCK">สินค้าไม่ตัดสต็อก</option>
            </SelectField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="category" label="หมวดหมู่ / Category" placeholder="เช่น อาหาร" />
            <TextField name="reorderPoint" label="จุดสั่งซื้อ / Reorder point" placeholder="0" inputMode="decimal" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="salePrice" label="ราคาขาย (บาท)" placeholder="0.00" inputMode="decimal" />
            <SelectField name="bookingDurationMinutes" label="ระยะเวลาจอง" defaultValue="" disabled={kind !== 'SERVICE'} hint={kind !== 'SERVICE' ? 'ใช้ได้เฉพาะประเภทบริการ' : undefined}>
              <option value="">ไม่กำหนดระยะเวลาจอง</option>
              {[60, 90, 120, 150, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} นาที</option>)}
            </SelectField>
          </div>
          <div className="rounded-xl border border-brand-100 bg-brand-25 p-4">
            <SwitchField name="customerVisible" label="เปิดให้ลูกค้าเห็น" hint="CRM AI ใช้ตอบคำถาม และบริการจะแสดงในหน้าจองของพนักงาน" />
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-5">
            <Link href={basePath} className={ghostButtonClass}>ยกเลิก</Link>
            <Button type="submit" loading={loading}>บันทึก / Save</Button>
          </div>
        </form>
      </MangmeeCard>
    </MangmeePage>
  );
}

export function ProductDetailPageClient({
  companyId,
  productId,
  canManage = false,
  canManageLabels = false,
  canReadBalances = false,
  canReadMovements = false,
  catalogMode = false,
}: {
  companyId: string;
  productId: string;
  canManage?: boolean;
  canManageLabels?: boolean;
  canReadBalances?: boolean;
  canReadMovements?: boolean;
  catalogMode?: boolean;
}) {
  const toast = useToast();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [balances, setBalances] = useState<StockBalance[]>([]);
  const [movements, setMovements] = useState<StockMovementSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      if (catalogMode) {
        setProduct(await getProduct(companyId, productId));
        setBalances([]);
        setMovements([]);
        return;
      }
      const [nextProduct, nextBalances, nextMovements] = await Promise.all([
        getProduct(companyId, productId),
        canReadBalances ? getStockBalance(companyId, { productId }) : Promise.resolve([]),
        canReadMovements ? listMovements(companyId, { productId, pageSize: 10 }) : Promise.resolve(null),
      ]);
      setProduct(nextProduct);
      setBalances(nextBalances);
      setMovements(nextMovements?.items ?? []);
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [canReadBalances, canReadMovements, companyId, productId, catalogMode]);

  async function update(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) return;
    setError(null);
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await updateProduct(companyId, product.id, {
        name: form.get('name'),
        unit: form.get('unit'),
        description: form.get('description') || null,
        category: form.get('category') || undefined,
        reorderPoint: form.get('reorderPoint') || undefined,
        salePrice: form.get('salePrice') || null,
        bookingDurationMinutes: form.get('bookingDurationMinutes') ? Number(form.get('bookingDurationMinutes')) : null,
        customerVisible: form.get('customerVisible') === 'on',
      });
      toast.success('บันทึกข้อมูลสินค้าเรียบร้อยแล้ว');
      await load();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function addBarcode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await addProductBarcode(companyId, productId, { type: form.get('type'), value: form.get('value') });
      formElement.reset();
      toast.success('เพิ่มบาร์โค้ดเรียบร้อยแล้ว');
      await load();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function qr() {
    setError(null);
    setBusy(true);
    try {
      await generateProductQr(companyId, productId);
      toast.success('สร้าง QR สินค้าเรียบร้อยแล้ว');
      await load();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main className="p-6"><LoadingState label="กำลังโหลด..." /></main>;
  if (!product) return <main className="p-6">{error ? <ErrorBanner message={error} /> : <span className="text-sm text-gray-500">ไม่พบข้อมูล</span>}</main>;

  return (
    <main className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{product.name}</h1>
          <p className="font-mono text-sm text-gray-500">{product.sku}</p>
        </div>
        <StatusPill status={product.status} />
      </div>
      {error && <ErrorBanner message={error} />}

      {canManage && <form onSubmit={update} className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <input name="name" className={inputClass} defaultValue={product.name} required />
        <input name="unit" className={inputClass} defaultValue={product.unit} required />
        <textarea name="description" className={`${inputClass} sm:col-span-2`} defaultValue={product.description ?? ''} placeholder="รายละเอียดที่พนักงานและ AI ใช้ตอบลูกค้า" rows={3} />
        <input name="category" className={inputClass} defaultValue={product.category ?? ''} placeholder="หมวดหมู่ / Category" />
        <input name="reorderPoint" className={inputClass} defaultValue={product.reorderPoint ?? ''} placeholder="จุดสั่งซื้อ / Reorder point" />
        <input name="salePrice" className={inputClass} defaultValue={product.salePrice ?? ''} placeholder="ราคาขาย (บาท)" inputMode="decimal" />
        <ThemedSelect name="bookingDurationMinutes" className={inputClass} defaultValue={product.bookingDurationMinutes ?? ''} disabled={product.kind !== 'SERVICE'}>
          <option value="">ไม่กำหนดระยะเวลาจอง</option>
          {[60, 90, 120, 150, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} นาที</option>)}
        </ThemedSelect>
        <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
          <input name="customerVisible" type="checkbox" defaultChecked={product.customerVisible} />
          เปิดให้ลูกค้าเห็นและอนุญาตให้ CRM AI ใช้ตอบคำถาม
        </label>
        <button type="submit" className={buttonClass} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก / Save'}</button>
      </form>}
      {!canManage && <dl className="grid gap-4 rounded-lg border border-gray-200 bg-white p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-xs font-medium text-gray-500">หน่วย / Unit</dt><dd className="mt-1 font-medium text-gray-900">{product.unit}</dd></div>
        <div><dt className="text-xs font-medium text-gray-500">หมวดหมู่ / Category</dt><dd className="mt-1 font-medium text-gray-900">{product.category ?? '—'}</dd></div>
        <div><dt className="text-xs font-medium text-gray-500">จุดสั่งซื้อ / Reorder point</dt><dd className="mt-1 font-medium text-gray-900">{product.reorderPoint ?? '—'}</dd></div>
        <div><dt className="text-xs font-medium text-gray-500">ราคาขาย</dt><dd className="mt-1 font-medium text-gray-900">{product.salePrice ? `${Number(product.salePrice).toLocaleString('th-TH')} บาท` : '—'}</dd></div>
        <div><dt className="text-xs font-medium text-gray-500">ระยะเวลาจอง</dt><dd className="mt-1 font-medium text-gray-900">{product.bookingDurationMinutes ? `${product.bookingDurationMinutes} นาที` : '—'}</dd></div>
        <div><dt className="text-xs font-medium text-gray-500">การมองเห็นของลูกค้า</dt><dd className="mt-1 font-medium text-gray-900">{product.customerVisible ? 'เปิด' : 'ปิด'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-xs font-medium text-gray-500">รายละเอียด</dt><dd className="mt-1 whitespace-pre-wrap text-gray-900">{product.description ?? '—'}</dd></div>
      </dl>}

      {!catalogMode && <>
      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">บาร์โค้ดและ QR</h2>
            {canManageLabels && <button type="button" className={ghostButtonClass} disabled={busy} onClick={qr}>{busy ? 'กำลังทำงาน...' : 'สร้าง QR'}</button>}
          </div>
          {canManageLabels && <form onSubmit={addBarcode} className="mb-3 grid gap-2 sm:grid-cols-[140px_1fr_auto]">
            <ThemedSelect name="type" className={inputClass} defaultValue="SUPPLIER">
              <option value="EAN13">EAN13</option>
              <option value="UPC">UPC</option>
              <option value="CODE128">CODE128</option>
              <option value="SUPPLIER">Supplier</option>
              <option value="OTHER">Other</option>
            </ThemedSelect>
            <input name="value" className={inputClass} placeholder="Barcode" required />
            <button className={ghostButtonClass} disabled={busy}>{busy ? 'กำลังเพิ่ม...' : 'เพิ่ม'}</button>
          </form>}
          <ul className="space-y-2 text-sm">
            {product.barcodes.length === 0 && <li className="text-gray-400">ไม่มีข้อมูล</li>}
            {product.barcodes.map((barcode) => <li key={barcode.id} className="font-mono">{barcode.type}: {barcode.value}</li>)}
          </ul>
        </div>

        {canReadBalances && <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-semibold">ยอดตามสถานที่ / Balances</h2>
          <ul className="space-y-2 text-sm">
            {balances.length === 0 && <li className="text-gray-400">ไม่มีข้อมูล</li>}
            {balances.map((balance) => <li key={`${balance.productId}:${balance.locationId}`} className="flex justify-between gap-4"><span className="font-mono">{balance.locationId}</span><strong>{formatQty(balance.quantity)}</strong></li>)}
          </ul>
        </div>}
      </section>

      {canReadMovements && <section className="rounded-lg border border-gray-200 bg-white">
        <h2 className="border-b border-gray-200 px-4 py-3 font-semibold">ความเคลื่อนไหวล่าสุด</h2>
        <MovementTable movements={movements} />
      </section>}
      </>}
    </main>
  );
}

export function LocationsPageClient({ companyId, canManage = false, canManageLabels = false }: { companyId: string; canManage?: boolean; canManageLabels?: boolean }) {
  const toast = useToast();
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await listLocations(companyId, { search, pageSize: 50 });
      setLocations(result.items);
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [companyId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await createLocation(companyId, {
        code: form.get('code'),
        name: form.get('name'),
        type: form.get('type'),
      });
      formElement.reset();
      toast.success('เพิ่มสถานที่จัดเก็บเรียบร้อยแล้ว');
      await load();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function qr(locationId: string) {
    setError(null);
    setBusy(true);
    try {
      await generateLocationQr(companyId, locationId);
      toast.success('สร้าง QR สถานที่จัดเก็บเรียบร้อยแล้ว');
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">สถานที่จัดเก็บ / Inventory Locations</h1>
      {error && <ErrorBanner message={error} />}
      {canManage && <form onSubmit={submit} className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-[1fr_2fr_180px_auto]">
        <input name="code" className={inputClass} placeholder="รหัส / Code" required />
        <input name="name" className={inputClass} placeholder="ชื่อ / Name" required />
        <ThemedSelect name="type" className={inputClass} defaultValue="MAIN">
          {Object.entries(LOCATION_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label.th}</option>)}
        </ThemedSelect>
        <button className={buttonClass} disabled={busy}>{busy ? 'กำลังบันทึก...' : 'เพิ่ม'}</button>
      </form>}
      <form onSubmit={(event) => { event.preventDefault(); void load(); }} className="flex gap-2">
        <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="ค้นหารหัสหรือชื่อ" />
        <button className={ghostButtonClass} disabled={loading}>ค้นหา</button>
      </form>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="mangmee-table-scroll">
          <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
            <tr><th className="px-4 py-3 text-left">รหัส / Code</th><th className="px-4 py-3 text-left">ชื่อ / Name</th><th className="px-4 py-3 text-left">ประเภท / Type</th><th className="px-4 py-3 text-left">สถานะ</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <EmptyRow colSpan={5} text="กำลังโหลด..." />}
            {!loading && locations.length === 0 && <EmptyRow colSpan={5} />}
            {locations.map((location) => (
              <tr key={location.id}>
                <td className="px-4 py-3 font-mono">{location.code}</td>
                <td className="px-4 py-3 font-medium">{location.name}</td>
                <td className="px-4 py-3">{LOCATION_TYPE_LABELS[location.type]?.th ?? location.type}</td>
                <td className="px-4 py-3"><StatusPill status={location.status} /></td>
                <td className="px-4 py-3 text-right">{canManageLabels && <button type="button" className="font-semibold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void qr(location.id)}>{busy ? 'กำลังสร้าง...' : 'QR'}</button>}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

export function MovementsPageClient({ companyId, canCreate = false }: { companyId: string; canCreate?: boolean }) {
  const [movements, setMovements] = useState<StockMovementSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await listMovements(companyId, { pageSize: 50 });
        setMovements(result.items);
      } catch (error) {
        setError(apiErrorMessage(error));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [companyId]);

  return (
    <MangmeePage
      title="ความเคลื่อนไหวสต็อก / Stock Movements"
      description="รายการรับเข้า จ่ายออก โอนย้าย และปรับปรุงสต็อก 50 รายการล่าสุด"
      actions={canCreate && <Link href={`/companies/${companyId}/inventory/movements/new`} className={buttonClass}>บันทึก / New</Link>}
    >
      {error && <ErrorBanner message={error} />}
      <MangmeeCard className="overflow-x-auto">
        <MovementTable movements={movements} loading={loading} />
      </MangmeeCard>
    </MangmeePage>
  );
}

const MOVEMENT_TONE: Record<StockMovementType, MangmeeTone> = {
  STOCK_IN: 'brand',
  STOCK_OUT: 'danger',
  TRANSFER_IN: 'sky',
  TRANSFER_OUT: 'sky',
  COUNT_ADJUSTMENT_IN: 'amber',
  COUNT_ADJUSTMENT_OUT: 'amber',
  ADJUSTMENT_IN: 'amber',
  ADJUSTMENT_OUT: 'amber',
};

function MovementTable({ movements, loading = false }: { movements: StockMovementSummary[]; loading?: boolean }) {
  return (
    <div className="mangmee-table-scroll">
      <table className="mangmee-table">
      <thead>
        <tr>
          <th>เลขที่ / No.</th>
          <th>ประเภท / Type</th>
          <th>สินค้า</th>
          <th>สถานที่</th>
          <th className="text-right">จำนวน</th>
          <th>เวลา</th>
        </tr>
      </thead>
      <tbody>
        {loading && <EmptyRow colSpan={6} text="กำลังโหลด..." />}
        {!loading && movements.length === 0 && <EmptyRow colSpan={6} text="ยังไม่มีความเคลื่อนไหวสต็อก" />}
        {!loading && movements.map((movement) => (
          <tr key={movement.id}>
            <td className="font-mono text-xs text-gray-500">{movement.movementNumber ?? movement.id.slice(0, 8)}</td>
            <td><MangmeeBadge tone={MOVEMENT_TONE[movement.movementType] ?? 'slate'}>{MOVEMENT_TYPE_LABELS[movement.movementType]?.th ?? movement.movementType}</MangmeeBadge></td>
            <td className="font-medium text-gray-900">{movement.productId}</td>
            <td className="text-gray-500">{movement.locationId}</td>
            <td className={cx('text-right font-bold tabular-nums', movement.direction === 'OUT' ? 'text-error-700' : 'text-brand-700')}>
              {movement.direction === 'OUT' ? '−' : '+'}{formatQty(movement.quantity)}
            </td>
            <td className="whitespace-nowrap text-gray-500">{formatThaiDateTime(movement.occurredAt)}</td>
          </tr>
        ))}
      </tbody>
      </table>
    </div>
  );
}

export type MovementAction = 'STOCK_IN' | 'STOCK_OUT' | 'TRANSFER' | 'COUNT' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';

const MODE_LABELS: Record<MovementAction, string> = {
  STOCK_IN: 'รับเข้า',
  STOCK_OUT: 'จ่ายออก',
  TRANSFER: 'โอนย้าย',
  COUNT: 'ตรวจนับ',
  ADJUSTMENT_IN: 'ปรับเพิ่ม',
  ADJUSTMENT_OUT: 'ปรับลด',
};

export function MovementFormPageClient({ companyId, defaultAction = 'STOCK_IN', allowedActions = [] }: { companyId: string; defaultAction?: MovementAction; allowedActions?: readonly MovementAction[] }) {
  const toast = useToast();
  const [action, setAction] = useState<MovementAction>(allowedActions.includes(defaultAction) ? defaultAction : allowedActions[0] ?? defaultAction);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const productId = String(form.get('productId') ?? '');
    const locationId = String(form.get('locationId') ?? '');
    const quantity = String(form.get('quantity') ?? '');
    const reason = String(form.get('reason') ?? '');

    try {
      if (action === 'TRANSFER') {
        await transferStock(companyId, { productId, fromLocationId: locationId, toLocationId: String(form.get('toLocationId') ?? ''), quantity, reason });
      } else if (action === 'COUNT') {
        const movement = await stockCount(companyId, { productId, locationId, countedQuantity: quantity, reason });
        if (!movement) {
          toast.warning('ยอดตรงกับระบบอยู่แล้ว ไม่มีการปรับปรุง');
          formElement.reset();
          return;
        }
      } else {
        await createMovement(companyId, { productId, locationId, movementType: action as StockMovementType, quantity, reason });
      }
      toast.success(`บันทึก${MODE_LABELS[action]}เรียบร้อยแล้ว`);
      formElement.reset();
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const needsReason = action === 'COUNT' || action === 'ADJUSTMENT_IN' || action === 'ADJUSTMENT_OUT';

  if (allowedActions.length === 0) return <ForbiddenState />;

  return (
    <main className="max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">บันทึกสต็อก / Stock Action</h1>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit} className="space-y-4">
        <ThemedSelect value={action} onChange={(event) => setAction(event.target.value as MovementAction)} className={inputClass}>
          {allowedActions.map((value) => <option key={value} value={value}>{MODE_LABELS[value]}</option>)}
        </ThemedSelect>
        <input name="productId" className={inputClass} placeholder="Product ID" required />
        <input name="locationId" className={inputClass} placeholder={action === 'TRANSFER' ? 'From Location ID' : 'Location ID'} required />
        {action === 'TRANSFER' && <input name="toLocationId" className={inputClass} placeholder="To Location ID" required />}
        <input name="quantity" className={inputClass} placeholder={action === 'COUNT' ? 'Counted quantity' : 'Quantity'} inputMode="decimal" required />
        {(needsReason || action === 'TRANSFER') && <textarea name="reason" className={inputClass} rows={3} placeholder="เหตุผล / Reason" required={needsReason} />}
        <button className={buttonClass} disabled={loading}>{loading ? 'กำลังบันทึก...' : 'บันทึก / Save'}</button>
      </form>
    </main>
  );
}

export function ScanPageClient({ companyId }: { companyId: string }) {
  const [payload, setPayload] = useState('');
  const [result, setResult] = useState<{ entityType: string; entityId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await resolveQrScan(companyId, payload.trim()));
    } catch (error) {
      setError(apiErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  const href = result?.entityType === 'PRODUCT'
    ? `/companies/${companyId}/inventory/products/${result.entityId}`
    : `/companies/${companyId}/inventory/locations`;

  return (
    <main className="max-w-2xl p-6">
      <h1 className="mb-6 text-xl font-semibold">สแกน QR / Scan QR</h1>
      {error && <ErrorBanner message={error} />}
      <form onSubmit={submit} className="mb-4 flex gap-2">
        <input value={payload} onChange={(event) => setPayload(event.target.value)} className={`${inputClass} font-mono`} placeholder="WD1:P:... หรือ WD1:LOC:..." required />
        <button className={buttonClass} disabled={loading}>{loading ? '...' : 'ค้นหา'}</button>
      </form>
      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          <p className="font-medium">{result.entityType === 'PRODUCT' ? 'สินค้า / Product' : 'สถานที่ / Location'}</p>
          <p className="mt-1 font-mono text-xs">{result.entityId}</p>
          <Link href={href} className="mt-3 inline-block font-semibold text-brand-700">เปิด / Open</Link>
        </div>
      )}
    </main>
  );
}

export function StockReportPageClient({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<StockBalance[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const report = await getStockReport(companyId);
        setItems(report.items);
      } catch (error) {
        setError(apiErrorMessage(error));
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [companyId]);

  return (
    <main className="space-y-6 p-6">
      <h1 className="text-xl font-semibold">รายงานสต็อก / Stock Report</h1>
      {error && <ErrorBanner message={error} />}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="mangmee-table-scroll">
          <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-500">
            <tr><th className="px-4 py-3 text-left">สินค้า / Product</th><th className="px-4 py-3 text-left">สถานที่ / Location</th><th className="px-4 py-3 text-right">ยอดคงเหลือ / Balance</th><th className="px-4 py-3 text-left">สถานะ</th></tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <EmptyRow colSpan={4} text="กำลังโหลด..." />}
            {!loading && items.length === 0 && <EmptyRow colSpan={4} />}
            {items.map((item) => (
              <tr key={`${item.productId}:${item.locationId}`}>
                <td className="px-4 py-3 font-mono text-xs">{item.productId}</td>
                <td className="px-4 py-3 font-mono text-xs">{item.locationId}</td>
                <td className="px-4 py-3 text-right font-medium">{formatQty(item.quantity)}</td>
                <td className="px-4 py-3">{item.isLowStock ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">ต่ำ / Low</span> : <span className="text-gray-400">-</span>}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
