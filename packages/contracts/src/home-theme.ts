/** Installed homepage presentations; adding/removing artwork is a code release. */
export const HOME_EVENTS = { default: 'ปกติ', halloween: 'ฮาโลวีน' } as const;
export type HomeEvent = keyof typeof HOME_EVENTS;
export const HOME_THEME_MANAGE_PERMISSION = 'system.home_theme.manage';

export function isHomeEvent(value: unknown): value is HomeEvent {
  return typeof value === 'string' && Object.hasOwn(HOME_EVENTS, value);
}

export function resolveHomeEvent(value: unknown): HomeEvent {
  return isHomeEvent(value) ? value : 'default';
}

export type PublicHomeTheme = { event: HomeEvent };
export type HomeThemeSetting = PublicHomeTheme & { version: number; updatedAt: string | null };
export type SetHomeTheme = { event: HomeEvent; expectedVersion: number };
