/**
 * WHAT A PRODUCT HANDS THE SCAFFOLDER — the kit's half of `create`.
 *
 * CREATION IS THE PRODUCT'S (ARCHITECTURE-CORE §The target shape, rule 1: the
 * kit knows no package and no product by name). This scaffolder is a LIBRARY:
 * it owns the base template under `packages/editor/template/`, the additions
 * (`three`, `ui`, `server`, `blender`, `studio`) and every rewrite that turns
 * one into a project — and it knows nothing about which compositions exist,
 * what they are called, which editor-side packages a project declares, or
 * which layout and look its adapter states. Those are a PRODUCT's declaration,
 * and a product is the program a person runs (`game-editor create`,
 * `model-editor create`).
 *
 * The declaration is ordinary ESM the product owns — data for the presets, a
 * FUNCTION for the rule that reads them, because compositions are code (rule
 * 8). It is read by three doors: the product's own `bin`, this scaffolder's
 * caller in the CLI, and the editor server's New Project route. All three
 * validate it through {@link assertProductCreateDeclaration}, so a malformed
 * declaration is named at the door rather than half-applied to a project.
 */

import { isScaffoldAddition, type ScaffoldAddition } from './additions.js';

/** A value the generated `vgai.adapter.ts` imports by name from a package. */
export interface ImportedValue {
  /** The exported binding — `GameLayout`, `blenderStyle`. */
  readonly name: string;
  /** The module specifier it is imported from — `@volter/editor-sdk/layouts`. */
  readonly from: string;
}

/**
 * HOW A PROJECT PRESENTS, as its adapter declares it (`editor: { Layout,
 * style, keymap, inspector }`). The editor reads that declaration beneath the
 * project's own `.vgai/settings.json` and above the person's cross-project one
 * (`settings-store.ts`), so a scaffolded project opens in its look with no
 * settings file at all.
 */
export interface ScaffoldEditorDeclaration {
  readonly layout: ImportedValue;
  /** A package's own style, when the product's reference application has one. */
  readonly style?: ImportedValue;
  /** A package's own keymap, same rule. */
  readonly keymap?: ImportedValue;
  /** Which Inspector presentation this project opens with. */
  readonly inspector: string;
}

/** What a product decides for one project, given the additions it ends with. */
export interface ScaffoldComposition {
  /**
   * The editor-side packages the project declares, the product's own package
   * first. The scaffolder writes exactly these into `devDependencies` and
   * removes whatever editor-side packages the base template carried
   * ({@link KIT_DECLARED_PACKAGES} is the boundary — see `writeEditorPackages`).
   */
  readonly editorPackages: readonly string[];
  readonly editor: ScaffoldEditorDeclaration;
}

/** One named preset — a list of additions over the empty project. */
export interface ProductTemplate {
  readonly additions: readonly ScaffoldAddition[];
}

/** A product's whole `create` declaration. */
export interface ProductCreateDeclaration {
  /** The product's package name — what the scaffolded project declares. */
  readonly product: string;
  /** The presets this product offers, by the name its `--template` takes. */
  readonly templates: Readonly<Record<string, ProductTemplate>>;
  /** The preset used when no `--template` is passed; a key of `templates`. */
  readonly defaultTemplate: string;
  /** Whether this product's `create` takes `--example <id>`. */
  readonly examples: boolean;
  /**
   * The product's rule: what a project with THESE additions declares. A
   * function and not a table because the answer is a composition — the game
   * editor's 3D lane rides the `three` addition, and its Design layout is what
   * a project with a React root and no 3D world opens in.
   */
  compose(additions: ReadonlySet<ScaffoldAddition>): ScaffoldComposition;
}

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

function assertImportedValue(value: unknown, source: string, field: string): ImportedValue {
  const record = value as Partial<ImportedValue> | undefined;
  if (typeof record?.name !== 'string' || record.name.length === 0)
    fail(source, `${field}.name must be the exported binding to import, e.g. "GameLayout"`);
  if (typeof record.from !== 'string' || record.from.length === 0)
    fail(
      source,
      `${field}.from must be the module it is imported from, e.g. "@volter/editor-blender/layouts"`,
    );
  return { name: record.name, from: record.from };
}

/**
 * Validate one `compose(...)` answer. Called at every scaffold, because a
 * product's rule is code: a preset that returns a package list without the
 * product itself would scaffold a project no editor opens, and the refusal
 * belongs where it can name the product and the additions that produced it.
 */
export function assertScaffoldComposition(
  value: unknown,
  source: string,
  product: string,
): ScaffoldComposition {
  const composition = value as Partial<ScaffoldComposition> | undefined;
  const packages = composition?.editorPackages;
  if (!Array.isArray(packages) || packages.some((name) => typeof name !== 'string' || !name))
    fail(source, 'compose() must return editorPackages: a list of package names');
  if (!packages.includes(product))
    fail(
      source,
      `compose() returned editorPackages ${JSON.stringify(packages)}, which omits ${product}. ` +
        'A scaffolded project declares the product it opens in — that declaration is how `vgai ' +
        'edit` finds the editor to run (ARCHITECTURE-CORE §The target shape, rule 4).',
    );
  const editor = composition?.editor as Partial<ScaffoldEditorDeclaration> | undefined;
  if (typeof editor?.inspector !== 'string' || editor.inspector.length === 0)
    fail(
      source,
      'compose() must return editor.inspector — which Inspector presentation this project opens with',
    );
  return {
    editorPackages: [...packages],
    editor: {
      layout: assertImportedValue(editor.layout, source, 'compose().editor.layout'),
      ...(editor.style === undefined
        ? {}
        : { style: assertImportedValue(editor.style, source, 'compose().editor.style') }),
      ...(editor.keymap === undefined
        ? {}
        : { keymap: assertImportedValue(editor.keymap, source, 'compose().editor.keymap') }),
      inspector: editor.inspector,
    },
  };
}

/**
 * Validate a product's create declaration, or throw naming the file it came
 * from. `source` is that file's path: every message here is read by whoever is
 * editing the product, and "presets.mjs is wrong" is useless without it.
 */
export function assertProductCreateDeclaration(
  value: unknown,
  source: string,
): ProductCreateDeclaration {
  const declaration = value as Partial<ProductCreateDeclaration> | undefined;
  if (typeof declaration?.product !== 'string' || declaration.product.length === 0)
    fail(source, "must export a default object whose `product` is this product's package name");
  const templates = declaration.templates;
  if (typeof templates !== 'object' || templates === null)
    fail(source, '`templates` must be an object of preset name -> { additions }');
  const names = Object.keys(templates);
  if (names.length === 0) fail(source, '`templates` declares no preset');
  for (const name of names) {
    const additions = (templates as Record<string, ProductTemplate>)[name]?.additions;
    if (!Array.isArray(additions))
      fail(source, `template "${name}" must declare \`additions\` (possibly empty)`);
    for (const addition of additions) {
      if (!isScaffoldAddition(addition))
        fail(source, `template "${name}" names an unknown addition ${JSON.stringify(addition)}`);
    }
  }
  if (
    typeof declaration.defaultTemplate !== 'string' ||
    !names.includes(declaration.defaultTemplate)
  )
    fail(
      source,
      `\`defaultTemplate\` must be one of ${names.join(', ')} — got ${JSON.stringify(declaration.defaultTemplate)}`,
    );
  if (typeof declaration.examples !== 'boolean')
    fail(
      source,
      "`examples` must be a boolean — whether this product's create takes --example <id>",
    );
  if (typeof declaration.compose !== 'function')
    fail(source, '`compose(additions)` must be a function returning { editorPackages, editor }');
  return declaration as ProductCreateDeclaration;
}
