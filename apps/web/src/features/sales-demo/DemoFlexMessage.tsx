'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { safeDemoUrl, type DemoAction, type DemoMessage } from './demo-line-chat.logic';

type FlexNode = Partial<Record<
  'spacing' | 'margin' | 'position' | 'offsetTop' | 'offsetBottom' | 'offsetStart' | 'offsetEnd'
  | 'width' | 'maxWidth' | 'height' | 'maxHeight' | 'backgroundColor' | 'cornerRadius' | 'borderWidth' | 'borderColor'
  | 'paddingAll' | 'paddingTop' | 'paddingBottom' | 'paddingStart' | 'paddingEnd' | 'justifyContent' | 'alignItems'
  | 'size' | 'lineSpacing' | 'weight' | 'style' | 'decoration' | 'color' | 'text'
  | 'adjustMode' | 'url' | 'aspectRatio' | 'aspectMode', string>> & {
  type: string; layout?: 'horizontal' | 'vertical' | 'baseline'; gravity?: 'top' | 'center' | 'bottom'; align?: 'start' | 'end' | 'center'; contents?: FlexNode[]; flex?: number; wrap?: boolean; maxLines?: number; action?: DemoAction;
  header?: FlexNode; hero?: FlexNode; body?: FlexNode; footer?: FlexNode;
  styles?: Record<string, { backgroundColor?: string; separator?: boolean; separatorColor?: string }>;
  background?: { type: string; angle: string; startColor: string; endColor: string; centerColor?: string; centerPosition?: string };
};
const SPACE = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 };
const TEXT = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22, xxl: 29, '3xl': 35, '4xl': 48, '5xl': 74 };
const IMAGE = { xxs: 40, xs: 60, sm: 80, md: 100, lg: 120, xl: 140, xxl: 160, '3xl': 180, '4xl': 200, '5xl': 220 };
const BORDER = { none: 0, light: 0.5, normal: 1, medium: 2, 'semi-bold': 3, bold: 4 };
// LINE's bubble widths; the bubble is also capped by the chat column it sits in.
const BUBBLE = { nano: 120, micro: 160, deca: 220, hecto: 241, kilo: 260, mega: 300, giga: 500 };
/** React clears a longhand set to undefined, which also wipes the shorthand before it: drop them. */
function css(style: CSSProperties): CSSProperties {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as CSSProperties;
}
function imageOrigin() {
  return typeof window === 'undefined' || !window.location ? 'https://mangmeeplus.com' : window.location.origin;
}
function length(value: string | undefined, table: Record<string, number> = SPACE) {
  if (value === undefined) return undefined;
  return Object.hasOwn(table, value) ? `${table[value]}px` : /^\d+(\.\d+)?(px|%)$/.test(value) ? value : undefined;
}
function placement(node: FlexNode, parent: FlexNode, index: number): CSSProperties {
  const vertical = parent.layout === 'vertical';
  const absolute = node.position === 'absolute';
  const sized = node.type === 'box' && (vertical ? node.height !== undefined : node.width !== undefined || node.height !== undefined);
  const flex = node.type === 'icon' || sized ? 0 : node.flex ?? (vertical ? 0 : 1);
  const gap = node.margin !== undefined ? length(node.margin) : index > 0 ? length(parent.spacing ?? 'none') : undefined;
  return css({
    position: absolute ? 'absolute' : 'relative',
    ...(absolute ? {} : { flex: flex === 0 ? '0 0 auto' : `${flex} 0 ${vertical ? 'auto' : '0'}`, minWidth: 0, [vertical ? 'marginTop' : 'marginLeft']: gap }),
    top: length(node.offsetTop) ?? (!absolute && length(node.offsetBottom) ? `-${length(node.offsetBottom)}` : undefined),
    left: length(node.offsetStart) ?? (!absolute && length(node.offsetEnd) ? `-${length(node.offsetEnd)}` : undefined),
    bottom: absolute ? length(node.offsetBottom) : undefined,
    right: absolute ? length(node.offsetEnd) : undefined,
  });
}
function known(node: unknown): node is FlexNode {
  if (!node || typeof node !== 'object') return false;
  const item = node as FlexNode;
  if (!['bubble', 'carousel', 'box', 'text', 'span', 'image', 'icon', 'button', 'separator', 'spacer', 'filler'].includes(item.type)) return false;
  return (item.contents === undefined || Array.isArray(item.contents) && item.contents.every(known))
    && [item.header, item.hero, item.body, item.footer].every(block => !block || known(block));
}
function FlexText({ node, place, parent }: { node: FlexNode; place: CSSProperties; parent: FlexNode }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const size = parseFloat(length(node.size ?? 'md', TEXT) ?? '16');
  const spacing = parseFloat(node.lineSpacing ?? '0');
  useEffect(() => {
    if (node.adjustMode !== 'shrink-to-fit' || !ref.current) return;
    const element = ref.current;
    const shrink = () => {
      let current = size;
      element.style.fontSize = `${current}px`;
      while (element.scrollWidth > element.clientWidth + 0.5 && current > 6) {
        current -= 0.5;
        element.style.fontSize = `${current}px`;
      }
      element.style.lineHeight = `${current * 1.4 + spacing}px`;
    };
    shrink();
    const observer = new ResizeObserver(shrink);
    observer.observe(element);
    return () => observer.disconnect();
  }, [node, size, spacing]);
  return <div style={css({ ...place, overflow: 'hidden', alignSelf: parent.layout === 'vertical' ? undefined : (node.gravity ? { top: 'flex-start', center: 'center', bottom: 'flex-end' }[node.gravity] as CSSProperties['alignSelf'] : undefined) })}>
    <p ref={ref} style={css({
      margin: spacing ? `${-spacing / 2}px 0` : 0, fontSize: size, lineHeight: `${size * 1.4 + spacing}px`,
      fontWeight: node.weight === 'bold' ? 700 : 400, fontStyle: node.style === 'italic' ? 'italic' : undefined,
      textDecoration: node.decoration === 'none' ? undefined : node.decoration, color: node.color ?? '#111111',
      textAlign: ({ start: 'left', end: 'right', center: 'center' }[node.align ?? 'start'] as CSSProperties['textAlign']),
      whiteSpace: node.wrap ? 'pre-wrap' : 'nowrap', overflowWrap: node.wrap ? 'anywhere' : undefined,
      overflow: 'hidden', textOverflow: node.wrap ? undefined : 'ellipsis',
      ...(node.wrap && node.maxLines ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: node.maxLines } : {}),
    })}>{node.contents?.length ? node.contents.map((span, index) => <span key={index} style={css({ color: span.color, fontSize: length(span.size, TEXT), fontWeight: span.weight === 'bold' ? 700 : undefined })}>{span.text}</span>) : node.text ?? ''}</p>
  </div>;
}

type RenderProps = { onAction: (action: DemoAction) => void; disabled?: boolean };
function actionDisabled(action: DemoAction | undefined, disabled?: boolean) {
  return disabled && action && ['message', 'postback', 'camera', 'cameraRoll'].includes(action.type);
}
function FlexComponent({ node, parent, index = 0, onAction, disabled }: RenderProps & { node: FlexNode; parent: FlexNode; index?: number }) {
  const place = placement(node, parent, index);
  const actionable = node.action && !actionDisabled(node.action, disabled) ? {
    role: 'button', tabIndex: 0,
    onClick: (event: React.MouseEvent) => { event.stopPropagation(); onAction(node.action!); },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onAction(node.action!); }
    },
  } : {};
  if (node.type === 'box') {
    const gradient = node.background?.type === 'linearGradient' ? node.background : undefined;
    const pad = (side: string | undefined) => length(side ?? node.paddingAll);
    return <div {...actionable} style={css({
      ...place, display: 'flex', flexDirection: node.layout === 'vertical' ? 'column' : 'row', boxSizing: 'border-box', overflow: 'hidden',
      width: length(node.width), maxWidth: length(node.maxWidth), height: length(node.height), maxHeight: length(node.maxHeight),
      background: gradient ? `linear-gradient(${gradient.angle}, ${gradient.startColor}, ${gradient.centerColor ? `${gradient.centerColor} ${gradient.centerPosition ?? '50%'}, ` : ''}${gradient.endColor})` : node.backgroundColor,
      borderRadius: length(node.cornerRadius), border: node.borderWidth ? `${length(node.borderWidth, BORDER)} solid ${node.borderColor ?? '#000'}` : undefined,
      paddingTop: pad(node.paddingTop), paddingBottom: pad(node.paddingBottom),
      paddingLeft: pad(node.paddingStart), paddingRight: pad(node.paddingEnd),
      justifyContent: node.justifyContent, alignItems: node.layout === 'baseline' ? 'baseline' : node.alignItems,
    })}>{node.contents?.map((child, childIndex) => <FlexComponent key={childIndex} node={child} parent={node} index={childIndex} onAction={onAction} disabled={disabled} />)}</div>;
  }
  if (node.type === 'text') return <div {...actionable} style={{ display: 'contents' }}><FlexText node={node} place={place} parent={parent} /></div>;
  if (node.type === 'image' || node.type === 'icon') {
    const url = safeDemoUrl(node.url ?? '', imageOrigin());
    const horizontal = parent.layout !== 'vertical';
    const align = ({ start: 'flex-start', end: 'flex-end', center: 'center' } as const)[node.align ?? 'center'];
    const gravity = ({ top: 'flex-start', center: 'center', bottom: 'flex-end' } as const)[node.gravity ?? 'top'];
    return <div {...actionable} style={css({ ...place, display: 'flex', flexDirection: horizontal ? 'row' : 'column', justifyContent: horizontal ? align : undefined, alignItems: horizontal ? gravity : align, alignSelf: horizontal && !parent.alignItems ? gravity : undefined })}>
      {url ? <img src={url.href} alt="" style={css({ display: 'block', flex: 'none', width: node.size === 'full' ? '100%' : length(node.size ?? 'md', IMAGE), maxWidth: '100%', aspectRatio: (node.aspectRatio ?? '1:1').replace(':', ' / '), objectFit: node.aspectMode === 'cover' ? 'cover' : 'contain', backgroundColor: node.backgroundColor })} /> : null}
    </div>;
  }
  if (node.type === 'button') return <div style={place}><button type="button" disabled={Boolean(actionDisabled(node.action, disabled))} onClick={event => { event.stopPropagation(); if (node.action) onAction(node.action); }}
    className="demo-flex-button"
    style={{ height: node.height === 'sm' ? 40 : 52,
      background: node.style === 'primary' ? node.color ?? '#17c950' : node.style === 'secondary' ? node.color ?? '#dcdfe5' : 'transparent',
      color: node.style === 'primary' ? '#fff' : node.style === 'secondary' ? '#111' : node.color ?? '#42659a',
    }}>{node.action?.label}</button></div>;
  if (node.type === 'separator') return <div style={css({ ...place, flex: 'none', background: node.color ?? '#d4d6da', [parent.layout === 'vertical' ? 'height' : 'width']: 1, alignSelf: 'stretch' })} />;
  if (node.type === 'filler') return <div style={{ flex: `${node.flex ?? 1} 0 0` }} />;
  return <div style={css({ ...place, flex: 'none', [parent.layout === 'vertical' ? 'height' : 'width']: length(node.size ?? 'md') })} />;
}

function FlexBubble({ node, inCarousel, ...props }: RenderProps & { node: FlexNode; inCarousel?: boolean }) {
  const width = BUBBLE[(node.size ?? 'mega') as keyof typeof BUBBLE] ?? BUBBLE.mega;
  // A carousel leaves the next bubble peeking in, as LINE does.
  return <div className="demo-flex-bubble" data-size={node.size ?? 'mega'} style={{ width: `min(${width}px, ${inCarousel ? '85%' : '100%'})` }}>
    {(['header', 'hero', 'body', 'footer'] as const).filter(name => node[name]).map((name, blockIndex) => {
      const block = node[name]!;
      const style = node.styles?.[name];
      const separator = blockIndex > 0 && style?.separator ? <div key={`${name}-separator`} style={{ flex: 'none', height: 1, background: style.separatorColor ?? '#d4d6da' }} /> : null;
      if (name === 'hero' && block.type === 'image') return [separator, <FlexComponent key={name} {...props} node={{ ...block, size: block.size ?? 'full' }} parent={{ type: 'box', layout: 'vertical' }} />];
      const explicit = ['paddingAll', 'paddingTop', 'paddingBottom', 'paddingStart', 'paddingEnd'].some(key => block[key as keyof FlexNode] !== undefined);
      const padding = name === 'footer' ? '10px' : '20px';
      return [separator, <FlexComponent key={name} {...props} node={{ ...block, flex: name === 'body' ? 1 : 0, paddingAll: explicit || name === 'hero' ? block.paddingAll : padding, backgroundColor: block.backgroundColor ?? style?.backgroundColor }} parent={{ type: 'box', layout: 'vertical' }} />];
    })}
  </div>;
}

export function DemoFlexMessage({ message, ...props }: RenderProps & { message: Extract<DemoMessage, { type: 'flex' }> }) {
  if (!known(message.contents) || !['bubble', 'carousel'].includes(message.contents.type)) return <p className="demo-chat-text">{message.canonicalText ?? message.altText}</p>;
  const node = message.contents;
  return <div className="demo-flex-message">{node.type === 'carousel'
    ? <div className="demo-flex-carousel">{node.contents?.map((bubble, index) => <FlexBubble key={index} node={bubble} inCarousel {...props} />)}</div>
    : <FlexBubble node={node} {...props} />}</div>;
}
