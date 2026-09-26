/**
 * Godot XMLParser's pull cursor over the native `saxes` streaming parser.
 *
 * `saxes` owns XML tokenization, entity decoding, names, attributes, and source positions. This
 * module translates that native token stream into Godot 3.6/4.7's cached current-node protocol:
 * `read()` advances once and getters never advance. Files come from the existing project-owned
 * FileAccess filesystem; compat owns neither fetching nor another resource registry.
 */

import { SaxesParser } from 'saxes';
import { GodotFileAccess } from './file-access';

export const XmlNodeType = {
  NODE_NONE: 0,
  NODE_ELEMENT: 1,
  NODE_ELEMENT_END: 2,
  NODE_TEXT: 3,
  NODE_COMMENT: 4,
  NODE_CDATA: 5,
  NODE_UNKNOWN: 6,
} as const;

export type XmlNodeTypeValue = (typeof XmlNodeType)[keyof typeof XmlNodeType];

const OK = 0;
const ERR_FILE_NOT_FOUND = 7;
const ERR_FILE_CORRUPT = 16;
const ERR_FILE_EOF = 18;
const ERR_INVALID_DATA = 30;

interface XmlAttribute {
  readonly name: string;
  readonly value: string;
}

interface XmlToken {
  readonly type: XmlNodeTypeValue;
  readonly name: string;
  readonly data: string;
  readonly attributes: readonly XmlAttribute[];
  readonly empty: boolean;
  readonly line: number;
}

const NONE: XmlToken = {
  type: XmlNodeType.NODE_NONE,
  name: '',
  data: '',
  attributes: [],
  empty: false,
  line: 0,
};

function attributeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'value' in value) {
    return String((value as { readonly value: unknown }).value);
  }
  return String(value);
}

function rawProcessingInstruction(xml: string, endPosition: number): string {
  const end = xml.lastIndexOf('>', endPosition - 1);
  const start = xml.lastIndexOf('<?', end);
  if (start < 0 || end < start) {
    throw new Error(
      'godot-compat: saxes reported an XML processing instruction without a source span.',
    );
  }
  // Godot starts at the '?' immediately after '<' and stops immediately before '>'.
  return xml.slice(start + 1, end);
}

function rawDoctype(xml: string, endPosition: number): string {
  const end = xml.lastIndexOf('>', endPosition - 1);
  const start = xml.lastIndexOf('<!DOCTYPE', end);
  if (start < 0 || end < start) {
    throw new Error('godot-compat: saxes reported an XML doctype without a source span.');
  }
  // `_parse_comment()` skips '<!' and preserves the rest, including DTD whitespace and children.
  return xml.slice(start + 2, end);
}

function tokenize(xml: string): readonly XmlToken[] {
  // Saxes applies XML's CR/CRLF normalization while Godot's byte cursor preserves CR in token
  // content and increments current_line only on LF. Refuse that unmeasured source shape rather
  // than silently changing text, declaration, DTD, or line semantics.
  if (xml.includes('\r')) {
    throw new Error(
      'godot-compat: XMLParser cannot carry carriage returns exactly; use LF source bytes.',
    );
  }
  if (xml.startsWith('\uFEFF')) {
    throw new Error(
      'godot-compat: XMLParser cannot carry a UTF-8 BOM exactly; saxes discards it while Godot exposes its bytes as text.',
    );
  }
  const tokens: XmlToken[] = [];
  const parser = new SaxesParser({ xmlns: false });
  const newlineOffsets: number[] = [];
  for (let index = xml.indexOf('\n'); index >= 0; index = xml.indexOf('\n', index + 1)) {
    newlineOffsets.push(index);
  }
  const lineAt = (position: number): number => {
    let low = 0;
    let high = newlineOffsets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if ((newlineOffsets[middle] ?? Number.POSITIVE_INFINITY) < position) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  // Godot 4 counts LF bytes consumed through the end of the current token. Saxes' public
  // position is the next source character, so count source LF offsets strictly before it.
  const line = (): number => lineAt(parser.position);
  let currentAttributes: readonly XmlAttribute[] = [];
  let currentEmpty = false;
  const leadingWhitespace = /^[ \t\n]+/.exec(xml)?.[0] ?? '';
  if (leadingWhitespace.length >= 3) {
    // Saxes intentionally discards document-leading whitespace. Godot reports it when its source
    // span is at least three bytes, under the same rule as every other text span.
    tokens.push({
      type: XmlNodeType.NODE_TEXT,
      name: '',
      data: leadingWhitespace,
      attributes: currentAttributes,
      empty: currentEmpty,
      line: lineAt(leadingWhitespace.length),
    });
  }
  parser.on('error', (cause) => {
    throw new Error(
      `godot-compat: XMLParser cannot carry malformed XML through saxes: ${cause.message}`,
      { cause },
    );
  });
  parser.on('xmldecl', () => {
    tokens.push({
      type: XmlNodeType.NODE_UNKNOWN,
      name: rawProcessingInstruction(xml, parser.position),
      data: '',
      attributes: currentAttributes,
      empty: currentEmpty,
      line: line(),
    });
  });
  parser.on('attribute', () => {
    // Saxes normalizes literal XML whitespace inside attribute values. Godot's hand parser keeps
    // those source bytes and only entity-decodes them, so reject the differing shape by name.
    const close = parser.position - 1;
    const quote = xml[close];
    if (quote !== '"' && quote !== "'") return;
    const open = xml.lastIndexOf(quote, close - 1);
    if (open >= 0 && /[\t\n]/.test(xml.slice(open + 1, close))) {
      throw new Error(
        'godot-compat: XMLParser cannot carry literal tab/newline attribute whitespace exactly.',
      );
    }
  });
  parser.on('opentag', (tag) => {
    currentAttributes = Object.entries(tag.attributes).map(([name, value]) => ({
      name,
      value: attributeValue(value),
    }));
    currentEmpty = tag.isSelfClosing;
    tokens.push({
      type: XmlNodeType.NODE_ELEMENT,
      name: tag.name,
      data: '',
      attributes: currentAttributes,
      empty: tag.isSelfClosing,
      line: line(),
    });
  });
  parser.on('closetag', (tag) => {
    if (tag.isSelfClosing) return;
    currentAttributes = [];
    currentEmpty = false;
    tokens.push({
      type: XmlNodeType.NODE_ELEMENT_END,
      name: tag.name,
      data: '',
      attributes: [],
      empty: false,
      line: line(),
    });
  });
  parser.on('text', (data) => {
    // Both pinned majors suppress only short all-whitespace spans; whitespace length >= 3 is a
    // real NODE_TEXT. This deliberately does not call trim().
    if (data.length < 3 && /^\s*$/.test(data)) return;
    tokens.push({
      type: XmlNodeType.NODE_TEXT,
      name: '',
      data,
      attributes: currentAttributes,
      empty: currentEmpty,
      line: line(),
    });
  });
  parser.on('comment', (data) => {
    tokens.push({
      type: XmlNodeType.NODE_COMMENT,
      name: data,
      data: '',
      attributes: currentAttributes,
      empty: currentEmpty,
      line: line(),
    });
  });
  parser.on('cdata', (data) => {
    tokens.push({
      type: XmlNodeType.NODE_CDATA,
      name: data,
      data: '',
      attributes: currentAttributes,
      empty: currentEmpty,
      line: line(),
    });
  });
  parser.on('processinginstruction', () => {
    tokens.push({
      type: XmlNodeType.NODE_UNKNOWN,
      // `_ignore_definition()` preserves everything after '<' through the byte before '>'.
      name: rawProcessingInstruction(xml, parser.position),
      data: '',
      attributes: currentAttributes,
      empty: currentEmpty,
      line: line(),
    });
  });
  parser.on('doctype', () => {
    tokens.push({
      // Pinned `_parse_comment()` handles every <!…> that is not CDATA as NODE_COMMENT.
      type: XmlNodeType.NODE_COMMENT,
      name: rawDoctype(xml, parser.position),
      data: '',
      attributes: currentAttributes,
      empty: currentEmpty,
      line: line(),
    });
  });
  try {
    parser.write(xml).close();
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('godot-compat: XMLParser')) {
      throw cause;
    }
    throw new Error('godot-compat: XMLParser cannot carry malformed XML through saxes.', {
      cause,
    });
  }
  const trailingWhitespace = /[ \t\n]+$/.exec(xml)?.[0] ?? '';
  if (trailingWhitespace.length === 2) {
    // Pinned read() enters `_parse_current_node()` whenever more than one byte remains. That
    // parser suppresses a one/two-byte whitespace span, but read() still returns OK once without
    // changing ANY cached getter state. A repeated final token is the same observable pull step.
    tokens.push(tokens[tokens.length - 1] ?? NONE);
  }
  return tokens;
}

export class GodotXMLParser {
  readonly NODE_NONE = XmlNodeType.NODE_NONE;
  readonly NODE_ELEMENT = XmlNodeType.NODE_ELEMENT;
  readonly NODE_ELEMENT_END = XmlNodeType.NODE_ELEMENT_END;
  readonly NODE_TEXT = XmlNodeType.NODE_TEXT;
  readonly NODE_COMMENT = XmlNodeType.NODE_COMMENT;
  readonly NODE_CDATA = XmlNodeType.NODE_CDATA;
  readonly NODE_UNKNOWN = XmlNodeType.NODE_UNKNOWN;

  private tokens: readonly XmlToken[] = [];
  private cursor = -1;
  private current: XmlToken = NONE;

  constructor(private readonly godotMajor: 3 | 4) {}

  open(path: string): number {
    if (!GodotFileAccess.file_exists(path)) {
      this.reset();
      return ERR_FILE_NOT_FOUND;
    }
    const bytes = GodotFileAccess.get_file_as_bytes(path);
    if (bytes.length === 0) {
      this.reset();
      return ERR_FILE_CORRUPT;
    }
    return this.openText(new TextDecoder().decode(bytes));
  }

  open_buffer(bytes: Uint8Array): number {
    if (!(bytes instanceof Uint8Array)) {
      throw new TypeError('XMLParser.open_buffer requires PackedByteArray-compatible bytes.');
    }
    if (bytes.length === 0) {
      this.reset();
      return ERR_INVALID_DATA;
    }
    return this.openText(new TextDecoder().decode(bytes));
  }

  read(): number {
    const next = this.tokens[this.cursor + 1];
    if (next !== undefined) {
      this.cursor += 1;
      this.current = next;
      return OK;
    }
    return ERR_FILE_EOF;
  }

  get_node_type(): XmlNodeTypeValue {
    return this.current.type;
  }

  get_node_name(): string {
    return this.current.name;
  }

  get_node_data(): string {
    if (this.current.type !== XmlNodeType.NODE_TEXT) {
      throw new Error('XMLParser.get_node_data requires current NODE_TEXT.');
    }
    return this.current.data;
  }

  get_attribute_count(): number {
    return this.current.attributes.length;
  }

  get_attribute_name(index: number): string {
    return this.attribute(index).name;
  }

  get_attribute_value(index: number): string {
    return this.attribute(index).value;
  }

  has_attribute(name: string): boolean {
    return this.current.attributes.some((attribute) => attribute.name === String(name));
  }

  get_named_attribute_value(name: string): string {
    const found = this.current.attributes.find((attribute) => attribute.name === String(name));
    if (found === undefined) {
      throw new Error(`XMLParser current node has no attribute ${JSON.stringify(String(name))}.`);
    }
    return found.value;
  }

  get_named_attribute_value_safe(name: string): string {
    return (
      this.current.attributes.find((attribute) => attribute.name === String(name))?.value ?? ''
    );
  }

  is_empty(): boolean {
    // The native parser exposes the cached node_empty field even after a text/comment token.
    return this.current.empty;
  }

  get_current_line(): number {
    // Godot 3.6's implementation is a literal `return 0`; 4.7 reports the parser cursor line.
    return this.godotMajor === 3 ? 0 : this.current.line;
  }

  private openText(xml: string): number {
    this.reset();
    this.tokens = tokenize(xml);
    return OK;
  }

  private reset(): void {
    this.tokens = [];
    this.cursor = -1;
    this.current = NONE;
  }

  private attribute(index: number): XmlAttribute {
    if (!Number.isInteger(index)) {
      throw new RangeError(`XMLParser attribute index must be an integer; received ${String(index)}.`);
    }
    const attribute = this.current.attributes[index];
    if (attribute === undefined) {
      throw new RangeError(
        `XMLParser attribute index ${String(index)} is outside 0..${String(this.current.attributes.length - 1)}.`,
      );
    }
    return attribute;
  }
}

export function createGodotXMLParser(godotMajor: 3 | 4): GodotXMLParser {
  return new GodotXMLParser(godotMajor);
}
