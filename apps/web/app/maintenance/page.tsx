import Link from 'next/link';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';

export const dynamic = 'force-dynamic';

export default function MaintenancePage() {
  return (
    <main
      data-platform-maintenance-page="active"
      className="grid min-h-dvh place-items-center bg-[radial-gradient(circle_at_15%_15%,rgba(134,239,172,.34),transparent_34rem),radial-gradient(circle_at_88%_82%,rgba(252,211,77,.28),transparent_30rem),#f6f8f5] p-4"
    >
      <section className="w-full max-w-xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl shadow-brand-900/10">
        <div className="h-2 bg-linear-to-r from-brand-600 via-brand-400 to-gold-300" />
        <div className="px-6 py-10 text-center sm:px-12 sm:py-14">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-brand-100 bg-brand-50">
            <MangmeeLogo size={46} />
          </div>
          <p className="mt-5 text-lg font-extrabold text-brand-800">มั่ง<span className="text-gold-500">มี</span> · MangmeePlus</p>
          <span className="mt-7 inline-flex rounded-full bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700">
            กำลังเตรียมระบบ
          </span>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-gray-900 sm:text-4xl">ระบบกำลังปรับปรุง</h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-7 text-gray-600">
            บัญชีของคุณเป็นสมาชิก MangmeePlus แต่ขณะนี้ระบบงานยังไม่เปิดให้ใช้งาน
            เราไม่ได้สร้างหรือเก็บ session จากการเข้าสู่ระบบครั้งนี้ กรุณากลับมาใหม่หลังประกาศเปิดระบบ
          </p>
          <div className="mt-7 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            กรุณาอย่าส่งข้อมูล เอกสาร หรือข้อความผ่าน LINE จนกว่าจะประกาศเปิดใช้งาน
          </div>
          <Link
            href="/login"
            className="mt-7 inline-flex rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            กลับหน้าเข้าสู่ระบบ
          </Link>
        </div>
        <footer className="border-t border-gray-100 bg-gray-50 px-6 py-4 text-center text-xs text-gray-500">
          บริษัท มั่งมียั่งยืน จำกัด · <a className="font-semibold text-brand-700" href="mailto:contact@mangmeeplus.com">contact@mangmeeplus.com</a>
        </footer>
      </section>
    </main>
  );
}
