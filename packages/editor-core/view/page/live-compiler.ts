/**
 * ONE PROJECT MODULE, COMPILED IN THE PAGE — what the session's Vite does to a game module, for a
 * file that changed after the view was built (`live-modules.ts` decides which, and serves this).
 *
 * A view's modules are recorded once, by the project's own Vite. This reproduces, for one changed
 * `src/` module, the steps of that pipeline a game module needs to run beside the recorded ones:
 *
 *  1. TypeScript and JSX to JavaScript (the automatic JSX runtime's development entry, as the
 *     session's esbuild emits), with `typescript`'s own single-file transpile.
 *  2. Every import to the URL the RECORDED modules use for the same thing, so there is one React,
 *     one three and one instance of each project module per mount: a project path gets its real
 *     extension and the request's `?volter-mount=<id>` (`vite-plugin-mount-isolation.ts`); a
 *     package is looked up among the recorded URLs, with the named-import interop Vite writes
 *     for a prebundled CommonJS package.
 *  3. The game-globals prelude, with the mount id baked in (`vite-plugin-game-globals.ts`), and
 *     the realm's `recordModuleUrl` line.
 *
 * NOT reproduced, and said in docs/LIMITED-VIEW.md: the creation-site and animation stamps (the
 * inspector's source addresses for objects made by an edited file), `import.meta.env`, hot
 * acceptance (a change remounts), CSS and asset imports the build did not record, and any
 * package the build did not record: there is no installer in a tab.
 *
 * Its own chunk (`__view/live-compiler.js`), loaded on the first edit: it carries the TypeScript
 * compiler.
 */

import { init, parse } from 'es-module-lexer';
import ts from 'typescript';
import { gameGlobalsPrelude } from '@volter/editor-sdk/kit/game-globals-prelude';

export interface LiveCompileRequest {
  /** Project-relative path of the module, `/`-separated. */
  readonly path: string;
  readonly source: string;
  /** The `?volter-mount=<id>` the module was asked for under, if any. */
  readonly mountId: string | null;
  /** How many changes the page has seen: with no mount id, project imports carry it as `?t=`, the
   *  cache-buster the session's Vite uses (the worker's recorded lookup ignores it). */
  readonly revision: number;
  /** Whether a project-relative path is a file now. */
  exists(path: string): Promise<boolean>;
  /** Every URL the view recorded (`__view/routes.json`'s keys). */
  readonly recorded: readonly string[];
}

/** A module that cannot be compiled here, in words for the person who edited it. */
export class LiveCompileError extends Error {}

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs'];

function dirname(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

/** `base` + a relative specifier, as a project-relative path; null when it leaves the project. */
function join(base: string, relative: string): string | null {
  const out = base === '' ? [] : base.split('/');
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(segment);
  }
  return out.join('/');
}

/** Vite's name for a prebundled package's file (`flattenId`). */
const flattened = (specifier: string): string => specifier.replace(/[/:]/g, '_').replace(/\./g, '__');
const pathnameOf = (url: string): string => url.split('?')[0]!;

/** The recorded URL the view's own modules import `specifier` (a package) by, or null. */
function recordedPackage(specifier: string, recorded: readonly string[]): string | null {
  // three is one shared copy behind a doorway module (`vite-plugin-shared-three.ts`).
  if (specifier === 'three') {
    const doorway = recorded.find((url) => url.includes('volter-shared-three-doorway'));
    if (doorway) return doorway;
  }
  const prebundled = new RegExp(`/node_modules/\\.vite[^/]*/deps/${flattened(specifier).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.js$`);
  const dep = recorded.find((url) => prebundled.test(pathnameOf(url)));
  if (dep) return dep;
  // A package served as source: its file under some node_modules.
  const tails = CODE.test(specifier) ? [`/node_modules/${specifier}`] : [`/node_modules/${specifier}.js`, `/node_modules/${specifier}/index.js`];
  return recorded.find((url) => tails.some((tail) => pathnameOf(url).endsWith(tail))) ?? null;
}

const exportsOf = new Map<string, Promise<ReadonlySet<string>>>();
/** What a recorded module exports. A prebundled CommonJS package exports `default` alone. */
function recordedExports(url: string): Promise<ReadonlySet<string>> {
  let known = exportsOf.get(url);
  if (!known) {
    known = fetch(url)
      .then((response) => response.text())
      .then((text) => new Set(parse(text)[1].map((exported) => exported.n)));
    exportsOf.set(url, known);
  }
  return known;
}

interface ImportClause {
  readonly defaultName: string | null;
  readonly namespace: string | null;
  readonly named: readonly (readonly [imported: string, local: string])[];
}

/** The bindings of one `import … from` statement as TypeScript prints it; null for any other shape. */
function clauseOf(statement: string): ImportClause | null {
  const match = /^import\s+([\s\S]+?)\s+from\s*["']/.exec(statement);
  if (!match) return null;
  let rest = match[1]!.trim();
  let defaultName: string | null = null;
  let namespace: string | null = null;
  const named: (readonly [string, string])[] = [];
  const leading = /^([A-Za-z_$][\w$]*)\s*(?:,\s*)?/.exec(rest);
  if (leading && !rest.startsWith('{') && !rest.startsWith('*')) {
    defaultName = leading[1]!;
    rest = rest.slice(leading[0].length).trim();
  }
  if (rest.startsWith('*')) {
    const star = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(rest);
    if (!star) return null;
    namespace = star[1]!;
  } else if (rest.startsWith('{')) {
    if (!rest.endsWith('}')) return null;
    for (const part of rest.slice(1, -1).split(',').map((piece) => piece.trim()).filter(Boolean)) {
      const pair = /^([A-Za-z_$][\w$]*|"[^"]*")(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
      if (!pair) return null;
      const imported = pair[1]!.startsWith('"') ? (JSON.parse(pair[1]!) as string) : pair[1]!;
      named.push([imported, pair[2] ?? imported]);
    }
  } else if (rest !== '') return null;
  return { defaultName, namespace, named };
}

/**
 * Compile one changed project module to the JavaScript the browser imports.
 * Throws {@link LiveCompileError} with what stands in the way.
 */
export async function compileLiveModule(request: LiveCompileRequest): Promise<string> {
  const { path, mountId, recorded } = request;
  await init;

  const transpiled = ts.transpileModule(request.source, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSXDev,
      jsxImportSource: 'react',
      isolatedModules: true,
      useDefineForClassFields: true,
      sourceMap: false,
    },
  });
  const broken = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (broken.length > 0) {
    const first = broken[0]!;
    const where = first.file && first.start !== undefined ? first.file.getLineAndCharacterOfPosition(first.start) : null;
    throw new LiveCompileError(`${path}${where ? `:${where.line + 1}:${where.character + 1}` : ''}: ${ts.flattenDiagnosticMessageText(first.messageText, '\n')}`);
  }
  const code = transpiled.outputText;

  const projectUrl = async (specifier: string): Promise<string> => {
    // Root-absolute is the project root's, as the project-rooted Vite resolves it.
    const start = specifier.startsWith('/') ? join('', specifier) : join(dirname(path), specifier);
    if (start === null) throw new LiveCompileError(`${path} imports ${specifier}, which is outside the project.`);
    // A TypeScript file may name its sibling by the `.js` it compiles to.
    const stem = start.replace(/\.[cm]?jsx?$/, '');
    const candidates = [start, ...CODE_EXTENSIONS.map((extension) => `${start}${extension}`), ...(stem === start ? [] : CODE_EXTENSIONS.map((extension) => `${stem}${extension}`)), ...CODE_EXTENSIONS.map((extension) => `${start}/index${extension}`)];
    for (const candidate of candidates) {
      if (!(await request.exists(candidate))) continue;
      if (CODE.test(candidate)) return `/${candidate}${mountId !== null ? `?volter-mount=${mountId}` : request.revision > 0 ? `?t=${request.revision}` : ''}`;
      // JSON, CSS, an asset: only as the build compiled it.
      const built = recorded.find((url) => pathnameOf(url) === `/${candidate}`);
      if (built) return built;
      throw new LiveCompileError(`${path} imports ${specifier}. This view's build did not compile that file as a module, and the browser view compiles only scripts.`);
    }
    throw new LiveCompileError(`${path} imports ${specifier}, and there is no such file in the project.`);
  };

  const [imports] = parse(code);
  let out = '';
  let cursor = 0;
  let interop = 0;
  for (const found of imports) {
    const specifier = found.n;
    // `import.meta`, and an import whose target is computed at run time, are left as written.
    if (specifier === undefined) continue;
    const dynamic = found.d > -1;
    const own = specifier.startsWith('.') || specifier.startsWith('/');
    let url: string;
    if (own) url = await projectUrl(specifier);
    else {
      const packaged = recordedPackage(specifier, recorded);
      if (packaged === null) {
        throw new LiveCompileError(`${path} imports '${specifier}', which this view's build does not include. A package cannot be added in the browser: install it in the local editor.`);
      }
      url = packaged;
    }
    if (dynamic) {
      out += code.slice(cursor, found.s) + JSON.stringify(url);
      cursor = found.e;
      continue;
    }
    const statement = code.slice(found.ss, found.se);
    // `export … from` a package: by URL when the recorded module has the names; for a prebundled
    // CommonJS package (its one export is `default`) each name is read off the module object.
    if (!own && /^export\b/.test(statement)) {
      if (![...(await recordedExports(url))].every((name) => name === 'default')) {
        out += code.slice(cursor, found.s) + url;
        cursor = found.e;
        continue;
      }
      const listed = /^export\s*\{([\s\S]*)\}\s*from\s*["']/.exec(statement);
      if (!listed) throw new LiveCompileError(`${path} re-exports everything from '${specifier}', a package this view holds as one object. Name what you re-export: export { a, b } from '${specifier}'.`);
      const whole = `__volter_cjs_${interop++}`;
      const lines = [`import ${whole} from ${JSON.stringify(url)};`];
      const names: string[] = [];
      for (const part of listed[1]!.split(',').map((piece) => piece.trim()).filter(Boolean)) {
        const pair = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part);
        if (!pair) throw new LiveCompileError(`${path}: this view cannot compile the re-export '${part}' from '${specifier}'.`);
        const local = `${whole}_${names.length}`;
        lines.push(`const ${local} = ${pair[1] === 'default' ? `(${whole} && ${whole}.__esModule ? ${whole}.default : ${whole})` : `${whole}[${JSON.stringify(pair[1])}]`};`);
        names.push(`${local} as ${pair[2] ?? pair[1]!}`);
      }
      lines.push(`export { ${names.join(', ')} }`);
      out += code.slice(cursor, found.ss) + lines.join(' ');
      cursor = found.se;
      continue;
    }
    const clause = own ? null : clauseOf(statement);
    const needsInterop = clause !== null && (clause.named.length > 0 || clause.namespace !== null || clause.defaultName !== null)
      && [...(await recordedExports(url))].every((name) => name === 'default');
    if (clause === null || !needsInterop) {
      out += code.slice(cursor, found.s) + url;
      cursor = found.e;
      continue;
    }
    // Vite's interop for a prebundled CommonJS package: its one export is the module object.
    const whole = `__volter_cjs_${interop++}`;
    const lines = [`import ${whole} from ${JSON.stringify(url)};`];
    if (clause.defaultName) lines.push(`const ${clause.defaultName} = ${whole} && ${whole}.__esModule ? ${whole}.default : ${whole};`);
    if (clause.namespace) lines.push(`const ${clause.namespace} = ${whole};`);
    for (const [imported, local] of clause.named) lines.push(`const ${local} = ${whole}[${JSON.stringify(imported)}];`);
    out += code.slice(cursor, found.ss) + lines.join(' ');
    cursor = found.se;
  }
  out += code.slice(cursor);

  return `${gameGlobalsPrelude(mountId ?? undefined)}\n${out}${mountId === null ? '' : '\n;__volterR?.recordModuleUrl(import.meta.url);\n'}`;
}
