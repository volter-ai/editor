# The limited view

A limited view is a static page that looks like the editor open on one project: the Code-OSS
workbench, the product's panels, Blender editing, Game mode with Play, autoplay and its log, and
the project's own UI. It leaves out what needs the person's machine. It is the roadmap's static
authoring peer (ROADMAP.md, editor-and-contributions), and owner/fleet decision D231 shaped it.

```
volter-model-editor view build [project] --out <dir> --workbench <vscode-web dir>
volter-game-editor  view build [project] --out <dir> --workbench <vscode-web dir>
```

Any static host can serve the output.

## The design: a second transport, not a second mode

The editor in a limited view is the same code as in a session. Nothing in the kit asks which
surface it is on (the 2026-09-20 one-tier ruling holds). The only difference is who answers
`/__editor/*`:

| | Session | Limited view |
| --- | --- | --- |
| Workbench | Code-OSS server (REH) behind the session's proxy | Upstream's `vscode-web` package of the same fork, pin and overlay (`build-release.mjs --target web`) |
| Project folder | `vscode-remote:` over the disk | `volter-view:`, the page's in-memory store (`view/workbench/src/volterView.contribution.ts`) |
| `/__editor/*` | The session's Express routes | A service worker that hands each request to the page's router (`view/page/`) |
| Project modules | The project-rooted Vite, live | The same Vite and plugins, recorded once at `view build` time |
| Chat | supercode chat + harness runtime | `volter-view-chat`: answers with the product's install command and a copy button |

The kit's workbench code runs unchanged:

- `volterSessionOrigin.ts` finds that the page's own origin answers `/__editor/served-modules`, so the page is the session origin.
- The tab bootstrap is served and stays quiet: the page holds the session's sockets in CONNECTING.
- `volterFiles.ts` writes through `IFileService` to the in-memory folder.
- The bridge is the product's production build entry, `__view/frame-bridge.js`.

## What `view build` does

1. It starts the project's own packaged session headless: no workbench, no tab, and an ephemeral identity. The modules are therefore compiled by the same Vite instance and plugins `edit` uses (`server/packaged.ts`, `project-serving-plugins.ts`).
2. It records what that session serves into `__view/routes.json` and `__view/r/`:
   - The kit's fixed answers: `compatibility`, `project` (the session identity is scrubbed), `project-verbs`, `project-components`, `project-tools`, `project-attribution`, `story-files`, `scoped-game-css`, `configurations`, `gameplay-sessions`, `project-thumbnail`, `tab-bootstrap.js`.
   - Each composed integration's `viewSnapshotRoutes()`. For Blender these are the WebAssembly engine files.
   - Every project module and everything it imports, crawled from the project's source files, its packages' contributions and the kit's module doorways. Each project module is also recorded under a sentinel mount id. The worker puts the page's real `?volter-mount=<id>` back into the URL and body, so per-mount module instances still work.
3. It stops the session by its own PID, then writes:

```
index.html  view-sw.js  _headers
assets/…            the product's production build (<product>/dist)
workbench/…         the vscode-web package
__view/view.json    product (name, displayName, colorTheme, install) and project (root, name)
__view/files.json   the project's files: path, size, mtime
__view/project/…    their bytes, fetched by the page on first read
__view/routes.json  recorded answers  →  __view/r/…
__view/boot.js      the page, with each integration's volter.viewServing routes compiled in
__view/frame-bridge.js
```

`view build` copies the project's files without `node_modules`, build output, `logs/`, `server/`,
`.git`, `.env*`, or any `.volter/` file a session keeps for itself. From `.volter/` it carries only
`editor-state.json`, `workbench-storage.json`, `settings.json`, `themes/` and provenance.

## The routes the page answers

The worker checks four things in order: the recorded answers, then the static host (`/__view/`,
`/workbench/`, `/assets/`), then the page's router (`view/page/router.ts`), then back to the
static host if the router has no answer.

**File routes, over the in-memory store, with the session's request and response shapes:**
`assets`, `save-file`, `source-file`, `source-conflict` (GET), `source-files`, `volter-file`,
`project-resource` (GET, POST, DELETE), `data-files`, `data-file` (the server's own fold),
`manifest` (GET, POST, DELETE), `editor-state`, `workbench-storage` (the workbench's
`workspaceStorageUrl`), `settings/{user,project}`, `user-state`, `themes/{user,project}`, and
`served-modules` (answered with `__view/frame-bridge.js`). Two kinds of read are served from the
store as well:

- `/@fs/<project root>/…` and root-relative paths (`public/` first, then the file itself);
- `?raw`, as the file's current text.

The person's own layers start empty and live only in that page: user settings, user state and user
themes. A view must not carry its builder's.

**Reports a session collects, accepted and dropped:** `state`, `heartbeat`, `tab/*`,
`page-error`, `play-phase`, `console-entries`, `console-resolved`, `console/ack`,
`command-result`, `command-received`, `command-listener`, `contributed-commands`,
`log-session`, `log-entries`, `server-log`. `events` answers 204, so an EventSource does not
reconnect. `tab-heartbeat.js` is a no-op worker.

**Blender (`editor-blender/view/blender-view-routes.ts`):** `blender-file` (an in-memory spool),
`blender-project-index`, `blender-project-file`, `blender-output`, `blender-document-chunk` and
`blender-document`. The engine's files (`blender-wasm/*`) are recorded.

**Everything else under `/__editor/`** answers 503 with
`{ error, limitedView: { unavailable, installCommand } }` and the header `x-volter-limited-view`.
These are the routes that need the person's machine or account:

| Refused | Why |
| --- | --- |
| `account/*`, `twin*` | No account is signed in on a static page |
| `harness-chat/*`, `worktrees/*`, `project-work*`, `repository-presence` | Agents run in the local editor's runtime; the Chat view says so in place |
| `git/*`, `share-control/*` | No repository and no sharing host |
| `collaboration/*` | No session to collaborate in |
| `recording/*` | Recording writes to the session's disk |
| `generations*`, `project-tools/run`, `asset-library/*` | Tools and providers run in Node with credentials |
| `configurations/*/{start,build,stop}` | Running the project's own server or build |
| `open-project`, `create-project`, `inspect-project`, `adapt-project`, `browse-folder`, `reveal`, `recent-projects`, `launcher-settings`, `templates`, `examples` | A view is one project |
| `download`, `export` | No build to export |
| `command` | Terminal control of a session |

## What a limited view is not

- **Code changes do not recompile.** The modules are the ones compiled at `view build`. A source edit lives in the page's memory and shows in the workbench, but the running game keeps the compiled module. Data edits behave the same way.
- **Edits stay in memory.** A reload starts over from the shipped files. "Download project" is not built yet.
- **No git, no accounts, no sharing.**
- **Webviews do not render.** Code-OSS loads them from `vscode-cdn.net`, which a cross-origin-isolated static page cannot embed. The editor's own panels do not use webviews.

## Building and hosting

1. **The web workbench (once per fork pin and editor revision):**

   ```
   node scripts/workbench/build-release.mjs --target web --product model-editor \
        --checkout <code-oss fork at FORK.json's pin> --work C:\vwb-web --out C:\vwb-web-out
   ```

   This runs `npm ci` and then `gulp vscode-web-min-ci`: the esbuild bundle of `src/` with no `compile-build-without-mangling`. The workbench lands in `<work>/vscode-web`, with a tarball and `BUILD.json` in `--out`. Keep `--work` on a short path, because the fork's `extensions/copilot` paths exceed Windows' limit until the overlay removes them.

2. **The pieces `view build` reads, built from a checkout:**
   - The product's production build: `npm run build -w @volter/model-editor`.
   - The kit's session and launcher: `npm run build:server -w @volter/editor-core` and `npm run build:session -w @volter/editor-core`.
   - Blender's serving module: `npm run build -w @volter/editor-blender`.
   - The product's CLI: `npm run build:node -w @volter/model-editor`.

3. **The view:** `volter-model-editor view build <project> --out <dir> --workbench <work>/vscode-web`.

Hosting rules:

- **Origin root.** Serve the view from the root of an origin, because the editor's URLs are root-relative.
- **Secure context.** Serve it over https, or from localhost; service workers need a secure context.
- **Cross-origin isolation.** It is required for Blender's threads. `_headers` states it for hosts that read one (Netlify, Cloudflare Pages). On any other host the view's worker adds the headers, after at most one reload.
- **File sizes.** Blender's recorded engine files are stored uncompressed, around 100 MB together. Hosts with a per-file cap (Cloudflare Pages: 25 MiB) cannot serve them; Netlify and most object stores can.

## Known limits and risks (unverified: built typecheck-only)

- **The module crawl is best effort.** Anything the editor imports by a URL that is neither crawled nor reducible by the worker's key rule gets the page's raw file or a 404. The worker's key rule drops `t`, `volter-source` and `volter-reload`, and maps `volter-mount`. Watch the network panel on the first walk.
- **The view leaks local paths.** Compiled module URLs and `/__editor/project` carry the build machine's absolute project path (`/@fs/C:/…`).
- **One page holds the files.** Requests from workers go to the page that registered last. Two tabs of one view are two separate projects.
- **Synchronous XHR would deadlock.** A synchronous XHR to a forwarded route would block the page that has to answer it. None is known.
- **The WALI Blender skew is partial.** Its substrate modules (`blender-wasm/wali/…`) are named at run time and are not recorded. The default Emscripten skew is complete.
