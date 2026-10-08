# Brief: AI in Cyclotron's browser trial, through Volter ID (board task t_0cc77c45)

You are the one builder for this track. You report to volter-10 (sc:volter-desktop:claude-code:57f627d2-73b5-414e-a6c0-8bbbf6fc4cbe)
with `supercode message send <address>` and talk to no other session. Your work runs in this folder,
/Volumes/PeakSSD/cyclotron-browser-ai: clone what you need here (fresh clones are your own working trees; never write in
another session's checkout).

## The owner's words (verbatim)
- "instead of doing it here, you should just pilot the entire track on macbook. And regarding the allowance, give them 5 dollars worth per day. In the browser, let them do whatever they need. We already have volter id as an auth service (using better auth by us)"
- Earlier: "we can offer a little usage (gpt sol 6.1 from our openai api key) with a per account cap but the primary thing we want them to do is to download for their own use ... If they do want to sign up online, we can offer them a 19.99 subscription and if they click that, we add them to the waitlist ... I think we can call it the volter account because they can signin with volter and it allows them to spend the tokens on any of our products." and "if they what to use it online, we can offer ours or openrouter (openrouter signin is also possible)".

## Goal
On https://cyclotron-web.videogame.ai (the browser trial of Cyclotron, `@volter/cyclotron`, served by the Cloudflare Worker
`cyclotron-trial` from volter-ai/sites `model-editor/trial/`), a person can:
1. **Sign in with Volter ID.** Volter ID is volter-ai/identity (Better Auth, ours). PR #11 there (phone-width sign-in
   layout, head 09f8e2ea, from another arc) is open and in that arc's review: build beside it, not on it.
2. **Get $5 worth of AI usage per day per account** on Volter's OpenAI key (GPT Sol 6.1), metered per account, with a
   global daily ceiling you propose.
3. **Have the agent do whatever they need in the browser**: not only chat. Edit the project's files, drive Blender in the
   tab, change gameplay and UI. Today the trial (a "limited view", `cyclotron view build`) has NO agent and does NOT
   recompile source edits: edits stay in memory and gameplay/UI code is not rebuilt. Making edits take effect in the tab is
   part of this goal.
4. Optional: **Sign in with OpenRouter** to use their own credits.
5. A **"Volter plan, $19.99/month"** button that adds them to a waitlist.

## Read first
- **HANDOVER.md**: notes from the first builder (Codex, stopped clean before building). It already found Volter ID's live
  issuer (id.volter.ai), the in-tab Blender command path, the service-worker blocker for recompiling, a money draft, and
  two known blockers: registering a Volter ID client needs a signed-in admin (an operator step for the owner, not you), and
  there is no `bao` binary for the vault door (if the door needs it, tell me and stop the key part).
- **SCOPING.md**: a read-only survey of the editor and the archived account services.

## What exists (from SCOPING.md)
- The local editor has a full Volter-account client (sign-in, credits, spend policy, usage, checkout) aimed at
  auth.videogame.ai, whose services were archived 2026-09-20. Volter ID (identity repo) is the live auth now; check how
  the client and Volter ID line up rather than restoring the archive.
- In the trial, account and chat routes are refused by design (editor-core/view/page/router.ts), Chat is a canned extension
  (`view/workbench/extensions/volter-view-chat`), and the view's service worker would break same-origin POSTs: a
  pass-through for `/api/` and `/auth/` is needed. The trial Worker is the place for the key (a Worker secret) and the
  metering (e.g. a Durable Object ledger).

## Order
1. **Scope first and send me a plan before building big pieces:** the architecture (where the agent loop runs, how tools
   act on the in-tab project and Blender, how edits recompile in the tab, how Volter ID sign-in works from a page embedded
   in cyclotron.videogame.ai with COOP same-origin), the pieces in order with sizes, and what you need from me.
2. **Money bounds, sent to me BEFORE any key is set on any Worker:** the global ceiling's number and what enforces it; the
   per-account meter's unit and reset; what a person sees when they hit either; and the one command that turns the paid
   path off.
3. Then build, in small PRs. Send me each PR's URL and full head SHA; it is reviewed (volter-a3, through the manager)
   and merged only at the reviewed head. Deploys after merge.

## Keys
- Volter's OpenAI key is NOT in /Volumes/PeakSSD/peak-floor/state/prod-ops/credentials.env (it holds only CLOUDFLARE_*
  names). Vendor keys have been read through the vault door by reference before: `supercode credentials configure
  vault-team`, kv path `teams/volter/vendors/<vendor>`, `supercode credentials run --profile vault-team -- <cmd>`. Homebrew's
  OpenBao was uninstalled at 04:12Z; if the door needs the bao binary, tell me and stop.
- If no key is found: say so and stop that part. No key is minted. Nothing signs in to the OpenAI platform, ChatGPT, Claude
  or Codex without the owner's explicit yes for that attempt.
- Any secret is read only by the command that uses it: never printed, echoed, logged, copied off this machine or written
  into a repository or shell history. Cloudflare tokens are in the custody file above (CLOUDFLARE_ACCOUNT_ID and
  CLOUDFLARE_API_TOKEN_* names; the sites Workers are on the account in CLOUDFLARE_ACCOUNT_ID).

## Rules
- No tests, and nothing that runs over ten seconds; an unknown Rust compile goes through the repository's native-build
  workflow. Long builds (e.g. the Code-OSS web workbench) go through the repositories' CI workflows.
- Never start or retry any ChatGPT, Claude, Codex or OpenAI sign-in, `harness login`, `codex login` or Chat sign-in button.
- Kill processes by PID only, and only ones you started.
- Work on branches, open PRs; never push to main; never force-push others' branches.
- Report blockers to me as soon as you hit them; don't wait to batch them.
