export const UNSAVED_NAVIGATION_EVENT = 'watchdog:unsaved-navigation';

/** Direct navigations (such as switching shop) use the same guard as ordinary links. */
export function requestInAppNavigation(navigate: () => void): void {
  const event = new CustomEvent(UNSAVED_NAVIGATION_EVENT, { cancelable: true, detail: navigate });
  if (window.dispatchEvent(event)) navigate();
}
