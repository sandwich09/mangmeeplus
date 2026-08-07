import type { Metadata } from 'next';

// PDPA privacy notice (M-05 register: docs/security-evidence/p1-ai-processor-lawful-basis-register.md).
// Public and static on purpose: the LINE OA first-contact message and the in-app links point here,
// and a customer reading it is not signed in. Content states only facts verified in the register;
// the unsubscribe keywords below must stay identical to CONSENT_DEFAULTS.unsubscribeKeywords.
export const metadata: Metadata = {
  title: 'นโยบายความเป็นส่วนตัว | WatchDog BMS',
  description: 'นโยบายความเป็นส่วนตัวและการประมวลผลข้อมูลส่วนบุคคล รวมถึงการใช้ระบบ AI',
};

const UPDATED_AT = '28 กรกฎาคม 2569';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="space-y-2 text-sm leading-6 text-gray-700">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">นโยบายความเป็นส่วนตัว</h1>
        <p className="text-sm text-gray-500">
          ประกาศนี้อธิบายว่าธุรกิจที่ให้บริการผ่านระบบ WatchDog BMS (&ldquo;เรา&rdquo;)
          เก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของคุณอย่างไร ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล
          พ.ศ. 2562 (PDPA) — อัปเดตล่าสุด {UPDATED_AT}
        </p>
      </header>

      <Section title="ข้อมูลที่เราประมวลผล และเพื่ออะไร">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="font-medium">การตอบข้อความลูกค้าทาง LINE</span> — ข้อความที่คุณส่งถึงบัญชี LINE
            ของร้าน ข้อมูลการจอง/คำสั่งซื้อของคุณ ใช้เพื่อตอบคำถามและให้บริการตามที่คุณติดต่อเข้ามา
            ข้อความตอบกลับบางส่วนจัดทำโดยระบบ AI
          </li>
          <li>
            <span className="font-medium">ข้อความประชาสัมพันธ์และการแจ้งเตือน</span> — ส่งเมื่อได้รับความยินยอมเท่านั้น
            ยกเลิกได้ตลอดเวลา (ดูหัวข้อ &ldquo;การยกเลิกข่าวสาร&rdquo;)
          </li>
          <li>
            <span className="font-medium">เอกสารบัญชี (ใบเสร็จ/ใบกำกับภาษี/รายการเดินบัญชี)</span> —
            ภาพเอกสารถูกอ่านด้วยระบบ OCR และ AI เพื่อบันทึกบัญชีตามหน้าที่ทางกฎหมายด้านบัญชีและภาษี
            เอกสารเหล่านี้อาจมีชื่อ จำนวนเงิน เลขผู้เสียภาษี หรือเลขบัญชีธนาคารปรากฏอยู่
          </li>
          <li>
            <span className="font-medium">ผู้ช่วย AI สำหรับพนักงาน</span> — พนักงานที่เชื่อมบัญชีกับ LINE
            สามารถสอบถามข้อมูลงานที่ตนมีสิทธิ์เข้าถึงอยู่แล้วผ่านผู้ช่วย AI
            ระบบเก็บเพียงตัวอย่างข้อความแบบย่อและค่าแฮช ไม่เก็บข้อความเต็ม
          </li>
        </ul>
      </Section>

      <Section title="ผู้ประมวลผลข้อมูลที่เราใช้">
        <p>เราใช้ผู้ให้บริการภายนอกเป็นผู้ประมวลผลข้อมูลแทนเรา ได้แก่</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>AWS Bedrock (โมเดล Anthropic Claude) — ประมวลผลข้อความและทำความเข้าใจเอกสาร</li>
          <li>Typhoon OCR — อ่านข้อความจากภาพใบเสร็จ/เอกสาร (ประมวลผลในภูมิภาคเอเชียตะวันออกเฉียงใต้)</li>
          <li>LINE — ช่องทางรับส่งข้อความ</li>
        </ul>
        <p>
          ระบบบันทึกเส้นทางการประมวลผลของแต่ละครั้ง (ผู้ให้บริการ โมเดล ภูมิภาค วัตถุประสงค์)
          ไว้เพื่อการตรวจสอบ
        </p>
      </Section>

      <Section title="การส่งหรือโอนข้อมูลไปต่างประเทศ">
        <p>
          บัญชีผู้ให้บริการคลาวด์ของเราอยู่ในภูมิภาคสิงคโปร์ (ap-southeast-1)
          อย่างไรก็ตาม การประมวลผลด้วยโมเดล AI บางรายการอาจเกิดขึ้นนอกประเทศไทยหรือนอกภูมิภาคดังกล่าว
          ภายใต้มาตรการคุ้มครองตามสัญญาการประมวลผลข้อมูล (DPA) กับผู้ให้บริการ
          และการโอนดังกล่าวได้รับการบันทึกและอนุมัติภายใต้ทะเบียนผู้ประมวลผลของเรา
          ผู้ให้บริการโมเดลไม่นำข้อมูลของคุณไปใช้ฝึกโมเดล
        </p>
      </Section>

      <Section title="ระยะเวลาการเก็บรักษา">
        <ul className="list-disc space-y-1 pl-5">
          <li>ข้อมูลการสนทนากับผู้ช่วย AI: ลบอัตโนมัติภายใน 90 วัน</li>
          <li>
            เอกสารบัญชีและภาษี: เก็บตามระยะเวลาที่กฎหมายบัญชี/สรรพากรกำหนด
            แม้จะมีคำขอลบข้อมูล ส่วนที่กฎหมายบังคับให้เก็บจะยังคงถูกเก็บไว้ตามหน้าที่นั้น
          </li>
        </ul>
      </Section>

      <Section title="การยกเลิกข่าวสาร (ลูกค้า)">
        <p>
          หากไม่ต้องการรับข่าวสารและโปรโมชันทาง LINE พิมพ์ <span className="font-medium">&ldquo;ยกเลิกข่าวสาร&rdquo;</span>{' '}
          <span className="font-medium">&ldquo;หยุดโปร&rdquo;</span> หรือ <span className="font-medium">&ldquo;STOP&rdquo;</span>{' '}
          ในแชทได้ตลอดเวลา — คุณจะยังได้รับข้อความเกี่ยวกับการจองหรือบริการที่ใช้อยู่ตามปกติ
        </p>
      </Section>

      <Section title="การปิดผู้ช่วย AI (พนักงาน)">
        <p>
          พนักงานสามารถปิดการประมวลผลด้วย AI สำหรับบัญชีของตนได้เองที่ เว็บแอป → ตั้งค่า → ความปลอดภัย
          เมื่อปิดแล้ว ข้อความและรูปที่ส่งเข้า LINE จะไม่ถูกประมวลผลด้วย AI
          โดยยังใช้งานเว็บแอปได้ตามปกติ
        </p>
      </Section>

      <Section title="สิทธิของคุณ">
        <p>
          คุณมีสิทธิขอเข้าถึง ขอสำเนา ขอแก้ไข ขอให้ลบข้อมูลส่วนบุคคล คัดค้านหรือถอนความยินยอมการประมวลผล
          ตามที่ PDPA กำหนด โดยติดต่อผ่านช่องทาง LINE ของร้านหรือช่องทางติดต่อของธุรกิจที่คุณใช้บริการ
          คำขอลบข้อมูลจะถูกเปิดเป็นเรื่องติดตามที่มีกำหนดเวลาและผลลัพธ์ตรวจสอบได้
          (ข้อมูลที่กฎหมายบังคับให้เก็บ เช่น เอกสารบัญชี จะได้รับการยกเว้นตามหน้าที่ทางกฎหมาย)
        </p>
      </Section>

      <footer className="border-t border-gray-200 pt-4 text-xs text-gray-400">
        ประกาศนี้อาจได้รับการปรับปรุงเป็นครั้งคราว โดยฉบับล่าสุดจะแสดงที่หน้านี้เสมอ
      </footer>
    </main>
  );
}
