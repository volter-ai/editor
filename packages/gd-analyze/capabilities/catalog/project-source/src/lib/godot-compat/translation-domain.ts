import {
  GodotTranslation,
  godotTranslationCompareLocales,
  godotTranslationGetLocale,
} from './translation-server';

const EOT = '\u0004';

export class GodotTranslationDomain {
  private readonly translations: GodotTranslation[] = [];
  private localeOverride = '';
  private enabled = true;
  private pseudolocalizationEnabled = false;
  private pseudolocalizationAccentsEnabled = true;
  private pseudolocalizationDoubleVowelsEnabled = false;
  private pseudolocalizationFakeBidiEnabled = false;
  private pseudolocalizationOverrideEnabled = false;
  private pseudolocalizationSkipPlaceholdersEnabled = true;
  private pseudolocalizationExpansionRatio = 0;
  private pseudolocalizationPrefix = '[';
  private pseudolocalizationSuffix = ']';

  get_translation_object(locale: string): GodotTranslation | null {
    return this.find_translations(locale, false)[0] ?? null;
  }

  add_translation(translation: GodotTranslation): void {
    if (!(translation instanceof GodotTranslation)) throw new TypeError('TranslationDomain.add_translation requires Translation.');
    if (!this.translations.includes(translation)) this.translations.push(translation);
  }

  remove_translation(translation: GodotTranslation): void {
    const index = this.translations.indexOf(translation);
    if (index >= 0) this.translations.splice(index, 1);
  }

  clear(): void { this.translations.length = 0; }
  get_translations(): readonly GodotTranslation[] { return [...this.translations]; }

  has_translation_for_locale(locale: string, exact = false): boolean {
    return this.find_translations(locale, exact).length > 0;
  }

  has_translation(translation: GodotTranslation): boolean { return this.translations.includes(translation); }

  find_translations(locale: string, exact = false): GodotTranslation[] {
    if (exact) return this.translations.filter((translation) => translation.locale === locale);
    return this.translations
      .map((translation) => ({ translation, score: godotTranslationCompareLocales(locale, translation.locale) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ translation }) => translation);
  }

  translate(message: string, context = ''): string {
    if (!this.enabled) return message;
    const locale = this.localeOverride || godotTranslationGetLocale();
    const key = context === '' ? message : `${context}${EOT}${message}`;
    let translated = message;
    for (const translation of this.find_translations(locale, false)) {
      const value = translation.messageMap.get(key);
      if (value !== undefined && value !== '') { translated = value; break; }
    }
    return this.pseudolocalizationEnabled ? this.pseudolocalize(translated) : translated;
  }

  translate_plural(message: string, messagePlural: string, n: number, context = ''): string {
    return this.translate(n === 1 ? message : messagePlural, context);
  }

  get_locale_override(): string { return this.localeOverride; }
  set_locale_override(locale: string): void { this.localeOverride = locale; }
  is_enabled(): boolean { return this.enabled; }
  set_enabled(enabled: boolean): void { this.enabled = enabled; }
  is_pseudolocalization_enabled(): boolean { return this.pseudolocalizationEnabled; }
  set_pseudolocalization_enabled(enabled: boolean): void { this.pseudolocalizationEnabled = enabled; }
  is_pseudolocalization_accents_enabled(): boolean { return this.pseudolocalizationAccentsEnabled; }
  set_pseudolocalization_accents_enabled(enabled: boolean): void { this.pseudolocalizationAccentsEnabled = enabled; }
  is_pseudolocalization_double_vowels_enabled(): boolean { return this.pseudolocalizationDoubleVowelsEnabled; }
  set_pseudolocalization_double_vowels_enabled(enabled: boolean): void { this.pseudolocalizationDoubleVowelsEnabled = enabled; }
  is_pseudolocalization_fake_bidi_enabled(): boolean { return this.pseudolocalizationFakeBidiEnabled; }
  set_pseudolocalization_fake_bidi_enabled(enabled: boolean): void { this.pseudolocalizationFakeBidiEnabled = enabled; }
  is_pseudolocalization_override_enabled(): boolean { return this.pseudolocalizationOverrideEnabled; }
  set_pseudolocalization_override_enabled(enabled: boolean): void { this.pseudolocalizationOverrideEnabled = enabled; }
  is_pseudolocalization_skip_placeholders_enabled(): boolean { return this.pseudolocalizationSkipPlaceholdersEnabled; }
  set_pseudolocalization_skip_placeholders_enabled(enabled: boolean): void { this.pseudolocalizationSkipPlaceholdersEnabled = enabled; }
  get_pseudolocalization_expansion_ratio(): number { return this.pseudolocalizationExpansionRatio; }
  set_pseudolocalization_expansion_ratio(ratio: number): void {
    if (!Number.isFinite(ratio) || ratio < 0) throw new RangeError('TranslationDomain expansion ratio must be non-negative.');
    this.pseudolocalizationExpansionRatio = ratio;
  }
  get_pseudolocalization_prefix(): string { return this.pseudolocalizationPrefix; }
  set_pseudolocalization_prefix(prefix: string): void { this.pseudolocalizationPrefix = prefix; }
  get_pseudolocalization_suffix(): string { return this.pseudolocalizationSuffix; }
  set_pseudolocalization_suffix(suffix: string): void { this.pseudolocalizationSuffix = suffix; }

  pseudolocalize(message: string): string {
    const segments = this.pseudolocalizationSkipPlaceholdersEnabled
      ? message.split(/(%(?:\d+\$)?[-+#0 ]*\d*(?:\.\d+)?[a-zA-Z]|\{[^}]*\})/g)
      : [message];
    let output = segments.map((segment, index) => {
      if (this.pseudolocalizationSkipPlaceholdersEnabled && index % 2 === 1) return segment;
      return this.transformSegment(segment);
    }).join('');
    const expandable = [...output].filter((character) => /[A-Za-z]/.test(character));
    const extra = Math.ceil(expandable.length * this.pseudolocalizationExpansionRatio);
    if (extra > 0) output += '~'.repeat(extra);
    if (this.pseudolocalizationFakeBidiEnabled) output = `\u202e${[...output].reverse().join('')}\u202c`;
    return `${this.pseudolocalizationPrefix}${output}${this.pseudolocalizationSuffix}`;
  }

  private transformSegment(segment: string): string {
    const accents: Readonly<Record<string, string>> = {
      a: 'á', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ğ', h: 'ħ', i: 'í', j: 'ĵ',
      k: 'ķ', l: 'ĺ', m: 'ɱ', n: 'ñ', o: 'ó', p: 'þ', q: 'ʠ', r: 'ŕ', s: 'š', t: 'ţ',
      u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
    };
    let result = '';
    for (const character of segment) {
      const lower = character.toLowerCase();
      const replacement = this.pseudolocalizationAccentsEnabled ? accents[lower] : undefined;
      const transformed = replacement === undefined
        ? character
        : character === lower ? replacement : replacement.toUpperCase();
      result += transformed;
      if (this.pseudolocalizationDoubleVowelsEnabled && /[aeiou]/i.test(character)) result += transformed;
    }
    return result;
  }
}

export function createGodotTranslationDomain(): GodotTranslationDomain { return new GodotTranslationDomain(); }
