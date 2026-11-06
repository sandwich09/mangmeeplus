import { lineCustomerText } from './line-language.logic';
/**
 * The ONE native Flex presentation of the locked System OA card design
 * (docs/specs/line-system-oa-card-design-lock-spec-th.md, approved preview 2026-10-04).
 *
 * Every colour and size below is the approved preview's own CSS value. A context builder chooses the
 * mascot, the two header lines and what goes on the white paper; it never sets a colour or a size.
 *
 * What LINE decides and this file cannot: the bubble width (`mega`), the bubble's own corner radius,
 * the device font (regular and bold only) and its line height. Sizes here assume a line box of
 * `LINE_BOX` × the font size, so the preview's CSS line heights become padding and `lineSpacing`.
 *
 * Layout: one body block and no header block. The mascot is the LAST child of the body, positioned
 * absolutely, so it is drawn above the green top and the white paper and is clipped by neither.
 * LINE accepts no negative offset, so the paper's rounded top that overlaps the green is its own
 * absolutely positioned box inside the green top, clipped by it.
 */
const FOREST = '#174e37';
const FOREST_END = '#167c52';
const INK = '#233b2f';
const MUTED = '#647366';
const CREAM = '#f3f0df';
const RULE = '#e5e9df';
const PAPER = '#ffffff';
const PILL = { ok: ['#edf3e8', '#356341'], pending: ['#fbf1d8', '#755418'], closed: ['#f5e4de', '#884838'] } as const;
const BANNER = { ok: ['#dceadd', '#255b38'], pending: ['#f5e8c5', '#755418'], scanning: ['#deeee8', '#286857'] } as const;
const SECONDARY = ['#e0e8d8', '#325e44'] as const;

const LINE_BOX = 1.4;
const HEADER_HEIGHT = 80;
const PAPER_OVERLAP = 12;
const PAPER_RADIUS = 18;
const MASCOT_WIDTH = 112;
const MASCOT_HEIGHT = 82;
/** The mascot's box ends this far below the green top, i.e. 16 px below the paper's upper edge. */
const MASCOT_BELOW_HEADER = 4;
/**
 * The preview draws a row with two sets of measures — 18 px sides, a 10 px colon and 7 px gaps on its
 * wide bubble (342 px); 14, 8 and 5 on its narrow one (252 px) — and LINE, not this file, decides how
 * wide a bubble is. Both sets are the same share of the width, so the sides and the colon column are
 * given as that share: the columns then hold as much text as the preview's at either width.
 */
const ROW_SIDE = '5.4%';
/** The gap, the colon and the gap: 24 of 306 px, 18 of 224 px. */
const ROW_COLON = '7.9%';

const px = (value: number) => `${Math.round(value * 100) / 100}px`;
/** Half of what a CSS line height adds around one line of text; LINE draws the line without it. */
const lead = (size: number, lineHeight: number) => size * (lineHeight - LINE_BOX) / 2;

type Flex = Record<string, unknown>;

/**
 * LINE and the CDN cache an image by its URL, so a changed picture needs a new name: bump the date.
 * The three mascots are byte copies of the locked cut-outs; the icons are the preview's line icons.
 */
const ASSET_VERSION = '20261005';
const ASSETS = {
  general: 'mascot-general', review: 'mascot-review', scanning: 'mascot-scanning',
  receipt: 'icon-receipt', list: 'icon-list', file: 'icon-file', clipboard: 'icon-clipboard-light',
  chevron: 'icon-chevron', chevronLight: 'icon-chevron-light',
  checkOk: 'icon-check-ok', checkPending: 'icon-check-pending', scan: 'icon-scan',
} as const;
type Asset = keyof typeof ASSETS;
export type LineSystemCardIcon = 'receipt' | 'list' | 'file' | 'clipboard';

export function lineSystemCardAssetPath(asset: Asset): string {
  return `/assets/line/system-card-${ASSETS[asset]}-${ASSET_VERSION}.png`;
}

/** LINE fetches images over https only. No https web base means no card of this design: the caller
 *  keeps the reply it sent before, the fail-open every card here uses for an unusable URL. */
export function lineSystemCardAvailable(webBaseUrl: string | undefined): webBaseUrl is string {
  if (!webBaseUrl || !URL.canParse(webBaseUrl)) return false;
  return new URL(webBaseUrl).protocol === 'https:';
}

export type LineSystemCardRow = {
  label: string;
  value: string;
  /** The cream row with the large figure. */
  total?: boolean;
  /** The value as a state pill. */
  pill?: keyof typeof PILL;
};

export type LineSystemCardAction =
  | { type: 'uri'; label: string; uri: string }
  | { type: 'postback'; label: string; data: string; displayText?: string }
  | { type: 'message'; label: string; text: string };

export type LineSystemCard = {
  mascot: 'general' | 'review' | 'scanning';
  /** Exactly two lines. By default the first is the small context line and the second the title;
   *  `question` draws both as the title (a question used as the heading), `quiet` in the lighter
   *  style the preview gives a long question. */
  header: { lines: readonly [string, string]; question?: boolean; quiet?: boolean };
  banner?: { tone: keyof typeof BANNER; text: string };
  rows?: readonly LineSystemCardRow[];
  notes?: readonly string[];
  /** Prose on the paper, one paragraph per line; consecutive `•` lines stay together. */
  text?: string;
  /** 14 px for an answer, 13 px for a result or a waiting sentence (the preview's two sizes). */
  textStyle?: 'answer' | 'result' | 'waiting';
  /** Small muted lines under the rows or the prose. */
  footnotes?: readonly string[];
  /** One full-width link button… */
  button?: { action: LineSystemCardAction; icon: LineSystemCardIcon; primary?: boolean };
  /** …or several, one under the other, each named by what it opens (owner 2026-10-05: an answer with
   *  several places to open names every one of them). Drawn only when there is no `button`. */
  buttons?: ReadonlyArray<{ action: LineSystemCardAction; icon: LineSystemCardIcon }>;
  /** …or the two answers to a question, side by side: the first is the dark one. A `button` with a
   *  choice is drawn under it (the claim card's way to the web, owner 2026-11-06). */
  choice?: readonly [LineSystemCardAction, LineSystemCardAction];
};

function text(value: string, size: number, color: string, extra: Flex = {}): Flex {
  return { type: 'text', text: lineCustomerText(value), size: px(size), color, ...extra };
}

function wrapped(value: string, size: number, lineHeight: number, color: string, extra: Flex = {}): Flex {
  return text(value, size, color, { wrap: true, lineSpacing: px(size * (lineHeight - LINE_BOX)), ...extra });
}

function image(webBaseUrl: string, asset: Asset, size: number, extra: Flex = {}): Flex {
  return { type: 'image', url: new URL(lineSystemCardAssetPath(asset), webBaseUrl).toString(), size: px(size), aspectRatio: '1:1', aspectMode: 'fit', flex: 0, ...extra };
}

/** The preview's header is 80 px; two full-size question lines make it 81. */
function headerHeight(card: LineSystemCard): number {
  return card.header.question && !card.header.quiet ? HEADER_HEIGHT + 1 : HEADER_HEIGHT;
}

function top(card: LineSystemCard): Flex {
  const [first, second] = card.header.lines;
  const height = headerHeight(card);
  const fit = { adjustMode: 'shrink-to-fit' };
  const lines = card.header.question
    ? (() => {
      const size = card.header.quiet ? 14 : 15;
      const style = { ...(card.header.quiet ? {} : { weight: 'bold' }), ...fit };
      return { paddingTop: px(14 + lead(size, 1.5)), contents: [text(first, size, PAPER, style), text(second, size, PAPER, { ...style, margin: px(size * (1.5 - LINE_BOX)) })] };
    })()
    : { paddingTop: '14px', contents: [text(first, 11, '#d2e8db', fit), text(second, 15, PAPER, { weight: 'bold', margin: '2px', ...fit })] };
  return {
    type: 'box', layout: 'vertical', height: px(height),
    background: { type: 'linearGradient', angle: '115deg', startColor: FOREST, endColor: FOREST_END },
    contents: [
      { type: 'box', layout: 'vertical', paddingStart: '16px', paddingEnd: px(MASCOT_WIDTH - 16 + 36), ...lines },
      // The paper's rounded top. Twice the radius tall so both corners are whole; the green top shows
      // only its upper 12 px.
      { type: 'box', layout: 'vertical', contents: [], position: 'absolute', offsetTop: px(height - PAPER_OVERLAP), offsetStart: '0px',
        width: '100%', height: px(PAPER_RADIUS * 2), backgroundColor: PAPER, cornerRadius: px(PAPER_RADIUS) },
    ],
  };
}

function mascot(card: LineSystemCard, webBaseUrl: string): Flex {
  return {
    type: 'box', layout: 'vertical', position: 'absolute', width: px(MASCOT_WIDTH), height: px(MASCOT_HEIGHT),
    offsetTop: px(headerHeight(card) + MASCOT_BELOW_HEADER - MASCOT_HEIGHT), offsetEnd: '8px',
    contents: [image(webBaseUrl, card.mascot, MASCOT_WIDTH, { aspectRatio: `${MASCOT_WIDTH}:${MASCOT_HEIGHT}` })],
  };
}

function banner(tone: keyof typeof BANNER, value: string, webBaseUrl: string): Flex {
  const [background, color] = BANNER[tone];
  const icon: Asset = tone === 'scanning' ? 'scan' : tone === 'ok' ? 'checkOk' : 'checkPending';
  return { type: 'box', layout: 'vertical', paddingStart: '16px', paddingEnd: '16px', contents: [{
    type: 'box', layout: 'horizontal', spacing: '7px', alignItems: 'center', backgroundColor: background, cornerRadius: '9px',
    paddingTop: px(10 + lead(13, 1.5)), paddingBottom: px(10 + lead(13, 1.5)), paddingStart: '12px', paddingEnd: '12px',
    contents: [image(webBaseUrl, icon, 16), wrapped(value, 13, 1.5, color, { weight: 'bold', flex: 1 })],
  }] };
}

/** `label : value` with the colon in its own column, so every colon of a card stands in one line. */
export const lineSystemCardRowValue = (value: string): string => value.replace(/[\s·•|]+$/gu, '').trim();

function row(entry: LineSystemCardRow): Flex {
  entry = { ...entry, value: lineSystemCardRowValue(entry.value) };
  const pill = entry.pill ? PILL[entry.pill] : undefined;
  const size = entry.total ? 17 : 13;
  // The label starts where the preview puts it: 3 px lower beside the large figure, and at the top of
  // a pill row, whose own height is the pill's.
  const nudge = entry.total ? { paddingTop: px(3 + lead(13, 1.6) - lead(17, 1.6)) } : pill ? { paddingTop: px(lead(13, 1.6)) } : {};
  const value: Flex = pill
    ? { type: 'box', layout: 'horizontal', flex: 1, contents: [{
      type: 'box', layout: 'vertical', flex: 0, backgroundColor: pill[0], cornerRadius: '5px',
      paddingTop: px(2 + lead(12, 1.6)), paddingBottom: px(2 + lead(12, 1.6)), paddingStart: '7px', paddingEnd: '7px',
      contents: [text(entry.value, 12, pill[1])],
    }] }
    : wrapped(entry.value, size, 1.6, entry.total ? FOREST : INK, { flex: 1, ...(entry.total ? { weight: 'bold' } : {}) });
  const padding = px(pill ? 8 : (entry.total ? 12 : 8) + lead(size, 1.6));
  return {
    type: 'box', layout: 'vertical', paddingStart: ROW_SIDE, paddingEnd: ROW_SIDE, paddingTop: padding, paddingBottom: padding,
    ...(entry.total ? { backgroundColor: CREAM } : {}),
    contents: [{ type: 'box', layout: 'horizontal', contents: [
      { type: 'box', layout: 'vertical', width: '37%', ...nudge, contents: [wrapped(entry.label, 13, 1.6, entry.total ? '#59684f' : MUTED)] },
      { type: 'box', layout: 'vertical', width: ROW_COLON, ...nudge, contents: [text(':', 13, '#89978b', { align: 'center' })] },
      value,
    ] }],
  };
}

function rows(entries: readonly LineSystemCardRow[]): Flex {
  const rule: Flex = { type: 'box', layout: 'vertical', paddingStart: ROW_SIDE, paddingEnd: ROW_SIDE, contents: [{ type: 'separator', color: RULE }] };
  const contents: Flex[] = [];
  entries.forEach((entry, index) => {
    // The cream row has no rule of its own and stands 3 px clear of what is above it.
    if (entry.total) contents.push({ ...row(entry), margin: '3px' });
    else contents.push(row(entry), ...(index < entries.length - 1 ? [rule] : []));
  });
  return { type: 'box', layout: 'vertical', paddingTop: '4px', contents };
}

function note(value: string): Flex {
  return { type: 'box', layout: 'vertical', paddingTop: '5px', paddingStart: '18px', paddingEnd: '18px', contents: [{
    type: 'box', layout: 'vertical', backgroundColor: '#f6f5ed', cornerRadius: '8px',
    paddingTop: px(9 + lead(12, 1.6)), paddingBottom: px(9 + lead(12, 1.6)), paddingStart: '11px', paddingEnd: '11px',
    contents: [wrapped(value, 12, 1.6, '#656e5d')],
  }] };
}

function prose(value: string, style: NonNullable<LineSystemCard['textStyle']>): Flex {
  const waiting = style === 'waiting';
  const size = style === 'answer' ? 14 : 13;
  const lineHeight = waiting ? 1.75 : 1.8;
  const lines = value.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim());
  const bullet = (line: string) => line.trimStart().startsWith('•');
  return {
    type: 'box', layout: 'vertical', paddingStart: '18px', paddingEnd: '18px',
    paddingTop: px((waiting ? 8 : 6) + lead(size, lineHeight)),
    paddingBottom: px((style === 'answer' ? 20 : 18) + lead(size, lineHeight)),
    contents: lines.map((line, index) => wrapped(line, size, lineHeight, waiting ? '#657365' : INK, index === 0 ? {} : {
      // 8 px between paragraphs; lines of one list keep only the line spacing.
      margin: px((bullet(line) && bullet(lines[index - 1]!) ? 0 : 8) + 2 * lead(size, lineHeight)),
    })),
  };
}

function footnote(value: string): Flex {
  return { type: 'box', layout: 'vertical', paddingTop: px(12 + lead(12, 1.7)), paddingBottom: px(lead(12, 1.7)), paddingStart: '18px', paddingEnd: '18px',
    contents: [wrapped(value, 12, 1.7, MUTED)] };
}

function action(entry: LineSystemCardAction): Flex {
  return entry.type === 'uri' ? { type: 'uri', label: entry.label, uri: entry.uri }
    : entry.type === 'message' ? { type: 'message', label: entry.label, text: entry.text }
      : { type: 'postback', label: entry.label, data: entry.data, ...(entry.displayText ? { displayText: entry.displayText } : {}) };
}

/** A LINE button component can carry neither an icon nor these colours, so a button is a box with an
 *  action. The label wraps; one line makes the preview's 46 px. */
function button(entry: LineSystemCardAction, primary: boolean, inner: Flex[], extra: Flex = {}): Flex {
  const padding = px((46 - 14 * LINE_BOX) / 2);
  return { type: 'box', layout: 'horizontal', spacing: '8px', alignItems: 'center', cornerRadius: '10px',
    backgroundColor: primary ? FOREST : SECONDARY[0], paddingTop: padding, paddingBottom: padding, paddingStart: '12px', paddingEnd: '12px',
    action: action(entry), contents: inner, ...extra };
}

function footer(card: LineSystemCard, webBaseUrl: string): Flex | undefined {
  const label = (entry: LineSystemCardAction, primary: boolean, extra: Flex = {}) =>
    wrapped(entry.label, 14, 1.6, primary ? PAPER : SECONDARY[1], { flex: 1, ...extra });
  const link = (entry: NonNullable<LineSystemCard['button']>) => button(entry.action, entry.primary === true, [
    image(webBaseUrl, entry.icon === 'clipboard' ? 'clipboard' : entry.icon, 16),
    label(entry.action, entry.primary === true),
    image(webBaseUrl, entry.primary ? 'chevronLight' : 'chevron', 16),
  ]);
  const contents = card.choice
    ? [{ type: 'box', layout: 'horizontal', spacing: '8px', contents: card.choice.map((entry, index) =>
      button(entry, index === 0, [label(entry, index === 0, { align: 'center' })], { flex: 1 })) },
    ...(card.button ? [link(card.button)] : [])]
    : card.button ? [link(card.button)]
      : card.buttons?.length ? card.buttons.map(link)
        : undefined;
  // Buttons under one another stand 8 px apart, the gap the design has between its two buttons.
  return contents && { type: 'box', layout: 'vertical', paddingTop: '14px', paddingBottom: '16px', paddingStart: '16px', paddingEnd: '16px',
    ...(contents.length > 1 ? { spacing: '8px' } : {}), contents };
}

/** The bubble. `webBaseUrl` must have passed `lineSystemCardAvailable`. */
export function buildLineSystemCardBubble(card: LineSystemCard, webBaseUrl: string): Flex {
  const end = footer(card, webBaseUrl);
  const paper: Flex[] = [
    ...(card.banner ? [banner(card.banner.tone, card.banner.text, webBaseUrl)] : []),
    ...(card.rows?.length ? [rows(card.rows)] : []),
    ...(card.notes ?? []).map(note),
    ...(card.text?.trim() ? [prose(card.text, card.textStyle ?? 'answer')] : []),
    ...(card.footnotes ?? []).map(footnote),
  ];
  if (end) paper.push(end);
  // Prose brings its own lower margin; rows, a note or a footnote that close a card get the same 18 px.
  else if (!card.text?.trim() || card.footnotes?.length) paper.push({ type: 'box', layout: 'vertical', height: '18px', contents: [] });
  return {
    type: 'bubble', size: 'mega',
    body: { type: 'box', layout: 'vertical', paddingAll: '0px', backgroundColor: PAPER, contents: [
      top(card),
      // The paper starts 12 px inside the green top, so 8 px of its 20 px upper padding remain here.
      { type: 'box', layout: 'vertical', paddingTop: px(20 - PAPER_OVERLAP), backgroundColor: PAPER, contents: paper },
      mascot(card, webBaseUrl),
    ] },
  };
}

/** Every string a person reads on the bubble, top to bottom: what a test asserts on, and what the
 *  preview's checks read. */
export function lineSystemCardTexts(bubble: unknown): string[] {
  const found: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== 'object') return;
    const entry = node as Flex;
    if (entry['type'] === 'text' && typeof entry['text'] === 'string') found.push(entry['text']);
    else for (const [key, value] of Object.entries(entry)) if (key !== 'action') visit(value);
  };
  visit(bubble);
  return found;
}
