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
| Chat | supercode chat + harness runtime | `volter-view-chat`: answers with the product's install command and a copy button |

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
| `harness-chat/*`, `worktrees/*`, `project-work*`, `repository-presence` | Agents run in the local editor's runtime; the Chat view says so in place |
| `git/*`, `share-control/*` | No repository and no sharing host |
| `collaboration/*` (its `presence` reports are accepted and dropped) | No session to collaborate in |
| `gameplay-sessions/*` | The recorded play sessions are the builder's, from `logs/`. The catalog itself answers empty. |
| `recording/*` | Recording writes to the session's disk |
| `generations*`, `project-tools/run`, `asset-library/*` | Tools and providers run in Node with credentials |
| `configurations/*/{start,build,stop}` | Running the project's own server or build |
| `open-project`, `create-project`, `inspect-project`, `adapt-project`, `browse-folder`, `reveal`, `recent-projects`, `launcher-settings`, `templates`, `examples`, `save-thumbnail` | A view is one project |
| `download`, `export` | No build to export |
| `command` | Terminal control of a session |
| `/__ui-source/*`, `/__ingest-source/*` (outside `/__editor/`) | Writing edits back into the project's source needs the session's source-authoring routes. The recorded `/__editor/project` says `sourceWrite: false` and `ingestSourceWrite: false`. |

## What a limited view is not

- **Code changes do not recompile.** The modules are the ones compiled at `view build`. A source edit lives in the page's memory and shows in the workbench, but the running game keeps the compiled module. Data edits behave the same way.
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
- **File sizes.** Blender's recorded engine files are stored uncompressed, around 100 MB together. Hosts with a per-file cap (Cloudflare Pages: 25 MiB) cannot serve them; Netlify and most object stores can.
- **Where `--out` can go.** It may not be inside the project, because the view would publish itself on the next build. It may not overlap `--workbench`, because the output is replaced whole before the workbench is copied in. Both checks resolve symlinks first.

## Known limits and risks (unverified: built typecheck-only)

- **The module crawl is best effort.** Anything the editor imports by a URL that is neither crawled nor reducible by the worker's key rule gets the page's raw file or a 404. The worker's key rule drops `t`, `volter-source` and `volter-reload`, and maps `volter-mount`. Watch the network panel on the first walk.
- **The product's chunks shadow `public/assets/`.** The product's production build is served at `/assets/…`, and the static host answers it before the page's router sees the request. So a project file at `public/assets/<same name>` would not be the one served. Real chunk names are content-hashed, so this is latent.
- **Imported ignored files are still compiled.** A committed module that imports a gitignored one is compiled with it, as the session serves it. Only the ignored file's own source is left out of the published files.
- **One page holds the files.** Requests from workers go to the page that registered last. Two tabs of one view are two separate projects.
- **Synchronous XHR would deadlock.** A synchronous XHR to a forwarded route would block the page that has to answer it. None is known.
- **The WALI Blender skew is partial.** Its substrate modules (`blender-wasm/wali/…`) are named at run time and are not recorded. The default Emscripten skew is complete.
