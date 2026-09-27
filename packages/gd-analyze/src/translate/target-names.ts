/** Target-language names derived mechanically from authored Godot names and paths. */

/** JavaScript reserved words a GDScript identifier may collide with. */
const JS_RESERVED: ReadonlySet<string> = new Set([
  'arguments', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'eval', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'null', 'package', 'private', 'protected', 'public', 'return', 'static', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while',
  'with', 'yield',
]);

/** A GDScript identifier as a safe TypeScript identifier. */
export function safeIdent(name: string): string {
  return JS_RESERVED.has(name) ? `$${name}` : name;
}

/** A Godot node name as a TypeScript identifier. */
export function identFromNodeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned === '' ? '_' : safeIdent(cleaned);
}

/** A source-authored node name as a React component identifier. */
export function componentNameFromNodeName(name: string): string {
  const ident = identFromNodeName(name);
  return ident.charAt(0).toUpperCase() + ident.slice(1);
}

/** `res://src/actor/Player.tscn` → `Player`. */
export function classNameFromResPath(resPath: string): string {
  const base = resPath.replace(/^res:\/\//, '').replace(/\.[^./]+$/, '');
  const last = base.split('/').pop() ?? base;
  return componentNameFromNodeName(last);
}
