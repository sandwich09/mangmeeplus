import React from 'react';

// Sidebar icon set matching the มั่งมี prototype (line icons, 24×24, 1.8 stroke,
// round joins). Element data mirrors the prototype's icon map so the app's main
// navigation icons render identically to the design.
type IconEl = [string, Record<string, string | number>];

const ICONS: Record<string, IconEl[]> = {
  info: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 11v6M12 7h.01' }]],
  filter: [['path', { d: 'M4 5h16l-6 7v6l-4 2v-8Z' }]],
  search: [['circle', { cx: 11, cy: 11, r: 7 }], ['path', { d: 'M20 20l-3.8-3.8' }]],
  megaphone: [['path', { d: 'M4 10h4l12-5v14L8 14H4Z' }], ['path', { d: 'M8 14l2 7h4l-2-6' }]],
  grid: [['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }], ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }], ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }]],
  chat: [['path', { d: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z' }], ['path', { d: 'M8 10h8M8 13h5' }]],
  cart: [['circle', { cx: 9, cy: 20, r: 1.4 }], ['circle', { cx: 18, cy: 20, r: 1.4 }], ['path', { d: 'M2 3h2l2.2 12.4a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L21 7H5.5' }]],
  users: [['circle', { cx: 9, cy: 8, r: 3 }], ['path', { d: 'M3 20a6 6 0 0 1 12 0' }], ['path', { d: 'M16 5.5a3 3 0 0 1 0 5.5' }], ['path', { d: 'M17.5 14a6 6 0 0 1 3.5 6' }]],
  calendar: [['rect', { x: 3, y: 4, width: 18, height: 17, rx: 2 }], ['path', { d: 'M3 9h18M8 2v4M16 2v4' }]],
  chart: [['path', { d: 'M4 20V4' }], ['path', { d: 'M4 20h16' }], ['rect', { x: 7, y: 11, width: 3, height: 6 }], ['rect', { x: 12, y: 7, width: 3, height: 10 }], ['rect', { x: 17, y: 13, width: 3, height: 4 }]],
  bell: [['path', { d: 'M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6' }], ['path', { d: 'M10 20a2 2 0 0 0 4 0' }]],
  receipt: [['path', { d: 'M5 3v18l2-1.2L9 21l2-1.2L13 21l2-1.2L17 21l2-1.2V3l-2 1.2L15 3l-2 1.2L11 3 9 4.2 7 3Z' }], ['path', { d: 'M8 8h8M8 12h6' }]],
  swap: [['path', { d: 'M7 4 3 8l4 4' }], ['path', { d: 'M3 8h13' }], ['path', { d: 'M17 20l4-4-4-4' }], ['path', { d: 'M21 16H8' }]],
  doc: [['path', { d: 'M6 2h8l4 4v16H6Z' }], ['path', { d: 'M14 2v4h4' }], ['path', { d: 'M9 12h6M9 16h6' }]],
  lock: [['rect', { x: 4, y: 10, width: 16, height: 11, rx: 2 }], ['path', { d: 'M8 10V7a4 4 0 0 1 8 0v3' }]],
  shield: [['path', { d: 'M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6Z' }], ['path', { d: 'M9 12l2 2 4-4' }]],
  stamp: [['path', { d: 'M12 3a3 3 0 0 0-3 3c0 1.6.8 2.9 1.3 4.2.3.9-.3 1.8-1.3 1.8H7a2 2 0 0 0-2 2v2h14v-2a2 2 0 0 0-2-2h-2c-1 0-1.6-.9-1.3-1.8.5-1.3 1.3-2.6 1.3-4.2a3 3 0 0 0-3-3Z' }], ['path', { d: 'M5 20h14' }]],
  tag: [['path', { d: 'M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9Z' }], ['circle', { cx: 8, cy: 8, r: 1.4 }]],
  money: [['rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }], ['circle', { cx: 12, cy: 12, r: 2.5 }], ['path', { d: 'M6 9v6M18 9v6' }]],
  store: [['path', { d: 'M4 9l1-5h14l1 5' }], ['path', { d: 'M4 9h16v11H4Z' }], ['path', { d: 'M4 9a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0' }], ['path', { d: 'M9 20v-6h6v6' }]],
  user: [['circle', { cx: 12, cy: 8, r: 4 }], ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]],
  plus: [['path', { d: 'M12 5v14M5 12h14' }]],
  box: [['path', { d: 'M12 2 20 6.5v9L12 20 4 15.5v-9Z' }], ['path', { d: 'M4 6.5 12 11l8-4.5M12 11v9' }]],
  bolt: [['path', { d: 'M13 2 4 14h7l-2 8 9-12h-7l2-8Z' }]],
  dots: [['circle', { cx: 5, cy: 12, r: 1 }], ['circle', { cx: 12, cy: 12, r: 1 }], ['circle', { cx: 19, cy: 12, r: 1 }]],
};

function makeIcon(name: string): React.FC<React.SVGProps<SVGSVGElement>> {
  const Icon: React.FC<React.SVGProps<SVGSVGElement>> = (props) =>
    React.createElement(
      'svg',
      { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', ...props },
      ICONS[name].map(([tag, attrs], i) => React.createElement(tag, { key: i, ...attrs })),
    );
  Icon.displayName = `DesignIcon_${name}`;
  return Icon;
}

export const DesignIcons: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = Object.fromEntries(
  Object.keys(ICONS).map((k) => [k, makeIcon(k)]),
);

export const WORKSPACE_ICON_NODES: Record<string, React.ReactNode> = {
  GridIcon: <DesignIcons.grid />,
  ChatIcon: <DesignIcons.chat />,
  CalendarIcon: <DesignIcons.calendar />,
  BellIcon: <DesignIcons.bell />,
  LockIcon: <DesignIcons.lock />,
  PlusIcon: <DesignIcons.plus />,
  UserIcon: <DesignIcons.user />,
  BoxIcon: <DesignIcons.box />,
  DollarLineIcon: <DesignIcons.money />,
  FileIcon: <DesignIcons.receipt />,
  DocsIcon: <DesignIcons.doc />,
  GroupIcon: <DesignIcons.users />,
  PieChartIcon: <DesignIcons.chart />,
  BoltIcon: <DesignIcons.bolt />,
  HorizontalDotsIcon: <DesignIcons.dots />,
  ShoppingCartIcon: <DesignIcons.cart />,
  BankIcon: <DesignIcons.store />,
  SwapIcon: <DesignIcons.swap />,
  ShieldIcon: <DesignIcons.shield />,
  StampIcon: <DesignIcons.stamp />,
  TagIcon: <DesignIcons.tag />,
};
