/**
 * Source-text guards for the sales console. Every page here is a client component whose behaviour
 * lives behind `useEffect`/`useState`, so nothing in a unit test renders them — these assert the
 * decisions the logic module cannot make on its own and that a reviewer would otherwise have to
 * re-check by eye on every diff.
 *
 * Same shape as `SignupQueuePage.qa.spec.ts`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = [
  'SalesCompaniesPage.tsx', 'SalesConsoleParts.tsx', 'SalesDealFormPage.tsx', 'SalesDealsPage.tsx',
  'SalesEventBatchForm.tsx', 'SalesEventBatchPage.tsx', 'SalesEventsPage.tsx',
  'SalesMyWorkPage.tsx', 'SalesMyProfilePage.tsx', 'SalesProfileEditor.tsx', 'SalesReportsPage.tsx', 'SalesTeamPage.tsx',
  // Sales-event report view of /sales/reports (SD-E).
  'SalesEventReportSection.tsx',
];

const SHELL = join(__dirname, '../../common/components/app-shell/SalesHeader.tsx');

function source(page: string): string {
  return readFileSync(join(__dirname, page), 'utf8');
}

describe('sales console theme and copy', () => {
  // The list does the work, so a new page quietly skipping it would retire the guard rather than
  // fail it — which is exactly how an unthemed screen ships.
  it('scans every page component in the feature', () => {
    const present = readdirSync(__dirname).filter((name) => name.endsWith('.tsx') && !name.includes('.spec.'));
    assert.deepEqual([...PAGES].sort(), present.sort());
  });

  for (const page of [...PAGES, SHELL]) {
    const label = page.endsWith('SalesHeader.tsx') ? 'SalesHeader.tsx' : page;
    const text = page.endsWith('SalesHeader.tsx') ? readFileSync(page, 'utf8') : source(page);

    it(`${label} uses มั่งมี tokens, never a raw colour`, () => {
      // Tokens are redefinable per theme; a literal is not, and one hex here is how a console
      // starts drifting away from the rest of the product. Arbitrary SIZES (`text-[15px]`) are the
      // repo's existing idiom and are left alone — only arbitrary COLOURS are the drift.
      assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, `${label} hardcodes a colour`);
      assert.doesNotMatch(
        text,
        /(?:bg|text|border|ring|fill|stroke|from|via|to)-\[(?:#|rgb|hsl|color)/,
        `${label} uses an arbitrary colour utility`,
      );
    });

    it(`${label} shows no raw API diagnostic`, () => {
      // The screen a เซลล์ reads in front of a shop owner is the last place an English stack
      // message belongs; every catch routes through the reviewed Thai map.
      assert.doesNotMatch(text, /\bcatch\s*\([A-Za-z_$][\w$]*\)\s*\{[^}]*\.message\b/, `${label} displays a caught message`);
    });
  }

  it('the deal form reloads instead of retrying blindly on a version conflict (R3)', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /SALES_DEAL_STATE_CONFLICT/);
    assert.match(text, /โหลดข้อมูลล่าสุด/);
  });

  it('the deal form sends the version it read, so a concurrent edit cannot be overwritten', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /version: deal\.version/);
    assert.match(text, /version: saved\.version/);
  });

  it('approve and reject are rendered only for a holder of sales.deal.approve on a PENDING deal (D2)', () => {
    const text = source('SalesDealFormPage.tsx');
    assert.match(text, /canApprove && deal\.status === 'PENDING_APPROVAL'/);
  });

  it('the หัวหน้า can read team profiles and admin can edit them', () => {
    const text = source('SalesTeamPage.tsx');
    assert.match(text, /<div className="grid gap-4 rounded-xl border[^\n]*>\s*<p[^>]*>ข้อมูลภาษีและบัญชีธนาคาร/);
    assert.match(text, /profile: \{/);
    assert.match(text, /getSalesTeamProfile\(agent\.userId\)/);
    assert.match(text, /\{admin && <button[^\n]*onClick=\{\(\) => setProfileEditing\(true\)\}/);
  });

  it('the one-time password is shown once, with a copy button and no promise it can be fetched again (Q3/S28)', () => {
    const text = source('SalesConsoleParts.tsx');
    assert.match(text, /แสดงครั้งเดียว/);
    assert.match(text, /navigator\.clipboard\?\.writeText\(credential\.temporaryPassword\)/);
    assert.match(text, /ยังไม่ได้ผูก LINE/);
  });

  it('shows the returned temporary password above the team list after create or reset', () => {
    const team = source('SalesTeamPage.tsx');
    assert.match(team, /setCredential\(result\.credential\);[\s\S]{0,300}await load\(\)/);
    assert.match(team, /setCredential\(await \(admin \? resetSalesAgentCredential\(agent\.userId\) : resetSalesTeamCredential\(agent\.userId\)\)\)/);
    assert.ok(team.indexOf('{credential && <SalesCredentialPanel') < team.indexOf('{agents === null'));
  });

  it('reading an agent profile says on screen that the read is recorded (S10)', () => {
    assert.match(source('SalesTeamPage.tsx'), /ระบบบันทึกการเปิดดูข้อมูลนี้ไว้ทุกครั้ง/);
  });

  it('warns from the picked shop before the first save, and from the saved deal after it (S31/Q5)', () => {
    const text = source('SalesDealFormPage.tsx');
    // The server's own numbers win once they exist; the search row is the stand-in that lets a
    // เซลล์ see "เกินลิมิตใหม่" and "สูงกว่าราคาปกติ" while still typing, not after a round trip.
    assert.match(text, /deal\?\.catalogPriceSatang\s*\n?\s*\?\?\s*\(company && months !== null \? company\.catalogMonthlyPriceSatang \* months : null\)/);
    assert.match(text, /company\.branchCount, employeeCount: company\.employeeCount/);
    assert.doesNotMatch(text, /จะแสดงหลังบันทึกฉบับร่าง/, 'the counts are live now — the apology is stale');
  });

  it('the referral repair on the partner page is bounded and reasoned (D6)', () => {
    const text = readFileSync(join(__dirname, '../system-partners/PartnerDetailPage.tsx'), 'utf8');
    // The credit decides a เซลล์'s numbers: it may never be changed silently, nor offered after
    // the window the API enforces.
    assert.match(text, /disabled=\{disabled \|\| !windowOpen\}/);
    assert.match(text, /disabled=\{busy \|\| !reason\.trim\(\) \|\| Boolean\(codeError\)\}/);
    assert.match(text, /salesCode: trimmedCode \|\| null/, 'an empty code must clear the credit, not send ""');
    assert.match(text, /apiErrorMessage\(\{ code: 'SALES_REFERRAL_WINDOW_CLOSED' \}\)/, 'the closed-window sentence must come from the shared map');
  });

  it('company search waits for the minimum length and debounces, because every call is audited (S33)', () => {
    for (const page of ['SalesCompaniesPage.tsx', 'SalesDealFormPage.tsx']) {
      assert.match(source(page), /SALES_COMPANY_SEARCH_MIN_CHARS/, page);
      assert.match(source(page), /setTimeout\(/, page);
    }
  });

  it('creating a deal from a searched shop preserves that exact shop (P2)', () => {
    assert.match(source('SalesCompaniesPage.tsx'), /\/sales\/deals\/new\?companyId=\$\{encodeURIComponent\(company\.companyId\)\}/);
    const form = source('SalesDealFormPage.tsx');
    assert.match(form, /searchSalesCompanies\(preselectedCompanyId\)/);
    assert.match(form, /item\.companyId === preselectedCompanyId/);
  });

  it('the console never renders a shop field the search contract does not carry (Q4/S33)', () => {
    // Revenue, receipts and owner contact are exactly what "ค้นหาได้ทุกร้าน" must not hand out, and
    // a shop object is the only place they could come from — so the guard looks for the property
    // access, not the word, which a comment would also match.
    for (const page of PAGES) {
      assert.doesNotMatch(
        source(page),
        /\b(?:company|item|shop)\.(?:ownerDisplayName|ownerName|contactEmail|phoneNumber|revenue\w*|receipt\w*|taxId)\b/,
        page,
      );
    }
  });

  it('the report never links to a financial document (§B)', () => {
    // A เซลล์ may see what a shop opened with, never its invoices or receipts — so the guard is on
    // the link, not the word, which the module's own comment about the rule would also match.
    assert.doesNotMatch(source('SalesReportsPage.tsx'), /(?:href|<Link)[^\n]*(?:billing|invoice|receipt|document)/i);
  });

  it('a flagged attribution is only cleared or kept with a reason the Owner typed (D6)', () => {
    const text = source('SalesTeamPage.tsx');
    assert.match(text, /disabled=\{busy \|\| !flagReason\.trim\(\)\}/);
    assert.match(text, /reviewSalesAttributionFlag\(flagDecision\.row\.companyId, \{ keep: flagDecision\.keep/);
  });

  it('44px touch targets come from the shared button primitive, not a per-page height', () => {
    for (const page of PAGES) {
      const text = source(page);
      const buttons = [...text.matchAll(/<button\b[^>]*className="([^"]*)"/g)].map((match) => match[1]!);
      for (const className of buttons) {
        assert.ok(
          /mangmee-btn|min-h-1[12]/.test(className),
          `${page}: a button without a 44px-tall primitive: ${className}`,
        );
      }
    }
  });
});
