/**
 * The `vgai-creation-site` serve-time transform — the source half of
 * the creation-site index.
 *
 * WHAT IT DOES. Every direct `new <Ctor>(…)` expression, plus every call used
 * directly as a variable/property initializer, in a served PROJECT module is
 * wrapped in a recorder call that hands the constructed object, plus
 * this file's path and the expression's `line:col`, to a host-side registry and
 * returns the object UNCHANGED:
 *
 *     const t = new Tile(x, y);
 *     // becomes
 *     const t = (__vgaiCS$(new Tile(x, y), 59, 17));
 *
 * Initializer calls are the factory-construction lane (`const box =
 * MeshBuilder.CreateBox(...)`). The syntactic declaration is the evidence: no
 * library name or factory signature is guessed, and primitive returns are
 * ignored by the recorder. That is what lets the editor answer "which line of the game's own source
 * created this object?" for a selected `Object3D` — the thing that makes
 * editing SimCity mean editing SimCity's files.
 *
 * WHY WRAPPING, NOT REWRITING. The whole `NewExpression` is left byte-identical
 * inside the wrapper call, so the transform is semantics-preserving by
 * construction rather than by argument:
 *   - EVALUATION ORDER — the wrapper's single argument IS the original
 *     expression, so callee and arguments evaluate exactly when they did.
 *     Nesting composes: `new A(new B())` becomes
 *     `(__vgaiCS$(new A((__vgaiCS$(new B(),…))),…))`, and B is still
 *     constructed before A.
 *   - `new.target` — untouched: the real `new` is still a real `new`, with the
 *     same callee expression.
 *   - CONSTRUCTOR RETURN VALUES — a constructor that returns an object returns
 *     it; the recorder is an identity function on its first argument.
 *   - EXOTIC CALLEES — `new (getCtor())()`, `new a.b.C()`, `new Foo` (no
 *     parens), `new Foo<T>()`, `new Foo()!` all wrap safely, because we never
 *     look at or rewrite the callee.
 * WHAT WRAPPING DOES NOT GIVE YOU FOR FREE — two re-association hazards, both
 * about the OPENING paren, both closed explicitly:
 *   1. a `new` used as another `new`'s callee (`new new Foo()()`), where a bare
 *      call would re-associate the outer `new`. The wrapper is always
 *      parenthesized, so `new (__vgaiCS$(new Foo(),…))()` parses as it did.
 *   2. a STATEMENT-INITIAL `new` after an ASI-terminated line, where a leading
 *      `(` is the call operator and swallows the previous statement's value.
 *      {@link startsAStatementInAList} decides where a `;` must precede the
 *      paren; its doc comment carries the repro and why the guard is scoped the
 *      way it is. This case is a real MISCOMPILE, not a theoretical one — it
 *      is why the second bullet exists rather than a claim that wrapping is
 *      unconditionally safe.
 *
 * PARSE-TIME POSITIONS, NOT RUNTIME ONES. The plugin registers with
 * `enforce: 'pre'`, so this runs on the file as it sits on disk — before the
 * game-globals prelude prepends its line and before esbuild transpiles TS. The
 * recorded `line:col` therefore points at the author's own source, and nothing
 * downstream can shift it: the numbers are baked into the emitted call as
 * literals.
 *
 * IDEMPOTENT, and it takes TWO checks rather than one. {@link
 * CREATION_SITE_MARKER} is emitted in the prologue and checked on entry, which
 * covers a double registration inside one pipeline (the repo-root config and
 * `server/dev.ts` both register this plugin in dev, exactly as they both
 * register the game-globals shadow). It does NOT cover the case where the two
 * passes are separated by esbuild, because esbuild DROPS the comment: the
 * second pass then sees a module with no marker and prepends a second
 * `function __vgaiCS$`, which is a `SyntaxError: Identifier '__vgaiCS$' has
 * already been declared` — the module never evaluates and the mount dies with
 * an error that names nothing about creation sites.
 *
 * That is not hypothetical and not rare: it fires for any module holding a
 * `new` expression whose file is inside BOTH root sets, which is exactly what
 * an in-tree ingest fixture folder becomes the moment someone OPENS it as a
 * project (`ingestGameShadowRoots` already covers it; `dev.ts` adds the opened
 * project root on top). Measured on the racing-game ingest's contract shim.
 * So {@link CREATION_SITE_RECORDER} — an identifier, which no minifier or
 * transpiler may remove — is checked too.
 */
import ts from 'typescript';

/** Emitted in the prologue; its presence means "already transformed". */
export const CREATION_SITE_MARKER = '/*@vgai-creation-site*/';

/** The per-module recorder identifier. Deliberately unlovely — it is a lexical
 *  declaration in the game's own module scope, and must not collide. */
export const CREATION_SITE_RECORDER = '__vgaiCS$';

/**
 * The global the recorder calls through, installed by the editor page
 * (`creation-site-registry.ts`). Read LAZILY inside the recorder — a module may
 * evaluate before the editor has installed it, and a missing global must
 * degrade to a plain identity function, never throw.
 */
export const CREATION_SITE_GLOBAL = '__vgaiRecordCreationSite';

export interface CreationSiteTransformResult {
  code: string;
  /** How many `new` expressions were stamped — the unit tests' shape assertion
   *  and the plugin's "did anything change" check. */
  sites: number;
}

/** One stamped `new` expression, in the ORIGINAL file's coordinates. */
interface SiteRange {
  start: number;
  end: number;
  /** 1-based, matching every editor-facing `file:line` we already print. */
  line: number;
  /** 0-based character offset, matching `OidEntry.col`. */
  col: number;
  /** See {@link startsAStatementInAList} — emit `;(` rather than `(`. */
  needsAsiGuard: boolean;
}

/**
 * True when this `new` is the LEFTMOST TOKEN of an `ExpressionStatement` that
 * sits in a statement LIST — and therefore when the wrapper's opening paren
 * must be preceded by a `;`.
 *
 * THE HAZARD (found in review of the first cut of this file, which emitted a
 * bare `(` everywhere). A bare paren at the start of a statement is not inert:
 * it is the call-expression operator, and JS decides statement boundaries by
 * ASI, which does NOT insert a semicolon before a token that can continue the
 * previous expression. So semicolon-less code
 *
 *     let a = foo()
 *     new Bar()
 *
 * became `let a = foo()(…new Bar()…)` — the previous line's VALUE gets called
 * with the construction as its argument. Silently wrong when `foo()` returns a
 * function; a `TypeError` at module evaluation (a bricked mount) when it
 * doesn't. Statement-initial `new` in semicolon-less style is ordinary JS
 * (`new Audio(src).play()`, side-effect constructors), and this transform runs
 * over every opened project's roots — SimCity missed it only because
 * micropolisJS is semicolon-terminated throughout.
 *
 * WHY THE `;` IS BOTH SUFFICIENT AND SAFE HERE. In a statement-list position an
 * extra `;` is an empty statement: legal everywhere a statement is, and a no-op.
 * It is emitted unconditionally rather than only after an ASI boundary, because
 * "was a semicolon already there?" is a lexical question this AST walk should
 * not be answering — `;;(…)` is exactly as correct as `;(…)`.
 *
 * WHY IT MUST NOT BE EMITTED ELSEWHERE. For a DEPENDENT single-statement body
 * the `;` would BECOME that body: `if (x) new Foo()` → `if (x) ;(…)` runs the
 * construction unconditionally, and `for (…) new Foo()` → `for (…) ;(…)` runs
 * it once instead of per iteration. Those positions need no guard anyway — the
 * token before the body is the `)` of the head (or `else`/`do`/a label), none
 * of which a `(` can continue into a call. Hence the parent test rather than a
 * blanket `;`.
 *
 * Only the LEFTMOST token matters: `foo(new Bar())` puts our paren after the
 * call's own `(`, and `!new Bar()` / `+new Bar()` keep their unary operator
 * first, so in every one of those the ASI verdict is whatever it already was.
 */
function startsAStatementInAList(node: ts.Expression, sourceFile: ts.SourceFile): boolean {
  const start = node.getStart(sourceFile);
  let current: ts.Node = node;
  // Climb while the ancestor still BEGINS at this `new` — the moment one
  // starts earlier, this expression is not the statement's first token.
  while (current.parent && current.parent.getStart(sourceFile) === start) {
    current = current.parent;
    if (ts.isExpressionStatement(current)) {
      const parent = current.parent;
      return (
        !!parent &&
        (ts.isSourceFile(parent) ||
          ts.isBlock(parent) ||
          ts.isModuleBlock(parent) ||
          ts.isCaseClause(parent) ||
          ts.isDefaultClause(parent))
      );
    }
  }
  return false;
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  // A `.js` file in a project may still contain JSX (SimCity's does not, but
  // vendored react games' `.js` sources do), and TS's JS parser accepts it.
  return ts.ScriptKind.JS;
}

/**
 * Stamp every direct `new` expression in `code`.
 *
 * `displayFile` is the path recorded for this module — project-root-RELATIVE,
 * because that string is what the inspector shows and what `vgai eval` reads
 * back; an absolute path would leak the host's directory layout into the
 * product surface.
 *
 * Returns `null` when nothing was stamped (no `new` expressions, an already
 * transformed module, or a declaration file) so the caller can hand Vite an
 * untouched module rather than an identical copy.
 */
export function transformCreationSites(
  code: string,
  displayFile: string,
): CreationSiteTransformResult | null {
  // Two idempotence checks, not one — see this module's header: the comment
  // marker does not survive an esbuild pass between two transforms, the
  // identifier does.
  if (code.includes(CREATION_SITE_MARKER) || code.includes(CREATION_SITE_RECORDER)) return null;
  if (displayFile.endsWith('.d.ts')) return null;
  // Cheap bail before paying for a parse: neither construction syntax can be
  // present without `new` or `(`. False positives only cost a parse; a false
  // negative would lose a real site.
  if (!code.includes('new') && !code.includes('(')) return null;

  const sourceFile = ts.createSourceFile(
    displayFile,
    code,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindFor(displayFile),
  );

  const sites: SiteRange[] = [];
  const isFactoryInitializer = (node: ts.CallExpression): boolean => {
    let current: ts.Expression = node;
    while (
      current.parent &&
      (ts.isParenthesizedExpression(current.parent) ||
        ts.isAsExpression(current.parent) ||
        ts.isNonNullExpression(current.parent))
    ) {
      current = current.parent;
    }
    const parent = current.parent;
    return Boolean(
      parent &&
        ((ts.isVariableDeclaration(parent) && parent.initializer === current) ||
          (ts.isPropertyDeclaration(parent) && parent.initializer === current)),
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) || (ts.isCallExpression(node) && isFactoryInitializer(node))) {
      const start = node.getStart(sourceFile);
      const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, start);
      sites.push({
        start,
        end: node.getEnd(),
        line: line + 1,
        col: character,
        needsAsiGuard: startsAStatementInAList(node, sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  if (sites.length === 0) return null;

  // Pure INSERTIONS at expression boundaries — never a replacement — so nested
  // `new` expressions (whose ranges properly contain one another) need no
  // offset arithmetic at all. The only collision possible is two CLOSING marks
  // at one offset (`new new A` ends both expressions at the same character);
  // the inner one, which is the one with the LATER start, must close first.
  const marks: Array<{ pos: number; rank: number; start: number; text: string }> = [];
  for (const site of sites) {
    marks.push({
      pos: site.start,
      rank: 1,
      start: site.start,
      text: `${site.needsAsiGuard ? ';' : ''}(${CREATION_SITE_RECORDER}(`,
    });
    marks.push({ pos: site.end, rank: 0, start: site.start, text: `,${site.line},${site.col}))` });
  }
  marks.sort((a, b) => a.pos - b.pos || a.rank - b.rank || b.start - a.start);

  let out = '';
  let cursor = 0;
  for (const mark of marks) {
    out += code.slice(cursor, mark.pos) + mark.text;
    cursor = mark.pos;
  }
  out += code.slice(cursor);

  return { code: creationSitePrologue(displayFile) + out, sites: sites.length };
}

/**
 * The recorder declaration prepended to a stamped module.
 *
 * A hoisted FUNCTION DECLARATION, not a `const`: ESM `import` statements are
 * hoisted above everything, and a stamped `new` can appear in an imported
 * module's evaluation order before this line is reached textually — a function
 * declaration is in scope for the whole module body regardless. (The
 * game-globals prelude gets away with `const` because it only shadows names
 * READ at call time.)
 *
 * The global lookup happens per call, so the recorder works whether the editor
 * installed the registry before or after this module evaluated, and an
 * uninstalled registry costs one property read and no behavior change.
 */
function creationSitePrologue(displayFile: string): string {
  return (
    `${CREATION_SITE_MARKER}function ${CREATION_SITE_RECORDER}(o,l,c){` +
    `var r=globalThis.${CREATION_SITE_GLOBAL};` +
    // `new` always yields an object, but a recorder that can throw would be a
    // recorder that can break a pristine mount — so the guard is explicit.
    `if(r&&o!==null&&(typeof o==='object'||typeof o==='function'))` +
    `r(o,${JSON.stringify(displayFile)},l,c);` +
    'return o;}\n'
  );
}
