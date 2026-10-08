# Volter account and AI in the browser trial (scoping, 2026-10-08)

Read-only scoping of the editor (origin/main afba5651) and the local volter-engine / sites clones. No network calls.

## What exists
- **Local editor: a complete client for a Volter account.** Covers sign-in (PKCE in the system browser, device code,
  refresh), plan, credits, spend controls, usage, checkout and billing portal, and paid OpenRouter coding.
  It lives in `editor-core/server/account-service.ts`, `routes/account.ts`, `editor-sdk/src/account.ts`, and the
  Account document UI. Default service URL `https://auth.videogame.ai`; client id `volter-editor`.
- **The services it talks to were archived on 2026-09-20** (volter-engine tag `archive/launch-scope-2026-09-20`):
  - `vgai-auth` at auth.videogame.ai (Clerk front, OAuth, `/v1/account`, `/inference/grant`);
  - `managed-account-service` (Clerk + Polar, a Durable Object ledger for all usage kinds: one ledger across products,
    which matches the owner's "spend the tokens on any of our products");
  - `generative-gateway` at generate.videogame.ai (OpenRouter, fal, tripo, worldlabs).
  Whether anything still runs at those hosts is unknown. *Inferred:* if the archived auth build runs, local sign-in now
  fails, because it accepts client id `vgai-editor` and the editor sends `volter-editor` since 2026-09-27.
- **Only a mock and loopback twins remain in source.** Managed (Volter-paid) routes are off in shipped builds
  (`VOLTER_GENERATION_GATEWAY` is never set). The archived design gates every paid or managed use behind a hand-set
  Clerk flag ("payment is not admission").
- **OpenRouter:** API key only (pasted, stored in the OS credential store). No "Sign in with OpenRouter" (OAuth/PKCE).
  Note the owner's 2026-09-21 ruling against OpenRouter for agents, superseded by today's "openrouter signin is also
  possible".
- **No waitlist anywhere.**

## The browser trial today
- **No account and no AI.** Account and chat routes are refused (503) by design, and Chat is a canned extension that
  prints the install command. No agent processes can run in a tab.
- **A natural home for the key:** the trial is already served by the Cloudflare Worker `cyclotron-trial`. A Worker
  secret plus new same-origin `/api/*` routes there keeps the key off the page.
- **Two blockers to fix first:**
  - the view's service worker would break same-origin POSTs (*from reading the code, not run*): add an `/api/` and
    `/auth/` pass-through;
  - the auth worker's callback allow-list excludes the trial origin.
- **Edits don't recompile in the trial**, so AI there is mainly a chat assistant unless it also drives Blender.

## Minimal plan for (1) free allowance, (2) OpenRouter, (3) $19.99 waitlist
1. **Owner:** what runs at auth.videogame.ai; keep Clerk (and Polar)? Cloudflare access. *(small, blocking)*
2. Service-worker pass-through for `/api/` and `/auth/`. *(editor, small)*
3. **Sign in with Volter** for the trial. *(medium)* Either restore vgai-auth from the tag (allow-list the trial
   callback, fix the client id) with PKCE start/callback/poll in the trial Worker and an HttpOnly cookie, or use Clerk
   JS directly with token checks in the Worker.
4. **Metering** in the trial Worker. *(medium)* A Durable Object ledger (reserve/settle/release, as the mock does)
   with a per-account allowance plus a global daily ceiling.
5. **`/api/chat`.** *(small-medium)* Streams from OpenAI's Responses API with the key as a Worker secret, the model
   pinned on the server, capped output, and usage recorded.
6. **Rewrite `volter-view-chat`.** *(medium)* Signed out: Sign in with Volter (and OpenRouter). Signed in: streamed
   chat and remaining allowance. Rebuild the web workbench, then redeploy the trial.
7. **"Volter plan $19.99/mo" button.** *(small)* `/api/waitlist`, storing the account and email in D1/KV, or the
   intake form.
8. **Optional: OpenRouter PKCE sign-in in the browser** for the person's own credits. *(small-medium; verify that
   OpenRouter allows browser calls)*
9. **Later:** restore the shared ledger so the local editor's Account document (already built) works across
   products. *(large)*

## Owner decisions
- Is auth.videogame.ai live and which build runs there? Keep Clerk / Polar?
- The free allowance's size and period (lifetime, month or day); the global daily ceiling; abuse checks.
- Does the free allowance bypass the hand-set admission flag?
- GPT Sol 6.1's exact model id; direct OpenAI or through OpenRouter; data retention and terms.
- Trial AI: chat only, or also edit and drive Blender in the tab?
- One ledger and payment rail for all products: the archived Polar ledger, or the RH2 grants ledger then Stripe
  (company decision 0006)?
- What the $19.99 plan includes, and how it maps to free/creator/max/ultra (the mock's Creator is $20 for 2,000
  credits).
- Does a Worker-held key fit company decision 0015 ("the key is brokered, never built")?
