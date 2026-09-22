/*---------------------------------------------------------------------------------------------
 *  vgai: WHERE THE SESSION IS, and how a page that is not on its origin talks to it.
 *
 *  The vgai editor is served by a `vgai edit` session (a Vite dev server plus the
 *  `/__editor/*` routes). In the WEB shape the Code-OSS workbench and that session sit
 *  behind one proxy origin, so every URL the editor writes is same-origin and nothing in
 *  this file does anything. In the DESKTOP shape the workbench page is
 *  `vscode-file://vscode-app` — Electron's privileged scheme over the app root — and the
 *  session is `http://127.0.0.1:<port>`. Two origins, unavoidably: a proxy cannot front a
 *  page Electron loads off disk.
 *
 *  So desktop needs two things, and both are here rather than in the vgai editor (rule 2:
 *  zero changes to the editor for the sake of the frame) and rather than in a core service
 *  (rule 1: additive).
 *
 *  1. WHERE THE SESSION IS. Not an env var, not a setting: the open WORKSPACE FOLDER is the
 *     project, and a live session writes `<project>/.vgai/session.json` with its own port —
 *     the same file `vgai sessions`/`vgai close` read. The frame reads the project's own
 *     statement through the file service. If the page is already http(s) (the web shape),
 *     the page's origin IS the session and the file is not consulted.
 *
 *  2. HOW ROOT-RELATIVE URLS REACH IT. Editor code writes `/__editor/state`, and on a
 *     `vscode-file://vscode-app/…/workbench-dev.html` page that resolves to the app root and
 *     404s. The rule this shim applies is narrow and was MEASURED before it was written
 *     (2026-09-19): with recorders on fetch/XHR/WebSocket/EventSource/Worker installed and
 *     the workbench driven through Explorer, Source Control and Go to File, the workbench
 *     produced ZERO root-relative URLs — it addresses its own resources as absolute
 *     `vscode-file:` URIs through `FileAccess`. A root-relative URL on this page therefore
 *     means "the session", and that is the whole rewrite rule.
 *
 *  A cross-origin WORKER is the one case a rewrite alone cannot fix: the HTML spec forbids
 *  constructing a worker from a cross-origin script however permissive CORS is. The shim
 *  wraps such a worker in a same-origin `blob:` module that installs this same shim inside
 *  the worker and then imports the real script by absolute URL — so `import.meta.url` inside
 *  the real module is still its own http URL (relative imports, wasm and the Emscripten
 *  pthread workers it spawns all resolve correctly), and the blob is only the doorway.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { joinPath } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/** Electron's fixed authority for the desktop app root. */
const DESKTOP_PAGE_ORIGIN = 'vscode-file://vscode-app';

/**
 * The origin that serves the vgai editor for the folder this workbench has open.
 *
 * Web shape: this page's own origin (the proxy fronts both). Desktop: the port the live
 * session wrote into the project's `.vgai/session.json`.
 */
export async function resolveSessionOrigin(
	fileService: IFileService,
	workspaceService: IWorkspaceContextService,
): Promise<string> {
	const pageOrigin = mainWindow.location.origin;
	// An http(s) page is USUALLY the session: the web harness and the WEB + SERVER shape
	// both put one proxy origin in front of the workbench and the session (docs/CODE-OSS.md
	// §Boot, WEB + SERVER), so the page's own origin answers `/__editor/*`. It is not
	// ALWAYS: the Code-OSS server can be reached directly, without that proxy, and then the
	// page is on the REH's origin and the session is on another port entirely. So the page
	// origin is CHECKED against the session's own door rather than assumed, and the fallback
	// is the same one desktop uses — the open project's `.vgai/session.json`.
	if (pageOrigin.startsWith('http://') || pageOrigin.startsWith('https://')) {
		if (await answersSessionDoor(pageOrigin)) {
			return pageOrigin;
		}
	}
	const folder = workspaceService.getWorkspace().folders[0]?.uri;
	if (!folder) {
		throw new Error(`no folder is open, so there is no project whose vgai session this ${pageOrigin} page could reach — open the project folder (File > Open Folder)`);
	}
	const sessionFile = joinPath(folder, '.vgai', 'session.json');
	let parsed: { port?: number; url?: string; pid?: number };
	try {
		const content = await fileService.readFile(sessionFile);
		parsed = JSON.parse(content.value.toString()) as typeof parsed;
	} catch (error) {
		throw new Error(`no live vgai session for ${folder.fsPath}: ${sessionFile.fsPath} is not readable (${error instanceof Error ? error.message : String(error)}). Start one with \`volter-editor edit . --no-open\` in that folder.`);
	}
	const origin = parsed.url ? new URL(parsed.url).origin : parsed.port ? `http://127.0.0.1:${parsed.port}` : undefined;
	if (!origin) {
		throw new Error(`${sessionFile.fsPath} names neither a url nor a port, so the session's origin is unknown`);
	}
	return origin;
}

/**
 * Does `origin` serve a `vgai edit` session? The serving door is the cheapest honest
 * question — it is a session-only route, it needs no project state, and it is the very
 * next thing the contribution asks of whatever this function returns.
 *
 * A short timeout, because the answer is only used to choose between two origins: a
 * slow or absent server reads as "not the session" and the `.vgai/session.json` path
 * takes over, which is the right outcome either way.
 */
async function answersSessionDoor(origin: string): Promise<boolean> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), 2_000);
	try {
		const answer = await fetch(`${origin}/__editor/served-modules`, { signal: abort.signal });
		return answer.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timer);
	}
}


/**
 * A `default` Trusted Types policy, so the vgai editor's modules can run on this page.
 *
 * The workbench's CSP carries `require-trusted-types-for 'script'`, which is right for a page
 * whose only script author is VS Code: every core sink (`innerHTML`, `new Function`, worker
 * URLs) goes through a NAMED policy. The vgai editor is ordinary web code and its
 * dependencies are too — Font Awesome sets `innerHTML`, Vite's client builds a module
 * through the `Function` constructor — so without a default policy the editor's first render
 * throws "This document requires 'TrustedHTML' assignment" (measured 2026-09-19).
 *
 * A DEFAULT policy is the only kind that applies implicitly, so it is the only kind that can
 * cover third-party code. It is registered here, by the frame, rather than by editing the
 * editor: making the editor and its dependency tree Trusted-Types-clean is the product answer
 * and it is not this unit's (docs/CODE-OSS.md §Desktop names it). `default` is on the dev
 * workbench's `trusted-types` allowlist — the one core edit this shape needed.
 *
 * It is installed only when this page is NOT the session's own origin, i.e. only in the
 * desktop frame: the web shape's page carries no Trusted Types requirement.
 */
export function installDefaultTrustedTypesPolicy(): 'installed' | 'not-needed' | 'already' {
	const tt = (mainWindow as unknown as { trustedTypes?: TrustedTypePolicyFactory }).trustedTypes;
	if (!tt || typeof tt.createPolicy !== 'function') {
		return 'not-needed';
	}
	if ((mainWindow as unknown as Record<string, unknown>)['__vgaiDefaultTrustedTypes']) {
		return 'already';
	}
	tt.createPolicy('default', {
		createHTML: (value: string) => value,
		createScript: (value: string) => value,
		createScriptURL: (value: string) => value,
	});
	(mainWindow as unknown as Record<string, unknown>)['__vgaiDefaultTrustedTypes'] = true;
	return 'installed';
}


/**
 * THE FRAME'S PAGE BECOMES A TAB.
 *
 * The vgai session counts pages as TABS — one per edited game, extras yield, a lost tab
 * self-heals, shutdown closes it — and everything it decides comes from what a page's own
 * bootstrap sends: a tab identity, a duplex control channel, and a HEARTBEAT from a dedicated
 * worker that keeps beating while the page's main thread does not. In the editor's own page
 * that bootstrap is inline in `index.html`, before the module graph.
 *
 * This page's HTML is VS Code's, so it has none of that. Measured on 2026-09-19 (U1): the
 * workbench ran the editor, took commands, and NEVER BEAT — `vgai status` said "TAB PRESENCE
 * — SOMETHING IS OFF … no heartbeat", and no bpy call ever answered, because the Blender
 * engine's own doors wait on a session that believes this tab is not really there.
 *
 * The fix is NOT to reimplement that bootstrap here: it is a protocol with a server on the
 * other end, and two copies of a protocol drift on the first change. The session SERVES its
 * own — `/__editor/tab-bootstrap.js`, read out of `index.html` by
 * `packages/editor/server/tab-bootstrap.ts` — and this loads it as an ordinary classic
 * script from that origin. The script takes its base from its own `src`, so every url it
 * builds (control socket, heartbeat worker, goodbye beacon) points at the session and not at
 * `vscode-file://vscode-app`, and `?surface=vscode` is how the tab table knows to call this
 * page a VS Code window instead of an anomaly.
 *
 * ORDER MATTERS: it must run BEFORE the bridge's module graph, because the editor's
 * `editor-presence.ts` adopts `__VGAI_EDITOR_PRESENCE_BOOTSTRAP__` at module evaluation and
 * otherwise opens a second, heartbeat-less channel of its own. It must run AFTER
 * {@link installDefaultTrustedTypesPolicy}, because assigning `script.src` is a
 * TrustedScriptURL sink on this page.
 */
export async function installSessionTabBootstrap(sessionOrigin: string): Promise<'installed' | 'already'> {
	const w = mainWindow as unknown as Record<string, unknown>;
	if (w['__VGAI_EDITOR_PRESENCE_BOOTSTRAP__']) {
		return 'already';
	}
	const src = `${sessionOrigin}/__editor/tab-bootstrap.js?surface=vscode`;
	await new Promise<void>((resolve, reject) => {
		const script = mainWindow.document.createElement('script');
		// Classic, not a module: the bootstrap reads `document.currentScript` to learn where
		// the session is, and a module script has none.
		script.async = false;
		// CORS MODE, or this page cannot load it at all. The window runs cross-origin-isolated
		// (`--enable-coi`, which the Blender worker needs), and a cross-origin subresource
		// fetched in the default no-cors mode is refused by COEP unless it carries a
		// cross-origin resource policy. Measured 2026-09-19: the load raised `error` with no
		// detail, the mount stopped at this line, and the window stayed heartbeat-less.
		// `anonymous` makes it the same kind of fetch the bridge's own module import already
		// is, and the session answers it — it allows exactly this origin (DESKTOP_FRAME_ORIGIN).
		script.crossOrigin = 'anonymous';
		script.src = src;
		script.addEventListener('load', () => resolve());
		script.addEventListener('error', () => reject(new Error(`the vgai session did not serve ${src} — without it this window cannot beat, and the session will report it as a tab that is not running`)));
		mainWindow.document.head.appendChild(script);
	});
	if (!w['__VGAI_EDITOR_PRESENCE_BOOTSTRAP__']) {
		throw new Error(`${src} loaded but registered no presence bootstrap; the session is serving something other than index.html's inline bootstrap`);
	}
	return 'installed';
}

/**
 * Point this page's root-relative URLs at `sessionOrigin`. A no-op when the page is already
 * on that origin (the web shape). Idempotent; returns the number of doors it patched.
 */
export function installSessionOriginShim(sessionOrigin: string): number {
	const w = mainWindow as unknown as Record<string, unknown>;
	if (w['__vgaiSessionOrigin'] === sessionOrigin) {
		return 0;
	}
	if (mainWindow.location.origin === sessionOrigin) {
		w['__vgaiSessionOrigin'] = sessionOrigin;
		return 0;
	}
	w['__vgaiSessionOrigin'] = sessionOrigin;

	const scope = mainWindow as unknown as {
		fetch: typeof fetch;
		Worker: typeof Worker;
		WebSocket: typeof WebSocket;
		EventSource: typeof EventSource;
		XMLHttpRequest: typeof XMLHttpRequest;
	};
	let patched = 0;

	/** `/x` → `<session>/x`; a ws(s) URL on the page origin → the session's; anything else as-is. */
	const map = (raw: unknown): unknown => {
		if (typeof raw !== 'string') { return raw; }
		if (raw.startsWith('//')) { return raw; }
		if (raw.startsWith('/')) { return sessionOrigin + raw; }
		return raw;
	};

	// Bound to the window: an unbound `fetch` is an illegal invocation.
	const originalFetch = scope.fetch.bind(mainWindow);
	scope.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
		if (typeof input === 'string') { return originalFetch(map(input) as string, init); }
		if (input instanceof Request && input.url.startsWith(DESKTOP_PAGE_ORIGIN + '/')) {
			const rewritten = sessionOrigin + input.url.slice(DESKTOP_PAGE_ORIGIN.length);
			return originalFetch(new Request(rewritten, input), init);
		}
		return originalFetch(input, init);
	} as typeof fetch;
	patched++;

	const originalOpen = scope.XMLHttpRequest.prototype.open;
	scope.XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
		return (originalOpen as unknown as (...a: unknown[]) => void).call(this, method, map(url), ...rest);
	} as typeof originalOpen;
	patched++;

	const OriginalWebSocket = scope.WebSocket;
	const PatchedWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
		let target = typeof url === 'string' ? url : url.toString();
		if (target.startsWith('/')) { target = sessionOrigin.replace(/^http/, 'ws') + target; }
		return new OriginalWebSocket(target, protocols as string | string[]);
	} as unknown as typeof WebSocket;
	PatchedWebSocket.prototype = OriginalWebSocket.prototype;
	scope.WebSocket = PatchedWebSocket;
	patched++;

	if (scope.EventSource) {
		const OriginalEventSource = scope.EventSource;
		const PatchedEventSource = function (this: unknown, url: string | URL, init?: EventSourceInit) {
			return new OriginalEventSource(map(url) as string, init);
		} as unknown as typeof EventSource;
		PatchedEventSource.prototype = OriginalEventSource.prototype;
		scope.EventSource = PatchedEventSource;
		patched++;
	}

	scope.Worker = makeWorkerShim(scope.Worker, sessionOrigin);
	patched++;
	return patched;
}

/**
 * A `Worker` that can be handed a cross-origin script. The browser refuses one outright, so
 * the shim makes a same-origin `blob:` module whose whole body installs this shim again (the
 * worker's own nested workers — Emscripten's pthreads — hit the same wall) and then imports
 * the real script. The real module keeps its own http `import.meta.url`, which is what makes
 * its relative imports, its `.wasm` and its `.data` resolve.
 */
function makeWorkerShim(OriginalWorker: typeof Worker, sessionOrigin: string): typeof Worker {
	const Shim = function (this: unknown, scriptURL: string | URL, options?: WorkerOptions) {
		let target = typeof scriptURL === 'string' ? scriptURL : scriptURL.toString();
		if (target.startsWith('/') && !target.startsWith('//')) { target = sessionOrigin + target; }
		const crossOrigin = /^https?:\/\//.test(target) && new URL(target).origin !== mainWindow.location.origin;
		if (!crossOrigin) {
			return new OriginalWorker(target, options);
		}
		const isModule = options?.type === 'module';
		const body = isModule
			? `${WORKER_SHIM_SOURCE}\n__vgaiWorkerShim(${JSON.stringify(sessionOrigin)});\n__vgaiWorkerEntry(${JSON.stringify(target)});\n`
			: `${WORKER_SHIM_SOURCE}\n__vgaiWorkerShim(${JSON.stringify(sessionOrigin)});\nimportScripts(${JSON.stringify(target)});\n`;
		const blob = new Blob([body], { type: 'text/javascript' });
		const url = URL.createObjectURL(blob);
		const worker = new OriginalWorker(url, { ...options, type: isModule ? 'module' : 'classic' });
		// The blob is the doorway only; the worker has its own copy of the source by the time
		// anything else runs, and leaving the object URL alive leaks one per worker.
		setTimeout(() => URL.revokeObjectURL(url), 30_000);
		return worker;
	} as unknown as typeof Worker;
	Shim.prototype = OriginalWorker.prototype;
	return Shim;
}

/**
 * The same rewrite, as source, for injection into a worker scope. It is a string because a
 * worker cannot import from this module graph — the whole point is that it is on the other
 * origin.
 */
const WORKER_SHIM_SOURCE = `
function __vgaiWorkerShim(sessionOrigin) {
	if (self.__vgaiSessionOrigin === sessionOrigin) { return; }
	self.__vgaiSessionOrigin = sessionOrigin;
	/* A worker inherits its document's CSP, so require-trusted-types-for script follows
	   it in here — and the page's default policy does NOT: policies are per realm. Measured
	   2026-09-19 with the session's heartbeat worker: the doorway's own importScripts
	   threw "This document requires 'TrustedScriptURL' assignment", the worker died before
	   its first line, and the tab never beat. Same reasoning as the page's policy: the code
	   on the far side is ordinary web code, and a default policy is the only kind that
	   applies implicitly. */
	try {
		if (self.trustedTypes && self.trustedTypes.createPolicy && !self.__vgaiDefaultTrustedTypes) {
			self.trustedTypes.createPolicy('default', { createHTML: (v) => v, createScript: (v) => v, createScriptURL: (v) => v });
			self.__vgaiDefaultTrustedTypes = true;
		}
	} catch (error) { /* a realm that already has one is fine */ }
	const map = (raw) => (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? sessionOrigin + raw : raw);
	const of_ = self.fetch;
	self.fetch = function (input, init) { return of_.call(this, typeof input === 'string' ? map(input) : input, init); };
	const OW = self.Worker;
	if (OW) {
		const Shim = function (scriptURL, options) {
			let target = String(scriptURL);
			if (target.startsWith('/') && !target.startsWith('//')) { target = sessionOrigin + target; }
			const cross = /^https?:\\/\\//.test(target) && new URL(target).origin !== self.location.origin;
			if (!cross) { return new OW(target, options); }
			const isModule = options && options.type === 'module';
			const body = __vgaiWorkerShim.toString() + '\\n' + __vgaiWorkerEntry.toString() + '\\n__vgaiWorkerShim(' + JSON.stringify(sessionOrigin) + ');\\n'
				+ (isModule ? '__vgaiWorkerEntry(' + JSON.stringify(target) + ');' : 'importScripts(' + JSON.stringify(target) + ');');
			const url = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
			return new OW(url, Object.assign({}, options, { type: isModule ? 'module' : 'classic' }));
		};
		Shim.prototype = OW.prototype;
		self.Worker = Shim;
	}
}
/* THE FIRST MESSAGE, which a module worker behind this doorway used to LOSE.

   A dedicated worker queues what is posted to it while its top-level script runs and
   delivers it the moment that script finishes. A CLASSIC doorway is fine: importScripts is
   synchronous, so the real script's handler is installed before delivery. A MODULE doorway
   is not — import() returns a promise, the blob's own script ends immediately, and the
   queued message is dispatched into a scope with no listener and is gone.

   Measured 2026-09-19: Blender's worker sat with its onmessage registered and nothing else,
   the page's first call never got a reply, and blender-start timed out against a tab that
   was otherwise healthy (WORK.md U11; it is the half U1 could not close). Nothing anywhere
   reports it, because losing a message is not an error.

   So the doorway HOLDS every message until the real module is in, then re-dispatches them in
   order. Ports are carried across; anything transferred is already in this realm by then. */
function __vgaiWorkerEntry(target) {
	const queued = [];
	let delivered = false;
	const hold = (event) => { if (!delivered) { queued.push(event); } };
	self.addEventListener('message', hold);
	return import(target).then(() => {
		delivered = true;
		self.removeEventListener('message', hold);
		for (const event of queued) {
			self.dispatchEvent(new MessageEvent('message', { data: event.data, ports: event.ports }));
		}
	}, (error) => {
		delivered = true;
		self.removeEventListener('message', hold);
		setTimeout(() => { throw error; });
	});
}
`;
