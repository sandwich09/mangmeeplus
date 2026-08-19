import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';

/**
 * INV-11 — "nothing off screen, nothing lost off the edge" (spec section 12.2).
 *
 * Generalises INV-2 from `table, [data-testid=expenses-grid]` to every visible actionable
 * element, and adds the three checks INV-2 does not make:
 *
 *   offscreen  the rect leaves the viewport horizontally and no scroller ancestor can bring
 *              it back. INV-2 already does this, for tables only.
 *   clipped    an ancestor with `overflow-x: clip|hidden` cuts the element off. This is the
 *              one that catches "หายจากจอ": `.mangmee-content` sets `overflow-x: clip`, so a
 *              too-wide child is not merely awkward, it is invisible AND unscrollable.
 *              INV-2 misses this entirely — it only asks whether a scroller exists.
 *   covered    something is painted on top, so the control cannot be tapped. A screenshot
 *              cannot show this; a control under a sticky bar photographs perfectly.
 *   too-small  below the 44px touch target.
 *
 * Why each element is scrolled to the middle before hit-testing: the question is "can the
 * user reach this?", not "is it visible right now". Scrolling to centre keeps a control that
 * is merely below the fold from being reported, while a control on a page too short to
 * scroll stays under its sticky bar and is correctly reported as covered.
 */

export type Inv11Check = 'offscreen' | 'clipped' | 'covered' | 'too-small';

export type Inv11Failure = {
  check: Inv11Check;
  detail: string;
  html: string;
  rect: { x: number; y: number; width: number; height: number };
};

const ACTIONABLE = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  // A label wrapping a file input is the real tap target: the input itself is `sr-only`,
  // which this check skips, so without this the camera button would have no coverage at all.
  'label:has(input[type="file"])',
].join(', ');

/** Documented exceptions to the 44px rule (spec section 12.2). */
const TOUCH_TARGET_EXCEPTIONS = [
  // ThemedDate ships a deliberate 40px day cell; a 7-column calendar cannot hold 44px at 375px.
  '[data-testid="themed-date-day"]',
  // Breadcrumb links are running text. A flex parent blockifies them, so the `display: inline`
  // exemption below misses them, but WCAG 2.5.8's inline reasoning covers them all the same:
  // padding one to 44px would break the trail it lives in.
  '[data-breadcrumb] a',
];

/**
 * `touchTargets` gates the 44px rule. It is a *touch* minimum: enforcing it on a mouse-driven
 * desktop would bury the findings that matter there (offscreen, clipped, covered) under
 * hundreds of legitimately 32px buttons.
 */
export async function collectInv11(page: Page, scope?: Locator, touchTargets = true): Promise<Inv11Failure[]> {
  const root = scope ? await scope.elementHandle() : null;
  type Args = { selector: string; exceptions: string[]; host: Element | null; touchTargets: boolean };
  return page.evaluate<Inv11Failure[], Args>(
    ({ selector, exceptions, host: scopeRoot, touchTargets }) => {
      const host = (scopeRoot ?? document) as unknown as ParentNode;
      const results: Inv11Failure[] = [];
      const seen = new Set<Element>();

      const isRendered = (element: Element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (element.closest('[aria-hidden="true"], [inert], .sr-only')) return false;
        const rect = element.getBoundingClientRect();
        // 1px boxes are the sr-only/file-input idiom, not something a finger aims at.
        if (rect.width <= 1 || rect.height <= 1) return false;

        // A collapsed accordion keeps its children's layout rects: AppSidebar.tsx:348 wraps a
        // closed submenu in `overflow-hidden` at `height: 0px`. Those links are not on screen
        // and reporting them as "covered" was this check's first false positive. Vertical
        // clipping means deliberately collapsed UI; horizontal clipping is the defect we hunt.
        for (let node = element.parentElement; node; node = node.parentElement) {
          const parentStyle = window.getComputedStyle(node);
          if (parentStyle.overflowY !== 'hidden' && parentStyle.overflowY !== 'clip') continue;
          const bounds = node.getBoundingClientRect();
          if (bounds.height < 4 || rect.bottom <= bounds.top + 1 || rect.top >= bounds.bottom - 1) return false;
        }
        return true;
      };

      for (const element of Array.from(host.querySelectorAll(selector))) {
        if (seen.has(element) || !isRendered(element)) continue;
        seen.add(element);

        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        const rect = element.getBoundingClientRect();
        const box = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
        const html = (element.outerHTML ?? '').replace(/\s+/g, ' ').slice(0, 180);
        const push = (check: Inv11Check, detail: string) => results.push({ check, detail, html, rect: box });

        // Walk outward and stop at the FIRST ancestor that decides the element's fate. A
        // scroller reached first means the overflow is reachable by scrolling that container,
        // even though an outer `overflow-x: clip` box also cuts across it — which is exactly
        // the shape of a `.mangmee-table-scroll` table inside `.mangmee-card`. Not stopping
        // was this check's second false positive: it reported every evidence table row as lost.
        let hasScroller = false;
        let clippedBy: string | null = null;
        for (let node = element.parentElement; node; node = node.parentElement) {
          const style = window.getComputedStyle(node);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll') {
            hasScroller = true;
            break;
          }
          if (style.overflowX === 'clip' || style.overflowX === 'hidden') {
            const bounds = node.getBoundingClientRect();
            if (rect.right > bounds.right + 1 || rect.left < bounds.left - 1) {
              clippedBy = `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(/\s+/)[0]}` : ''}`;
              break;
            }
          }
        }

        if (clippedBy) {
          push('clipped', `cut off by ancestor ${clippedBy} with overflow-x clip/hidden — invisible and unscrollable`);
        } else if (!hasScroller && (rect.left < -1 || rect.right > window.innerWidth + 1)) {
          push('offscreen', `rect ${Math.round(rect.left)}..${Math.round(rect.right)} leaves viewport 0..${window.innerWidth} with no scroller ancestor`);
        }

        const centreX = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
        const centreY = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);
        const hit = document.elementFromPoint(centreX, centreY);
        // `next dev` injects <nextjs-portal> for its error overlay and dev indicator. It is
        // not part of the product and only exists because the e2e web server runs in dev mode,
        // so a control "covered" by it is a rig artefact, not a defect.
        const isDevOverlay = hit?.closest('nextjs-portal, #__next-build-watcher') != null;
        if (hit && !isDevOverlay && hit !== element && !element.contains(hit) && !hit.contains(element)) {
          const blocker = `${hit.tagName.toLowerCase()}${hit.className ? `.${String(hit.className).split(/\s+/)[0]}` : ''}`;
          push('covered', `centre point hits ${blocker} instead — control cannot be tapped`);
        }

        // A native checkbox or radio renders ~16px and cannot be meaningfully resized; what the
        // user aims at is the label wrapping it (Field.tsx:155 sizes exactly that way). Measure
        // the label when there is one, and fall back to the input only when there is not.
        const isTickbox = element.matches('input[type="checkbox"], input[type="radio"]');
        const target = isTickbox ? (element.closest('label') ?? element) : element;
        const targetRect = target === element ? rect : target.getBoundingClientRect();

        // WCAG 2.5.8 exempts a target that sits inline in a sentence — a link inside running
        // text cannot be 44px without breaking the paragraph, and the sentence itself is the
        // affordance. Only `display: inline` qualifies; inline-flex/inline-block buttons do not.
        const inlineInProse = window.getComputedStyle(target).display === 'inline';
        // 1px of tolerance: a `min-h-11` element measures 43.x after border-box rounding at
        // some device pixel ratios, and reporting a 44px control as undersized burns review time.
        const MIN = 43;

        const exempt = exceptions.some((pattern) => element.matches(pattern)) || inlineInProse;
        if (touchTargets && !exempt && (targetRect.width < MIN || targetRect.height < MIN)) {
          const what = target === element ? '' : ' (its label)';
          push('too-small', `${Math.round(targetRect.width)}x${Math.round(targetRect.height)}${what} is below the 44x44 touch target`);
        }
      }

      return results;
    },
    { selector: ACTIONABLE, exceptions: TOUCH_TARGET_EXCEPTIONS, host: root, touchTargets } as unknown as Args,
  );
}

/* ── evidence bundle ──────────────────────────────────────────────────────── */

export const EVIDENCE_ROOT = process.env['EVIDENCE_DIR'] ?? join(process.cwd(), 'outputs', 'mobile-evidence');

export type EvidenceRow = {
  device: string;
  width: number;
  subject: string;
  cardsChecked: number;
  controlsChecked: number;
  failures: Inv11Failure[];
  screenshot: string;
  /** Desktop findings are recorded, not enforced (decision D11 — D2 outranks them). */
  desktopFinding: boolean;
  noEvidence?: string;
};

export function evidenceDeviceDir(testInfo: TestInfo): string {
  return join(EVIDENCE_ROOT, testInfo.project.name);
}

export function recordEvidence(testInfo: TestInfo, row: EvidenceRow): void {
  const file = join(evidenceDeviceDir(testInfo), 'results.jsonl');
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

export async function captureEvidence(
  page: Page,
  testInfo: TestInfo,
  subject: string,
  options: { scope?: Locator; cardsChecked?: number; noEvidence?: string } = {},
): Promise<EvidenceRow> {
  const safeName = subject.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'root';
  const screenshot = join(evidenceDeviceDir(testInfo), `${safeName}.png`);
  mkdirSync(dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot, fullPage: true });

  const isDesktop = testInfo.project.name.startsWith('desktop-');
  const failures = options.noEvidence ? [] : await collectInv11(page, options.scope, !isDesktop);
  const controlsChecked = options.noEvidence
    ? 0
    : await (options.scope ?? page.locator('body')).locator(ACTIONABLE).count().catch(() => 0);

  const row: EvidenceRow = {
    device: testInfo.project.name,
    width: page.viewportSize()?.width ?? 0,
    subject,
    cardsChecked: options.cardsChecked ?? 0,
    controlsChecked,
    failures,
    screenshot,
    desktopFinding: isDesktop,
    ...(options.noEvidence ? { noEvidence: options.noEvidence } : {}),
  };
  recordEvidence(testInfo, row);
  return row;
}

export function describeFailures(subject: string, failures: Inv11Failure[]): string {
  return [
    `INV-11 ${subject}: ${failures.length} control(s) unreachable or undersized`,
    ...failures.map((failure) => `  [${failure.check}] ${failure.detail}\n    ${failure.html}`),
  ].join('\n');
}
