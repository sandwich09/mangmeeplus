import Link from 'next/link';
import { fetchServerSession } from '@/common/auth/server-session';
import { ForbiddenState } from '@/common/components/state';
import { visibleInventoryTabs, type InventoryTab } from '@/features/inventory/inventory.logic';

export default async function InventoryPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await fetchServerSession(companyId);
  const visibleTabs = visibleInventoryTabs(session?.permissions ?? []);

  const links = ([
    { key: 'products', href: `/companies/${companyId}/inventory/products`, label: 'สินค้า / Products' },
    { key: 'locations', href: `/companies/${companyId}/inventory/locations`, label: 'สถานที่จัดเก็บ / Locations' },
    { key: 'movements', href: `/companies/${companyId}/inventory/movements`, label: 'ความเคลื่อนไหว / Movements' },
    { key: 'stockAction', href: `/companies/${companyId}/inventory/movements/new`, label: 'บันทึกสต็อก / Stock Action' },
    { key: 'stockCount', href: `/companies/${companyId}/inventory/stock-count`, label: 'ตรวจนับ / Stock Count' },
    { key: 'stockReport', href: `/companies/${companyId}/inventory/reports/stock`, label: 'รายงานสต็อก / Stock Report' },
    { key: 'scan', href: `/companies/${companyId}/inventory/scan`, label: 'สแกน QR / Scan' },
  ] satisfies Array<{ key: InventoryTab; href: string; label: string }>).filter((link) => visibleTabs.includes(link.key));

  return (
    <main className="p-6">
      <h1 className="text-2xl font-semibold mb-6">คลังสินค้า / Inventory</h1>
      {links.length === 0 ? (
        <ForbiddenState description="บัญชีของคุณไม่มีสิทธิ์ใช้งานเมนูคลังสินค้า" />
      ) : (
        <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 transition-colors"
            >
              <span className="font-medium text-gray-900">{l.label}</span>
            </Link>
          ))}
        </nav>
      )}
    </main>
  );
}
