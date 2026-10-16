import Link from 'next/link';
import type { ReactNode } from 'react';
import { MangmeeLogo } from '@/common/components/brand/MangmeeLogo';
import { LegalBackLink, LegalReadingProgress, LegalToc } from './LegalDocNav';
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_LAST_UPDATED,
  LEGAL_NAV_ITEMS,
  LEGAL_OPERATOR,
  type LegalPageKind,
} from './legal-content';

type TocItem = { id: string; label: string };

/**
 * These pages are read start-to-finish or searched for one clause — never operated.
 * They are therefore set as a document: a title plate, a navigable rail, and a single
 * sheet whose sections are divided by rules. See legal.css for the type system.
 */
export function LegalPageShell({
  active,
  eyebrow,
  title,
  summary,
  toc,
  children,
}: {
  active: LegalPageKind;
  eyebrow: string;
  title: string;
  summary: string;
  toc: ReadonlyArray<TocItem>;
  children: ReactNode;
}) {
  const currentYear = new Date().getFullYear();
  return (
    <div className="doc">
      <header className="doc-mast">
        <div className="doc-mast-inner">
          <span className="doc-mast-lead">
            <LegalBackLink />
            <Link href="/login" className="doc-wordmark">
              <span className="doc-wordmark-glyph" aria-hidden>
                <MangmeeLogo size={19} />
              </span>
              <span className="doc-wordmark-text">
                มั่ง<span style={{ color: 'var(--doc-gold)' }}>มี</span>
              </span>
            </Link>
          </span>
          <nav aria-label="เอกสารทางกฎหมาย" className="doc-switch">
            {LEGAL_NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                aria-current={item.key === active ? 'page' : undefined}
                className="doc-switch-item"
              >
                <span className="doc-switch-label-long">{item.label}</span>
                <span className="doc-switch-label-short">{item.shortLabel}</span>
              </Link>
            ))}
          </nav>
        </div>
        <LegalReadingProgress />
      </header>

      <main className="doc-main">
        <header className="doc-plate">
          <div className="doc-plate-body">
            <p className="doc-eyebrow doc-display">{eyebrow}</p>
            <h1 className="doc-title">{title}</h1>
            <p className="doc-standfirst">{summary}</p>
            {/* The document's own identity, set as a colophon rather than a badge —
                effective date and operator are the facts a reader checks first. */}
            <dl className="doc-colophon">
              <div className="doc-colophon-item">
                <dt className="doc-colophon-label doc-display">มีผลใช้บังคับ</dt>
                <dd className="doc-colophon-value">{LEGAL_EFFECTIVE_DATE}</dd>
              </div>
              <div className="doc-colophon-item">
                <dt className="doc-colophon-label doc-display">ปรับปรุงล่าสุด</dt>
                <dd className="doc-colophon-value">{LEGAL_LAST_UPDATED}</dd>
              </div>
              <div className="doc-colophon-item">
                <dt className="doc-colophon-label doc-display">ผู้ให้บริการ</dt>
                <dd className="doc-colophon-value">{LEGAL_OPERATOR.legalName}</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="doc-columns">
          <aside className="doc-rail">
            <p className="doc-rail-label doc-display">เนื้อหาในหน้านี้</p>
            <LegalToc items={toc} />
            <div className="doc-rail-contact">
              <p className="doc-rail-contact-title doc-display">ติดต่อเรื่องข้อมูลส่วนบุคคล</p>
              {/* Not .doc-source — that appends an "opens externally" mark, which
                  would be a lie on a mailto. */}
              <a className="doc-rail-mail" href={`mailto:${LEGAL_OPERATOR.privacyEmail}`}>
                {LEGAL_OPERATOR.privacyEmail}
              </a>
              <p style={{ margin: '0.625rem 0 0' }}>
                {LEGAL_OPERATOR.legalName}<br />
                เลขทะเบียน {LEGAL_OPERATOR.registrationNumber}<br />
                {LEGAL_OPERATOR.contactAddress}
              </p>
            </div>
          </aside>

          <article className="doc-sheet">{children}</article>
        </div>
      </main>

      <footer className="doc-foot">
        <div className="doc-foot-inner">
          <p style={{ margin: 0 }}>
            © {currentYear} {LEGAL_OPERATOR.legalName} · {LEGAL_OPERATOR.tradeName}
          </p>
          <nav aria-label="เอกสารทางกฎหมาย" className="doc-foot-links">
            {LEGAL_NAV_ITEMS.map((item) => (
              <Link key={item.key} href={item.href}>{item.label}</Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="doc-section">
      <div className="doc-section-head">
        <h2 className="doc-h2">
          {title}
          {/* Legal clauses get cited by URL, so every section needs a reachable
              permalink — hidden until the heading is hovered or the link focused. */}
          <a className="doc-anchor" href={`#${id}`} aria-label={`ลิงก์ไปยังหัวข้อ ${title}`}>§</a>
        </h2>
        {lead ? <p className="doc-lead">{lead}</p> : null}
      </div>
      <div className="doc-prose">{children}</div>
    </section>
  );
}

export function LegalCallout({
  title,
  tone = 'brand',
  children,
}: {
  title: string;
  tone?: 'brand' | 'warning' | 'neutral';
  children: ReactNode;
}) {
  return (
    <aside className={`doc-note doc-note-${tone}`}>
      <p className="doc-note-title">{title}</p>
      <div className="doc-note-body">{children}</div>
    </aside>
  );
}

export function LegalBulletList({ children }: { children: ReactNode }) {
  return <ul className="doc-list">{children}</ul>;
}

export function LegalNumberList({ children }: { children: ReactNode }) {
  return <ol className="doc-olist">{children}</ol>;
}

/** Key/value pairs on hairline rules. This content is a specification — a grid of
 *  tinted boxes said nothing about it and buried the running text it sat between. */
export function LegalDataGrid({ children }: { children: ReactNode }) {
  return <dl className="doc-defs">{children}</dl>;
}

export function LegalDataCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="doc-def">
      <dt className="doc-def-title">{title}</dt>
      <dd className="doc-def-body">{children}</dd>
    </div>
  );
}

export function LegalSourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="doc-source">
      {children}<span className="sr-only"> (เปิดในแท็บใหม่)</span>
    </a>
  );
}

/** Section sub-heading — one step below the section title. */
export function LegalSubheading({ children }: { children: ReactNode }) {
  return <h3 className="doc-h3">{children}</h3>;
}

/** Small print: qualifications and "check the current version" notes. */
export function LegalFootnote({ children }: { children: ReactNode }) {
  return <p className="doc-footnote">{children}</p>;
}

/** Wide content keeps its own scroller so the page body never moves sideways. */
export function LegalTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="doc-table-scroll">
      <table className="doc-table">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
