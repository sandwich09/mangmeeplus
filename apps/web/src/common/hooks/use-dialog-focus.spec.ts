import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dialogOpener, restoreDialogFocus } from './use-dialog-focus';

test('BEH-Q closing a dialog restores its connected launcher without scrolling', () => {
  let focused: unknown;
  const button = { isConnected: true, tagName: 'BUTTON', focus: (options: unknown) => { focused = options; } } as HTMLElement;
  assert.equal(dialogOpener(button, null), button);
  restoreDialogFocus(button);
  assert.deepEqual(focused, { preventScroll: true });
  focused = null;
  restoreDialogFocus({ isConnected: false, focus: () => { throw Error('detached'); } } as unknown as HTMLElement);
  assert.equal(focused, null);
});
test('BEH-Q async and touch previews recover the remembered control when focus became body', () => {
  const launcher = { isConnected: true, tagName: 'BUTTON' } as HTMLElement;
  assert.equal(dialogOpener({ isConnected: true, tagName: 'BODY' } as HTMLElement, launcher), launcher);
  assert.equal(dialogOpener(null, launcher), launcher);
  assert.equal(dialogOpener({ isConnected: true, tagName: 'INPUT' } as HTMLElement, launcher), launcher, 'a touch press wins over stale input focus');
  assert.equal(dialogOpener(null, { ...launcher, isConnected: false } as HTMLElement), null);
});
test('BEH-Q shared modal captures its opener before child autofocus, and document previews use it', () => {
  const hook = readFileSync(new URL('./use-dialog-focus.ts', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../components/modal/Modal.tsx', import.meta.url), 'utf8');
  const preview = readFileSync(new URL('../components/document-preview/DocumentPreviewModal.tsx', import.meta.url), 'utf8');
  assert.ok(hook.indexOf('opener.current = dialogOpener') < hook.indexOf('useEffect(() =>'));
  assert.match(modal, /useDialogFocus\(open, dialogRef\)/);
  assert.match(preview, /<Modal\s+open/);
});
