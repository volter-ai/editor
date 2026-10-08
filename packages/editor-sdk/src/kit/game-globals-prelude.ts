/**
 * The lexical shadow prepended to every project/game module so `globalThis`,
 * `window`, and `document` resolve to the mount's game realm instead of the
 * real host objects. This is how raw listeners, timers, storage calls, and
 * game-global properties stay attributable without touching editor globals.
 *
 * It lives in its own module, apart from `gated-globals.ts`, because it has THREE
 * consumers spanning two TypeScript programs:
 *   - `gated-globals.ts` (browser) re-exports it, and installs the proxies;
 *   - `browser-transpile.ts` (browser) prepends it to client-transpiled source;
 *   - `vite-plugin-game-globals.ts` (Node) prepends it at transform time, and is
 *     reachable from `tsconfig.server.json` via `server/dev.ts`.
 *
 * That last one is the constraint: the server program compiles without the DOM
 * lib, so it cannot pull in `gated-globals.ts` (whose proxy code names `window`,
 * `document`, and `EventListenerOrEventListenerObject`). This module names none
 * of them, so both programs can import the ONE definition. The dev server used to
 * keep a hand-copied duplicate policed by a source-text sync test; extracting the
 * constant deletes the copy and the test with it.
 *
 * Safe ahead of a module's own `import` statements: ESM imports are hoisted, so a
 * leading `const window = …` still shadows for the whole module body. See
 * `gated-globals.ts` for the proxy semantics it reaches.
 *
 * S-5 (the SimCity ingest ledger) added the SCHEDULING half. Shadowing `window`
 * alone never reached a bare `setInterval(this.simulate, 1000)` — that resolves
 * to the global binding, not to `window.setInterval` — which is exactly how a
 * "gated" SimCity mount kept simulating after pause. The scheduling names are
 * shadowed onto the same-realm loop gate
 * (`ingest/same-realm-loop-gate.ts`, installed by `gated-globals.ts`), which is
 * a pure pass-through until something holds it, so an ungated session's timing
 * is unchanged. `.bind` is not optional: these are window methods and a bare
 * call would hand them an `undefined` receiver ("Illegal invocation"), the same
 * trap the `set` proxy's receiver comment records.
 */
/**
 * MULTI-INSTANCE: the prelude for a module belonging to mount `mountId`.
 *
 * The mount id is BAKED IN at transform time rather than discovered at runtime
 * from `import.meta.url`. Reading the module's own url would have worked —
 * every project module under a mount already carries `?volter-mount=<id>` — and
 * it needed no parameter. It was rejected because it silently constrains the
 * prelude to ES-MODULE evaluation forever: `import.meta` is a SyntaxError in a
 * `new Function` body, so any future non-module evaluation path would break at
 * runtime with a message naming neither this file nor the reason. A test
 * evaluating the prelude that way is what surfaced it. The transform already
 * knows the mount id, so baking it costs one argument and keeps the prelude
 * evaluable anywhere.
 *
 * With no mount id the same resolver selects the default realm. Hosted/client
 * transpile paths therefore receive the same isolation semantics rather than
 * a weaker fallback realm.
 */
export function gameGlobalsPrelude(mountId?: string): string {
  const realm = `(__volterHost.__volterGameRealm?__volterHost.__volterGameRealm(${JSON.stringify(mountId ?? '')}):null)`;
  return PRELUDE_HEAD.replace('__VOLTER_REALM__', realm);
}

/**
 * The page's real global object, as an expression that names no identifier a project can shadow
 * and compiles no code from a string.
 *
 * A module may itself declare `globalThis` (the prelude does), so reading the host through that
 * identifier before its declaration would hit the declaration's TDZ. The expression instead puts
 * a getter on `Object.prototype` for a moment and reads it as a bare name: a bare name that no
 * scope declares is looked up on the global object, which inherits from `Object.prototype`, so the
 * getter runs with the global object as `this`. It is the published `globalThis` polyfill
 * (mathiasbynens.be/notes/globalthis), with `Object` itself reached through a literal. When
 * `Object.prototype` will not take the getter (a project froze it), the global is read as `self`
 * or `global` instead, so one project's freeze does not break every module that loads after it.
 *
 * It replaced a call of the Function constructor on the string 'return globalThis', which a
 * content security policy without 'unsafe-eval' refuses: under such a policy every project module
 * failed on its first line.
 *
 * This is lifecycle instrumentation, not a security sandbox: arbitrary same-realm code can reach
 * the same object, which is why the architecture does not claim a browsing-context boundary.
 */
export const HOST_GLOBAL_EXPRESSION =
  "(()=>{const O=({}).constructor;try{O.defineProperty(O.prototype,'__volterHostOf',{get(){return this},configurable:true});" +
  'try{return __volterHostOf}finally{delete O.prototype.__volterHostOf}}' +
  // A project may have frozen Object.prototype, and then the getter cannot be put there. The
  // global is then read by a name the prelude itself does not declare: `self` (a window or a
  // worker), then `global` (Node). Each is tried alone, because a project that declares the
  // name makes even `typeof` of it throw until its declaration runs. `window` and `globalThis`
  // are not tried: the prelude declares both in this same statement.
  "catch(d){try{if(typeof self!=='undefined')return self}catch(s){}" +
  "try{if(typeof global!=='undefined')return global}catch(g){}throw d}})()";

/** How every prelude begins: the text a transform looks for to know a module already has one. */
export const GAME_GLOBALS_PRELUDE_START = `const __volterHost=${HOST_GLOBAL_EXPRESSION},`;

const PRELUDE_HEAD =
  GAME_GLOBALS_PRELUDE_START +
  '__volterR=__VOLTER_REALM__,' +
  '__volterGlobal=((__volterR&&__volterR.globalThis)||__volterHost.__volterGameWindow||__volterHost),' +
  'globalThis=__volterGlobal,' +
  '__volterSched=((__volterR&&__volterR.timers)||__volterHost.__volterGameTimers||__volterHost),' +
  // Bind or pass through UNCHANGED. `.bind` is not optional for a real window
  // method — a bare call would hand it an `undefined` receiver ("Illegal
  // invocation"), the same trap `gated-globals.ts`'s `set` trap records — but
  // an environment missing the API entirely (a Node-side transpile test, a
  // worker) must degrade at the CALL site, not explode at module load.
  '__volterBind=function(n){var f=__volterSched[n];' +
  "return typeof f==='function'?f.bind(__volterSched):f;}," +
  'console=((__volterR&&__volterR.console)||__volterHost.__volterGameConsole||__volterHost.console),' +
  'window=((__volterR&&__volterR.window)||__volterHost.__volterGameWindow||__volterGlobal.window),' +
  'document=((__volterR&&__volterR.document)||__volterHost.__volterGameDocument||__volterGlobal.document),' +
  '__volterWindowBind=function(n){var f=window&&window[n];' +
  "return typeof f==='function'?f.bind(window):f;}," +
  'localStorage=(window&&window.localStorage),' +
  'sessionStorage=(window&&window.sessionStorage),' +
  'location=(window&&window.location),' +
  "addEventListener=__volterWindowBind('addEventListener')," +
  "removeEventListener=__volterWindowBind('removeEventListener')," +
  "dispatchEvent=__volterWindowBind('dispatchEvent')," +
  // PROJECT-SCOPED fetch: `__volterProjectFetch`, when a host installs one,
  // answers a root-absolute `fetch('/shaders/…')` from project code against
  // the project's own files; everywhere else this binds the host's own fetch (bound
  // to the REAL global: native fetch called on a proxied window receiver
  // throws "Illegal invocation"). The browser twin of the dev server's
  // `vite-plugin-project-root-absolute-assets` rule: a root-absolute request
  // made BY PROJECT CODE resolves inside the project.
  // RESOLVED AT CALL TIME, not at module evaluation. Binding the hook once,
  // when the module evaluated, captured whatever existed THEN: a canvas
  // project's world evaluated on RELOAD before the bridge had installed the
  // hook, so Pixi's atlas fetch of `/sprites/survivor.json` went to the host
  // and got the SPA's index.html — `Unexpected token '<'`, the scene gutted to
  // one row (build-45 gate, 2026-09-02); and after a library download the
  // bridge mints a NEW hook over a new url map, which an already-evaluated
  // module would never see. Reading the host's property on every call keeps
  // every module on the current bridge, with the same host-fetch fallback.
  'fetch=function(){var f=__volterHost.__volterProjectFetch;' +
  'return f?f.apply(null,arguments):__volterHost.fetch.apply(__volterHost,arguments)},' +
  "setTimeout=__volterBind('setTimeout')," +
  "clearTimeout=__volterBind('clearTimeout')," +
  "setInterval=__volterBind('setInterval')," +
  "clearInterval=__volterBind('clearInterval')," +
  "requestAnimationFrame=__volterBind('requestAnimationFrame')," +
  "cancelAnimationFrame=__volterBind('cancelAnimationFrame');\n";

/** The no-mount prelude — the constant every existing consumer already uses. */
export const GAME_GLOBALS_PRELUDE = gameGlobalsPrelude();
