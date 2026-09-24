/**
 * "one dialect, full capability" (second bullet) — an in-page shim
 * implementing a SUBSET of Playwright's own `Page`/`Locator` surface, rooted at
 * an arbitrary `HTMLElement` (the play-mode game container, `play-mode.ts`'s
 * `getGameContainer()` — see interface doctrine §3.2: "The AI should think it
 * is basically just executing Playwright"). It runs INSIDE the already-open
 * editor tab (no browser automation, no CDP) — `command-listener.ts`'s
 * `page-script` relay op constructs one per call and hands it to a
 * reconstructed step function; a real `@playwright/test` `Page` drives the SAME
 * step file when the spec runs under `PageTransport`
 * (`packages/vgai-live/src/game-client/client.ts`) in CI. That duality is why
 * `createPageShim`'s return value is typed `as Page` — every implemented member
 * matches Playwright's own shape closely enough that a step written against it
 * compiles against the real type too.
 *
 * ## Honesty boundary (spec §3.2, §4 rung 4, §4's honesty-boundary bullet)
 *
 * This shim is for DOM interaction — menus, dialogs, HUD controls, and
 * React-only games whose gameplay surface is the DOM itself. Its
 * events are synthesized DOM events (`dispatchEvent`, always `isTrusted:
 * false` — inherent to the DOM API, never faked or hidden) with no real hit
 * testing. Canvas/adapter gameplay input must still use the engine's virtual-
 * action seam (`game.input.*`); a React-only game uses `game.page(...)` because
 * DOM keyboard/click handlers are its real player-facing input path.
 *
 * Every Playwright `Page`/`Locator` member NOT implemented below throws
 * `PageShimUnsupportedError` naming itself and listing what IS supported —
 * per the interface doctrine, "the illusion may be incomplete, never
 * silently wrong": a step calling `page.mouse.move(...)` must fail loudly the
 * instant it touches the unsupported member, not silently no-op.
 *
 * ## The wire's closure-capture limitation (decision 2)
 *
 * A `page-script` step travels the wire as `step.toString()` and is
 * reconstructed here with `new Function('page', 'return (' + src + ')(page)')`
 * — the SAME limitation class as Playwright's own `page.evaluate`
 * serialization: closures over anything outside the step's own function body
 * (outer `const`s, imported helpers, captured test state) do NOT survive the
 * trip. Only `page` itself (this shim's return value) and whatever the step
 * computes/inlines internally are available. Specs meant to run unmodified
 * under both `PageTransport` (real Playwright, real closures) and
 * `RelayTransport` (this shim, serialized) must be written as though ALWAYS
 * serialized — inline every value the step needs; see
 * `packages/vgai-live/src/game-client/client.ts`'s `GameClient.page()` doc comment for
 * the client-facing half of this contract.
 */

import type { Locator, Page } from '@playwright/test';

/** Thrown by every unimplemented `Page`/`Locator` member this shim proxies.
 *  `member` is the exact property name touched; `supported` is the sibling
 *  member list at the SAME object level (Page's own supported members, or a
 *  Locator's own), so the thrown message alone is enough for an agent to
 *  self-correct without reading this file. */
export class PageShimUnsupportedError extends Error {
  readonly member: string;
  readonly supported: readonly string[];

  constructor(objectName: string, member: string, supported: readonly string[]) {
    super(
      `playwright-shim: ${objectName}.${member} is not supported by the in-page shim. ` +
        `Supported ${objectName} members: ${supported.join(', ')}. ` +
        'This shim is DOM-only — canvas gameplay input must use game.input.*, while React-only ' +
        'DOM games may use Page keyboard/locator input. See packages/editor/src/playwright-shim.ts for ' +
        "the full supported subset and the wire's closure-capture limitation.",
    );
    this.name = 'PageShimUnsupportedError';
    this.member = member;
    this.supported = supported;
  }
}

/**
 * Wraps a plain object so that reading any property NOT already present
 * (own OR inherited — `in` walks the prototype chain, so ordinary
 * `Object.prototype` members like `toString`/`hasOwnProperty` pass through
 * harmlessly) throws `PageShimUnsupportedError` instead of returning
 * `undefined`. Symbol-keyed access (`Symbol.toPrimitive`, Node's
 * `util.inspect.custom`, etc. — console/debugger machinery that probes
 * objects defensively) is let through as `undefined` rather than throwing,
 * so merely logging or inspecting a shim object never itself explodes.
 */
function wrapWithUnsupportedProxy<T extends object>(target: T, objectName: string): T {
  const supported = Object.keys(target);
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(obj, prop, receiver);
      if (prop in obj) return Reflect.get(obj, prop, receiver);
      throw new PageShimUnsupportedError(objectName, prop, supported);
    },
  }) as T;
}

// --- accessible-name / role approximation (a reasonable subset, per brief) -

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function impliedRole(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && el.hasAttribute('href')) return 'link';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'img') return 'img';
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase();
    if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  return null;
}

function roleOf(el: Element): string | null {
  return el.getAttribute('role') ?? impliedRole(el);
}

/** Accessible-name approximation, exactly per brief: `aria-label` first, then
 *  trimmed `textContent`. Real accessible-name computation (aria-labelledby,
 *  associated `<label>`, placeholder fallback, etc.) is out of scope for this
 *  "reasonable subset". */
function accessibleName(el: Element): string {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return normalizeWs(ariaLabel);
  return normalizeWs(el.textContent ?? '');
}

function matchesName(el: Element, name: string | RegExp | undefined): boolean {
  if (name === undefined) return true;
  const accName = accessibleName(el);
  return name instanceof RegExp ? name.test(accName) : accName === name;
}

function queryByRole(
  root: HTMLElement,
  role: string,
  opts?: { name?: string | RegExp },
): Element[] {
  const all = Array.from(root.querySelectorAll('*'));
  return all.filter((el) => roleOf(el) === role && matchesName(el, opts?.name));
}

/** Substring match on normalized whitespace text (Playwright's own
 *  `getByText` default), keeping only the most SPECIFIC matches — an
 *  ancestor whose own match is purely inherited from an already-matching
 *  descendant is dropped, approximating Playwright's leaf-text bias. */
function queryByText(root: HTMLElement, text: string | RegExp): Element[] {
  const all = Array.from(root.querySelectorAll('*')).filter(
    (el) => el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE',
  );
  const isMatch = (el: Element): boolean => {
    const t = normalizeWs(el.textContent ?? '');
    if (t.length === 0) return false;
    return text instanceof RegExp ? text.test(t) : t.includes(text);
  };
  const matched = all.filter(isMatch);
  return matched.filter((el) => !matched.some((other) => other !== el && el.contains(other)));
}

function queryByTestId(root: HTMLElement, testId: string | RegExp): Element[] {
  return Array.from(root.querySelectorAll('[data-testid]')).filter((el) => {
    const value = el.getAttribute('data-testid') ?? '';
    return testId instanceof RegExp ? testId.test(value) : value === testId;
  });
}

function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.hidden) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

// --- event dispatch (isTrusted:false by construction — dispatchEvent's own
// contract, never spoofed) -------------------------------------------------

function dispatchClick(el: Element): void {
  const rect = (el as HTMLElement).getBoundingClientRect?.() ?? {
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  };
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  // `view` is deliberately omitted: Playwright's own synthesized events make
  // no promise about it either, and supplying one risks a cross-realm
  // mismatch (the element's owner window vs. whatever `Window` class the
  // event constructors currently in scope expect) — omitting it sidesteps
  // that entirely with no loss of fidelity for a UI-only automation shim.
  const mouseInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  };
  if (typeof PointerEvent !== 'undefined') {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { ...mouseInit, pointerId: 1, isPrimary: true }),
    );
  }
  el.dispatchEvent(new MouseEvent('mousedown', mouseInit));
  if (typeof PointerEvent !== 'undefined') {
    el.dispatchEvent(
      new PointerEvent('pointerup', { ...mouseInit, pointerId: 1, isPrimary: true }),
    );
  }
  el.dispatchEvent(new MouseEvent('mouseup', mouseInit));
  el.dispatchEvent(new MouseEvent('click', mouseInit));
}

/** React-compatible value set: React's synthetic `onChange` listens through
 *  a wrapped native setter, so assigning `el.value = ...` directly is a
 *  no-op from React's perspective — bypass it via the PROTOTYPE's own
 *  setter (the well-known trick), then fire real `input`/`change` events. */
function nativeValueSetter(el: HTMLInputElement | HTMLTextAreaElement): (value: string) => void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  return (value: string) => {
    if (descriptor?.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  };
}

function dispatchFill(el: Element, value: string): void {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    throw new Error(
      `playwright-shim: fill() target is not an <input>/<textarea> (got <${el.tagName.toLowerCase()}>)`,
    );
  }
  el.focus();
  nativeValueSetter(el)(value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// --- keyboard --------------------------------------------------------------

const MODIFIER_KEYS = new Set(['Alt', 'Control', 'Meta', 'Shift']);

function normalizedKey(key: string): string {
  if (key !== 'ControlOrMeta') return key;
  return /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';
}

function codeForKey(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (key === ' ') return 'Space';
  return key;
}

function keyboardTarget(root: HTMLElement): HTMLElement {
  const active = document.activeElement;
  return active instanceof HTMLElement && root.contains(active) ? active : root;
}

function dispatchKey(
  root: HTMLElement,
  type: 'keydown' | 'keyup',
  key: string,
  pressed: ReadonlySet<string>,
): void {
  keyboardTarget(root).dispatchEvent(
    new KeyboardEvent(type, {
      key,
      code: codeForKey(key),
      bubbles: true,
      cancelable: true,
      altKey: pressed.has('Alt'),
      ctrlKey: pressed.has('Control'),
      metaKey: pressed.has('Meta'),
      shiftKey: pressed.has('Shift'),
    }),
  );
}

function makeKeyboard(root: HTMLElement) {
  const pressed = new Set<string>();
  const down = async (rawKey: string): Promise<void> => {
    const key = normalizedKey(rawKey);
    pressed.add(key);
    dispatchKey(root, 'keydown', key, pressed);
  };
  const up = async (rawKey: string): Promise<void> => {
    const key = normalizedKey(rawKey);
    dispatchKey(root, 'keyup', key, pressed);
    pressed.delete(key);
  };
  return {
    down,
    up,
    async press(shortcut: string): Promise<void> {
      const keys = shortcut.split('+').map(normalizedKey);
      const modifiers = keys.filter((key) => MODIFIER_KEYS.has(key));
      const primary = keys.find((key) => !MODIFIER_KEYS.has(key));
      for (const modifier of modifiers) await down(modifier);
      if (primary) {
        await down(primary);
        await up(primary);
      }
      for (const modifier of modifiers.reverse()) await up(modifier);
    },
  };
}

// --- ariaSnapshot ------------------------------------------------------

/** A simple indented role/name tree — "enough for an agent to orient" (per
 *  brief), not a byte-accurate accessibility-tree dump. Only elements with a
 *  resolvable role appear; their descendants nest one level deeper. */
function buildAriaSnapshot(root: Element): string {
  const lines: string[] = [];
  function walk(el: Element, depth: number): void {
    const role = roleOf(el);
    if (role) {
      const name = accessibleName(el);
      lines.push(`${'  '.repeat(depth)}- ${role}${name ? ` "${name}"` : ''}`);
    }
    const nextDepth = role ? depth + 1 : depth;
    for (const child of Array.from(el.children)) walk(child, nextDepth);
  }
  for (const child of Array.from(root.children)) walk(child, 0);
  return lines.join('\n');
}

// --- Locator -------------------------------------------------------------

function makeLocator(query: () => Element[], description: string): Locator {
  const resolveFirst = (action: string): Element => {
    const el = query()[0];
    if (!el) {
      throw new Error(`playwright-shim: ${action}() found no element for ${description}`);
    }
    return el;
  };

  const locatorObj = {
    async click(): Promise<void> {
      dispatchClick(resolveFirst('click'));
    },
    async fill(value: string): Promise<void> {
      dispatchFill(resolveFirst('fill'), value);
    },
    async textContent(): Promise<string | null> {
      const el = query()[0];
      return el ? (el.textContent ?? null) : null;
    },
    async evaluate<R, Arg>(
      pageFunction: (element: Element, arg: Arg) => R | Promise<R>,
      arg?: Arg,
    ): Promise<R> {
      return pageFunction(resolveFirst('evaluate'), arg as Arg);
    },
    async count(): Promise<number> {
      return query().length;
    },
    async waitFor(opts?: { state?: 'visible' | 'attached'; timeout?: number }): Promise<void> {
      const timeoutMs = opts?.timeout ?? 5000;
      const wantState = opts?.state ?? 'visible';
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const el = query()[0];
        if (el && (wantState === 'attached' || isVisible(el))) return;
        if (Date.now() >= deadline) {
          throw new Error(
            `playwright-shim: waitFor() timed out after ${timeoutMs}ms waiting for ${description} ` +
              `to be ${wantState}`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    first(): Locator {
      return makeLocator(() => query().slice(0, 1), `${description}.first()`);
    },
    nth(index: number): Locator {
      return makeLocator(() => {
        const el = query()[index];
        return el ? [el] : [];
      }, `${description}.nth(${index})`);
    },
    // Real Playwright places `ariaSnapshot` on `Locator` (not `Page`) — kept
    // here for parity with the real type; `createPageShim`'s own
    // convenience `ariaSnapshot()` (see `PageShim` below) is a root-rooted
    // shorthand for `page.locator(':scope').ariaSnapshot()`.
    async ariaSnapshot(): Promise<string> {
      return buildAriaSnapshot(resolveFirst('ariaSnapshot'));
    },
  };
  return wrapWithUnsupportedProxy(locatorObj, 'Locator') as unknown as Locator;
}

// --- evaluate --------------------------------------------------------------

/** Accepts either a real function (called directly — no serialization
 *  needed since the shim already runs in-page, unlike real Playwright's
 *  cross-process `evaluate`) or a function-source string (reconstructed via
 *  `new Function`, same wire contract as the outer `page-script` step
 *  itself — see this module's own doc comment). */
async function evaluateImpl(fn: unknown, arg?: unknown): Promise<unknown> {
  if (typeof fn === 'function') {
    return (fn as (a: unknown) => unknown)(arg);
  }
  if (typeof fn === 'string') {
    // Reconstructing a wire-carried function's source is this shim's
    // documented contract (decision 2) — the same limitation class as
    // Playwright's own evaluate serialization.
    const reconstructed = new Function('arg', `return (${fn})(arg)`) as (a: unknown) => unknown;
    return reconstructed(arg);
  }
  throw new Error('playwright-shim: evaluate() requires a function or a function-source string');
}

// --- Page ------------------------------------------------------------------

/**
 * `createPageShim`'s return type: real Playwright's `Page` plus ONE
 * shim-specific convenience, `ariaSnapshot()` — real Playwright only places
 * `ariaSnapshot` on `Locator` (`page.locator(...).ariaSnapshot()`), which
 * this shim ALSO implements (see `makeLocator`, above) for byte-parity with
 * real specs. The root-level shorthand here exists because "enough for an
 * agent to orient" (the brief this shim was built against) is a whole-root
 * orientation primitive, not a per-locator one — a step that calls
 * `page.ariaSnapshot()` directly is shim-specific and won't type-check
 * against a bare `Page` under real Playwright; prefer
 * `page.locator(':scope').ariaSnapshot()` (or any real Locator) in a spec
 * meant to run unmodified under both hosts.
 */
export type PageShim = Page & { ariaSnapshot(): Promise<string> };

/**
 * Builds an in-page `Page` shim rooted at `root` (the game container — never
 * editor chrome, see this module's own doc comment). Every member not
 * implemented here throws `PageShimUnsupportedError` the instant it is
 * touched (property read), naming itself and the supported list.
 */
export function createPageShim(root: HTMLElement): PageShim {
  const pageObj = {
    keyboard: makeKeyboard(root),
    evaluate: async (fn: unknown, arg?: unknown): Promise<unknown> => evaluateImpl(fn, arg),
    locator: (selector: string): Locator =>
      makeLocator(
        () => Array.from(root.querySelectorAll(selector)),
        `locator(${JSON.stringify(selector)})`,
      ),
    getByRole: (role: string, opts?: { name?: string | RegExp }): Locator =>
      makeLocator(
        () => queryByRole(root, role, opts),
        `getByRole(${JSON.stringify(role)}${
          opts?.name !== undefined ? `, {name: ${JSON.stringify(String(opts.name))}}` : ''
        })`,
      ),
    getByText: (text: string | RegExp): Locator =>
      makeLocator(() => queryByText(root, text), `getByText(${JSON.stringify(String(text))})`),
    getByTestId: (testId: string | RegExp): Locator =>
      makeLocator(
        () => queryByTestId(root, testId),
        `getByTestId(${JSON.stringify(String(testId))})`,
      ),
    click: async (selector: string): Promise<void> => {
      await pageObj.locator(selector).click();
    },
    fill: async (selector: string, value: string): Promise<void> => {
      await pageObj.locator(selector).fill(value);
    },
    ariaSnapshot: async (): Promise<string> => buildAriaSnapshot(root),
  };
  return wrapWithUnsupportedProxy(pageObj, 'Page') as unknown as PageShim;
}
