/**
 * What LINE accepts in a Flex message, checked BEFORE a card of the locked System OA design is drawn.
 *
 * LINE refuses the WHOLE message for one empty text, one label that is too long or one value in the
 * wrong shape — and a refused body is an answer nobody receives. So no context builder calls the
 * renderer directly: each describes its card and asks `drawLineSystemCard`, which returns nothing for
 * a card LINE would refuse (or that would show an empty cell), and the builder's caller then sends the
 * reply the way it was sent before this design.
 *
 * The limits are the Messaging API reference's own
 * (https://developers.line.biz/en/reference/messaging-api/#flex-message): a text component needs text;
 * an action label on anything but a button is at most 40 characters; postback `data`, `displayText`
 * and a message action's `text` are at most 300; a URI is at most 1000 and, here, always https; the
 * JSON of one bubble is at most 30 KB and of a carousel 50 KB.
 */
import { buildLineSystemCardBubble, lineSystemCardAvailable, type LineSystemCard, type LineSystemCardAction } from './line-system-card.logic';

export const LINE_FLEX_ACTION_LABEL_MAX = 40;
export const LINE_FLEX_ACTION_DATA_MAX = 300;
export const LINE_FLEX_URI_MAX = 1000;
export const LINE_FLEX_BUBBLE_MAX_BYTES = 30_000;
export const LINE_FLEX_CAROUSEL_MAX_BYTES = 50_000;
/** Longest line the design has room for outside the prose: a header line, a row label. */
const SHORT_LINE_MAX = 40;
/** A row value, a note, a banner or a footnote: bounded so that no single field can carry the bubble past 30 KB. */
const FIELD_MAX = 600;
/** The prose of one card; the callers' own limit is 1,200. */
const PROSE_MAX = 4_000;
const ROWS_MAX = 20;

const length = (value: string) => Array.from(value).length;
/** Text a person can read: something other than white space, and no character LINE's JSON rejects. */
// eslint-disable-next-line no-control-regex
const readable = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && length(value) <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);

function sendableAction(action: LineSystemCardAction): boolean {
  if (!readable(action.label, LINE_FLEX_ACTION_LABEL_MAX)) return false;
  if (action.type === 'uri') {
    return action.uri.length <= LINE_FLEX_URI_MAX && URL.canParse(action.uri) && new URL(action.uri).protocol === 'https:';
  }
  if (action.type === 'message') return readable(action.text, LINE_FLEX_ACTION_DATA_MAX);
  return action.data.length > 0 && action.data.length <= LINE_FLEX_ACTION_DATA_MAX
    && (action.displayText === undefined || readable(action.displayText, LINE_FLEX_ACTION_DATA_MAX));
}

/** Would LINE accept this card, with every cell of it showing something? */
export function lineSystemCardSendable(card: LineSystemCard): boolean {
  const rows = card.rows ?? [], notes = card.notes ?? [], footnotes = card.footnotes ?? [];
  return card.header.lines.length === 2 && card.header.lines.every((line) => readable(line, SHORT_LINE_MAX))
    && (card.banner === undefined || readable(card.banner.text, FIELD_MAX))
    && rows.length <= ROWS_MAX && rows.every((row) => readable(row.label, SHORT_LINE_MAX) && readable(row.value, FIELD_MAX))
    && notes.every((note) => readable(note, FIELD_MAX)) && footnotes.every((note) => readable(note, FIELD_MAX))
    && (card.text === undefined || !card.text.trim() || readable(card.text, PROSE_MAX))
    // A card must say something under its header.
    && (rows.length > 0 || notes.length > 0 || !!card.text?.trim() || card.banner !== undefined)
    && (card.button === undefined || sendableAction(card.button.action))
    && (card.choice === undefined || card.choice.every(sendableAction));
}

/**
 * The bubble of a card of the locked design, or `undefined` when it cannot be drawn so that LINE
 * accepts it: no https base for the pictures, a cell that would be empty, a label or value past LINE's
 * limits, or a bubble past 30 KB.
 */
export function drawLineSystemCard(card: LineSystemCard, webBaseUrl: string | undefined): Record<string, unknown> | undefined {
  if (!lineSystemCardAvailable(webBaseUrl) || !lineSystemCardSendable(card)) return undefined;
  const bubble = buildLineSystemCardBubble(card, webBaseUrl);
  return Buffer.byteLength(JSON.stringify(bubble), 'utf8') <= LINE_FLEX_BUBBLE_MAX_BYTES ? bubble : undefined;
}

/** Every reason LINE would refuse this Flex `contents`, by what is checked above — empty for a body it
 *  accepts. For the specs: one walk over a finished bubble or carousel, whoever built it. */
export function lineFlexBodyProblems(contents: unknown): string[] {
  const problems: string[] = [];
  const bubbles = (contents as { type?: unknown; contents?: unknown[] })?.type === 'carousel' ? (contents as { contents: unknown[] }).contents : [contents];
  if (bubbles.length === 0 || bubbles.length > 12) problems.push(`carousel of ${bubbles.length} bubbles`);
  if (bubbles.length > 1 && Buffer.byteLength(JSON.stringify(contents), 'utf8') > LINE_FLEX_CAROUSEL_MAX_BYTES) problems.push('carousel over 50 KB');
  const visit = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((child, index) => visit(child, `${path}[${index}]`)); return; }
    if (!node || typeof node !== 'object') return;
    const entry = node as Record<string, unknown>;
    if (entry['type'] === 'text' && !(typeof entry['text'] === 'string' && entry['text'].trim())) problems.push(`${path}: empty text`);
    if (entry['type'] === 'image' && !(typeof entry['url'] === 'string' && entry['url'].length <= 2000 && URL.canParse(entry['url']) && new URL(entry['url']).protocol === 'https:')) problems.push(`${path}: image url`);
    const action = entry['action'] as Record<string, unknown> | undefined;
    if (action) {
      if (action['label'] !== undefined && !(typeof action['label'] === 'string' && action['label'].trim() && length(action['label']) <= LINE_FLEX_ACTION_LABEL_MAX)) problems.push(`${path}: action label`);
      if (action['type'] === 'uri' && !(typeof action['uri'] === 'string' && action['uri'].length <= LINE_FLEX_URI_MAX && /^https:\/\//u.test(action['uri']))) problems.push(`${path}: uri`);
      if (action['type'] === 'postback' && !(typeof action['data'] === 'string' && action['data'].length > 0 && action['data'].length <= LINE_FLEX_ACTION_DATA_MAX)) problems.push(`${path}: postback data`);
      if (action['displayText'] !== undefined && !(typeof action['displayText'] === 'string' && action['displayText'].trim() && action['displayText'].length <= LINE_FLEX_ACTION_DATA_MAX)) problems.push(`${path}: displayText`);
      if (action['type'] === 'message' && !(typeof action['text'] === 'string' && action['text'].trim() && action['text'].length <= LINE_FLEX_ACTION_DATA_MAX)) problems.push(`${path}: message text`);
    }
    // LINE takes only positive sizes: `-4px`, `NaNpx` or an empty value refuses the message.
    for (const [key, value] of Object.entries(entry)) {
      if (/^(?:padding|offset|margin|spacing|width|height|size|lineSpacing|cornerRadius|maxWidth|maxHeight)/u.test(key) && typeof value === 'string'
        && /px$|%$/u.test(value) && !/^\d+(?:\.\d+)?(?:px|%)$/u.test(value)) problems.push(`${path}.${key}: ${value}`);
      if (key !== 'action' && value && typeof value === 'object') visit(value, `${path}.${key}`);
    }
  };
  bubbles.forEach((bubble, index) => {
    if (Buffer.byteLength(JSON.stringify(bubble), 'utf8') > LINE_FLEX_BUBBLE_MAX_BYTES) problems.push(`bubble ${index} over 30 KB`);
    visit(bubble, `bubble${index}`);
  });
  return problems;
}
