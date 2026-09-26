/**
 * read/text-format.ts — the ONE parser for Godot's text serialization.
 *
 * `project.godot`, `.tscn`, `.tres` and `.gdns` are the same file format wearing three hats, and
 * this module is the only thing in the package that reads characters. It is a character scanner,
 * not a line splitter, and that is deliberate: Godot writes values that span lines in two
 * different ways at once —
 *
 *     config/description="ROTA: Bend Gravity by Harmony Monroe
 *     harmonymonroe.com"                       ← a raw newline INSIDE a quoted string
 *
 *     events = [ Object(InputEventKey,"scancode":32,…)
 *     , Object(InputEventJoypadButton,…)
 *      ]                                       ← an array broken across lines, closing indented
 *
 * — so any rule of the form "a line beginning with `[` starts a section" is wrong on real files.
 * A scanner has no such ambiguity: `[` is a section header only at STATEMENT position, and a
 * value is read to its own end whatever it does with newlines.
 *
 * The output is structural only (`[kind attrs] { key: value }`); deciding what a section MEANS is
 * the job of `project-settings.ts` (for `project.godot`) and `scene.ts` (for scenes/resources).
 *
 * A file that does not parse throws `GodotParseError` with a line and column. That is a
 * per-FILE failure, and `godot-project.ts` turns it into a diagnostic rather than letting it kill
 * a read — one unreadable resource must never cost the other 322.
 */
import type { GodotEntry, GodotValue } from './godot-value';

export class GodotParseError extends Error {
  constructor(
    message: string,
    readonly resPath: string,
    readonly line: number,
    readonly column: number,
  ) {
    super(`${resPath}:${line}:${column}: ${message}`);
    this.name = 'GodotParseError';
  }
}

/** One `[kind attr=value …]` header plus the `key = value` body that follows it. */
export interface GodotSection {
  readonly kind: string;
  readonly attributes: Readonly<Record<string, GodotValue>>;
  readonly properties: Readonly<Record<string, GodotValue>>;
  /** 1-based line of the header, so a diagnostic can point at it. */
  readonly line: number;
}

export interface GodotTextFile {
  /** The `res://…` path this text was read from — every diagnostic cites it. */
  readonly resPath: string;
  /**
   * Keys written BEFORE the first section header. Only `project.godot` has any (`config_version`,
   * `_global_script_classes`, `_global_script_class_icons`); scenes and resources open with a
   * header, so this is empty for them.
   */
  readonly leading: Readonly<Record<string, GodotValue>>;
  readonly sections: readonly GodotSection[];
}

/**
 * What a bare key/identifier token may contain. Written as a NEGATIVE class because Godot keys are
 * open-ended (`tracks/0/keys`, `window/size/test_width`, `config/name`, `bus/1/volume_db`) while
 * the terminators are a short closed set. `:` is a terminator on purpose — it is the dictionary
 * separator, and letting a key swallow it would eat `"points":` whole.
 */
const KEY_CHARS = /[^\s=[\]{}(),:"']/;
/**
 * A statement-level property key has no dictionary separator. Godot 4 TileSetAtlasSource writes
 * integer-vector coordinates directly into keys (`0:0/0/terrain_set`), so `:` is data here even
 * though it terminates a key inside `{ ... }` and `Object("field": value)`.
 */
const PROPERTY_KEY_CHARS = /[^\s=[\]{}(),"']/;

/**
 * Godot 4's two PREFIX-SIGIL literals, decoded onto the model Godot 3 already produces for the
 * same variant. There is ONE reader and no version branch: neither sigil can appear at value
 * position in a Godot 3 document (a `&`/`^` there is inside a quoted string), so accepting them is
 * a strict superset, exactly the way `project-settings.ts`'s `readPhysicsFps` accepts both
 * spellings of the physics rate in one function.
 *
 *   `&"walk"`   StringName — Godot 3 writes the same value as a plain quoted string
 *                            (`animation = "walk"`, `_data = { "walk": … }`), so it decodes to
 *                            `{ kind: 'string' }`.
 *   `^"Body"`   NodePath   — Godot 3 writes the same value as `NodePath("Body")`, so it decodes to
 *                            that CONSTRUCTOR, not to a bare string.
 *
 * Decoding rather than adding two `GodotValue` kinds is the choice that keeps every existing
 * consumer CORRECT rather than merely compiling: `stringItems`/`asString` read the string kind, and
 * a dozen sites in `translate/` match `NodePath` by `value.name === 'NodePath'` and then read
 * `args[0]`. A new kind would make all of them silently answer `undefined` on a Godot 4 document —
 * a refusal that looks like an absent property. What the decode costs is the ability to tell a
 * StringName from a String after the fact; nothing in this package asks that question, and Godot
 * itself converts between them implicitly wherever these two appear.
 */
function sigilValue(sigil: '&' | '^' | undefined, text: string): GodotValue {
  if (sigil === '^') {
    return { kind: 'ctor', name: 'NodePath', args: [{ kind: 'string', value: text }], fields: [] };
  }
  return { kind: 'string', value: text };
}

class Scanner {
  private index = 0;

  constructor(
    private readonly text: string,
    private readonly resPath: string,
  ) {}

  private lineColumn(at: number): { line: number; column: number } {
    let line = 1;
    let lastBreak = -1;
    for (let i = 0; i < at; i++) {
      if (this.text[i] === '\n') {
        line++;
        lastBreak = i;
      }
    }
    return { line, column: at - lastBreak };
  }

  fail(message: string, at = this.index): never {
    const { line, column } = this.lineColumn(at);
    throw new GodotParseError(message, this.resPath, line, column);
  }

  lineOf(at: number): number {
    return this.lineColumn(at).line;
  }

  get position(): number {
    return this.index;
  }

  atEnd(): boolean {
    return this.index >= this.text.length;
  }

  peek(): string | undefined {
    return this.text[this.index];
  }

  /**
   * Whitespace and comments. Godot's config parser treats `;` and `#` as comments ONLY at the start
   * of a line — inside a value either character is data — and this is called at statement position and
   * between value tokens, never mid-string, so the line test is the whole rule.
   */
  skipTrivia(): void {
    for (;;) {
      const char = this.text[this.index];
      if (char === undefined) return;
      // Godot's ConfigFile/TextFile loaders accept the optional UTF-8 BOM at byte zero. It is
      // encoding metadata rather than a property-key character; retaining it made an otherwise
      // ordinary project.godot/.tscn fail before its first section or leading assignment. Refuse
      // the same code point anywhere else so an embedded BOM cannot silently split an authored
      // key or value.
      if (char === '\uFEFF' && this.index === 0) {
        this.index++;
        continue;
      }
      if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
        this.index++;
        continue;
      }
      if ((char === ';' || char === '#') && this.atLineStart()) {
        while (this.index < this.text.length && this.text[this.index] !== '\n') this.index++;
        continue;
      }
      return;
    }
  }

  private atLineStart(): boolean {
    for (let i = this.index - 1; i >= 0; i--) {
      const char = this.text[i];
      if (char === '\n') return true;
      if (char !== ' ' && char !== '\t' && char !== '\r') return false;
    }
    return true;
  }

  expect(char: string): void {
    if (this.text[this.index] !== char) this.fail(`expected "${char}"`);
    this.index++;
  }

  eat(char: string): boolean {
    if (this.text[this.index] !== char) return false;
    this.index++;
    return true;
  }

  /** A bare key/identifier token. */
  readKey(): string {
    const start = this.index;
    while (this.index < this.text.length && KEY_CHARS.test(this.text[this.index] as string)) {
      this.index++;
    }
    if (this.index === start) this.fail('expected an identifier');
    return this.text.slice(start, this.index);
  }

  /**
   * A property key, which Godot writes QUOTED whenever the name is not a bare identifier. Godot's
   * own writer quotes on demand and its parser accepts either spelling, so a reader that only
   * accepts the bare form rejects real files — `AnimationNodeBlendTree` names its graph nodes
   * after the resources they wrap, and Godot's editor mints "Animation 2", so a player scene with
   * an AnimationTree carries `"nodes/Animation 2/node" = SubResource( 13 )`. Same rule the
   * dictionary reader already applies to its entry keys; this is that rule at statement position.
   */
  readPropertyKey(): string {
    const quoted = this.readQuoted();
    if (quoted !== undefined) return quoted.text;
    const start = this.index;
    while (
      this.index < this.text.length &&
      PROPERTY_KEY_CHARS.test(this.text[this.index] as string)
    ) {
      this.index++;
    }
    if (this.index === start) this.fail('expected a property key');
    return this.text.slice(start, this.index);
  }

  /**
   * A quoted string at a position that also accepts a bare identifier, with or without one of
   * Godot 4's prefix sigils (see {@link sigilValue}). Returns `undefined` when the scanner is not
   * looking at one, so a caller can fall back to `readKey()`.
   *
   * The sigil is only consumed when a quote FOLLOWS it, because `&` and `^` are both members of
   * `KEY_CHARS` — without that lookahead a lone `&` would be eaten here and the identifier it
   * begins would be truncated.
   */
  private readQuoted(): { readonly sigil?: '&' | '^'; readonly text: string } | undefined {
    const char = this.text[this.index];
    if (char === '"') return { text: this.readString() };
    if (char !== '&' && char !== '^') return undefined;
    if (this.text[this.index + 1] !== '"') return undefined;
    this.index++;
    return { sigil: char, text: this.readString() };
  }

  readString(): string {
    this.expect('"');
    let out = '';
    for (;;) {
      const char = this.text[this.index];
      if (char === undefined) this.fail('unterminated string');
      this.index++;
      if (char === '"') return out;
      if (char !== '\\') {
        out += char;
        continue;
      }
      const escaped = this.text[this.index];
      if (escaped === undefined) this.fail('unterminated escape');
      this.index++;
      if (escaped === 'n') out += '\n';
      else if (escaped === 't') out += '\t';
      else if (escaped === 'r') out += '\r';
      else if (escaped === 'u') {
        const hex = this.text.slice(this.index, this.index + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('bad \\u escape');
        out += String.fromCharCode(Number.parseInt(hex, 16));
        this.index += 4;
      } else out += escaped;
    }
  }

  readValue(): GodotValue {
    this.skipTrivia();
    const char = this.peek();
    if (char === undefined) this.fail('expected a value');

    const quoted = this.readQuoted();
    if (quoted !== undefined) return sigilValue(quoted.sigil, quoted.text);
    if (char === '&' || char === '^') {
      // A sigil with no string after it. Refuse rather than let `readKey` swallow it as the first
      // character of a bare identifier — that is how the reader used to die three tokens later
      // with a message pointing at the wrong construct.
      this.fail(
        `"${char}" begins a Godot 4 ${char === '&' ? 'StringName' : 'NodePath'} literal and must be followed by a quoted string`,
      );
    }
    if (char === '[') return { kind: 'array', items: this.readArrayItems() };
    if (char === '{') return this.readDict();
    if (char === '-' || char === '+' || (char >= '0' && char <= '9')) return this.readNumber();

    const start = this.index;
    const word = this.readKey();
    if (word === 'true') return { kind: 'bool', value: true };
    if (word === 'false') return { kind: 'bool', value: false };
    if (word === 'null') return { kind: 'null' };
    if (word === 'nan') return { kind: 'number', value: Number.NaN, variantType: 'float' };
    if (word === 'inf') return { kind: 'number', value: Number.POSITIVE_INFINITY, variantType: 'float' };
    if (word === 'inf_neg') return { kind: 'number', value: Number.NEGATIVE_INFINITY, variantType: 'float' };

    // Godot 4's typed-collection literal, tested BEFORE `skipTrivia` — see `readTypedArray` for
    // why the `[` must be adjacent to the word.
    if (this.peek() === '[') return this.readTypedCollection(word, start);

    this.skipTrivia();
    if (this.peek() !== '(') {
      // A bare word that is not a constructor: `Object( InputEventKey, … )`'s first argument.
      return { kind: 'ident', name: word };
    }
    this.index++;
    const args: GodotValue[] = [];
    const fields: GodotEntry[] = [];
    this.skipTrivia();
    if (!this.eat(')')) {
      for (;;) {
        this.skipTrivia();
        const entry = this.readMaybeKeyedValue();
        if (entry.key === undefined) args.push(entry.value);
        else fields.push({ key: entry.key, value: entry.value });
        this.skipTrivia();
        if (this.eat(',')) continue;
        if (this.eat(')')) break;
        this.fail(`expected "," or ")" in ${word}(…) starting at offset ${start}`);
      }
    }
    return { kind: 'ctor', name: word, args, fields };
  }

  /** `"key":value` inside `Object( … )`, or a plain positional value. */
  private readMaybeKeyedValue(): { key?: string; value: GodotValue } {
    const mark = this.index;
    const quoted = this.readQuoted();
    if (quoted !== undefined) {
      this.skipTrivia();
      if (this.eat(':')) return { key: quoted.text, value: this.readValue() };
      this.index = mark;
    }
    return { value: this.readValue() };
  }

  private readNumber(): GodotValue {
    const start = this.index;
    if (this.peek() === '-' || this.peek() === '+') this.index++;
    // `-inf` is written with the sign attached.
    if (this.text.startsWith('inf', this.index)) {
      this.index += 3;
      return { kind: 'number', value: this.text[start] === '-' ? -Infinity : Infinity, variantType: 'float' };
    }
    while (this.index < this.text.length && /[0-9]/.test(this.text[this.index] as string)) {
      this.index++;
    }
    if (this.peek() === '.') {
      this.index++;
      while (this.index < this.text.length && /[0-9]/.test(this.text[this.index] as string)) {
        this.index++;
      }
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.index++;
      if (this.peek() === '-' || this.peek() === '+') this.index++;
      while (this.index < this.text.length && /[0-9]/.test(this.text[this.index] as string)) {
        this.index++;
      }
    }
    const raw = this.text.slice(start, this.index);
    const value = Number(raw);
    if (Number.isNaN(value) && raw !== 'nan') this.fail(`bad number "${raw}"`, start);
    return {
      kind: 'number',
      value,
      variantType: /[.eE]/.test(raw) ? 'float' : 'int',
    };
  }

  private readArrayItems(): GodotValue[] {
    this.expect('[');
    const items: GodotValue[] = [];
    this.skipTrivia();
    if (this.eat(']')) return items;
    for (;;) {
      items.push(this.readValue());
      this.skipTrivia();
      if (this.eat(',')) {
        this.skipTrivia();
        // Godot tolerates a trailing comma before the closing bracket.
        if (this.eat(']')) break;
        continue;
      }
      if (this.eat(']')) break;
      this.fail('expected "," or "]" in array');
    }
    return items;
  }

  /**
   * Godot 4's TYPED-ARRAY literal: `Array[T]([ … ])`. The pinned 4.7 dump declares the same
   * fact as Array constructor index 2 (`base`, `type`, `class_name`, `script`) and `is_typed`;
   * the text writer emits it as `Array[T]([values])`. It is what
   * `@export var weapons: Array[Weapon]` serializes to, and it is the line `starter-kit-fps`'s
   * own README tells a player to edit to add a weapon:
   *
   *     weapons = Array[ExtResource("2_i825w")]([ExtResource("3_kr4p8"), ExtResource("2_6epbw")])
   *
   * `T` is the element type the container carries; the values inside are ordinary variants of
   * the same shape an untyped `[ … ]` holds. This reader keeps the written spelling on
   * {@link GodotValue}'s `elementType` and resolves none of it — classification belongs to
   * `analyze/`. Dropping `T` is the one thing the lane's read-truth rule forbids: the resulting
   * value is indistinguishable from an array the document authored untyped, and for a
   * script-typed array it also loses the ONLY citation of that script in the document.
   *
   * The `[` must be ADJACENT to the word. Godot's writer never emits `Array [int]([])`, and
   * accepting that spelling would cost a real ambiguity: a bare identifier is a legal property
   * value, and a section header also opens with `[`, so a reader that skipped trivia looking
   * for the type parameter would read
   *
   *     some_key = SomeIdent
   *     [node name="Next" …]
   *
   * as a typed collection whose element type is `node`. Requiring adjacency makes the two
   * constructs impossible to confuse, because a header always follows a newline.
   *
   * Godot 4.4 gave `Dictionary` the parallel `Dictionary[K, V]({…})` shape. Its two types and its
   * Variant keys are retained just as exactly as Array's element type; a different `Word[…](…)`
   * still refuses here instead of falling through to a bogus section-header diagnostic.
   */
  private readTypedCollection(word: string, start: number): GodotValue {
    if (word !== 'Array' && word !== 'Dictionary') {
      this.fail(
        `"${word}[…](…)" is not a Godot 4 typed Array or Dictionary literal`,
        start,
      );
    }
    this.expect('[');
    this.skipTrivia();
    const firstType = this.readValue();
    if (firstType.kind !== 'ident' && firstType.kind !== 'ctor') {
      // Godot reads this position as a type identifier or a resource reference to the script
      // that defines the class; a string or a number here is a malformed document, not a type
      // this reader declined to model.
      this.fail(`${word}[…] type must be a type name or a resource reference`, start);
    }
    let valueType: GodotValue | undefined;
    if (word === 'Dictionary') {
      this.skipTrivia();
      if (!this.eat(',')) this.fail('expected "," between Dictionary key and value types', start);
      this.skipTrivia();
      valueType = this.readValue();
      if (valueType.kind !== 'ident' && valueType.kind !== 'ctor') {
        this.fail('Dictionary[…] value type must be a type name or a resource reference', start);
      }
    }
    this.skipTrivia();
    if (!this.eat(']')) this.fail(`expected "]" after the type arguments of ${word}[…](…)`);
    this.skipTrivia();
    if (!this.eat('(')) this.fail(`expected "(" after ${word}[…]`);
    this.skipTrivia();
    if (word === 'Array') {
      if (this.peek() !== '[') this.fail('expected an array literal inside Array[…](…)');
      const items = this.readArrayItems();
      this.skipTrivia();
      if (!this.eat(')')) this.fail('expected ")" closing Array[…](…)');
      return { kind: 'array', items, elementType: firstType };
    }
    if (this.peek() !== '{') this.fail('expected a dictionary literal inside Dictionary[…](…)');
    const dictionary = this.readDict();
    this.skipTrivia();
    if (!this.eat(')')) this.fail('expected ")" closing Dictionary[…](…)');
    if (dictionary.kind !== 'dict' || valueType === undefined) {
      this.fail('internal: typed Dictionary literal did not decode as a dictionary', start);
    }
    return { ...dictionary, keyType: firstType, valueType };
  }

  private readDict(): GodotValue {
    this.expect('{');
    const entries: GodotEntry[] = [];
    this.skipTrivia();
    if (this.eat('}')) return { kind: 'dict', entries };
    for (;;) {
      this.skipTrivia();
      // Dictionary keys are Variants, not identifiers. Most documents use strings/StringNames,
      // but typed resource dictionaries write keys such as `ExtResource("4_skill")`. Keep the
      // familiar canonical text key for existing consumers and carry the actual Variant beside it.
      const keyStart = this.index;
      const quoted = this.readQuoted();
      let key: string;
      let keyValue: GodotValue | undefined;
      if (quoted !== undefined) {
        key = quoted.text;
        if (quoted.sigil !== undefined) keyValue = sigilValue(quoted.sigil, quoted.text);
      } else {
        keyValue = this.readValue();
        key = this.text.slice(keyStart, this.index).trim();
      }
      this.skipTrivia();
      this.expect(':');
      entries.push({ key, ...(keyValue === undefined ? {} : { keyValue }), value: this.readValue() });
      this.skipTrivia();
      if (this.eat(',')) {
        this.skipTrivia();
        if (this.eat('}')) break;
        continue;
      }
      if (this.eat('}')) break;
      this.fail('expected "," or "}" in dictionary');
    }
    return { kind: 'dict', entries };
  }
}

/**
 * Parse one Godot text-format file. `resPath` is used only for error messages — pass the
 * `res://…` spelling so a diagnostic reads the way the project itself does.
 */
export function parseGodotTextFile(text: string, resPath: string): GodotTextFile {
  const scanner = new Scanner(text, resPath);
  const leading: Record<string, GodotValue> = {};
  const sections: GodotSection[] = [];
  let current: { kind: string; attributes: Record<string, GodotValue>; properties: Record<string, GodotValue>; line: number } | undefined;

  for (;;) {
    scanner.skipTrivia();
    if (scanner.atEnd()) break;

    if (scanner.peek() === '[') {
      const at = scanner.position;
      scanner.expect('[');
      scanner.skipTrivia();
      const kind = scanner.readKey();
      const attributes: Record<string, GodotValue> = {};
      for (;;) {
        scanner.skipTrivia();
        if (scanner.eat(']')) break;
        const key = scanner.readKey();
        scanner.skipTrivia();
        scanner.expect('=');
        attributes[key] = scanner.readValue();
      }
      current = { kind, attributes, properties: {}, line: scanner.lineOf(at) };
      sections.push(current);
      continue;
    }

    const key = scanner.readPropertyKey();
    scanner.skipTrivia();
    scanner.expect('=');
    const value = scanner.readValue();
    if (current === undefined) leading[key] = value;
    else current.properties[key] = value;
  }

  return { resPath, leading, sections };
}

const RESOURCE_IDENTITY_HEADER_KINDS = ['gd_scene', 'gd_resource', 'ext_resource'] as const;

function resourceIdentityHeaderLine(line: string): string | undefined {
  let start = 0;
  while (line[start] === ' ' || line[start] === '\t') start++;
  for (const kind of RESOURCE_IDENTITY_HEADER_KINDS) {
    const prefix = `[${kind}`;
    if (!line.startsWith(prefix, start)) continue;
    const boundary = line[start + prefix.length];
    if (boundary === ']' || boundary === ' ' || boundary === '\t') return line;
  }
  return undefined;
}

/**
 * Parse only the canonical single-line headers that establish a text resource's UID graph.
 *
 * The resolver runs before the real document reader and needs no property bodies, so feeding every
 * scene through the complete value parser doubled the dominant parse work. This scanner selects
 * whole header lines only at statement depth and then hands those lines back to
 * {@link parseGodotTextFile}; attribute strings, escapes, constructors, and malformed headers are
 * therefore still interpreted or rejected by the one canonical parser rather than by regexes.
 * Quote/depth tracking exists solely to avoid mistaking a header-shaped line inside a multiline
 * string or collection for a section. The optional UTF-8 BOM is accepted only at byte zero, exactly
 * like {@link Scanner.skipTrivia}; an embedded BOM never becomes a synthetic header.
 */
export function parseGodotTextResourceMetadata(text: string, resPath: string): GodotTextFile {
  const headers: string[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let lineStart = text.startsWith('\uFEFF') ? 1 : 0;
  let lineNumber = 1;

  for (let index = lineStart; index <= text.length; index++) {
    if (index !== text.length && text[index] !== '\n') continue;
    const rawLine = text.slice(lineStart, index);
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const atStatementDepth = !inString && depth === 0;
    if (atStatementDepth) {
      const header = resourceIdentityHeaderLine(line);
      if (header !== undefined) headers.push(header);
    }

    let firstNonWhitespace = -1;
    for (let cursor = 0; cursor < line.length; cursor++) {
      const char = line[cursor] as string;
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '\uFEFF') {
        throw new GodotParseError(
          'UTF-8 BOM is only valid at byte zero',
          resPath,
          lineNumber,
          cursor + 1,
        );
      }
      if (firstNonWhitespace < 0 && char !== ' ' && char !== '\t') {
        firstNonWhitespace = cursor;
        if (char === ';' || char === '#') break;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '[' || char === '{' || char === '(') depth++;
      else if (char === ']' || char === '}' || char === ')') depth = Math.max(0, depth - 1);
    }
    if (inString && escaped) escaped = false;
    lineStart = index + 1;
    lineNumber++;
  }

  return parseGodotTextFile(headers.join('\n'), resPath);
}
