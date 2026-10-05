// A small local renderer for LINE Flex Message JSON, used only to look at the REAL payloads the card
// builders emit before anything is sent to LINE. Plain Node, no dependency.
//
// It follows the official layout rules:
//   https://developers.line.biz/en/docs/messaging-api/flex-message-layout/
//   https://developers.line.biz/en/reference/messaging-api/#flex-message
// - box: horizontal / vertical / baseline; a child's `flex` is `X 0 0` in a horizontal box (default 1)
//   and `X 0 auto` in a vertical box (default 0); `flex: 0` is `0 0 auto`; a box with `width` or
//   `height` takes flex 0.
// - `spacing` is the space between children, `margin` the space before one child (it wins over the
//   spacing and also applies to a first child); padding, offsets and sizes are positive px, % or keywords.
// - `position: absolute` places a component from its parent's edges; it neither sizes the parent nor is
//   sized by it, and what falls outside the parent is not displayed (every box clips).
// - components are drawn in JSON order, the last one on top.
// - linear gradient: 0deg bottom→top, 90deg left→right, clockwise — the CSS angle.
// - text: regular or bold; `wrap`, `maxLines`; `lineSpacing` is added between lines but not above the
//   first or below the last; `adjustMode: shrink-to-fit` shrinks the font to the component's width.
// - image: `size` is the width of the drawing area, `aspectRatio` its shape, `aspectMode` fit | cover.
//
// What the documents do NOT state, and this file therefore ASSUMES (see README.md → "ข้อสมมุติ"):
// - bubble width: `mega` is 300 px, and at most 80 % of the chat width (the documents only say
//   "A bubble's width depends on the size of the device screen");
// - the bubble's own corner radius (17 px) and its white background;
// - a line of text is 1.4 × the font size tall, in the device's own font (here the Mac's system font
//   with Thonburi for Thai, which is what LINE on an iPhone uses);
// - the px value of each keyword. The card builders use px everywhere, so no keyword is needed for them.

const KEYWORD_PX = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const TEXT_PX = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35, '4xl': 48, '5xl': 74 };
const IMAGE_PX = { xxs: 40, xs: 60, sm: 80, md: 100, lg: 120, xl: 140, xxl: 160, '3xl': 180, '4xl': 200, '5xl': 220 };
const BUBBLE_MAX_PX = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 500 };
export const LINE_BOX = 1.4;
export const BUBBLE_SHARE_OF_CHAT = 0.8;

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const len = (value, table = KEYWORD_PX) => value === undefined ? undefined
  : Object.hasOwn(table, value) ? `${table[value]}px` : /^\d+(\.\d+)?(px|%)$/.test(value) ? value : undefined;
const css = (rules) => Object.entries(rules).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}:${v}`).join(';');

export function bubbleWidth(size, chatWidth) {
  return Math.min(BUBBLE_MAX_PX[size ?? 'mega'] ?? 300, Math.floor(chatWidth * BUBBLE_SHARE_OF_CHAT));
}

function flexRule(node, parentLayout) {
  const sized = node.type === 'box' && (parentLayout === 'vertical' ? node.height !== undefined : node.width !== undefined || node.height !== undefined);
  const flex = node.type === 'icon' || sized ? 0 : node.flex ?? (parentLayout === 'vertical' ? 0 : 1);
  if (flex === 0) return '0 0 auto';
  return parentLayout === 'vertical' ? `${flex} 0 auto` : `${flex} 0 0`;
}

function placement(node, parent, index) {
  const horizontal = parent.layout !== 'vertical';
  const absolute = node.position === 'absolute';
  const gap = node.margin !== undefined ? len(node.margin) : index > 0 ? len(parent.spacing ?? 'none') : undefined;
  const offsets = absolute
    ? { top: len(node.offsetTop), bottom: len(node.offsetBottom), left: len(node.offsetStart), right: len(node.offsetEnd) }
    : { top: len(node.offsetTop), bottom: node.offsetTop === undefined ? len(node.offsetBottom) && `-${len(node.offsetBottom)}` : undefined,
      left: len(node.offsetStart), right: node.offsetStart === undefined ? len(node.offsetEnd) && `-${len(node.offsetEnd)}` : undefined };
  return {
    position: absolute ? 'absolute' : 'relative',
    ...(absolute ? {} : { flex: flexRule(node, parent.layout), [horizontal ? 'margin-left' : 'margin-top']: gap, 'min-width': 0 }),
    ...(absolute ? offsets : { top: offsets.top ?? offsets.bottom, left: offsets.left ?? offsets.right }),
  };
}

function background(node) {
  const bg = node.background;
  if (bg?.type === 'linearGradient') {
    const stops = [bg.startColor, ...(bg.centerColor ? [`${bg.centerColor} ${bg.centerPosition ?? '50%'}`] : []), bg.endColor];
    return `linear-gradient(${bg.angle}, ${stops.join(', ')})`;
  }
  return node.backgroundColor;
}

const BORDER_PX = { none: 0, light: 0.5, normal: 1, medium: 2, 'semi-bold': 3, bold: 4 };

function renderBox(node, place) {
  const horizontal = node.layout !== 'vertical';
  const style = css({
    display: 'flex', 'flex-direction': horizontal ? 'row' : 'column', 'box-sizing': 'border-box', overflow: 'hidden',
    ...place,
    width: len(node.width), 'max-width': len(node.maxWidth), height: len(node.height), 'max-height': len(node.maxHeight),
    background: background(node), 'border-radius': len(node.cornerRadius),
    border: node.borderWidth ? `${len(node.borderWidth, BORDER_PX)} solid ${node.borderColor ?? '#000'}` : undefined,
    padding: node.paddingAll !== undefined ? len(node.paddingAll) : undefined,
    'padding-top': len(node.paddingTop), 'padding-bottom': len(node.paddingBottom),
    'padding-left': len(node.paddingStart), 'padding-right': len(node.paddingEnd),
    'justify-content': node.justifyContent, 'align-items': node.layout === 'baseline' ? 'baseline' : node.alignItems,
  });
  const kids = (node.contents ?? []).map((child, index) => renderComponent(child, node, index)).join('');
  return `<div class="bx" style="${style}"${node.action ? ` data-action="${esc(JSON.stringify(node.action))}"` : ''}>${kids}</div>`;
}

function renderText(node, place, parent) {
  const size = parseFloat(len(node.size ?? 'md', TEXT_PX));
  const spacing = node.lineSpacing ? parseFloat(node.lineSpacing) : 0;
  const wrap = node.wrap === true;
  const gravity = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[node.gravity];
  const outer = css({ ...place, 'align-self': parent.layout === 'vertical' ? undefined : gravity, 'overflow': 'hidden' });
  const inner = css({
    margin: spacing ? `${-spacing / 2}px 0` : 0, 'font-size': `${size}px`, 'line-height': `${size * LINE_BOX + spacing}px`,
    'font-weight': node.weight === 'bold' ? 700 : 400, 'font-style': node.style === 'italic' ? 'italic' : undefined,
    'text-decoration': node.decoration && node.decoration !== 'none' ? node.decoration : undefined,
    color: node.color ?? '#111111', 'text-align': { start: 'left', end: 'right', center: 'center' }[node.align ?? 'start'],
    ...(wrap ? { 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' } : { 'white-space': 'nowrap', overflow: 'hidden', 'text-overflow': 'ellipsis' }),
    ...(wrap && node.maxLines ? { display: '-webkit-box', '-webkit-box-orient': 'vertical', '-webkit-line-clamp': node.maxLines, overflow: 'hidden' } : {}),
  });
  const body = node.contents?.length
    ? node.contents.map((span) => `<span style="${css({ color: span.color, 'font-size': span.size && len(span.size, TEXT_PX), 'font-weight': span.weight === 'bold' ? 700 : undefined })}">${esc(span.text)}</span>`).join('')
    : esc(node.text ?? '');
  return `<div class="tx" style="${outer}"><p style="${inner}"${node.adjustMode === 'shrink-to-fit' ? ' data-shrink' : ''}>${body}</p></div>`;
}

function renderImage(node, place, parent) {
  const [w, h] = (node.aspectRatio ?? '1:1').split(':').map(Number);
  const width = node.size === 'full' ? '100%' : len(node.size ?? 'md', IMAGE_PX);
  const align = { start: 'flex-start', end: 'flex-end', center: 'center' }[node.align ?? 'center'];
  const gravity = { top: 'flex-start', center: 'center', bottom: 'flex-end' }[node.gravity ?? 'top'];
  const horizontal = parent.layout !== 'vertical';
  const outer = css({ ...place, display: 'flex', 'justify-content': horizontal ? align : undefined, 'align-items': horizontal ? gravity : align,
    'flex-direction': horizontal ? 'row' : 'column', ...(horizontal && parent.alignItems === undefined ? { 'align-self': gravity } : {}) });
  const inner = css({ width, 'max-width': '100%', 'aspect-ratio': `${w} / ${h}`, 'background-color': node.backgroundColor,
    'background-image': `url('${esc(node.url)}')`, 'background-repeat': 'no-repeat', 'background-position': 'center',
    'background-size': node.aspectMode === 'cover' ? 'cover' : 'contain', flex: 'none' });
  return `<div class="im" style="${outer}"><div style="${inner}" data-image="${esc(node.url)}"></div></div>`;
}

function renderButton(node, place) {
  const style = node.style ?? 'link';
  const height = node.height === 'sm' ? 40 : 52;
  const inner = css({ height: `${height}px`, 'border-radius': '8px', display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'font-size': '16px',
    background: style === 'link' ? undefined : node.color ?? (style === 'primary' ? '#17c950' : '#dcdfe5'),
    color: style === 'primary' ? '#ffffff' : style === 'secondary' ? '#111111' : node.color ?? '#42659a' });
  return `<div class="bt" style="${css(place)}"><div style="${inner}">${esc(node.action?.label ?? '')}</div></div>`;
}

function renderComponent(node, parent, index) {
  const place = placement(node, parent, index);
  if (node.type === 'box') return renderBox(node, place);
  if (node.type === 'text') return renderText(node, place, parent);
  if (node.type === 'image' || node.type === 'icon') return renderImage(node.type === 'icon' ? { ...node, flex: 0 } : node, place, parent);
  if (node.type === 'button') return renderButton(node, place);
  if (node.type === 'separator') {
    const horizontal = parent.layout !== 'vertical';
    const { flex: _flex, ...rest } = place;
    return `<div class="sp" style="${css({ ...rest, flex: 'none', background: node.color ?? '#d4d6da', [horizontal ? 'width' : 'height']: '1px', 'align-self': 'stretch' })}"></div>`;
  }
  if (node.type === 'filler') return `<div style="${css({ flex: `${node.flex ?? 1} 0 0` })}"></div>`;
  throw new Error(`Unsupported Flex component: ${node.type}`);
}

const BLOCK_PADDING = { header: '20px', body: '20px', footer: '10px' };

function renderBubble(bubble, chatWidth) {
  const blocks = ['header', 'hero', 'body', 'footer'].filter((name) => bubble[name]).map((name) => {
    const block = bubble[name];
    if (name === 'hero' && block.type === 'image') return renderImage({ ...block, size: block.size ?? 'full' }, { position: 'relative' }, { layout: 'vertical' });
    const explicit = ['paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd'].some((key) => block[key] !== undefined);
    const withDefault = explicit || name === 'hero' ? block : { ...block, paddingAll: BLOCK_PADDING[name] };
    const style = bubble.styles?.[name];
    return renderBox({ ...withDefault, backgroundColor: withDefault.backgroundColor ?? style?.backgroundColor }, { position: 'relative', flex: name === 'body' ? '1 0 auto' : '0 0 auto' });
  }).join('');
  return `<div class="bubble" data-size="${esc(bubble.size ?? 'mega')}" style="${css({ width: `${bubbleWidth(bubble.size, chatWidth)}px`, 'border-radius': '17px',
    overflow: 'hidden', background: '#ffffff', display: 'flex', 'flex-direction': 'column', flex: 'none' })}">${blocks}</div>`;
}

/** The Flex container as HTML. `chatWidth` is the width of the chat it is shown in. */
export function flexToHtml(contents, chatWidth) {
  if (contents.type === 'carousel') return `<div style="display:flex;gap:8px;align-items:stretch">${contents.contents.map((bubble) => renderBubble(bubble, chatWidth)).join('')}</div>`;
  if (contents.type !== 'bubble') throw new Error(`Unsupported Flex container: ${contents.type}`);
  return renderBubble(contents, chatWidth);
}

/** Styles and the one script the rendering needs: `shrink-to-fit` cannot be said in CSS. */
export const FLEX_PAGE_HEAD = `<style>
  html, body { margin: 0; }
  .bubble { font-family: -apple-system, "Helvetica Neue", Thonburi, sans-serif; -webkit-font-smoothing: antialiased; }
  .bubble p { margin: 0; }
</style>`;
export const FLEX_PAGE_SCRIPT = `<script>
  for (const p of document.querySelectorAll('p[data-shrink]')) {
    let size = parseFloat(getComputedStyle(p).fontSize);
    while (p.scrollWidth > p.clientWidth + 0.5 && size > 6) { size -= 0.5; p.style.fontSize = size + 'px'; p.style.lineHeight = size * 1.4 + 'px'; }
  }
</script>`;
