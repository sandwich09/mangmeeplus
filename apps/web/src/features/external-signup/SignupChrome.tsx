import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { SIGNUP_SUPPORT_PHONE } from './signup.logic';

/** Shared top bar for the public signup journey (มั่งมี Brand Kit dark green). */
export function SignupBrandHeader() {
  return (
    <header className="bg-[#143F28] px-4 py-3.5">
      <div className="mx-auto flex w-full max-w-md items-center gap-2.5 sm:max-w-lg">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15">
          <MangmeeLogo size={22} />
        </span>
        <span className="text-lg font-extrabold text-white">
          มั่ง<span className="text-gold-300">มี</span>
        </span>
      </div>
    </header>
  );
}

/** Shown when the public intake flag is off — polite, and pointed at a way in that still works. */
export function SignupClosedNotice() {
  return (
    <div className="space-y-4" role="status">
      <h1 className="text-[22px] font-extrabold leading-9 text-gray-900">ยังไม่เปิดรับสมัครทางออนไลน์</h1>
      <p className="text-[15px] leading-7 text-gray-600">
        ตอนนี้ยังไม่เปิดให้สมัครใช้งานผ่านหน้าเว็บ หากสนใจใช้งานมั่งมีพลัส ติดต่อทีมงานได้เลย
      </p>
      <a
        href={`tel:${SIGNUP_SUPPORT_PHONE.replace(/-/g, '')}`}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-[#046B29] text-[15.5px] font-semibold text-white"
      >
        โทร {SIGNUP_SUPPORT_PHONE}
      </a>
    </div>
  );
}
