/**
 * "Does THIS project interpret utility classes?" — the evidence gate in front of
 * `writeStyleAuto`'s className route.
 *
 * Why it exists: the router used to pick the Tailwind arbitrary-value class
 * (`bg-[#059669]`) whenever an element merely HAD a literal `className`, with no
 * evidence anything would ever compile that class. On a plain-CSS project the
 * write lands in source and paints NOTHING — measured on the vendored pmndrs
 * racing-game (plain Vite + `src/styles.css`, no tailwind in its tree or ours):
 * the editor's visible result was only the adapter's optimistic inline patch, a
 * cold remount rendered `rgba(0, 0, 0, 0)`, and the game's own build has no
 * transformer for it either. Inert bytes in someone's source that tell a lie
 * about their game.
 *
 * The fix is the same observation-over-inference rule the OID dialect decision
 * follows: route on what was OBSERVED about the project, not on what the
 * element's shape suggests. A tier gathers evidence with whatever I/O it has
 * (`node:fs` on the dev server, `StorageBackend` in the hosted browser) and
 * hands the bytes here; the decision itself is pure and lives ONLY here, so the
 * two tiers cannot drift into different answers.
 *
 * **The probe is deliberately strict, and the asymmetry is why.** A false
 * NEGATIVE costs an inline `style={{…}}` write — a less idiomatic expression of
 * the same edit that paints correctly in every project, in and out of the
 * editor. A false POSITIVE costs a write that is a lie. So "a dependency is
 * listed" is not enough on its own: something must also show the pipeline is
 * actually wired (a config file, a postcss/vite/astro plugin mention, or a css
 * entry that imports the framework). A CDN/runtime interpreter in HTML stands
 * alone because it needs no build step at all.
 */

/** The routing answer, plus what was actually observed to produce it. */
export interface UtilityClassSupport {
  /** True only when the project was OBSERVED to interpret utility classes. */
  readonly supported: boolean;
  /** What was (or was not) found — quoted verbatim in a refusal message. */
  readonly evidence: string;
}

/**
 * The answer when nothing was probed at all. It is `supported: false` because
 * an unprobed project is an unproven one, and the honest route for an unproven
 * project is the inline style that works everywhere.
 */
export const UTILITY_CLASSES_UNPROVEN: UtilityClassSupport = {
  supported: false,
  evidence: 'no utility-class pipeline was probed for this project',
};

/**
 * Root-relative files a tier should read when it can. Config files are listed
 * by exact name (a probe should not have to guess extensions); the css/html
 * evidence is found by extension instead — see {@link isUtilityClassEvidenceFile}.
 */
export const UTILITY_CLASS_EVIDENCE_FILES: readonly string[] = [
  'package.json',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts',
  'uno.config.js',
  'uno.config.ts',
  'unocss.config.js',
  'unocss.config.ts',
  'postcss.config.js',
  'postcss.config.cjs',
  'postcss.config.mjs',
  'postcss.config.ts',
  'vite.config.js',
  'vite.config.ts',
  'astro.config.mjs',
  'astro.config.ts',
];

/** Extensions worth scanning for a framework entry marker (`@tailwind`, a CDN script). */
export const UTILITY_CLASS_EVIDENCE_EXTENSIONS: readonly string[] = ['.css', '.html'];

/** True when `path`'s content can carry evidence — the filter a directory walk uses. */
export function isUtilityClassEvidenceFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (UTILITY_CLASS_EVIDENCE_FILES.includes(name)) return true;
  return UTILITY_CLASS_EVIDENCE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Package names whose presence means a utility-class compiler is a dependency. */
const UTILITY_PACKAGE_PREFIXES: readonly string[] = [
  'tailwindcss',
  '@tailwindcss/',
  'unocss',
  '@unocss/',
];

const CONFIG_FILE_RE = /(^|\/)(tailwind|uno|unocss)\.config\.[cm]?[jt]s$/;
const PLUGIN_HOST_RE = /(^|\/)(postcss|vite|astro)\.config\.[cm]?[jt]s$/;
const PLUGIN_MENTION_RE = /tailwindcss|unocss/;
/** Tailwind v3 directives, the v4 css import, `@apply`, and UnoCSS's own entry. */
const CSS_ENTRY_RE =
  /@tailwind\s+(base|components|utilities|variants)|@import\s+['"](tailwindcss|unocss)|@apply\s|@unocss\b/;
/** Interpreters that need no build step — the class is compiled in the page itself. */
const RUNTIME_RE = /cdn\.tailwindcss\.com|@unocss\/runtime|unocss\/runtime/;

function dependencyNames(packageJson: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/dependencies$/i.test(key) || !value || typeof value !== 'object') continue;
    names.push(...Object.keys(value as Record<string, unknown>));
  }
  return names;
}

/**
 * Decide from gathered evidence. `files` maps a root-relative path to that
 * file's text; a tier includes whatever it could read and omits the rest
 * (absence is simply less evidence, never an error).
 */
export function detectUtilityClassSupport(files: ReadonlyMap<string, string>): UtilityClassSupport {
  let dependency: string | null = null;
  let config: string | null = null;
  let plugin: string | null = null;
  let cssEntry: string | null = null;
  let runtime: string | null = null;

  for (const [path, content] of files) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    if (name === 'package.json') {
      const hit = dependencyNames(content).find((dep) =>
        UTILITY_PACKAGE_PREFIXES.some((prefix) =>
          prefix.endsWith('/') ? dep.startsWith(prefix) : dep === prefix,
        ),
      );
      if (hit) dependency ??= `"${hit}" in ${path}`;
      continue;
    }
    if (CONFIG_FILE_RE.test(path)) {
      config ??= path;
      continue;
    }
    if (PLUGIN_HOST_RE.test(path) && PLUGIN_MENTION_RE.test(content)) {
      plugin ??= path;
      continue;
    }
    if (name.endsWith('.css') && CSS_ENTRY_RE.test(content)) {
      cssEntry ??= path;
      continue;
    }
    if (name.endsWith('.html') && RUNTIME_RE.test(content)) runtime ??= path;
  }

  if (runtime) {
    return { supported: true, evidence: `a utility-class runtime is loaded by ${runtime}` };
  }
  const wiring = config ?? plugin ?? cssEntry;
  if (dependency && wiring) {
    return { supported: true, evidence: `${dependency}, wired by ${wiring}` };
  }
  const partial = dependency
    ? `${dependency} is declared but nothing wires it (no tailwind/uno config, no postcss/vite/astro plugin, no css entry)`
    : wiring
      ? `${wiring} mentions one but no tailwind/uno dependency is declared`
      : 'no tailwind/uno dependency, config, css entry or CDN runtime';
  return { supported: false, evidence: `${partial} — utility classes are not compiled here` };
}
