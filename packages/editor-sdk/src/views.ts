/**
 * A VIEW'S VERBS — the one product door into a panel that is not the centre
 * document (ARCHITECTURE-CORE §Our tier over the Code-OSS frame, "a panel →
 * view"; WORK.md §The core is Code-OSS U8, ruling (1), 2026-09-19).
 *
 * ## The problem this exists for, and the ruling that shaped it
 *
 * `editor.document.*` reaches only the ACTIVE CENTRE DOCUMENT, by its own
 * contract. Every drawer utility — Console, Profiler, Network, I5's node
 * editor — is therefore undrivable by the product, and each one that needed
 * driving was shipping its OWN session verb to compensate (I5's
 * `blender-node-view` is the worked case, and UV Editing, Animation and
 * Texture Paint were each about to pay the same price).
 *
 * The ruling refused both a utility scope on the document door and a verb per
 * view: **under the Code-OSS frame every one of our views is a VS Code view
 * in a view container, and its state and verbs are reached through
 * `vgai.<view>.<verb>` commands the bridge dispatches into the view** — the
 * same one-name door as every other verb, so `vgai eval` reaches it through
 * the frame's command service.
 *
 * ## Why the registry is HERE and not in the editor
 *
 * Both sides of it are outside `packages/editor/src`: a view's verbs are
 * registered by the package that OWNS the view (`@vgai/blender`'s node
 * editor), and they are read by the fork's bridge. The editor host mediates
 * nothing, so a registry inside it would be a closure file with no reader of
 * its own — the same reasoning `registerEditorHost` follows one module over.
 *
 * ## The two doors, one table
 *
 * Standalone `vgai edit` has no VS Code command service, so the SESSION's own
 * verb is how a view is driven there. That is not a second implementation:
 * the session verb calls {@link invokeViewVerb} on the same table the frame's
 * commands call, exactly as `key-actions.ts`'s action table is one
 * table behind two keyboards. A NEW view registers verbs here and adds no
 * session verb at all.
 */

export interface ViewVerb {
  /** The verb, bare: `state`, `view-all`, `zoom`. The frame publishes it as
   *  `vgai.<view>.<verb>`; the session spells it its own way. */
  readonly id: string;
  /** What the palette calls it, when the verb is one a PERSON would run. A
   *  verb with no title is reachable by command id and by the session, and is
   *  not listed — a read (`state`) or a refusal probe is not a menu item. */
  readonly title?: string;
  /** Run it. `args` is the command's own argument object, unvalidated: a view
   *  validates its own arguments and REFUSES BY NAME, because what an argument
   *  means is the view's and no registry can know it. */
  readonly run: (args?: Record<string, unknown>) => unknown;
}

export interface ViewVerbContribution {
  /** The view's id, and the middle segment of every command it publishes —
   *  `blender-node-view` → `vgai.blender-node-view.view-all`. It is the same
   *  id the view registers under when it becomes a VS Code view. */
  readonly view: string;
  /** What the view is called, for the palette entry's category. */
  readonly title: string;
  readonly verbs: readonly ViewVerb[];
}

const REGISTRY_KEY = Symbol.for('vgai.editor.viewVerbs');
interface RegistryState {
  contributions: readonly ViewVerbContribution[];
  listeners: Set<() => void>;
  version: number;
}
const globals = globalThis as typeof globalThis & { [REGISTRY_KEY]?: RegistryState };
// One registry across module copies, for the reason `host.ts` has one: the
// fork's bridge and a package's contribution can be different instances of
// this module, and a view registered into a second table is a view the frame
// never sees.
globals[REGISTRY_KEY] ??= { contributions: [], listeners: new Set(), version: 0 };
const state: RegistryState = globals[REGISTRY_KEY];

function emit(): void {
  state.version++;
  for (const listener of state.listeners) listener();
}

/**
 * Register a view's verbs. Returns the removal, which only fires while this
 * contribution is still the live one for its id.
 *
 * THE SAME VIEW REGISTERING AGAIN REPLACES ITSELF. A contribution module is
 * evaluated more than once per session by design: the tool loader imports it
 * as `/@fs/<path>?t=<version>` (packages/editor/src/tool-loader.ts) so a
 * project's save re-evaluates it, and a BUNDLED package's contribution is
 * reached by its bare specifier as well — while this registry is ONE table on
 * `globalThis` across
 * every module copy. Module-level `registerViewVerbs(...)` in a contribution
 * therefore runs once per evaluation, and on 2026-09-19 the second evaluation
 * threw and the editor did not boot. The re-evaluation is recognised by the
 * view id AND title agreeing — the same source, loaded again — and the newer
 * table wins, its predecessor's disposer becoming a no-op.
 *
 * A DIFFERENT view claiming the id still THROWS: the id keys the whole
 * `vgai.<view>.<verb>` command namespace, and a second view under it would
 * publish commands that shadow the first with no sign of it.
 */
export function registerViewVerbs(contribution: ViewVerbContribution): () => void {
  const existing = state.contributions.find((entry) => entry.view === contribution.view);
  if (existing && existing.title !== contribution.title) {
    throw new Error(
      `registerViewVerbs: the view "${contribution.view}" already publishes verbs as "${existing.title}"; "${contribution.title}" is a different view under the same id. A view id keys its whole \`vgai.<view>.<verb>\` command namespace, so a second view under it would shadow the first with no sign of it.`,
    );
  }
  state.contributions = [
    ...state.contributions.filter((entry) => entry !== existing),
    contribution,
  ];
  emit();
  return () => {
    if (!state.contributions.includes(contribution)) return;
    state.contributions = state.contributions.filter((entry) => entry !== contribution);
    emit();
  };
}

/** Every view publishing verbs right now. */
export function viewVerbContributions(): readonly ViewVerbContribution[] {
  return state.contributions;
}

export function viewVerbsVersion(): number {
  return state.version;
}

export function subscribeViewVerbs(listener: () => void): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/**
 * Run one view's verb. The refusal is a THROW naming the whole vocabulary,
 * because both callers — the frame's command and the session's verb — report
 * a thrown message and a silent `undefined` is how a typo becomes a mystery.
 */
export function invokeViewVerb(
  view: string,
  verb: string,
  args?: Record<string, unknown>,
): unknown {
  const contribution = state.contributions.find((entry) => entry.view === view);
  if (!contribution) {
    const known = state.contributions.map((entry) => entry.view).join(', ') || 'none';
    throw new Error(`No view "${view}" publishes verbs right now — the views that do: ${known}.`);
  }
  const entry = contribution.verbs.find((candidate) => candidate.id === verb);
  if (!entry) {
    throw new Error(
      `The view "${view}" has no verb "${verb}" — it publishes: ${contribution.verbs.map((candidate) => candidate.id).join(', ')}.`,
    );
  }
  return entry.run(args);
}

export function __resetViewVerbsForTest(): void {
  state.contributions = [];
  state.listeners.clear();
  state.version = 0;
}
