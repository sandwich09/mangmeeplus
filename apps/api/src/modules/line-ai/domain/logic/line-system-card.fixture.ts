/**
 * Shared unit fixture for the locked System OA card design (the `*.fixture.ts` precedent): reads a card
 * back out of its Flex JSON the way a person reads the card. Every spec that asserts on one of these
 * cards — the renderer's, each context builder's, the webhook's and the notifier's — reads it through
 * here, so a change to the bubble's structure is made in one place and no spec walks the JSON by hand.
 */
import assert from 'node:assert/strict';

export type ReadLineSystemCard = {
  bubble: any;
  /** The two header lines, top to bottom. */
  header: string[];
  /** The mascot picture's URL. */
  mascot: string;
  banner?: string;
  /** Each row as `[label, ':', value]`. */
  rows: string[][];
  /** The rows drawn on the cream band, by label. */
  totals: string[];
  /** label → [background, text colour] of the rows drawn as a state pill. */
  pills: Record<string, [string, string]>;
  notes: string[];
  prose: string[];
  footnotes: string[];
  actions: Array<{ type: string; label: string; uri?: string; data?: string; text?: string; displayText?: string }>;
  /** Every string a person reads, top to bottom. */
  texts: string[];
};

const texts = (node: any): string[] => node?.type === 'text' ? [node.text] : (node?.contents ?? []).flatMap(texts);

/** One bubble of the design. Throws (through `assert`) when the JSON is not that design's shape. */
export function readLineSystemBubble(bubble: any): ReadLineSystemCard {
  assert.equal(bubble?.type, 'bubble');
  assert.equal(bubble.header, undefined, 'the design has one body block: a header block would clip the mascot');
  assert.equal(bubble.footer, undefined);
  const [top, paper, mascot] = bubble.body.contents;
  assert.equal(bubble.body.contents.length, 3, 'green top, white paper, mascot');
  const sections: any[] = paper.contents;
  const rowBoxes = sections.filter((section) => section.paddingTop === '4px').flatMap((section) => section.contents)
    .filter((entry: any) => entry.contents?.[0]?.layout === 'horizontal');
  const boxed = (colour: string) => sections.filter((section) => section.contents?.[0]?.backgroundColor === colour).map((section) => texts(section).join('\n'));
  const actions: any[] = [];
  const visit = (node: any): void => { if (node?.action) actions.push(node.action); for (const child of node?.contents ?? []) visit(child); };
  visit(paper);
  const banner = sections.find((section) => section.contents?.[0]?.layout === 'horizontal' && section.contents[0].cornerRadius === '9px');
  const cells = (entry: any): any[] => entry.contents[0].contents;
  const pillOf = (entry: any) => cells(entry)[2]?.contents?.[0];
  return {
    bubble,
    header: texts(top.contents[0]),
    mascot: mascot.contents[0].url as string,
    ...(banner ? { banner: texts(banner).join('') } : {}),
    rows: rowBoxes.map((entry: any) => cells(entry).map((cell: any) => texts(cell).join(''))),
    totals: rowBoxes.filter((entry: any) => entry.backgroundColor === '#f3f0df').map((entry: any) => texts(cells(entry)[0]).join('')),
    pills: Object.fromEntries(rowBoxes.filter((entry: any) => pillOf(entry)?.cornerRadius === '5px')
      .map((entry: any) => [texts(cells(entry)[0]).join(''), [pillOf(entry).backgroundColor, pillOf(entry).contents[0].color]])),
    notes: boxed('#f6f5ed'),
    prose: sections.filter((section) => section.paddingStart === '18px' && section.contents?.length && section.contents.every((entry: any) => entry.type === 'text' && entry.color !== '#647366'))
      .map((section) => texts(section).join('\n')),
    footnotes: sections.filter((section) => section.contents?.length === 1 && section.contents[0].type === 'text' && section.contents[0].color === '#647366').map((section) => section.contents[0].text as string),
    actions,
    texts: texts(bubble.body),
  };
}

/** The card of a message: its only bubble, or the first of a carousel. */
export function readLineSystemCard(message: { type: string }): ReadLineSystemCard {
  assert.equal(message.type, 'flex');
  const contents = (message as any).contents;
  return readLineSystemBubble(contents.type === 'carousel' ? contents.contents[0] : contents);
}

/** Is this message a card of the locked design at all? (The cards before it had a header or a footer block.) */
export function isLineSystemCard(message: any): boolean {
  const bubble = message?.contents?.type === 'carousel' ? message.contents.contents?.[0] : message?.contents;
  return message?.type === 'flex' && bubble?.type === 'bubble' && !bubble.header && !bubble.footer
    && /system-card-mascot-/.test(String(bubble.body?.contents?.[2]?.contents?.[0]?.url ?? ''));
}
