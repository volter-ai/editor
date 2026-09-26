/**
 * Godot's project TranslationServer and Translation resource over project-owned catalog data.
 * Source: Godot 3.6 core/translation.cpp and Godot 4.7
 * core/string/{translation,translation_domain,translation_server}.cpp.
 */

import {
  GODOT3_LOCALE_DATA,
  GODOT4_LOCALE_DATA,
  type GodotLocaleData,
} from './locale-data';
import { packedStringArray, type PackedStringArray } from './packed-array';
import { registerGodotObjectIdentity } from './object';

export interface GodotTranslationCatalog {
  readonly locale: string;
  readonly messages: Readonly<Record<string, string>>;
  readonly resourcePath: string;
  readonly g3LocaleSelector?: string;
}

export interface GodotTranslationServerConfig {
  readonly major: 3 | 4;
  readonly fallbackLocale: string;
  readonly translations: readonly GodotTranslationCatalog[];
  readonly initialLocale?: string;
}

const EOT = '\u0004';

interface LocaleParts {
  readonly language: string;
  readonly script: string;
  readonly country: string;
  readonly variant: string;
}

function localeData(forMajor: 3 | 4 = major): GodotLocaleData {
  return forMajor === 3 ? GODOT3_LOCALE_DATA : GODOT4_LOCALE_DATA;
}

function localeParts(input: string, addDefaults: boolean, forMajor: 3 | 4 = major): LocaleParts {
  const data = localeData(forMajor);
  const [base = '', extra = ''] = input.replaceAll('-', '_').split('@', 2);
  const parts = base.split('_');
  let language = parts[0] ?? '';
  let script = '';
  let country = '';
  let variant = '';
  const second = parts[1] ?? '';
  const third = parts[2] ?? '';
  const fourth = parts[3] ?? '';
  if (/^[A-Z][a-z]{3}$/.test(second)) script = second;
  if (/^[A-Z]{2}$/.test(second)) country = second;
  if (/^[A-Z]{2}$/.test(third)) {
    country = third;
  } else if (data.variantLanguages[third.toLowerCase()] === language) {
    variant = third.toLowerCase();
  }
  if (data.variantLanguages[fourth.toLowerCase()] === language) variant = fourth.toLowerCase();
  for (const raw of extra.split(';').map((part) => part.toLowerCase())) {
    if (raw === 'cyrillic') { script = 'Cyrl'; break; }
    if (raw === 'latin') { script = 'Latn'; break; }
    if (raw === 'devanagari') { script = 'Deva'; break; }
    if (data.variantLanguages[raw] === language) variant = raw;
  }
  language = data.localeRenames[language] ?? language;
  country = data.countryRenames[country] ?? country;
  if (data.scriptNames[script] === undefined) script = '';
  if (addDefaults) {
    if (script === '') {
      const choice = data.localeScripts.find(
        (entry) => entry.language === language &&
          (country === '' || entry.supportedCountries.includes(country)),
      );
      if (choice !== undefined) script = choice.script;
    }
    if (script !== '' && country === '') {
      country = data.localeScripts.find(
        (entry) => entry.language === language && entry.script === script,
      )?.defaultCountry ?? '';
    }
  }
  return { language, script, country, variant };
}

export function godotStandardizeLocale(locale: string): string {
  return standardizeLocale(String(locale), major);
}

function standardizeLocale(locale: string, forMajor: 3 | 4): string {
  const value = localeParts(locale, forMajor === 3, forMajor);
  return [value.language, value.script, value.country, value.variant].filter(Boolean).join('_');
}

function compareLocales(a: string, b: string): number {
  if (major === 3) {
    const standardizedA = godotStandardizeLocale(a);
    const standardizedB = godotStandardizeLocale(b);
    if (standardizedA === standardizedB) return 10;
    const left = localeParts(standardizedA, true);
    const right = localeParts(standardizedB, true);
    if (left.language !== right.language) return 0;
    const leftElements = standardizedA.split('_').slice(1);
    const rightElements = standardizedB.split('_').slice(1);
    return 1 + leftElements.reduce(
      (count, element) => count + rightElements.filter((other) => other === element).length,
      0,
    );
  }
  if (a === b) return 10;
  const left = localeParts(a, true);
  const right = localeParts(b, true);
  if (left.language === right.language && left.script === right.script &&
      left.country === right.country && left.variant === right.variant) return 10;
  if (left.language !== right.language) return 0;
  let score = 5;
  for (const field of ['script', 'country', 'variant'] as const) {
    if (left[field] !== '' && right[field] !== '') score += left[field] === right[field] ? 1 : -1;
  }
  return score;
}

function hostLocale(): string {
  return typeof navigator === 'undefined' ? 'en' : navigator.language;
}

export class GodotTranslation {
  readonly __godotClass = 'Translation';
  #locale = 'en';
  readonly messageMap = new Map<string, string>();
  readonly pluralMessageMap = new Map<string, readonly string[]>();
  #pluralRulesOverride = '';

  constructor(readonly major: 3 | 4) {
    registerGodotObjectIdentity(this, 'Translation');
  }

  get locale(): string { return this.#locale; }
  set locale(value: string) { this.#locale = standardizeLocale(String(value), this.major); }

  get messages(): PackedStringArray {
    if (this.major !== 3) throw new Error('Godot 4 Translation.messages requires Dictionary storage');
    return packedStringArray(
      [...this.messageMap]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .flatMap(([source, translated]) => [source, translated]),
    );
  }
  set messages(value: readonly string[]) {
    if (this.major !== 3) throw new Error('Godot 4 Translation.messages requires Dictionary storage');
    if (!Array.isArray(value) || value.length % 2 !== 0) {
      throw new Error('Translation.messages requires alternating source/translated strings');
    }
    for (let index = 0; index < value.length; index += 2) {
      this.add_message(String(value[index]), String(value[index + 1]));
    }
  }

  add_message(source: string, translated: string, context = ''): void {
    if (this.major === 3 && context !== '') {
      throw new Error('Godot 3 Translation.add_message accepts source and translated only');
    }
    this.messageMap.set(context === '' ? String(source) : `${context}${EOT}${source}`, String(translated));
  }

  _get_message(source: string, context = ''): string {
    return this.get_message(source, context);
  }

  _get_plural_message(source: string, sourcePlural: string, count: number, context = ''): string {
    return this.get_plural_message(source, sourcePlural, count, context);
  }

  set_locale(value: string): void { this.locale = value; }
  get_locale(): string { return this.locale; }

  add_plural_message(source: string, translatedMessages: readonly string[], context = ''): void {
    if (!Array.isArray(translatedMessages) || translatedMessages.some((message) => typeof message !== 'string')) {
      throw new TypeError('Translation.add_plural_message requires PackedStringArray.');
    }
    const key = context === '' ? String(source) : `${context}${EOT}${source}`;
    this.pluralMessageMap.set(key, [...translatedMessages]);
  }

  get_message(source: string, context = ''): string {
    const key = context === '' ? String(source) : `${context}${EOT}${source}`;
    return this.messageMap.get(key) ?? '';
  }

  get_plural_message(source: string, sourcePlural: string, count: number, context = ''): string {
    if (!Number.isSafeInteger(count)) throw new TypeError('Translation.get_plural_message count requires integer.');
    const key = context === '' ? String(source) : `${context}${EOT}${source}`;
    const translated = this.pluralMessageMap.get(key);
    if (translated === undefined || translated.length === 0) return this.get_message(count === 1 ? source : sourcePlural, context);
    const index = this.pluralIndex(count, translated.length);
    return translated[Math.min(index, translated.length - 1)] ?? '';
  }

  erase_message(source: string, context = ''): void {
    const key = context === '' ? String(source) : `${context}${EOT}${source}`;
    this.messageMap.delete(key);
    this.pluralMessageMap.delete(key);
  }

  get_message_list(): PackedStringArray {
    return packedStringArray(new Set([...this.messageMap.keys(), ...this.pluralMessageMap.keys()]));
  }

  get_translated_message_list(): PackedStringArray {
    const messages = [...this.messageMap.values()];
    for (const translations of this.pluralMessageMap.values()) messages.push(...translations);
    return packedStringArray(messages);
  }

  get_message_count(): number {
    return new Set([...this.messageMap.keys(), ...this.pluralMessageMap.keys()]).size;
  }

  set_plural_rules_override(rules: string): void { this.#pluralRulesOverride = String(rules); }
  get_plural_rules_override(): string { return this.#pluralRulesOverride; }

  private pluralIndex(count: number, available: number): number {
    if (available <= 1) return 0;
    if (this.#pluralRulesOverride !== '') {
      const forms = this.#pluralRulesOverride.split(';').filter(Boolean);
      const exact = forms.findIndex((form) => form.trim() === `n=${count}`);
      if (exact >= 0) return exact;
    }
    try {
      const rule = new Intl.PluralRules(this.#locale).select(count);
      const order = ['one', 'two', 'few', 'many', 'other'];
      const index = order.indexOf(rule);
      return index < 0 ? Math.min(available - 1, count === 1 ? 0 : 1) : Math.min(available - 1, index);
    } catch {
      return count === 1 ? 0 : 1;
    }
  }
}

export function createGodotTranslation(resourceMajor: 3 | 4): GodotTranslation {
  if (resourceMajor !== 3 && resourceMajor !== 4) {
    throw new Error(`Translation.new requires Godot major 3 or 4, received ${String(resourceMajor)}`);
  }
  return new GodotTranslation(resourceMajor);
}

let major: 3 | 4 = 4;
let fallbackLocale = 'en';
let locale = godotStandardizeLocale(hostLocale());
let translations: GodotTranslation[] = [];

export function configureGodotTranslationServer(config: GodotTranslationServerConfig): void {
  major = config.major;
  fallbackLocale = String(config.fallbackLocale);
  locale = godotStandardizeLocale(config.initialLocale ?? hostLocale());
  const g3Selectors = new Set(['', locale.slice(0, 2), ...(locale.length === 2 ? [] : [locale])]);
  const resources = new Set<string>();
  translations = config.translations.flatMap((catalog) => {
    if (config.major === 3 && !g3Selectors.has(catalog.g3LocaleSelector ?? '')) return [];
    if (resources.has(catalog.resourcePath)) return [];
    resources.add(catalog.resourcePath);
    const result = createGodotTranslation(config.major);
    result.locale = catalog.locale;
    for (const [key, value] of Object.entries(catalog.messages)) result.messageMap.set(key, value);
    return [result];
  });
}

export function godotTranslationAdd(translation: GodotTranslation): void {
  if (!(translation instanceof GodotTranslation)) {
    throw new Error('TranslationServer.add_translation requires a Translation resource');
  }
  if (!translations.includes(translation)) translations.push(translation);
}

export function godotTranslationSetLocale(value: string): void {
  if (major === 4 && String(value) === '') {
    throw new Error('Godot 4 TranslationServer.set_locale refuses an empty locale');
  }
  locale = godotStandardizeLocale(String(value));
}

export function godotTranslationGetLocale(): string { return locale; }

export function godotTranslationGetLoadedLocales(): string[] | PackedStringArray {
  if (major === 3) return translations.map((translation) => translation.locale);
  return packedStringArray(new Set(translations.map((translation) => translation.locale)));
}

export function godotTranslationSetFallbackLocale(value: string): void {
  const normalized = godotStandardizeLocale(String(value));
  if (normalized.length === 0) throw new Error('TranslationServer.fallback_locale must not be empty.');
  fallbackLocale = normalized;
}

export function godotTranslationGetFallbackLocale(): string {
  return fallbackLocale;
}

export function godotTranslationGetTranslationObject(wantedLocale: string): GodotTranslation | null {
  const normalized = godotStandardizeLocale(String(wantedLocale));
  let result: GodotTranslation | null = null;
  let bestScore = 0;
  for (const translation of translations) {
    const score = compareLocales(normalized, translation.locale);
    if (score <= bestScore) continue;
    result = translation;
    bestScore = score;
    if (score === 10) break;
  }
  return result;
}

function findMessage(wantedLocale: string, message: string, context: string): string | undefined {
  return findMessageIn(translations, wantedLocale, message, context);
}

function findMessageIn(
  pool: readonly GodotTranslation[],
  wantedLocale: string,
  message: string,
  context: string,
): string | undefined {
  const key = context === '' || major === 3 ? message : `${context}${EOT}${message}`;
  let result: string | undefined;
  let bestScore = 0;
  for (const translation of pool) {
    const score = compareLocales(wantedLocale, translation.locale);
    if (score <= 0 || score < bestScore) continue;
    const candidate = translation.messageMap.get(key);
    if (candidate === undefined || candidate === '') continue;
    result = candidate;
    bestScore = score;
    if (score === 10) break;
  }
  return result;
}

function findPluralMessage(
  wantedLocale: string,
  message: string,
  pluralMessage: string,
  count: number,
  context: string,
): string | undefined {
  let result: string | undefined;
  let bestScore = 0;
  for (const translation of translations) {
    const score = compareLocales(wantedLocale, translation.locale);
    if (score <= 0 || score < bestScore) continue;
    const translated = translation.get_plural_message(message, pluralMessage, count, context);
    const source = count === 1 ? message : pluralMessage;
    if (translated === '' || translated === source) continue;
    result = translated;
    bestScore = score;
    if (score === 10) break;
  }
  return result;
}

export function godotTr(message: string, context = ''): string {
  if (major === 3 && context !== '') {
    throw new Error('Godot 3 Object.tr accepts only the message argument');
  }
  const source = String(message);
  return findMessage(locale, source, String(context)) ??
    (fallbackLocale.length >= 2 ? findMessage(fallbackLocale, source, String(context)) : undefined) ??
    source;
}

export const godotTranslationTranslate = godotTr;

export function godotTranslationTranslatePlural(
  message: string,
  pluralMessage: string,
  count: number,
  context = '',
): string {
  if (!Number.isSafeInteger(count)) throw new TypeError('TranslationServer.translate_plural count requires int.');
  const singular = String(message);
  const plural = String(pluralMessage);
  const retainedContext = String(context);
  return findPluralMessage(locale, singular, plural, count, retainedContext) ??
    (fallbackLocale.length >= 2
      ? findPluralMessage(fallbackLocale, singular, plural, count, retainedContext)
      : undefined) ??
    godotTr(count === 1 ? singular : plural, retainedContext);
}

export function godotTranslationGetLanguageName(language: string): string {
  const key = String(language);
  return localeData().languageNames[key] ?? (major === 3 ? '' : key);
}

export function godotTranslationGetLocaleName(value: string): string {
  const data = localeData();
  const parsed = localeParts(godotStandardizeLocale(String(value)), major === 3);
  let name = godotTranslationGetLanguageName(parsed.language);
  if (parsed.script !== '') {
    name += ` (${data.scriptNames[parsed.script] ?? (major === 3 ? '' : parsed.script)})`;
  }
  if (parsed.country !== '') {
    name += `, ${data.countryNames[parsed.country] ?? (major === 3 ? '' : parsed.country)}`;
  }
  return name;
}

export function godotTranslationGetToolLocale(): string {
  return godotStandardizeLocale(hostLocale());
}

export function godotTranslationCompareLocales(left: string, right: string): number {
  return compareLocales(String(left), String(right));
}

export function godotTranslationStandardizeLocale(value: string, addDefaults = false): string {
  if (typeof addDefaults !== 'boolean') throw new TypeError('TranslationServer.standardize_locale add_defaults requires bool.');
  const parts = localeParts(String(value), addDefaults);
  return [parts.language, parts.script, parts.country, parts.variant].filter(Boolean).join('_');
}

export function godotTranslationGetAllLanguages(): PackedStringArray {
  return packedStringArray(Object.keys(localeData().languageNames).sort());
}

export function godotTranslationGetAllScripts(): PackedStringArray {
  return packedStringArray(Object.keys(localeData().scriptNames).sort());
}

export function godotTranslationGetScriptName(script: string): string {
  const key = String(script);
  return localeData().scriptNames[key] ?? (major === 3 ? '' : key);
}

export function godotTranslationGetAllCountries(): PackedStringArray {
  return packedStringArray(Object.keys(localeData().countryNames).sort());
}

export function godotTranslationGetCountryName(country: string): string {
  const key = String(country);
  return localeData().countryNames[key] ?? (major === 3 ? '' : key);
}

export function godotTranslationGetPluralRules(localeValue: string): string {
  const selected = godotTranslationStandardizeLocale(localeValue).replaceAll('_', '-');
  try {
    const categories = new Intl.PluralRules(selected).resolvedOptions().pluralCategories;
    return categories.join(';');
  } catch {
    return '';
  }
}

export function godotTranslationRemove(translation: unknown): void {
  if (!(translation instanceof GodotTranslation)) {
    throw new TypeError('TranslationServer.remove_translation requires Translation.');
  }
  translations = translations.filter((candidate) => candidate !== translation);
}

export function godotTranslationGetObject(localeValue: string): GodotTranslation | null {
  const wanted = String(localeValue);
  let best: GodotTranslation | null = null;
  let score = 0;
  for (const translation of translations) {
    const next = compareLocales(wanted, translation.locale);
    if (next > score) { best = translation; score = next; }
  }
  return best;
}

export function godotTranslationGetTranslations(): GodotTranslation[] { return [...translations]; }

export function godotTranslationFindTranslations(localeValue: string, exact: boolean): GodotTranslation[] {
  if (typeof exact !== 'boolean') throw new TypeError('TranslationServer.find_translations exact requires bool.');
  const wanted = String(localeValue);
  return translations.filter((translation) => exact
    ? godotStandardizeLocale(translation.locale) === godotStandardizeLocale(wanted)
    : compareLocales(wanted, translation.locale) > 0);
}

export function godotTranslationHasForLocale(localeValue: string, exact: boolean): boolean {
  return godotTranslationFindTranslations(localeValue, exact).length > 0;
}

export function godotTranslationHas(translation: unknown): boolean {
  return translation instanceof GodotTranslation && translations.includes(translation);
}

export function godotTranslationClear(): void { translations = []; }

function localeForIntl(value: string): string {
  const candidate = value === '' ? locale : value;
  return godotStandardizeLocale(candidate).replaceAll('_', '-');
}

export function godotTranslationFormatNumber(numberValue: string, localeValue: string): string {
  const source = String(numberValue);
  const numeric = Number(source);
  if (!Number.isFinite(numeric)) return source;
  try {
    const decimals = source.includes('.') ? source.length - source.indexOf('.') - 1 : 0;
    return new Intl.NumberFormat(localeForIntl(String(localeValue)), {
      useGrouping: false,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(numeric);
  } catch {
    return source;
  }
}

export function godotTranslationGetPercentSign(localeValue: string): string {
  try {
    return new Intl.NumberFormat(localeForIntl(String(localeValue)), { style: 'percent' })
      .formatToParts(1)
      .find((part) => part.type === 'percentSign')?.value ?? '%';
  } catch {
    return '%';
  }
}

export function godotTranslationParseNumber(numberValue: string, localeValue: string): string {
  const source = String(numberValue);
  try {
    const formatter = new Intl.NumberFormat(localeForIntl(String(localeValue)));
    const parts = formatter.formatToParts(12345.6);
    const group = parts.find((part) => part.type === 'group')?.value;
    const decimal = parts.find((part) => part.type === 'decimal')?.value;
    const digits = new Intl.NumberFormat(localeForIntl(String(localeValue)), { useGrouping: false })
      .format(9876543210).split('').reverse();
    const digitMap = new Map(digits.map((digit, index) => [digit, String(index)]));
    return [...source].map((character) => {
      if (group !== undefined && character === group) return '';
      if (decimal !== undefined && character === decimal) return '.';
      return digitMap.get(character) ?? character;
    }).join('');
  } catch {
    return source;
  }
}

interface PseudolocalizationState {
  enabled: boolean;
  accents: boolean;
  doubleVowels: boolean;
  fakeBidi: boolean;
  override: boolean;
  skipPlaceholders: boolean;
  expansionRatio: number;
  prefix: string;
  suffix: string;
}

const ACCENTS: Readonly<Record<string, string>> = {
  a: 'à', e: 'ë', i: 'ï', o: 'ô', u: 'ü', y: 'ÿ',
  A: 'À', E: 'Ë', I: 'Ï', O: 'Ô', U: 'Ü', Y: 'Ÿ',
};

function pseudolocalize(message: string, state: PseudolocalizationState): string {
  if (!state.enabled) return message;
  const placeholders = /(%(?:\d+\$)?[-+#0 .'\d]*[a-zA-Z]|\{[^}]*\})/g;
  const transform = (segment: string): string => [...segment].map((character) => {
    const accented = state.accents ? (ACCENTS[character] ?? character) : character;
    return state.doubleVowels && /[aeiouy]/i.test(character) ? accented + accented : accented;
  }).join('');
  let body = state.skipPlaceholders
    ? message.split(placeholders).map((part) => /^(%(?:\d+\$)?[-+#0 .'\d]*[a-zA-Z]|\{[^}]*\})$/.test(part) ? part : transform(part)).join('')
    : transform(message);
  const targetLength = Math.ceil(message.length * Math.max(1, state.expansionRatio));
  if (body.length < targetLength) body += '~'.repeat(targetLength - body.length);
  if (state.fakeBidi) body = `\u202e${[...body].reverse().join('')}\u202c`;
  return `${state.prefix}${body}${state.suffix}`;
}

const serverPseudo: PseudolocalizationState = {
  enabled: false, accents: true, doubleVowels: false, fakeBidi: false,
  override: false, skipPlaceholders: true, expansionRatio: 1, prefix: '[', suffix: ']',
};

export function godotTranslationIsPseudolocalizationEnabled(): boolean { return serverPseudo.enabled; }
export function godotTranslationSetPseudolocalizationEnabled(enabled: boolean): void {
  if (typeof enabled !== 'boolean') throw new TypeError('TranslationServer pseudolocalization enabled requires bool.');
  serverPseudo.enabled = enabled;
}
export function godotTranslationReloadPseudolocalization(): void {}
export function godotTranslationPseudolocalize(message: string): string { return pseudolocalize(String(message), serverPseudo); }

export class GodotTranslationDomain {
  private translations: GodotTranslation[] = [];
  private localeOverride = '';
  private enabled = true;
  private readonly pseudo: PseudolocalizationState = { ...serverPseudo };

  constructor() { registerGodotObjectIdentity(this, 'TranslationDomain'); }

  get_translation_object(localeValue: string): GodotTranslation | null {
    return this.find_translations(localeValue, false)[0] ?? null;
  }
  add_translation(value: unknown): void {
    if (!(value instanceof GodotTranslation)) throw new TypeError('TranslationDomain.add_translation requires Translation.');
    if (!this.translations.includes(value)) this.translations.push(value);
  }
  remove_translation(value: unknown): void {
    if (!(value instanceof GodotTranslation)) throw new TypeError('TranslationDomain.remove_translation requires Translation.');
    this.translations = this.translations.filter((candidate) => candidate !== value);
  }
  clear(): void { this.translations = []; }
  get_translations(): GodotTranslation[] { return [...this.translations]; }
  has_translation_for_locale(localeValue: string, exact: boolean): boolean { return this.find_translations(localeValue, exact).length > 0; }
  has_translation(value: unknown): boolean { return value instanceof GodotTranslation && this.translations.includes(value); }
  find_translations(localeValue: string, exact: boolean): GodotTranslation[] {
    if (typeof exact !== 'boolean') throw new TypeError('TranslationDomain.find_translations exact requires bool.');
    const wanted = String(localeValue);
    return this.translations.filter((translation) => exact
      ? godotStandardizeLocale(translation.locale) === godotStandardizeLocale(wanted)
      : compareLocales(wanted, translation.locale) > 0);
  }
  translate(message: string, context = ''): string {
    const source = String(message);
    if (!this.enabled) return source;
    const wanted = this.localeOverride || locale;
    const translated = findMessageIn(this.translations, wanted, source, String(context)) ?? source;
    return pseudolocalize(translated, this.pseudo);
  }
  translate_plural(message: string, plural: string, count: number, context = ''): string {
    return this.translate(count === 1 ? message : plural, context);
  }
  get_locale_override(): string { return this.localeOverride; }
  set_locale_override(value: string): void { this.localeOverride = value === '' ? '' : godotStandardizeLocale(String(value)); }
  is_enabled(): boolean { return this.enabled; }
  set_enabled(value: boolean): void { this.enabled = Boolean(value); }
  is_pseudolocalization_enabled(): boolean { return this.pseudo.enabled; }
  set_pseudolocalization_enabled(value: boolean): void { this.pseudo.enabled = Boolean(value); }
  is_pseudolocalization_accents_enabled(): boolean { return this.pseudo.accents; }
  set_pseudolocalization_accents_enabled(value: boolean): void { this.pseudo.accents = Boolean(value); }
  is_pseudolocalization_double_vowels_enabled(): boolean { return this.pseudo.doubleVowels; }
  set_pseudolocalization_double_vowels_enabled(value: boolean): void { this.pseudo.doubleVowels = Boolean(value); }
  is_pseudolocalization_fake_bidi_enabled(): boolean { return this.pseudo.fakeBidi; }
  set_pseudolocalization_fake_bidi_enabled(value: boolean): void { this.pseudo.fakeBidi = Boolean(value); }
  is_pseudolocalization_override_enabled(): boolean { return this.pseudo.override; }
  set_pseudolocalization_override_enabled(value: boolean): void { this.pseudo.override = Boolean(value); }
  is_pseudolocalization_skip_placeholders_enabled(): boolean { return this.pseudo.skipPlaceholders; }
  set_pseudolocalization_skip_placeholders_enabled(value: boolean): void { this.pseudo.skipPlaceholders = Boolean(value); }
  get_pseudolocalization_expansion_ratio(): number { return this.pseudo.expansionRatio; }
  set_pseudolocalization_expansion_ratio(value: number): void {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('TranslationDomain expansion ratio requires a non-negative float.');
    this.pseudo.expansionRatio = value;
  }
  get_pseudolocalization_prefix(): string { return this.pseudo.prefix; }
  set_pseudolocalization_prefix(value: string): void { this.pseudo.prefix = String(value); }
  get_pseudolocalization_suffix(): string { return this.pseudo.suffix; }
  set_pseudolocalization_suffix(value: string): void { this.pseudo.suffix = String(value); }
  pseudolocalize(message: string): string { return pseudolocalize(String(message), this.pseudo); }
}

const translationDomains = new Map<string, GodotTranslationDomain>();

export function godotTranslationHasDomain(domain: string): boolean { return translationDomains.has(String(domain)); }
export function godotTranslationGetOrAddDomain(domainValue: string): GodotTranslationDomain {
  const name = String(domainValue);
  let domain = translationDomains.get(name);
  if (domain === undefined) { domain = new GodotTranslationDomain(); translationDomains.set(name, domain); }
  return domain;
}
export function godotTranslationRemoveDomain(domain: string): void { translationDomains.delete(String(domain)); }

export interface GodotTranslationServer {
  locale: string;
  fallback_locale: string;
  set_locale(value: string): void;
  get_locale(): string;
  set_fallback_locale(value: string): void;
  get_fallback_locale(): string;
  compare_locales(left: string, right: string): number;
  standardize_locale(value: string, addDefaults?: boolean): string;
  get_loaded_locales(): string[] | PackedStringArray;
  translate(message: string, context?: string): string;
  translate_plural(message: string, pluralMessage: string, count: number, context?: string): string;
  add_translation(translation: GodotTranslation): void;
  remove_translation(translation: GodotTranslation): void;
  get_translation_object(locale: string): GodotTranslation | null;
  clear(): void;
}

export function createGodotTranslationServer(): GodotTranslationServer {
  const server = {
    set_locale: godotTranslationSetLocale,
    get_locale: godotTranslationGetLocale,
    set_fallback_locale: godotTranslationSetFallbackLocale,
    get_fallback_locale: godotTranslationGetFallbackLocale,
    compare_locales: godotTranslationCompareLocales,
    standardize_locale: godotTranslationStandardizeLocale,
    get_loaded_locales: godotTranslationGetLoadedLocales,
    translate: godotTranslationTranslate,
    translate_plural: godotTranslationTranslatePlural,
    add_translation: godotTranslationAdd,
    remove_translation: godotTranslationRemove,
    get_translation_object: godotTranslationGetTranslationObject,
    clear: godotTranslationClear,
  } as GodotTranslationServer;
  Object.defineProperties(server, {
    locale: {
      enumerable: true,
      get: (): string => server.get_locale(),
      set: (value: string): void => server.set_locale(value),
    },
    fallback_locale: {
      enumerable: true,
      get: (): string => server.get_fallback_locale(),
      set: (value: string): void => server.set_fallback_locale(value),
    },
  });
  return server;
}

export const GODOT_TRANSLATION_SERVER: GodotTranslationServer = Object.freeze(createGodotTranslationServer());
