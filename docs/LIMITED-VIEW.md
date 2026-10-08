# The limited view

A limited view is a static page that looks like the editor open on one project: the Code-OSS
workbench, the product's panels, Blender editing, Game mode with Play, autoplay and its log, and
the project's own UI. It leaves out what needs the person's machine. It is the roadmap's static
authoring peer (ROADMAP.md, editor-and-contributions), and owner/fleet decision D231 shaped it.

```
cyclotron view build [project] --out <dir> --workbench <vscode-web dir>
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
| Chat | supercode chat + harness runtime | `volter-view-chat`: the face of an agent that runs in the page on the host's model (below); on a host with no AI it answers with the product's install command |

The kit's workbench code runs unchanged:

- `volterSessionOrigin.ts` finds that the page's own origin answers `/__editor/served-modules`, so the page is the session origin.
- The tab bootstrap is served and stays quiet: the page holds the session's sockets in CONNECTING.
- `volterFiles.ts` writes through `IFileService` to the in-memory folder.
- The bridge is the product's production build entry, `__view/frame-bridge.js`.

## What `view build` does

1. It starts the project's own packaged session headless: no workbench, no tab, and an ephemeral identity. The modules are therefore compiled by the same Vite instance and plugins `edit` uses (`server/packaged.ts`, `project-serving-plugins.ts`).
2. It records what that session serves into `__view/routes.json` and `__view/r/`:
   - The kit's fixed answers: `compatibility`, `project` (the session identity is scrubbed), `project-verbs`, `project-components`, `project-tools`, `project-attribution`, `story-files`, `scoped-game-css`, `configurations`, `project-thumbnail`, `tab-bootstrap.js`. The play-session catalog is not recorded: it comes from the project's `logs/`, which a view does not publish.
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

### What of the project is published

A limited view is made to be shared, so it publishes only what the project would commit, and never
a secret (`server/launcher/view-files.ts`). A file is published only if it passes all four rules:

1. **Never a secret.** This applies whatever `.gitignore` says: `.env*`, `.envrc`, `*.local`, `.npmrc`, `.yarnrc.yml`, `.pypirc`, `.netrc`, `.git-credentials`, `.dockercfg`, `.htpasswd`, `credentials*.json`, `service-account*.json`, any file in a `secrets/` folder, any file named exactly `secrets.<env|yaml|yml|toml|json|ini|txt|conf>` at any depth (so `secrets.data.json` still ships), `*.tfvars`, `kubeconfig`, `*.db`, `*.sqlite`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, and SSH keys (`id_*`, `*.ppk`).
2. **Not dependencies or output.** `node_modules`, `dist*`, `logs/`, `server/`, and every dot-folder except `.volter` and `.storybook` (so `.git` is never published).
3. **Only the project's own `.volter` files.** That means `.volter/settings.json` and `.volter/themes/*.json`. The editor state and workbench storage are a person's workspace: open documents, search history, and URIs naming their home folder. So a view always opens on the editor's default layout.
4. **Nothing `.gitignore` ignores.** In a git work tree, git answers (`git ls-files --cached --others --exclude-standard`). Elsewhere, every `.gitignore` is read with git's rules.

`view build` prints what it left out, by rule, as counts only.

**What these rules cannot stop.** Code is compiled into the view, so anything the code imports
ships inside its module. That includes a secret file a committed module imports, and every
`import.meta.env.VITE_*` value, which Vite inlines at compile time. Keep secrets out of code that
runs in the browser, as you would for any static deploy.

**Limits of the no-git fallback.** Outside a git work tree, only the project's `.gitignore` files
are read. git's global excludes (`core.excludesFile`) and `.git/info/exclude` are not, and neither
are Windows 8.3 short names. Build from a git work tree when that matters.

### No path of the building machine

Recorded URLs and bodies name the project root as `/volter-view/<name>`, which is also what the
page tells the editor it opened. Every other root that a recorded `/@fs/` URL names gets its own
`/volter-fs/<n>/` prefix, such as a workspace's hoisted packages or an editor checkout
(`server/launcher/view-paths.ts`). Recordings are named by the hash of their published URL.

The session's other answers drop what names the machine:

- The recorded `/__editor/project` drops the session's identity and the engine's git state.
- An integration's recorded answers pass through its own `viewSnapshotScrub`. Blender's engine status keeps what the page reads and drops `dir` (the engine folder, which may be `VOLTER_BLENDER_WASM_DIR` and named by no URL) and its path-quoting `missing` messages.
- Recorded modules lose their inline source maps.
- No `.map` file is copied from the product's build or the workbench.

The view is built in a staging folder beside `--out`, and that folder is scanned. The scan reads
every file except known binaries, as written, %-decoded and JSON-unescaped, and looks for:

- the builder's home folder;
- their user name inside a home path;
- any `/@fs/` URL that is still a real path;
- any inline source map.

A hit fails the build and deletes the staging folder, so `--out` keeps whatever it held before. The
view moves into `--out` only once it is whole and clean.

## The routes the page answers

The worker checks four things in order: the recorded answers, then the static host (`/__view/`,
`/workbench/`, `/assets/`), then the page's router (`view/page/router.ts`), then back to the
static host if the router has no answer.

**The host's own server, `/api/` and `/auth/`:** the worker does not answer these (`HOST_PREFIXES`,
`view/page/view-contract.ts`). The browser sends each as it would with no worker, so a host that runs
a server beside the view (an account's sign-in, an API) gets the request as it was made: redirects,
cookies and a streamed answer are untouched. A host with no such server answers them as any missing
file.

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

**The command relay, in the page (`view/page/command-relay.ts`):** `POST /__editor/command` runs a
command in this tab and answers with the session's shapes. The page hands it to the tab's own
command listener as the `editor-command` event the session's relay would send, and answers when the
listener posts `command-result`; `contributed-commands` supplies each contributed verb's budget.
Every verb the tab has runs this way: the kit's, Blender's (`blender-execute` and the rest), the
viewport's. A caller in the page or in a workbench extension uses it as a terminal uses a session.
Three limits:

- **Same origin only.** The route is answered inside the page, for requests the view's own worker
  hands it; no other site can reach it.
- **120 seconds over HTTP.** Every `fetch` of the route, a page script's included, passes through
  the view's worker, which gives the page 120 s to answer. A verb with a longer budget
  (`blender-execute`: 30 minutes) keeps running past that, but its caller gets a 502. The view's own
  agent does not use the route: it calls the relay in the page directly and waits the verb's whole
  budget.
- **Two tabs.** A request from a worker or an extension host carries no tab, so it runs in the
  focused tab of the view, then a visible one. With one view open in two tabs, the Chat of one can
  act on the other. Use one tab.

**The view's agent (`view/page/agent/`):** `/__editor/view-agent/turn`, `events`, `stop`, `account`
and `waitlist`. A tool loop in the page, for the Chat view: it posts each model call to the host's
`/api/ai/responses` (the Responses API, used statelessly; the host holds the key and decides the
model, who may call and what it costs), and runs the model's tool calls here: list, read, search,
write, edit and delete over the project's files, Python in the tab's Blender, and any command of
the editor through the relay above. `account` and `waitlist` pass on the host's `/api/account` and
`/api/waitlist`. A host with neither is a view with no AI, and the Chat says so. The agent reads
text only; it cannot see the screen.

**Reports a session collects, accepted and dropped:** `state`, `heartbeat`, `tab/*`,
`page-error`, `play-phase`, `console-entries`, `console-resolved`, `console/ack`,
`command-received`, `command-listener`,
`log-session`, `log-entries`, `server-log`, `collaboration/presence`. `events` answers 204, so an
EventSource does not reconnect. `tab-heartbeat.js` is a no-op worker. `gameplay-sessions` answers an
empty catalog (`{ sessions: [] }`).

**Blender (`editor-blender/view/blender-view-routes.ts`):** `blender-file` (an in-memory spool),
`blender-project-index`, `blender-project-file`, `blender-output`, `blender-document-chunk` and
`blender-document`. The engine's files (`blender-wasm/*`) are recorded.

**Everything else under `/__editor/`** answers 503 with
`{ error, limitedView: { unavailable, installCommand } }` and the header `x-volter-limited-view`.
These are the routes that need the person's machine or account:

| Refused | Why |
| --- | --- |
| `account/*`, `twin*` | No account is signed in on a static page |
| `harness-chat/*`, `worktrees/*`, `project-work*`, `repository-presence` | The local editor's agents and worktrees; the view's own agent is `view-agent/*` |
| `git/*`, `share-control/*` | No repository and no sharing host |
| `collaboration/*` (its `presence` reports are accepted and dropped) | No session to collaborate in |
| `gameplay-sessions/*` | The recorded play sessions are the builder's, from `logs/`. The catalog itself answers empty. |
| `recording/*` | Recording writes to the session's disk |
| `generations*`, `project-tools/run`, `asset-library/*` | Tools and providers run in Node with credentials |
| `configurations/*/{start,build,stop}` | Running the project's own server or build |
| `open-project`, `create-project`, `inspect-project`, `adapt-project`, `browse-folder`, `reveal`, `recent-projects`, `launcher-settings`, `templates`, `examples`, `save-thumbnail` | A view is one project |
| `download`, `export` | No build to export |
| `/__ui-source/*`, `/__ingest-source/*` (outside `/__editor/`) | Writing edits back into the project's source needs the session's source-authoring routes. The recorded `/__editor/project` says `sourceWrite: false` and `ingestSourceWrite: false`. |

## What a limited view is not

- **Code changes do not recompile.** The modules are the ones compiled at `view build`. A source edit, a person's or the agent's, lives in the page's memory and shows in the workbench, but the running game keeps the compiled module. Data edits behave the same way. Blender edits do take effect: Blender runs in the tab.
- **Edits stay in memory.** A reload starts over from the shipped files. "Download project" is not built yet.
- **No git, no accounts, no sharing.**
- **Webviews do not render.** Code-OSS loads them from `vscode-cdn.net`, which a cross-origin-isolated static page cannot embed. The editor's own panels do not use webviews.

## Building and hosting

1. **The web workbench (once per fork pin and editor revision):**

   ```
   node scripts/workbench/build-release.mjs --target web --product cyclotron \
        --checkout <code-oss fork at FORK.json's pin> --work C:\vwb-web --out C:\vwb-web-out
   ```

   This runs `npm ci` and then `gulp vscode-web-min-ci`: the esbuild bundle of `src/` with no `compile-build-without-mangling`. The workbench lands in `<work>/vscode-web`, with a tarball and `BUILD.json` in `--out`. Keep `--work` on a short path, because the fork's `extensions/copilot` paths exceed Windows' limit until the overlay removes them.

2. **The pieces `view build` reads, built from a checkout:**
   - The product's production build: `npm run build -w @volter/cyclotron`.
   - The kit's session and launcher: `npm run build:server -w @volter/editor-core` and `npm run build:session -w @volter/editor-core`.
   - Blender's serving module: `npm run build -w @volter/editor-blender`.
   - The product's CLI: `npm run build:node -w @volter/cyclotron`.

3. **The view:** `cyclotron view build <project> --out <dir> --workbench <work>/vscode-web`.

Hosting rules:

- **Origin root.** Serve the view from the root of an origin, because the editor's URLs are root-relative.
- **Secure context.** Serve it over https, or from localhost; service workers need a secure context.
- **Cross-origin isolation.** It is required for Blender's threads. `_headers` states it for hosts that read one (Netlify, Cloudflare Pages). On any other host the view's worker adds the headers, after at most one reload.
- **Embedding.** The parent page must send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, and its iframe must allow `cross-origin-isolated`. The view announces that it holds the project whether it is a standalone page or an iframe; extension-host frames do not hold project files. A document the host itself answers under `/api/` or `/auth/` does not pass through the view's worker, so it gets no isolation headers from it: a host that shows such a document inside the embed must send them itself. One opened as its own tab (a sign-in) needs none.
- **Lifetime.** The recorded project identity reports `session.lease: 'page'`. The server-process watchdog stops for this explicit page-owned lifetime; a quiet control socket or delayed request cannot establish that a nonexistent local server died. Ordinary server sessions retain their watchdog.
- **File sizes.** Blender's recorded engine files are stored uncompressed, around 100 MB together. Hosts with a per-file cap (Cloudflare Pages: 25 MiB) cannot serve them; Netlify and most object stores can.
- **Where `--out` can go.** It may not be inside the project, because the view would publish itself on the next build. It may not overlap `--workbench`, because the output is replaced whole before the workbench is copied in. Both checks resolve symlinks first.

## Known limits and risks (unverified: built typecheck-only)

- **The module crawl is best effort.** Anything the editor imports by a URL that is neither crawled nor reducible by the worker's key rule gets the page's raw file or a 404. The worker's key rule drops `t`, `volter-source` and `volter-reload`, and maps `volter-mount`. Watch the network panel on the first walk.
- **The product's chunks shadow `public/assets/`.** The product's production build is served at `/assets/…`, and the static host answers it before the page's router sees the request. So a project file at `public/assets/<same name>` would not be the one served. Real chunk names are content-hashed, so this is latent.
- **The host's routes shadow a project's `api/` and `auth/`.** Nothing of the project is served at `/api/…` or `/auth/…`: those paths go to the host. That covers a file under `public/api/` or `public/auth/`, a file in a root-level `api/` or `auth/` folder (root-relative paths are served from `public/` first, then the file itself), and the compiled module of source kept in such a root-level folder, which is recorded at `/<path>`: importing it fails in the view. `view build` warns, naming the files, and names any compiled module recorded there that the published files do not list (one `.gitignore` leaves out, imported by committed code). A project that keeps its source under `src/` is unaffected.
- **Imported ignored files are still compiled.** A committed module that imports a gitignored one is compiled with it, as the session serves it. Only the ignored file's own source is left out of the published files.
- **One page holds the files.** A request from an announced editor page goes back to that page. Requests from workers and extension-host frames prefer a focused announced editor, then a visible one, then the one that announced last. A restarted worker asks open windows to announce again. Two tabs of one view are two separate projects; worker requests still cannot be attributed to their owning tab when several are open.
- **Synchronous XHR would deadlock.** A synchronous XHR to a forwarded route would block the page that has to answer it. None is known.
- **The WALI Blender skew is partial.** Its substrate modules (`blender-wasm/wali/…`) are named at run time and are not recorded. The default Emscripten skew is complete.
