'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MangmeeCard, MangmeeIconFrame, MangmeePage } from '@/common/components/mangmee';
import { WORKSPACE_ICON_NODES } from '@/features/web-core-workspace/design-icons';
import type { GuideBlock, GuideSection, UserGuide } from './user-guide.model';

/**
 * คู่มือการใช้งานระบบ
 *
 * หน้านี้เป็นสารบัญและเนื้อหาในตัวเดียวกัน ทุกหัวข้อพับไว้ก่อน ผู้ใช้จึงเห็นภาพรวมทั้งคู่มือได้ในหน้าจอเดียว
 * แล้วค่อยกางเฉพาะหัวข้อที่ต้องการ รูปแบบเดียวกันนี้ใช้ได้ทั้งจอคอมพิวเตอร์และมือถือ จึงไม่ต้องมีสารบัญ
 * แยกอีกชุดให้ผู้ใช้ไล่อ่านซ้ำสองรอบ
 */

function ChevronIcon({ open, className = '' }: { open: boolean; className?: string }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function GuideLinkButton({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand-100 bg-brand-25 px-3.5 py-2 text-xs font-bold text-brand-700 transition-colors hover:bg-brand-50 sm:min-h-9"
    >
      {label}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  if (block.kind === 'items') {
    return (
      <ul className="flex flex-col gap-4">
        {block.items.map((item) => (
          <li key={item.title} className="border-l-2 border-gray-100 pl-3.5">
            <p className="text-sm font-bold text-gray-800">{item.title}</p>
            <p className="mt-1 text-sm leading-7 text-gray-600">{item.detail}</p>
            {item.link && <GuideLinkButton label={item.link.label} href={item.link.href} />}
          </li>
        ))}
      </ul>
    );
  }

  if (block.kind === 'steps') {
    return (
      <ol className="flex flex-col gap-3">
        {block.steps.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-extrabold text-brand-700">
              {index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-gray-800">{step.title}</span>
              <span className="mt-0.5 block text-sm leading-7 text-gray-600">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  if (block.kind === 'table') {
    return (
      <>
        {/*
          มือถือ: แต่ละแถวกลายเป็นการ์ดซ้อนกัน หัวคอลัมน์กลายเป็นป้ายกำกับเหนือค่า
          จึงไม่มีการเลื่อนแนวนอนเลย และข้อความยาวจะตัดขึ้นบรรทัดใหม่ตามความกว้างจอ
        */}
        <ul className="flex flex-col gap-2 sm:hidden">
          {block.rows.map((row) => (
            <li key={row.join('|')} className="rounded-xl border border-gray-200 p-3">
              {row.map((cell, index) => (
                <div key={`${row[0]}-${index}`} className={index === 0 ? '' : 'mt-2'}>
                  <p className="text-[11px] font-bold text-gray-400">{block.headers[index]}</p>
                  <p className={`text-sm leading-6 break-words ${
                    index === 0 ? 'font-bold text-gray-800' : 'text-gray-600'
                  }`}
                  >
                    {cell}
                  </p>
                </div>
              ))}
            </li>
          ))}
        </ul>

        {/* จอตั้งแต่ sm ขึ้นไป: ตารางจริง ไม่กำหนดความกว้างขั้นต่ำ ข้อความจึงตัดบรรทัดแทนการดันจอ */}
        <div className="hidden sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th
                  key={header}
                  scope="col"
                  className="border-b border-gray-200 pb-2 pr-4 text-xs font-bold text-gray-500 last:pr-0"
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.join('|')} className="align-top">
                {row.map((cell, index) => (
                  <td
                    key={`${row[0]}-${index}`}
                    className={`border-b border-gray-100 py-2.5 pr-4 leading-7 break-words last:pr-0 ${
                      index === 0 ? 'font-bold text-gray-800' : 'text-gray-600'
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </>
    );
  }

  if (block.kind === 'note') {
    const warn = block.tone === 'warn';
    return (
      <div
        className={`rounded-xl border p-3.5 ${
          warn ? 'border-warning-100 bg-warning-50' : 'border-brand-100 bg-brand-25'
        }`}
      >
        <p className={`flex items-start gap-2 text-sm font-bold ${warn ? 'text-warning-700' : 'text-brand-700'}`}>
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {warn
              ? <><path d="M12 4.5 2.8 20h18.4L12 4.5Z" /><path d="M12 10v4M12 17.2v.1" /></>
              : <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8v.1" /></>}
          </svg>
          {block.title}
        </p>
        <p className="mt-1 text-sm leading-7 text-gray-700">{block.detail}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {block.items.map((item) => (
        <details key={item.question} className="group rounded-xl border border-gray-200 bg-white px-3.5 py-3">
          <summary className="flex cursor-pointer list-none items-start gap-2 text-sm font-bold text-gray-800 marker:hidden">
            <span className="min-w-0 flex-1">{item.question}</span>
            <ChevronIcon open={false} className="mt-0.5 text-gray-400 group-open:rotate-180" />
          </summary>
          <p className="mt-2 text-sm leading-7 text-gray-600">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

function GuideSectionView({
  section,
  index,
  open,
  onToggle,
}: {
  section: GuideSection;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const bodyId = `${section.id}-body`;
  return (
    // The anchor sits on a wrapper, not on the card: MangmeeCard takes no id, and scroll-mt has to
    // clear the sticky app header when a deep link lands on the section.
    <div id={section.id} className="scroll-mt-24">
      <MangmeeCard>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className={`flex w-full items-center gap-3 p-3.5 text-left sm:gap-4 sm:p-4 ${
            open ? 'border-b border-gray-100' : ''
          }`}
        >
          <MangmeeIconFrame tone={section.tone}>{WORKSPACE_ICON_NODES[section.iconKey]}</MangmeeIconFrame>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-gray-900 sm:text-base">
              {index}. {section.title}
            </span>
            {section.summary && (
              // Collapsed rows keep a short preview so the closed page still reads as a menu; open
              // rows show the full sentence. `block` is dropped while clamping because both
              // utilities set `display` and the clamp needs its own box to win.
              <span className={`mt-0.5 text-xs leading-6 text-gray-500 sm:text-sm ${open ? 'block' : 'line-clamp-2'}`}>
                {section.summary}
              </span>
            )}
          </span>
          <ChevronIcon open={open} className="text-gray-400" />
        </button>
        {open && (
          <div id={bodyId} className="mangmee-card-body flex flex-col gap-4">
            {section.blocks.map((block, blockIndex) => (
              <GuideBlockView key={`${section.id}-${blockIndex}`} block={block} />
            ))}
          </div>
        )}
      </MangmeeCard>
    </div>
  );
}

export function UserGuidePage({ guide }: { guide: UserGuide }) {
  // ทุกหัวข้อพับไว้ตั้งแต่เปิดหน้า ผู้ใช้จึงเห็นสารบัญทั้งคู่มือก่อน แล้วค่อยกางเฉพาะหัวข้อที่ต้องการ
  const [openIds, setOpenIds] = useState<string[]>([]);

  // A link such as .../user-guide/reimbursements#faq must land on an open section, not a closed row.
  useEffect(() => {
    const targetId = window.location.hash.slice(1);
    if (!targetId || !guide.sections.some((section) => section.id === targetId)) return;
    setOpenIds((current) => (current.includes(targetId) ? current : [...current, targetId]));
    document.getElementById(targetId)?.scrollIntoView();
  }, [guide.sections]);

  const allOpen = openIds.length === guide.sections.length;
  const toggleAll = () => setOpenIds(allOpen ? [] : guide.sections.map((section) => section.id));
  const toggleSection = (id: string) =>
    setOpenIds((current) => (current.includes(id) ? current.filter((openId) => openId !== id) : [...current, id]));

  return (
    <MangmeePage
      eyebrow={guide.eyebrow}
      title={guide.title}
      description={guide.description}
      actions={
        guide.primaryLink && (
          <Link
            href={guide.primaryLink.href}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-linear-to-br from-brand-500 to-brand-700 px-4 text-sm font-bold text-white hover:from-brand-600 hover:to-brand-800 sm:min-h-10"
          >
            {guide.primaryLink.label}
            <span aria-hidden="true">→</span>
          </Link>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold text-gray-500">
            คู่มือนี้มี {guide.sections.length} หัวข้อ · เลือกหัวข้อที่ต้องการเพื่อเปิดอ่าน
          </p>
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-600 transition-colors hover:border-brand-100 hover:text-brand-700 sm:min-h-9"
          >
            {allOpen ? 'ย่อทุกหัวข้อ' : 'เปิดอ่านทุกหัวข้อ'}
            <ChevronIcon open={!allOpen} className="text-gray-400" />
          </button>
        </div>

        {guide.sections.map((section, index) => (
          <GuideSectionView
            key={section.id}
            section={section}
            index={index + 1}
            open={openIds.includes(section.id)}
            onToggle={() => toggleSection(section.id)}
          />
        ))}
      </div>
    </MangmeePage>
  );
}
