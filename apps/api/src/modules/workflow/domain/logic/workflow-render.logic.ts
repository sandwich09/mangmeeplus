// Minimal {{field}} substitution against a flat payload — no eval, no expressions.
export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = key.split('.').reduce<unknown>((acc, part) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[part];
    }, payload);
    return value == null ? '' : String(value);
  });
}
