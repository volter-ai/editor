/**
 * The product door onto EDITOR CHROME — read and drive what a person sees in
 * the editor's named surfaces, through the session, without play mode.
 *
 * ## Why this exists (WO: "No product door drives or reads EDITOR CHROME")
 *
 * `vgai eval`'s `page()` step is play-mode-gated and rooted at the GAME
 * container, so an editor surface that is not a running game — a capability's
 * workspace document, the Data sheet, the Project Tools catalog — could be
 * neither driven nor read through the product at all. The Sheets build could
 * not live-verify a TSV paste or a sheet-tab click: it had a screenshot
 * (`editor.captureActiveDocument`) and nothing else. That gap is the defect the
 * doctrine names — when a live surface can only be diagnosed out of band, the
 * product's own doors have failed.
 *
 * ## The API decision, and why it is this small
 *
 * ONE wire command (`document-probe`) carrying a step union, exposed on the
 * live side as `editor.document.{query,click,drag,key,type,paste,select}`.
 * Each verb is a thing an agent cannot otherwise do and cannot fake:
 *
 *  - `query` — READ. What is rendered, as data: tag, role, text, attributes,
 *    value/checked/disabled, rect. The one door that answers "what does the
 *    human see" for a surface that is not a canvas.
 *  - `click` — a REAL user gesture (pointerdown/mousedown/mouseup/click plus
 *    focus), not `element.click()`, because a component listening on
 *    `pointerdown` (react-data-grid's cell selection does) is invisible to the
 *    synthetic shortcut. `clicks: 2` is a real DOUBLE click (numbered
 *    `detail` plus the `dblclick` React's `onDoubleClick` listens for) — the
 *    Outliner's own rename gesture, and an option on the same verb rather
 *    than a second one because it is the same gesture on the same target.
 *  - `type` — text into a focused field, character by character, committed
 *    with Enter. `paste` cannot stand in: an untrusted `ClipboardEvent`
 *    performs no default action, so a plain `<input>` keeps its old value.
 *  - `key` — keydown/keyup on the explicit target, else on whatever inside the
 *    scope has focus. Arrow keys ARE the spreadsheet's cursor. (No `keypress`:
 *    it is deprecated and no shipped surface listens for it.)
 *  - `paste` — a real `ClipboardEvent` with a populated `DataTransfer`, which
 *    is the only way to exercise a paste handler; nothing else in the product
 *    can produce one. Verified live against the Data sheet's own `onPaste`,
 *    which read the TSV and wrote the file.
 *  - `select` — choose a value on a `<select>`. `click` genuinely cannot do
 *    this: the option list of a native dropdown is drawn by the OS, so there
 *    is nothing inside the document's container for a pointer gesture to
 *    resolve against. And a plain `element.value = x` is a no-op against
 *    React, which caches the last value it wrote on the node and puts it back
 *    on the next render. So this verb goes through the PROTOTYPE's own value
 *    setter (which bypasses that cache) and then dispatches `input`/`change` —
 *    the established spelling from this repo's own probes, and the one React's
 *    synthetic-event layer honours. Without it the animation transport's clip
 *    and speed — two `<select>`s — were undrivable through the product.
 *
 * There is deliberately NO `screenshot` verb: `editor.captureActiveDocument()`
 * already captures the document's content (`editor-view-presentation.ts`'s
 * `activeDocumentContent`); this door's scope is the document's whole box —
 * that content plus its header strip and shelf rail — and a synonym would be
 * a second name for one behavior.
 *
 * ## Scope is a VOCABULARY, and the contract is that it is closed
 *
 * This is NOT general page automation, and the refusal is how that stays true.
 * Every step resolves against ONE NAMED SURFACE — `document` (the default),
 * `header`, `shelf`, `rail`, `outliner`, `content` ({@link DocumentProbeScope}) — and a
 * selector that matches nothing inside it, or a resolved element that is not a
 * descendant of it, is REFUSED with a message naming the scope rather than
 * silently reaching into the rest of the page.
 *
 * ## How a scope finds its element: the owner's own stamp, never a class guess
 *
 * The Properties rail and the Outliner are VS CODE VIEWS (`vgai.properties`,
 * `vgai.outliner`) holding React portals of ours, so their roots are not
 * anywhere near the document's box and cannot be reached by walking down from
 * it. They are found by the id THE WORKBENCH REGISTERED: the contribution
 * hands each view's body element over as a named part, and `offerVgaiPart`
 * (`frame/bridge.tsx`) stamps it `data-vgai-part="<part>"` at the moment of
 * the handover. A pane that is disposed takes its stamped element with it, so
 * a closed view answers "not open" instead of matching a stale node. The same
 * shape as `activeDocumentContainer`'s `data-workspace-document-id` and as the
 * portal pair below: the surface publishes its own identity, and this module
 * never guesses from a class name.
 *
 * `rail` and `outliner` are EDITOR CHROME rather than the active document, so
 * (unlike `document`/`header`/`shelf`) they are reachable while the Game
 * document is active and while no document is open at all. The `editor.
 * hierarchy()` / `editor.inspect()` doors still report what those panels
 * RESOLVED; this door reports what they DREW and drives their controls —
 * WALK 5's beats 7 and 12 are the gap it closes (`editor.setField('name')`
 * writes the name, but it is not the Outliner's rename, and nothing at all
 * could click a Properties tab).
 *
 * Two deliberate consequences of the containment rule:
 *
 *  - A PORTALED overlay THIS DOCUMENT OPENED is in scope; anyone else's is
 *    not. Amended 2026-09-21 (B6), and what changed is the DOM rather than the
 *    rule: this note used to say a popover portaled to the theme root recorded
 *    no ownership, so any heuristic wide enough to reach it would also reach
 *    the editor's chrome menus. `ThemeRootPortal` records it now — an anchor
 *    span where the portal was declared and a matching stamp on what landed —
 *    so {@link scopeRoots} walks that pair from inside the document's box and
 *    reaches exactly the overlays the document opened. A chrome menu's anchor
 *    is in the chrome, so it is still refused by the same containment check.
 *    Without this a document's own header MENU could be opened by its trigger
 *    and never chosen from, which is "a control is accepted through its own
 *    click" failing one step short (measured on the Model document's Add
 *    menu). Widening further — every `.vgai-menu` on the root — is still the
 *    "general automation framework" this module exists to not become.
 *  - The GAME document is refused outright by the three scopes that ARE the
 *    active document (see `resolveDocumentScope`): a game is driven through
 *    its own registered commands and the play-gated `page` door, never
 *    through synthetic DOM gestures. `rail` and `outliner` are the editor's
 *    panels around it and stay open.
 */

import type {
  DocumentKeyStep,
  DocumentProbeResult,
  DocumentProbeScope,
  DocumentProbeStep,
  ProbedElement,
} from '@volter/editor-sdk/document-probe';
import { GAME_DOCUMENT_ID } from '@volter/editor-sdk/kit/workspace-document-ids';
import {
  activeWorkspaceDocument,
  activeWorkspaceDocumentId,
  activeWorkspaceDocumentViewId,
} from '@volter/editor-sdk/kit/workspace-document-registry';

/** The active document's mounted content element — what the `document`,
 *  `header` and `shelf` scopes resolve from. Shared with
 *  `editor-view-presentation.ts`'s capture so a probe and a screenshot can
 *  never disagree about what "the active document" is. */
export function activeDocumentContainer(documentId: string): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLElement>('[data-workspace-document-id]')).find(
      (element) =>
        element.dataset['workspaceDocumentId'] === documentId &&
        (activeWorkspaceDocumentViewId() === null ||
          element.dataset['workspaceViewId'] === activeWorkspaceDocumentViewId()),
    ) ?? null
  );
}

interface Scope {
  readonly container: HTMLElement;
  /** Roots the scope also covers beside its container (the inspector's card, for 'rail'). */
  readonly extraRoots?: readonly HTMLElement[];
  readonly name: DocumentProbeScope;
  readonly id: string;
  readonly title: string;
}

/** THE VOCABULARY, and the one place each word is spelled. Every name resolves
 *  through its surface's OWN stamp — see this module's header. */
const SCOPE_NAMES: readonly DocumentProbeScope[] = [
  'document',
  'header',
  'shelf',
  'rail',
  'outliner',
  'content',
  'utility',
];

/** The two scopes that are VS Code views: the part id the contribution hands
 *  over (`frame/bridge.tsx`'s `offerVgaiPart` stamps it), and the view id the
 *  workbench registered it under (`vgai.contribution.ts`). */
const VIEW_SCOPES = {
  rail: { part: 'properties', view: 'vgai.properties', title: 'Properties' },
  outliner: { part: 'outliner', view: 'vgai.outliner', title: 'Outliner' },
  content: { part: 'content', view: 'vgai.content', title: 'Content' },
} as const satisfies Record<string, { part: string; view: string; title: string }>;

/** The two scopes that are strips of the ACTIVE DOCUMENT's own box, by the
 *  `data-testid` their components write (`DocumentHeaderStrip`,
 *  `DocumentShelfRail`). */
const DOCUMENT_STRIPS = {
  header: { prefix: 'document-header', title: 'header strip' },
  shelf: { prefix: 'document-shelf', title: 'tool shelf' },
} as const satisfies Record<string, { prefix: string; title: string }>;

/**
 * EVERY ROOT THIS SCOPE COVERS — the document's own box, and whatever it
 * PORTALED out of itself.
 *
 * `ThemeRootPortal` writes an anchor span where the portal was declared and
 * stamps both ends with one generated id (`data-vgai-portal` in place,
 * `data-vgai-portal-content` on what landed at the theme root). So a menu the
 * document's own header opened is found by walking that pair from INSIDE the
 * box — not by a heuristic over every `.vgai-menu` on the root, which would
 * also reach the editor's chrome menus and is exactly the widening this
 * module's header rules out. A portal the chrome opened has its anchor in the
 * chrome, so it is not a root here and stays refused.
 *
 * Re-read per step rather than cached with the scope: a menu opens and closes
 * between steps, which is the whole point of driving one.
 */
function scopeRoots(scope: Scope): HTMLElement[] {
  const roots: HTMLElement[] = [scope.container, ...(scope.extraRoots ?? [])];
  // TRANSITIVE, because a portal opens a portal: a menu's PANEL is portaled,
  // and a submenu opened from one of its rows is portaled from inside THAT
  // panel — so the second anchor is not in the document's box at all. One
  // level deep found the Add menu's rows and none of Mesh's (measured
  // 2026-09-21 on the Model document). The walk terminates because each id is
  // taken once.
  for (let index = 0; index < roots.length; index++) {
    for (const anchor of roots[index]!.querySelectorAll<HTMLElement>('[data-vgai-portal]')) {
      const id = anchor.dataset['vgaiPortal'];
      if (id === undefined) continue;
      const content = document.querySelector<HTMLElement>(
        `[data-vgai-portal-content="${CSS.escape(id)}"]`,
      );
      if (content && !roots.includes(content)) roots.push(content);
    }
  }
  return roots;
}

/** A registered VIEW's handed-over body, by the part id the workbench stamped
 *  on it. `null` when the view is closed — its pane took the element with it. */
function viewPart(part: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-vgai-part="${part}"]`);
}

/** The utility view showing in the panel: its body is the one of the stamped
 *  bodies (`frame/bridge.tsx`'s `setUtilityBody`) that has a box on screen. */
function resolveUtilityScope(): Scope {
  const showing = [...document.querySelectorAll<HTMLElement>('[data-vgai-utility]')].find((body) => {
    const box = body.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  if (!showing) {
    throw new Error(
      "No utility view is showing, so scope 'utility' has nothing to reach. Show one in the " +
        'panel (View: Open View…) and retry.',
    );
  }
  const id = showing.dataset['vgaiUtility'] ?? '';
  return { container: showing, name: 'utility', id, title: id };
}

function resolveScope(name: DocumentProbeScope): Scope {
  if (name === 'utility') return resolveUtilityScope();
  const view =
    name === 'rail' || name === 'outliner' || name === 'content' ? VIEW_SCOPES[name] : null;
  if (view) {
    const container = viewPart(view.part);
    // THE INSPECTOR AS A CARD. The rail's subject is the inspector, which a person may show as a
    // card over the viewport instead of the Properties column (`inspector-presentation.ts`); the
    // workspace's layout host mounts that card outside every document's box, so scope 'rail'
    // covers it too — the same inspector in its other projection, whether or not the Properties
    // view is open beside it.
    // The visible card: every view of the active document mounts one, and a parked view's is
    // in the page with no box.
    const card =
      name === 'rail'
        ? ([
            ...document.querySelectorAll<HTMLElement>('[data-testid="inspector-panel"][data-vgai-inspector-presentation="card"]'),
          ].find((candidate) => {
            const box = candidate.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          }) ?? null)
        : null;
    if (card && !container) return { container: card, name, id: view.view, title: 'Inspector card' };
    if (card && container) return { container, extraRoots: [card], name, id: view.view, title: `${view.title} and the inspector card` };
    if (!container) {
      throw new Error(
        `The ${view.title} view (${view.view}) is not open, so scope '${name}' has nothing to ` +
          'reach. Open it from the workbench (View: Open View…) and retry — this door reads ' +
          'and drives what is on screen, and reports its absence rather than an empty match list.',
      );
    }
    return { container, name, id: view.view, title: view.title };
  }
  return resolveDocumentScope(name);
}

/** `document`, `header` and `shelf` — the ACTIVE CENTRE DOCUMENT's box and the
 *  two strips inside it. */
function resolveDocumentScope(name: DocumentProbeScope): Scope {
  const active = activeWorkspaceDocument();
  if (!active)
    throw new Error(
      `No active editor document, so scope '${name}' has nothing to reach. The editor's own ` +
        "views are still readable: scope 'outliner', scope 'rail', and scope 'content'.",
    );
  const id = activeWorkspaceDocumentId() ?? active.descriptor.id;
  // The Game document is the one center document with its OWN doors — and the
  // one where a synthetic DOM gesture is the exact instrument the doctrine
  // bans ("never pilot a game with synthetic key events"). Its input is
  // play-gated (`gated-globals.ts`), so a probe
  // here would either silently do nothing (not playing) or bypass the play
  // path's contract (playing). Refuse toward the honest doors instead of
  // becoming an ungated second one. Its HEADER STRIP is the exception: the
  // editor's own chrome (the Play bar, the resolution, the audio control), not
  // the game's DOM, and otherwise no door reached a control a person clicks
  // there every session.
  if (id === GAME_DOCUMENT_ID && name !== 'header') {
    throw new Error(
      "The Game document is out of this door's scope: drive and read a game through its own " +
        'doors — `game.commands()`/`game.command(n)`/`game.state(n)`, or `page(step)` during ' +
        "play — never through synthetic DOM gestures. Its header strip (the editor's own Play " +
        "bar and controls) is scope 'header'; the editor's views around it stay readable: scope " +
        "'outliner' and scope 'rail'.",
    );
  }
  const container = activeDocumentContainer(id);
  if (!container) {
    throw new Error(
      `The active document's surface is not mounted: ${id} (${active.title}). ` +
        'Present it first (`editor.present`) and retry.',
    );
  }
  // The scope is the document's WHOLE box — its header strip and its shelf
  // rail as well as its content (`WorkspaceDocumentSurface`: the strip is a
  // sibling of the content element the id is written on). Three builders
  // measured the same wall: a document's own header controls and menus were
  // unreachable and unreadable through the product, so a header could not be
  // driven by its own click. The Game document's refusal above still holds.
  const box = container.closest<HTMLElement>('.vgai-dock-document') ?? container;
  if (name === 'document') return { container: box, name, id, title: active.title };
  // `header` / `shelf` — MEASURED to be inside the box already (the strips are
  // this element's own children), so these names buy AIM rather than reach: a
  // selector that also matches in the content can be pointed at one strip
  // without counting indices. A document that draws no strip (`runtime:
  // false` and no toolbar, or a workspace whose skin hides headers) refuses by
  // name rather than answering zero matches.
  const strip = DOCUMENT_STRIPS[name as keyof typeof DOCUMENT_STRIPS];
  const element = box.querySelector<HTMLElement>(`[data-testid="${strip.prefix}:${id}"]`);
  if (!element) {
    throw new Error(
      `The active document "${active.title}" (${id}) draws no ${strip.title}, so scope ` +
        `'${name}' has nothing to reach. Its whole box is scope 'document'.`,
    );
  }
  return { container: element, name, id, title: `${active.title} — ${strip.title}` };
}

/** The refusal that keeps this door scoped — it names the scope every time,
 *  and the vocabulary, because "wrong scope" is the likeliest cause. */
function outOfScope(scope: Scope, detail: string): Error {
  return new Error(
    `Out of scope: ${detail}. This step ran in scope '${scope.name}' — ` +
      `"${scope.title}" (${scope.id}) — and reaches ONLY inside it. The other surfaces are ` +
      `named, not walked to: ${SCOPE_NAMES.filter((name) => name !== scope.name)
        .map((name) => `'${name}'`)
        .join(', ')} (pass \`{ scope }\`). The rest of the page is deliberately unreachable.`,
  );
}

const MAX_TEXT = 400;

/**
 * The sentinel a custom property is resolved against.
 *
 * `getComputedStyle(el).getPropertyValue('--x')` answers with the DECLARED
 * text, so a theme token reads back as its own `color-mix(…)` algebra rather
 * than the colour it paints. To get the paint, the value has to go through a
 * property the browser actually resolves. A throwaway span inside the element
 * inherits the same custom-property cascade, so `color: var(--x)` on it
 * computes to `rgb(…)`.
 *
 * The sentinel is how a NON-colour token stays honest: `color` silently keeps
 * its previous value when the new one does not parse, so a token holding a
 * length would otherwise be reported as whatever colour happened to be there.
 * Seed the sentinel, apply the var, and an unchanged reading means "this did
 * not resolve as a colour" — report the declared text instead of a lie.
 */
const STYLE_PROBE_SENTINEL = 'rgb(1, 2, 3)';

/**
 * `background-color`'s INITIAL value, which is what the probe below computes
 * to whenever the substituted token is not a colour — CSS's own answer for a
 * declaration that is invalid at computed-value time on a NON-INHERITED
 * property.
 */
const STYLE_PROBE_INITIAL = 'rgba(0, 0, 0, 0)';

/**
 * What a custom property PAINTS, its declared text when it is not a colour,
 * or the empty string when THE PROPERTY IS NOT DECLARED AT ALL.
 *
 * That last case is the one this door got wrong first and a builder caught: an
 * undeclared `var(--x)` makes the whole declaration invalid, so the probe fell
 * back and the reading came back as the surrounding text colour — a confident
 * wrong answer, identical for a real token, a misspelled one and a group the
 * palette does not declare. (Measured under Classic:
 * `--vgai-viewport-background` and a deliberately nonexistent name both
 * answered `rgb(197, 200, 206)`, and a reader nearly concluded Classic
 * declares a viewport group.) A custom property's computed value is the empty
 * string exactly when it is undeclared, so that is the answer.
 *
 * THE PAINT PROPERTY IS `background-color`, AND THAT IS THE WHOLE TRICK. It
 * used to be `color`, with a sentinel seeded first and the reasoning "an
 * unchanged reading means this did not resolve as a colour". That reasoning is
 * wrong, because `color` is INHERITED: a declaration invalid at computed-value
 * time does not keep its previous value, it takes the INHERITED one — so a
 * token holding a length read back as whatever colour the surrounding text
 * happened to be, the same confident lie one paragraph up. Measured 2026-09-21
 * on the Outliner: `--vgai-tree-row-height`, which holds `20px`, answered
 * `rgb(195, 195, 195)` while a reader was measuring row heights with it.
 * `background-color` is NOT inherited, so the same invalid declaration lands
 * on its initial value — `rgba(0, 0, 0, 0)`, a constant this module knows —
 * and "did this resolve as a colour" becomes a fact instead of a guess. The
 * sentinel is still seeded, so a browser that somehow leaves the declaration
 * untouched is also caught. A token whose value IS `transparent` reports its
 * declared text, which is the more useful of the two true answers.
 */
function resolveCustomProperty(element: HTMLElement, name: string): string {
  const declared = getComputedStyle(element).getPropertyValue(name).trim();
  if (declared === '') return '';
  const owner = element.ownerDocument;
  const probe = owner.createElement('span');
  // Out of flow and invisible: this must not reflow the surface being measured.
  probe.style.position = 'absolute';
  probe.style.pointerEvents = 'none';
  probe.style.visibility = 'hidden';
  probe.style.backgroundColor = STYLE_PROBE_SENTINEL;
  element.appendChild(probe);
  try {
    probe.style.backgroundColor = `var(${name})`;
    const painted = getComputedStyle(probe).backgroundColor.trim();
    return painted === STYLE_PROBE_SENTINEL || painted === STYLE_PROBE_INITIAL ? declared : painted;
  } finally {
    probe.remove();
  }
}

function resolveStyles(element: HTMLElement, names: readonly string[]): Record<string, string> {
  const computed = getComputedStyle(element);
  const styles: Record<string, string> = {};
  for (const name of names) {
    styles[name] = name.startsWith('--')
      ? resolveCustomProperty(element, name)
      : // A standard property is already RESOLVED by the browser here, which is
        // the whole reason to ask for it: the token's expression has become the
        // rgb the person sees.
        computed.getPropertyValue(cssPropertyName(name)).trim();
  }
  return styles;
}

/** `backgroundColor` → `background-color`; a name already dashed passes through. */
function cssPropertyName(name: string): string {
  return name.includes('-') ? name : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function describeElement(
  element: Element,
  index: number,
  styles?: readonly string[],
): ProbedElement {
  const html = element as HTMLElement;
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(element.attributes)) {
    attributes[attribute.name] = attribute.value;
  }
  const rect = html.getBoundingClientRect();
  const value = (element as HTMLInputElement).value;
  const checked = (element as HTMLInputElement).checked;
  // `||`, not `??`: in a BACKGROUNDED tab — this door's primary caller —
  // Chrome answers `innerText` with the empty string for everything, so the
  // nullish fallback never fired and every probe read a blank document
  // (measured live, 2026-08-14). `textContent` is the honest answer there.
  const text = (html.innerText || element.textContent || '').trim();
  return {
    index,
    tag: element.tagName.toLowerCase(),
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    attributes,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    ...(typeof value === 'string' ? { value } : {}),
    ...(typeof checked === 'boolean' ? { checked } : {}),
    ...(html.hasAttribute('disabled') ? { disabled: true } : {}),
    ...(styles && styles.length > 0 ? { styles: resolveStyles(html, styles) } : {}),
  };
}

/** Resolve one target inside the scope, refusing loudly rather than reaching out. */
function resolveTarget(scope: Scope, selector: string, index: number): HTMLElement {
  const matches = matchesIn(scope, selector);
  const element = matches[index];
  if (!element) {
    throw outOfScope(
      scope,
      `${JSON.stringify(selector)} matched ${matches.length} element(s), so index ${index} does not exist`,
    );
  }
  // querySelectorAll on an element is already descendants-only; this asserts
  // the invariant rather than trusting it. A PORTALED overlay the document
  // opened is one of the roots ({@link scopeRoots}), so it passes here by
  // being inside the root that owns it and not by any relaxation.
  if (!scopeRoots(scope).some((root) => root.contains(element))) {
    throw outOfScope(
      scope,
      `${JSON.stringify(selector)} resolved outside the document's container`,
    );
  }
  return element;
}

function pointerInit(element: HTMLElement): MouseEventInit {
  const rect = element.getBoundingClientRect();
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.x + rect.width / 2,
    clientY: rect.y + rect.height / 2,
    button: 0,
    buttons: 1,
  };
}

/**
 * A REAL click: the same event sequence a mouse produces. `element.click()`
 * dispatches only `click`, so a component that selects on `pointerdown` (the
 * sheet grid's cell selection) never sees the gesture at all.
 *
 * `clicks` > 1 is a REAL double click and not two calls to this function: the
 * browser numbers consecutive presses in `detail`, and a `dblclick` follows
 * the second `click`. React's `onDoubleClick` listens for that `dblclick` and
 * nothing else, so a rename driven by two separate single clicks never starts
 * (measured against the Outliner's own `onDoubleClick` → `onStartEditing`).
 */
function dispatchClick(element: HTMLElement, clicks = 1): void {
  const init = pointerInit(element);
  const total = Math.max(1, Math.round(clicks));
  withoutPointerCapture(element, () => {
    for (let n = 1; n <= total; n++) {
      const down = { ...init, detail: n };
      const up = { ...init, buttons: 0, detail: n };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...down, pointerType: 'mouse' }));
      element.dispatchEvent(new MouseEvent('mousedown', down));
      element.focus();
      element.dispatchEvent(new PointerEvent('pointerup', { ...up, pointerType: 'mouse' }));
      element.dispatchEvent(new MouseEvent('mouseup', up));
      element.dispatchEvent(new MouseEvent('click', up));
    }
    if (total >= 2) {
      element.dispatchEvent(new MouseEvent('dblclick', { ...init, buttons: 0, detail: total }));
    }
  });
}

/**
 * TYPE `text` into a field the way a person does — one character at a time,
 * through the PROTOTYPE's value setter, between real `keydown`/`keyup`.
 *
 * Three traps this exists for, each measured on a shipped surface:
 *  - `paste` cannot stand in. An untrusted `ClipboardEvent` performs NO
 *    default action, so a plain `<input>` with no paste handler keeps its old
 *    value and the probe reports a click it never made.
 *  - `element.value = x` is invisible to React (the value tracker it installs
 *    on the node compares the new value against itself and re-renders the old
 *    one) — the same trap {@link setSelectValue} documents, and the same cure.
 *  - a field may commit on a KEY rather than on `input`. The Outliner's rename
 *    reads `event.currentTarget.value` inside `onKeyDown` for Enter; a numeric
 *    field in the Properties rail blurs on Enter. So the keys are real and the
 *    Enter is the caller's choice, not an implicit one.
 */
function typeInto(element: HTMLElement, text: string, replace: boolean, enter: boolean): void {
  const editable =
    element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element : null;
  if (!editable) {
    throw new Error(
      `Cannot type into a <${element.tagName.toLowerCase()}>: this verb drives a text field. ` +
        "Click the control that opens one first (the Outliner's rename is a double click — " +
        '`click(selector, { clicks: 2 })`), then `type` into the field it puts up.',
    );
  }
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const write = (next: string) => {
    if (setter) setter.call(editable, next);
    else editable.value = next;
  };
  editable.focus();
  let held = editable.value;
  if (replace && held !== '') {
    // What select-all-and-delete produces, in one edit: a person's first
    // keystroke over a selected field is a replacement, not N backspaces.
    editable.select?.();
    held = '';
    write(held);
    editable.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'deleteContentBackward',
      }),
    );
  }
  for (const character of [...text]) {
    const init: KeyboardEventInit = {
      key: character,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    editable.dispatchEvent(new KeyboardEvent('keydown', init));
    held += character;
    write(held);
    editable.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: character,
      }),
    );
    editable.dispatchEvent(new KeyboardEvent('keyup', init));
  }
  if (enter) {
    const init: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    editable.dispatchEvent(new KeyboardEvent('keydown', init));
    editable.dispatchEvent(new KeyboardEvent('keyup', init));
  }
}

/**
 * A synthetic pointer has no id the browser knows, so a listener that calls
 * `setPointerCapture(event.pointerId)` — three's OrbitControls and
 * TransformControls do, on every press — throws `NotFoundError` INTO THE
 * CONSOLE whenever a document yields the press to the viewport (measured
 * 2026-09-02: every missed click on an Asset Lab canvas). Listeners run
 * synchronously inside `dispatchEvent`, so the capture calls are made
 * harmless for exactly the dispatch and restored after; a real pointer is
 * never affected.
 */
function withoutPointerCapture(_element: HTMLElement, dispatch: () => void): void {
  // On the PROTOTYPE, not the target: the viewport's controls listen on the
  // canvas's container and capture THERE, so the event's whole bubble path
  // has to be covered. Synchronous, restored in `finally`, and a real pointer
  // (which never dispatches through here) is untouched.
  const proto = Element.prototype;
  const set = proto.setPointerCapture;
  const release = proto.releasePointerCapture;
  proto.setPointerCapture = () => {};
  proto.releasePointerCapture = () => {};
  try {
    dispatch();
  } finally {
    proto.setPointerCapture = set;
    proto.releasePointerCapture = release;
  }
}

/** A REAL drag: press at `from`, move through `steps` points, release at `to`,
 *  all in the element's own box fractions — `dispatchClick`'s sequence with
 *  the moves a mouse makes between press and release. Moves carry
 *  `buttons: 1` (the primary button is held), the release `buttons: 0`. */
function dispatchDrag(
  element: HTMLElement,
  from: readonly [number, number],
  to: readonly [number, number],
  steps: number,
  modifiers: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {},
  via: readonly (readonly [number, number])[] = [],
  button: 0 | 1 | 2 = 0,
): void {
  const rect = element.getBoundingClientRect();
  // `buttons` is a bitmask in a different order from `button`: primary 1,
  // secondary 2, middle 4.
  const held = button === 0 ? 1 : button === 2 ? 2 : 4;
  const at = (fx: number, fy: number): MouseEventInit => ({
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.x + rect.width * fx,
    clientY: rect.y + rect.height * fy,
    button,
    buttons: held,
    altKey: modifiers.altKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
    shiftKey: modifiers.shiftKey ?? false,
  });
  const start = at(from[0], from[1]);
  withoutPointerCapture(element, () => {
    // A REAL POINTER HOVERS BEFORE IT PRESSES, and some targets latch on the
    // hover rather than on the press. three's `TransformControls` is the
    // worked case: `pointerHover` is what sets `this.axis` from the picker
    // under the cursor, and `pointerDown` does nothing at all while `axis` is
    // null — so a synthetic drag that began with `pointerdown` handed the
    // press to the VIEWPORT instead, which read it as a click on empty space
    // and cleared the selection. Measured 2026-09-21 on a Blender Model
    // document: dragging the X arrow of a freshly duplicated cube moved
    // nothing and deselected it.
    //
    // Same family as the `button: -1` note below, and the same rule: mirror
    // what the platform does. `buttons: 0` because nothing is held yet.
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        ...start,
        button: -1,
        buttons: 0,
        pointerType: 'mouse',
      }),
    );
    element.dispatchEvent(new MouseEvent('mousemove', { ...start, buttons: 0 }));
    element.dispatchEvent(new PointerEvent('pointerdown', { ...start, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', start));
    element.focus();
    const count = Math.max(1, Math.round(steps));
    const path: (readonly [number, number])[] = [from, ...via, to];
    for (let leg = 0; leg + 1 < path.length; leg++) {
      const a = path[leg] as readonly [number, number];
      const b = path[leg + 1] as readonly [number, number];
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        const move = at(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
        // `button: -1` ON A `pointermove`, because that is what a real mouse
        // reports: `PointerEvent.button` names the button whose STATE CHANGED,
        // and on a move none did. Held-ness lives in `buttons: 1` (kept by
        // `at`). This is not a detail — three.js guards on it exactly:
        // `TransformControls.pointerMove` returns at
        // `pointer.button !== -1` (r180, :472), so a drag of a gizmo handle
        // latched the axis, drew the drag helper line, and then moved NOTHING,
        // forever (measured 2026-09-21 on a Blender Model document, where it
        // read as "the transform provider is not writing"). `MouseEvent`'s
        // legacy `mousemove` keeps `button: 0` — a real browser reports that
        // one as 0, and mirroring the platform is the whole job here.
        element.dispatchEvent(
          new PointerEvent('pointermove', { ...move, button: -1, pointerType: 'mouse' }),
        );
        element.dispatchEvent(new MouseEvent('mousemove', move));
      }
    }
    const end = { ...at(to[0], to[1]), buttons: 0 };
    element.dispatchEvent(new PointerEvent('pointerup', { ...end, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', end));
    // A released primary button clicks; a released secondary one asks for the
    // context menu, as the platform does.
    if (button === 2) element.dispatchEvent(new MouseEvent('contextmenu', end));
    else if (button === 0 && from[0] === to[0] && from[1] === to[1]) {
      element.dispatchEvent(new MouseEvent('click', end));
    }
  });
}

/** The element a key goes to: the explicit target, else whatever inside the
 *  scope currently has focus, else the container itself. */
function keyTarget(scope: Scope, explicit: HTMLElement | null): HTMLElement {
  if (explicit) return explicit;
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && scopeRoots(scope).some((root) => root.contains(focused)))
    return focused;
  return scope.container;
}

/** Run a selector inside the scope, turning a malformed one into an honest error. */
function matchesIn(scope: Scope, selector: string): HTMLElement[] {
  try {
    return scopeRoots(scope).flatMap((root) =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)),
    );
  } catch (error) {
    throw new Error(`Invalid selector ${JSON.stringify(selector)}: ${String(error)}`);
  }
}

/** An optional `selector` resolves to a target; its absence means "the focused
 *  element inside the scope" — the shared shape of the `key` and `paste` steps. */
function gestureTarget(scope: Scope, step: { selector?: string; index?: number }): HTMLElement {
  const explicit =
    step.selector === undefined ? null : resolveTarget(scope, step.selector, step.index ?? 0);
  return keyTarget(scope, explicit);
}

/** The physical key a person presses for `key`, as `KeyboardEvent.code` names it on a US
 *  layout: a keystroke that says `code: 'w'` is one no keybinding resolver or game input map
 *  recognises. */
const PUNCTUATION_CODES: Readonly<Record<string, string>> = {
  ' ': 'Space', '`': 'Backquote', '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight',
  '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote', ',': 'Comma', '.': 'Period', '/': 'Slash',
};
function codeOf(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return PUNCTUATION_CODES[key] ?? key;
}

/** The legacy `keyCode` browsers still give every keystroke and VS Code's keybinding
 *  resolution reads; a synthesized event carries 0 unless it is set. */
const NAMED_KEY_CODES: Readonly<Record<string, number>> = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27, ' ': 32, PageUp: 33, PageDown: 34, End: 35, Home: 36,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46,
};
function keyCodeOf(key: string): number {
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  const fn = /^F([1-9]|1[0-2])$/.exec(key);
  if (fn) return 111 + Number(fn[1]);
  return NAMED_KEY_CODES[key] ?? 0;
}

/** A numpad key's legacy code follows its PHYSICAL key: Numpad0..9 are 96..105 and the
 *  decimal 110, where the digit they type would say 48..57. */
function numpadKeyCode(code: string | undefined): number | null {
  const digit = code === undefined ? null : /^Numpad([0-9])$/.exec(code);
  if (digit) return 96 + Number(digit[1]);
  return code === 'NumpadDecimal' ? 110 : null;
}

function keyEvent(type: 'keydown' | 'keyup', step: DocumentKeyStep): KeyboardEvent {
  const event = new KeyboardEvent(type, keyInit(step));
  const keyCode = numpadKeyCode(step.code) ?? keyCodeOf(step.key);
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  Object.defineProperty(event, 'which', { get: () => keyCode });
  return event;
}

function keyInit(step: DocumentKeyStep): KeyboardEventInit {
  return {
    key: step.key,
    code: step.code ?? codeOf(step.key),
    bubbles: true,
    cancelable: true,
    composed: true,
    ...(step.ctrlKey ? { ctrlKey: true } : {}),
    ...(step.metaKey ? { metaKey: true } : {}),
    ...(step.shiftKey ? { shiftKey: true } : {}),
    ...(step.altKey ? { altKey: true } : {}),
  };
}

/**
 * Set a `<select>`'s value the way React can see it.
 *
 * `HTMLSelectElement.prototype`'s own `value` setter is called explicitly
 * because React installs a value tracker on the node: assigning through the
 * instance updates that tracker too, so React compares the new value against
 * itself, concludes nothing changed, and re-renders the OLD value. Going
 * through the prototype descriptor leaves the tracker stale, which is exactly
 * what makes the following `change` read as a real user edit.
 */
function setSelectValue(element: HTMLSelectElement, value: string): void {
  const options = [...element.options].map((option) => option.value);
  if (!options.includes(value)) {
    throw new Error(
      `No option with value ${JSON.stringify(value)} on this <select> — it offers ` +
        `${options.map((option) => JSON.stringify(option)).join(', ') || '(no options)'}. ` +
        "The value is the option's `value`, not its label; `query` reports both.",
    );
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  if (setter) setter.call(element, value);
  else element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

const PROBE_ACTIONS = ['query', 'click', 'drag', 'key', 'paste', 'select', 'type'] as const;

/**
 * THE WIRE'S TWO FREE-FORM FIELDS, both refused by name.
 *
 * The wire hands the step in untyped (`cmd['step']`), so an unknown verb or an
 * unknown scope must refuse HERE — an exhaustive switch alone would fall
 * through and answer `ok` with nothing, and an unrecognized scope would
 * quietly fall back to the document and answer about a surface the caller did
 * not ask for. Both are the silent pass-through the strict-input rule bans.
 */
function acceptStep(step: DocumentProbeStep): Scope {
  const action = (step as { action?: unknown } | null | undefined)?.action;
  if (!PROBE_ACTIONS.includes(action as (typeof PROBE_ACTIONS)[number])) {
    throw new Error(
      `Unknown document-probe action ${JSON.stringify(action)}. This door has exactly ` +
        `${PROBE_ACTIONS.length} verbs: ${PROBE_ACTIONS.join(', ')} (\`editor.document.*\`).`,
    );
  }
  const requested = (step as { scope?: unknown }).scope ?? 'document';
  if (!SCOPE_NAMES.includes(requested as DocumentProbeScope)) {
    throw new Error(
      `Unknown scope ${JSON.stringify(requested)}. This door addresses exactly these ` +
        `surfaces: ${SCOPE_NAMES.map((name) => `'${name}'`).join(', ')}.`,
    );
  }
  return resolveScope(requested as DocumentProbeScope);
}

export async function runDocumentProbe(step: DocumentProbeStep): Promise<DocumentProbeResult> {
  const scope = acceptStep(step);
  // WHILE THE GAME IS THE ACTIVE DOCUMENT, THIS DOOR READS AND CLICKS ONLY. Every event it
  // dispatches bubbles to \`window\`, where the game listens when its document is active: a key,
  // a typed string, a paste or a drag in any scope (the game's header, the rail, the outliner)
  // would drive the game with synthetic input, which is what refusing the Game document protects.
  if (
    activeWorkspaceDocumentId() === GAME_DOCUMENT_ID &&
    step.action !== 'query' &&
    step.action !== 'click' &&
    step.action !== 'select'
  ) {
    throw new Error(
      `'${step.action}' is refused while the Game document is active: its events bubble to the game. ` +
        "Query, click and select still work; drive the game through the game's own doors.",
    );
  }
  const where = { name: scope.name, id: scope.id, title: scope.title };
  /** Every gesture answers with the element it drove, so a transcript proves
   *  WHAT was driven and not merely that something was. */
  const drove = (element: HTMLElement): DocumentProbeResult => ({
    scope: where,
    matched: 1,
    elements: [describeElement(element, 0)],
  });
  switch (step.action) {
    case 'query': {
      const matches = matchesIn(scope, step.selector);
      return {
        scope: where,
        matched: matches.length,
        elements: matches
          .slice(0, step.limit ?? 25)
          .map((element, index) => describeElement(element, index, step.styles)),
      };
    }
    case 'click': {
      const element = resolveTarget(scope, step.selector, step.index ?? 0);
      dispatchClick(element, step.clicks ?? 1);
      return drove(element);
    }
    case 'type': {
      const target = gestureTarget(scope, step);
      typeInto(target, step.text, step.replace ?? true, step.enter ?? true);
      return drove(target);
    }
    case 'drag': {
      if (step.button !== undefined && ![0, 1, 2].includes(step.button))
        throw new Error(`Unknown button ${JSON.stringify(step.button)}: 0 primary, 1 middle, 2 secondary.`);
      const element = resolveTarget(scope, step.selector, step.index ?? 0);
      // Points are FRACTIONS of the element's box. A pixel value lands far outside it and the
      // gesture silently goes somewhere else, so a point outside 0..1 is refused by name.
      const box = element.getBoundingClientRect();
      const points: [string, readonly [number, number]][] = [
        ['from', step.from],
        ...(step.via ?? []).map((point, index): [string, readonly [number, number]] => [`via[${index}]`, point]),
        ['to', step.to],
      ];
      for (const [name, point] of points) {
        if (point.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) continue;
        throw new Error(
          `drag ${name} ${JSON.stringify(point)} is not a fraction of the element's box: points are ` +
            `[x, y] from 0 to 1 from its top-left ([0.5, 0.5] is its centre). This element is ` +
            `${Math.round(box.width)} x ${Math.round(box.height)} px at (${Math.round(box.x)}, ${Math.round(box.y)}); ` +
            `a page pixel px becomes (px - ${Math.round(box.x)}) / ${Math.round(box.width)}.`,
        );
      }
      dispatchDrag(
        element,
        step.from,
        step.to,
        step.steps ?? 8,
        {
          ...(step.altKey === undefined ? {} : { altKey: step.altKey }),
          ...(step.ctrlKey === undefined ? {} : { ctrlKey: step.ctrlKey }),
          ...(step.metaKey === undefined ? {} : { metaKey: step.metaKey }),
          ...(step.shiftKey === undefined ? {} : { shiftKey: step.shiftKey }),
        },
        step.via ?? [],
        step.button ?? 0,
      );
      return drove(element);
    }
    case 'key': {
      const target = gestureTarget(scope, step);
      // A person's keystroke lands where their click put focus; what the workbench decides a
      // chord means follows that focus (its `vgai.stage.focused` context), so the target takes
      // focus first unless focus is already inside it.
      if (!(document.activeElement instanceof Node && target.contains(document.activeElement))) {
        // As a click does: the nearest element that can hold focus, the target or an ancestor.
        let focusable: HTMLElement | null = target;
        while (focusable && !(focusable.hasAttribute('tabindex') || focusable.tabIndex >= 0 || focusable.isContentEditable)) {
          focusable = focusable.parentElement;
        }
        focusable?.focus({ preventScroll: true });
      }
      target.dispatchEvent(keyEvent('keydown', step));
      if (step.holdMs) await new Promise((settle) => setTimeout(settle, step.holdMs));
      target.dispatchEvent(keyEvent('keyup', step));
      return drove(target);
    }
    case 'select': {
      const element = resolveTarget(scope, step.selector, step.index ?? 0);
      if (!(element instanceof HTMLSelectElement)) {
        throw new Error(
          `${JSON.stringify(step.selector)} resolved a <${element.tagName.toLowerCase()}>, not a ` +
            "<select>. This verb sets a dropdown's value; a button or a checkbox takes `click`.",
        );
      }
      setSelectValue(element, step.value);
      return drove(element);
    }
    case 'paste': {
      const target = gestureTarget(scope, step);
      const data = new DataTransfer();
      data.setData('text/plain', step.text);
      target.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: data,
        }),
      );
      return drove(target);
    }
  }
}
