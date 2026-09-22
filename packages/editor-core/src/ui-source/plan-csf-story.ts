/**
 * CSF STORY WRITES — the planner behind "save these args as a story",
 * rename, and delete (the design ledger's CSF-writing order: stories are
 * discovered, composed, framed and switched, and until this nothing WROTE
 * one except Extract Component's emitted file).
 *
 * Pure text surgery over the module source, in the repo's writer idiom
 * (`plan-extract-component.ts` is the emit-shape precedent): every refusal
 * is a named sentence, and nothing here parses with a full AST — a CSF
 * story export is a top-level `export const <Name>` with a braced
 * initializer, and balanced-brace scanning over that shape is the whole
 * grammar this file needs. Anything outside the shape refuses rather than
 * guessing.
 *
 * IT STAYS IN THE HOST, and the reason is the same one unit 6 recorded for the
 * harness and generation estates: its caller is the SERVER tier
 * (`vite-plugin-ui-oid.ts`'s `POST /__ui-source/csf-story`), and the
 * contribution points are page-side only — there is no server-side `.service`
 * or route point for a package to register a handler into. It was moved out
 * once and came straight back when the probe refused to boot: a grep over
 * `src` and `server` had reported zero importers, and the one importer is a
 * file at the package ROOT. (CLAUDE.md: never conclude "dead code" from a
 * search that returned zero.)
 */

/** One planned edit: the whole next source, or the refusal. */
export type CsfStoryPlan =
  | { ok: true; nextSource: string; summary: string }
  | { ok: false; reason: string };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Find `export const <name>` at top level; returns [start, endAfterSemi]. */
function findStoryExport(source: string, name: string): [number, number] | null {
  const re = new RegExp(`^export const ${name}\\b`, 'm');
  const m = re.exec(source);
  if (!m) return null;
  const eq = source.indexOf('=', m.index);
  if (eq < 0) return null;
  // Balanced scan from the first brace after `=` (a story initializer is an
  // object literal; a non-object initializer refuses at the caller).
  const braceStart = source.indexOf('{', eq);
  if (braceStart < 0) return null;
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        if (source[end] === ';') end++;
        if (source[end] === '\n') end++;
        return [m.index, end];
      }
    }
  }
  return null;
}

/** The file's story TYPE annotation, when it declares the common alias
 *  (`type Story = StoryObj<…>`); an un-annotated export is valid CSF, so
 *  absence simply drops the annotation. */
function storyTypeAlias(source: string): string | null {
  const m = /^(?:export )?type (\w+) = StoryObj\b/m.exec(source);
  return m?.[1] ?? null;
}

/** Serialize args to a JS object literal. JSON-shaped values only — a
 *  function/symbol/undefined arg refuses BY KEY, because emitting source
 *  that silently drops an arg would author a different story than the one
 *  on screen. */
function serializeArgs(
  args: Readonly<Record<string, unknown>>,
): CsfStoryPlan | { literal: string } {
  const unserializable = Object.entries(args)
    .filter(([, value]) => {
      if (value === null || value === undefined) return value === undefined;
      const t = typeof value;
      if (t === 'function' || t === 'symbol' || t === 'bigint') return true;
      try {
        return JSON.stringify(value) === undefined;
      } catch {
        return true;
      }
    })
    .map(([key]) => key);
  if (unserializable.length > 0) {
    return {
      ok: false,
      reason:
        `args ${unserializable.join(', ')} cannot be written as literals (function/symbol/` +
        'undefined values have no CSF source form) — set them in the story file by hand',
    };
  }
  const body = Object.entries(args)
    .map(([key, value]) => {
      const keyText = IDENTIFIER.test(key) ? key : JSON.stringify(key);
      return `    ${keyText}: ${JSON.stringify(value)},`;
    })
    .join('\n');
  return { literal: body.length > 0 ? `{\n${body}\n  }` : '{}' };
}

/** Append `export const <name>(: Alias)? = { args: {…} };` to the module. */
export function planSaveStory(
  source: string,
  name: string,
  args: Readonly<Record<string, unknown>>,
): CsfStoryPlan {
  if (!IDENTIFIER.test(name)) {
    return { ok: false, reason: `'${name}' is not a valid story export name (identifier)` };
  }
  if (findStoryExport(source, name) || new RegExp(`^export const ${name}\\b`, 'm').test(source)) {
    return { ok: false, reason: `a story named '${name}' already exists in this file` };
  }
  const serialized = serializeArgs(args);
  if ('ok' in serialized) return serialized;
  const alias = storyTypeAlias(source);
  const annotation = alias ? `: ${alias}` : '';
  const argsPart = serialized.literal === '{}' ? '' : `\n  args: ${serialized.literal},\n`;
  const block = `\nexport const ${name}${annotation} = {${argsPart}};\n`;
  const nextSource = source.endsWith('\n') ? source + block.slice(1) : source + block;
  return { ok: true, nextSource, summary: `story '${name}' appended` };
}

/**
 * Rename the export. Only the DECLARATION and `defaultStory: '<old>'`
 * references move; any other in-file use of the identifier refuses by name
 * (a broad textual rename would rewrite code this planner cannot see the
 * meaning of).
 */
export function planRenameStory(source: string, oldName: string, newName: string): CsfStoryPlan {
  if (!IDENTIFIER.test(newName)) {
    return { ok: false, reason: `'${newName}' is not a valid story export name (identifier)` };
  }
  const span = findStoryExport(source, oldName);
  if (!span) return { ok: false, reason: `no story export named '${oldName}' in this file` };
  if (new RegExp(`^export const ${newName}\\b`, 'm').test(source)) {
    return { ok: false, reason: `a story named '${newName}' already exists in this file` };
  }
  const outside = source.slice(0, span[0]) + source.slice(span[1]);
  const otherUses = [...outside.matchAll(new RegExp(`\\b${oldName}\\b`, 'g'))].filter((m) => {
    // string references to the story NAME (defaultStory: 'Old') are renamed
    // too; bare identifier uses are the refusal.
    const before = outside.slice(Math.max(0, (m.index ?? 0) - 1), m.index);
    const after = outside.slice(
      (m.index ?? 0) + oldName.length,
      (m.index ?? 0) + oldName.length + 1,
    );
    const quoted = (before === "'" && after === "'") || (before === '"' && after === '"');
    return !quoted;
  });
  if (otherUses.length > 0) {
    return {
      ok: false,
      reason:
        `'${oldName}' is referenced ${otherUses.length} more time(s) in this file beyond its ` +
        'declaration — rename it in source, where those uses are visible',
    };
  }
  let nextSource =
    source.slice(0, span[0]) +
    source.slice(span[0], span[1]).replace(`export const ${oldName}`, `export const ${newName}`) +
    source.slice(span[1]);
  nextSource = nextSource
    .replaceAll(`defaultStory: '${oldName}'`, `defaultStory: '${newName}'`)
    .replaceAll(`defaultStory: "${oldName}"`, `defaultStory: "${newName}"`);
  return { ok: true, nextSource, summary: `story '${oldName}' renamed to '${newName}'` };
}

/** Remove the export block. The LAST story refuses (an empty CSF file fails
 *  composition — delete the file instead), and a `defaultStory` reference
 *  refuses by name rather than leaving a dangling default. */
export function planDeleteStory(source: string, name: string): CsfStoryPlan {
  const span = findStoryExport(source, name);
  if (!span) return { ok: false, reason: `no story export named '${name}' in this file` };
  const outside = source.slice(0, span[0]) + source.slice(span[1]);
  if (!/^export const \w+/m.test(outside)) {
    return {
      ok: false,
      reason:
        `'${name}' is the last story in this file — an empty CSF file fails composition; ` +
        'delete the file instead',
    };
  }
  if (outside.includes(`defaultStory: '${name}'`) || outside.includes(`defaultStory: "${name}"`)) {
    return {
      ok: false,
      reason:
        `'${name}' is this file's declared defaultStory — point vgai.defaultStory at another ` +
        'story first',
    };
  }
  return { ok: true, nextSource: outside, summary: `story '${name}' deleted` };
}
