import { Collection, EquivalenceType, LanguageCode } from '../types/dictionary';
import { UI_COPY } from './uiCopy';
import { CONTENT_COPY } from './contentTranslations';
import { LocalizedContentCopy, UiCopy } from './types';

export type { UiCopy, LocalizedContentCopy } from './types';

export function getUiCopy(lang: LanguageCode): UiCopy {
  return UI_COPY[lang] || UI_COPY.en;
}

export function getContentCopy(lang: LanguageCode): LocalizedContentCopy {
  return CONTENT_COPY[lang] || CONTENT_COPY.en;
}

export function formatText(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in vars ? String(vars[key]) : `{${key}}`
  );
}

export function getLangName(code: LanguageCode, uiLang: LanguageCode): string {
  return getContentCopy(uiLang).langNames[code] || code.toUpperCase();
}

export function getLocalizedPos(rawPos: string, uiLang: LanguageCode): string {
  const labels = getContentCopy(uiLang).posLabels;
  const normalized = rawPos.trim().toLowerCase();
  if (normalized === 'noun') return labels.noun;
  if (normalized === 'verb') return labels.verb;
  if (normalized === 'adjective') return labels.adjective;
  if (normalized === 'phrase') return labels.phrase;
  if (normalized === 'greeting') return labels.greeting;
  if (normalized === 'idiomatic noun phrase') return labels.idiomaticNounPhrase;
  if (normalized === 'verb / noun') return labels.verbNoun;
  if (normalized === 'noun / adjective') return labels.nounAdjective;
  return rawPos;
}

export function getLocalizedEquivalence(
  eq: EquivalenceType,
  uiLang: LanguageCode
): string {
  const labels = getContentCopy(uiLang).equivalenceLabels;
  return labels[eq] || eq;
}

export function getLocalizedCollection(
  collection: Collection,
  uiLang: LanguageCode
): { name: string; description: string } {
  const localized = getContentCopy(uiLang).collections[collection.id];
  if (localized && !collection.isCustom) {
    return localized;
  }
  return {
    name: collection.name,
    description: collection.description,
  };
}
