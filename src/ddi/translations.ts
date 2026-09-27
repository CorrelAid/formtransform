/**
 * The form's other languages in the DDI (#135): each text element carries the
 * base language untagged and first (declared by `codeBook/@xml:lang`), then
 * one sibling per other language with `xml:lang`. A language that lacks a
 * text gets no element; nothing is ever filled in from another language.
 */
import type { Translations, Variable, VariableTexts } from './types.js';
import type { XmlElement } from './xml.js';

/** One field of a variable's translations, by language tag. */
export function textsOf(
  v: Variable | undefined,
  field: keyof VariableTexts,
): Translations {
  const out: Translations = {};
  for (const [lang, texts] of Object.entries(v?.translations ?? {})) {
    const text = texts[field];
    if (text) out[lang] = text;
  }
  return out;
}

/**
 * Join texts per language as the base language's parts are joined, from the
 * parts that language has.
 */
export function joinTranslations(
  parts: Array<Translations | undefined>,
  separator: string,
): Translations {
  const joined: Record<string, string[]> = {};
  for (const part of parts) {
    for (const [lang, text] of Object.entries(part ?? {})) {
      (joined[lang] ??= []).push(text);
    }
  }
  return Object.fromEntries(
    Object.entries(joined).map(([lang, texts]) => [
      lang,
      texts.join(separator),
    ]),
  );
}

/** `<tag>` with the base text, then one `xml:lang` sibling per translation. */
export function localizedChild(
  parent: XmlElement,
  tag: string,
  text: string,
  translations: Translations | undefined,
  attrs: Record<string, string> = {},
): void {
  parent.textChild(tag, text, attrs);
  for (const [lang, translated] of Object.entries(translations ?? {})) {
    parent.textChild(tag, translated, { ...attrs, 'xml:lang': lang });
  }
}
