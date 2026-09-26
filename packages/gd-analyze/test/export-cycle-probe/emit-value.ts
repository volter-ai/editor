/**
 * export-cycle-probe/emit-value.ts — GodotValue → Godot text-format spelling.
 *
 * Inverse of `read/text-format.ts`'s value grammar. Identity is SEMANTIC: the reader re-parses
 * this text into an equivalent `GodotValue`. Whitespace, key order Godot's own writer would
 * reshuffle, and float spelling are writer-normalization, not smuggled state.
 */
import type { GodotValue, ResourceId } from '../../src/read/godot-value';

const BARE_KEY = /^[^\s=[\]{}(),:"']+$/;

export function emitNumber(value: number): string {
  if (Object.is(value, -0)) return '-0';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';
  if (Number.isNaN(value)) return 'nan';
  if (Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) return String(value);
  const plain = value.toString();
  if (Number(plain) === value) return plain;
  return value.toPrecision(17);
}

export function emitQuoted(text: string): string {
  let out = '"';
  for (const char of text) {
    if (char === '\\') out += '\\\\';
    else if (char === '"') out += '\\"';
    else if (char === '\n') out += '\\n';
    else if (char === '\t') out += '\\t';
    else if (char === '\r') out += '\\r';
    else out += char;
  }
  return `${out}"`;
}

export function emitPropertyKey(key: string): string {
  return BARE_KEY.test(key) ? key : emitQuoted(key);
}

export function emitResourceId(id: ResourceId): string {
  return typeof id === 'number' ? String(id) : emitQuoted(id);
}

export function emitExtResourceRef(id: ResourceId): string {
  return typeof id === 'number' ? `ExtResource( ${id} )` : `ExtResource(${emitQuoted(id)})`;
}

export function emitSubResourceRef(id: ResourceId): string {
  return typeof id === 'number' ? `SubResource( ${id} )` : `SubResource(${emitQuoted(id)})`;
}

export function emitGodotValue(value: GodotValue): string {
  switch (value.kind) {
    case 'string':
      return emitQuoted(value.value);
    case 'number':
      return emitNumber(value.value);
    case 'bool':
      return value.value ? 'true' : 'false';
    case 'null':
      return 'null';
    case 'ident':
      return value.name;
    case 'array': {
      const body = `[ ${value.items.map(emitGodotValue).join(', ')} ]`;
      if (value.elementType === undefined) return body;
      return `Array[${emitGodotValue(value.elementType)}](${body})`;
    }
    case 'dict': {
      if (value.entries.length === 0) return '{}';
      const lines = value.entries.map(
        (entry) => `${emitQuoted(entry.key)}: ${emitGodotValue(entry.value)}`,
      );
      return `{\n${lines.join(',\n')}\n}`;
    }
    case 'ctor': {
      const parts: string[] = [
        ...value.args.map(emitGodotValue),
        ...value.fields.map((field) => `${emitQuoted(field.key)}:${emitGodotValue(field.value)}`),
      ];
      if (parts.length === 0) return `${value.name}()`;
      return `${value.name}( ${parts.join(', ')} )`;
    }
  }
}

export function emitHeaderAttributes(attributes: Readonly<Record<string, GodotValue>>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    parts.push(`${key}=${emitGodotValue(value)}`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

export function emitPropertyBlock(properties: Readonly<Record<string, GodotValue>>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(properties)) {
    lines.push(`${emitPropertyKey(key)} = ${emitGodotValue(value)}`);
  }
  return lines.join('\n');
}
