import type { SupportedLocale, DictionaryKey } from './workspace-dictionary';
import { workspaceDictionary } from './workspace-dictionary';

export function t(key: DictionaryKey, locale: SupportedLocale): string {
  return workspaceDictionary[locale][key] ?? workspaceDictionary['th'][key] ?? key;
}

export function getDefaultLocale(): SupportedLocale {
  return 'th';
}
