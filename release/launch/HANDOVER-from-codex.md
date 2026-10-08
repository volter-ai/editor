# Handover from the first builder (codex-01a119ec, stopped CLEAN at ~05:20Z)

Read-only scoping only; no implementation, tests, builds, sign-in, credential or vault reads, key minting, Worker changes,
commits, pushes, PRs or clones. Source snapshots it saved here (bounded GitHub API reads, not checkouts):
`sites-tree.json`, `scope-source/sites/...` (AGENTS.md, trial README/worker.js/wrangler.jsonc, src/index.html),
`scope-source/identity/...` (worker/src/auth.ts, index.ts, packages/identity/src/index.ts),
`scope-source/editor/packages/editor-core/view/page/{boot.ts,service-worker.ts}`.
Heads it saw: sites main 0c508875, editor main 6f3af0ef, identity main dc4ee6ab. Identity PR #11 is OPEN (head 09f8e2ea):
do not build on that arc. Local identity checkout: /Users/yueranyuan/volter/identity (HEAD 68293c2c); older editor copies
under /Volumes/PeakSSD/volter-work/editor and /Volumes/PeakSSD/sites-browser-trial-20261007/editor (may lag main).

## Preliminary notes (not a finished plan)
1. **Auth:** use the live **id.volter.ai** OIDC code flow with S256 PKCE for a dedicated trial client or resource; verify
   issuer and audience with @volter/identity; key usage by the permanent Volter subject. Identity's client registration
   (`POST /admin/clients`) needs an already signed-in admin and its admin token, so registering the trial client is an
   **operator dependency** (owner/admin), not something the builder signs in to do.
2. **COOP same-origin embedding:** prefer an independent top-level auth tab plus a status poll from the trial; don't rely
   on window.opener/postMessage surviving identity navigation. The homepage iframe has
   `allow="fullscreen; cross-origin-isolated; clipboard-write"` and no `credentialless` attribute. The cookie/session
   design is still open.
3. **Agent:** the page or a web extension runs the Responses tool loop, with inference from the same-origin trial Worker
   (model pinned on the server, metered). Project tools act on the single SeededProjectStore. Blender commands already run
   in the tab via `workspace.command -> handleBlenderCommand`, so adapt that dispatch; don't run a CLI agent in the tab.
   The existing view routes stage project files, persist Blender outputs and chunk-save .blend into the store. The bridge
   from a web extension to that command registry still needs scoping.
4. **Biggest piece: rebuilding editable source.** The service worker serves recorded compiled modules before the mutable
   store and refuses unseen TS/TSX/JSX imports. A browser compiler must intercept project imports ahead of recorded
   entries, watch store changes, keep the integration transforms, virtual modules and dependency resolution, publish a
   coherent graph, and remount gameplay and UI while keeping edits. esbuild-wasm is a candidate only; parity with the
   Vite/OID/game integration paths is not established. A transpile-only patch won't solve it.
5. **First small PR candidate:** an exact `/api/` and `/auth/` pass-through in the service worker, ahead of navigation
   rewriting and page forwarding, preserving methods, cookies, streaming and auth redirects. Then: auth/session (M),
   browser compile/refresh (L, highest uncertainty), tools/agent loop (L), ledger/gateway (M), allowance/waitlist UI
   (S-M), optional OpenRouter after the core. Workbench builds via existing CI only.
6. **Money draft:** $5 per account per day; proposed $100 global per day; UTC midnight reset; integer USD microdollars
   with server-owned pricing. One serialized Durable Object admission ledger atomically reserves the account AND global
   worst-case request cost before any provider call, then settles verified usage. Unknown provider outcomes keep the
   reservation (no refund on disconnect). The complete bounds, failure and kill-switch design and the exact model id are
   needed before any key is set. No money proposal has been sent or approved.
7. **Keys:** `command -v bao` found no binary. The vault door was not configured or opened. Whether Volter's OpenAI key
   exists is unknown. The custody file was not opened.
