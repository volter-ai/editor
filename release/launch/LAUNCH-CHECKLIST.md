# Cyclotron launch checklist (updated 2026-10-09, 08:40 UTC)

## The launch, end to end (2026-10-09, 08:40 UTC)

What the launch must prove, by decision 0047 and 0048. The published build completes the four first-user goals
with no FAIL: the race before signing in; a model, driving and HUD changed with the agent, then a second task by
New Chat; return to saved work with the conversation intact, including during a pending approval; and model,
save, undo and redo without an account. The posts lead with the browser trial once a stranger can start it from
the page. They claim a platform only where its fresh install passed, and they are measured (`ref` links, the
page counted, sign-ins and waitlist collected).

**The critical path, in order:**

| # | Step | Who | State |
|---|---|---|---|
| 1 | **0.5.207** (on npm 08:12 UTC from dab9cff4, run 37900486920; merged back by #360) | volter-10 | end-of-coding PASS on Windows: packed install, Play/keys/autoplay, Chat new/follow-up/reopen, refusals, upgrades from 0.5.206 and 0.5.202, and the claims (no tab row with one document, the status bar's Playing, Show in File Explorer, reopen after a tab closed without a goodbye); after publishing, a 0.5.206 project upgraded from npm played and ran a new Chat conversation; next: the walks on 0.5.207 |
| 2 | **darwin workbench**, then its pin | the Mac, on the owner's word | blocked on that word (t_a2bd2a5f); the revision to cut is editor 5b6840f8 (#350's merge; the card's body still names 9a813b17) |
| 3 | **Browser trial on the current release** | the Mac's sites World | release `model-editor-browser-trial-20261008-3` built and read locally; deploy waits on the World |
| 4 | **Blind walks** on the published build (stage 2) | volter-10 on Windows (walks 1, 3, 4, 5 in Chrome/Edge/Firefox, 6, 7); the Mac (2, 5 in Safari, 7); walk 8 after Discord | walk 1 (Windows, 0.5.206, 2026-10-09): steps 1-5 PASS (74 s to first model), step 7 FAIL (a tab closed without a goodbye: `edit` waited 101 s), fixed in 0.5.207 (#356); walks 3 and 4 running on 0.5.207; Chat-frontend findings (picker defaults to Codex, approval card names no file, Auto approve by default, typing lag) are supercode's (D228), sent to the manager |
| 5 | **Measurement** | frontline (t_04b1fcba, blocked 154 h) and the owner | sign-ins export live (`id.volter.ai/export/signins` answers 401); the page's analytics beacon names the old `volter-ai.github.io` site, so its token needs the owner's Cloudflare dashboard; the waitlist Worker was never deployed (`waitlist.volter.ai` does not resolve) and the page's waitlist is a `mailto:` for now; `ref` links are the posts' |
| 6 | **Pages**: www.videogame.ai replacement; the Discord link on the Cyclotron page | the owner's look at the copy (D352), then the World | the Cyclotron page's install line and scripts take `@latest` and state Windows |
| 7 | **Discord** | the owner, with the Mac's sessions (t_be8c9eea) | the owner's order: lucarne's input automation first (lucarne #104, draft), then Discord; the server's design is m-89b54b0e; nothing is registered with Discord without his word |
| 8 | **Stage 3**: the trial's security policy enforced and robots; the first real AI call on the trial by a person; the posts (claims only where walks passed); the timing | sites; a person; the media lane; the owner | after 1 to 7 |

**Only the owner can:** give the Mac its word for the 0.5.206 Mac workbench cut; look at the www.videogame.ai
copy; create the Discord server; set the Cyclotron page's analytics token in Cloudflare; make (or watch) the first
real AI call on the trial; approve the posts' copy; and choose the time.

## Live now
- [x] Editor 0.5.200, 0.5.201, 0.5.202 on npm: rendering fixes, browser-AI editor half, Blender retry, content-named recordings (returning-visitor fix)
- [x] Trial cyclotron-web.videogame.ai on 0.5.202 (Worker a359c8a1): opens for fresh and returning browsers, report-only security policy
- [x] Sign in with Volter live on the trial; Volter ID redeployed (f40a3bf0) with the cyclotron-web client
- [x] Trial AI switched on: gpt-6.1-sol, $5/day per account, $100/day global, four prices incl. cache writes, key from custody, kill switch documented
- [x] Home page cyclotron.videogame.ai: reworked page; SEO/AEO (canonical, JSON-LD, sitemap, robots, llms.txt); name styled videogame.ai
- [x] Hosted web-workbench cut workflow (code-oss), with checks
- [x] Licences: play-script API Apache-2.0, Blender-derived pose code GPL, COMMERCIAL.md
- [x] Off Vercel: www.videogame.ai, videogame.ai, volter.ai (15:13Z), amp.videogame.ai (15:46Z), ztrack.dev (15:55Z), all on Cloudflare Workers
- [x] Structured data: videogame.ai as Volter's games brand (the Xbox/Microsoft shape) on www.videogame.ai, the Cyclotron page and volter.ai
- [x] Old deploy paths removed (landing's Terraform/AWS, sites' record-deleting runbook)
- [x] volter.ai fellowship rebuilt on our own form and database (D1, 12-month deletion cron, notices); privacy and terms live
- [x] volter.ai terms corrected (17:55Z, sites #66): "The packages we publish…", not "open-source tools" (six of seven repositories are private, decision 0044)
- [x] tabnode 0.8.0 on npm (17:54Z): one process table, three review rounds
- [x] npm names held: volter-game-editor and eight twin/world names, live 18:17-18:22Z
- [x] Editor 0.5.203 on npm (18:51Z): renamed packages, `editor/` layout
- [x] Chat frontend 0.1.54 on npm `latest` (20:41Z, supercode #1352): first-message fix, read on Windows by me

## Merged today (editor)
- [x] #284 runtime packages renamed (@volter/sdk, /project, /play, /live)
- [x] #286 project layout `editor/` vs `src/`; #287 company named videogame.ai; #283 Game/Animation switch; #275 compressed .blend saves
- [x] #296 main's CLI starts again (#286 had made `npx cyclotron --help` die on its first line); #300 the CLI declares typescript
- [x] #301 the upgrade hint and the arena example, same fix
- [x] #299 the starter's 113 `npx volter-game-editor` lines can never fetch a stranger's package (`--no-install`)
- [x] #302-#306 Windows junction, starter manifest, workbench pin-back (Chat works again), RELEASING.md, refusal wording
- [x] #308 upgrade takes old projects the whole way (names, `editor/`, docs, tsconfigs); #310 game editor create + upgrade on Windows
- [x] #311-#314 `chat send` queues into a running turn (owner ask); #315 0.5.203 versions reconciled into main
- [x] #317 Windows license notices, game upgrade link rules, release steps; #318 npm shell lines; #319 upgrade refreshes check-idioms.ts

## Released
- [x] Editor 0.5.207 on npm (`latest`; cut and promoted dab9cff4, run 37900486920, on npm 08:12 UTC): no tab row with one document on the 5b6840f8 workbench for win32 and linux (#350, #353), a yielded tab's shutdown errors retired from the console (#351), the install line reopens after a tab closed without a goodbye (#356), the status bar follows Cyclotron's Play (#357), reveal names the platform's file manager and resolves asset paths (#354, #355), Play input under pointer lock (#358). End-of-coding on Windows all PASS; after publishing, a 0.5.206 project upgraded from npm played and ran a new Chat conversation. Version commit merged back (#360)
- [x] Editor 0.5.206 on npm (`latest` until 0.5.207; cut and promoted 5b4bdad5, run 37890009746, on npm 06:07 UTC): the card pull and Chat 0.1.55 on the d0e6c475 workbench for win32 and linux (#341, #342, #328), Ask for approval (#334), Safari (#346), the agent-guidance refresh ignoring line endings (#349). End-of-coding on Windows: packed install, Play/controls/autoplay, Chat new/follow-up/reopen, refusals, upgrades from 0.5.202 and 0.5.205; after publishing, a 0.5.205 project upgraded from the registry opened, played and ran a new Chat conversation. Version commit merged back (#352)
- [x] Editor 0.5.205 on npm (`latest` until 0.5.206; cut 467ffdac, run 37875783809, on npm 03:05 UTC): document tabs (#292) on the ec1e0e84 workbench for all three platforms (Chat 0.1.51), tripwires only while a tool call is out (#321), `chat send` (#312-#314), Play loading, guards and clip reads (#316, #338, #331), the UI board (#329, #330), run configurations (#318), game upgrades (#317, #319), the workbench's own extensions folder (#336), refreshed agent guidance (#337), `document.run` without a context and no flat-surface warning on page captures (#339). Version commit merged back (#345)
- [x] Editor 0.5.204 on npm (all 19 at `latest`; cut 5cc93da2, promoted b915c4d2, run 37843833336). Read after publishing: upgrade of a 0.5.202 project, Play, Chat first message in a new conversation, game editor create on Windows (runtime image installed). Version commit merged back (#320)

## Sites (consolidated 2026-10-08: the sites README is the per-site record; 66 branches to 5, 9 checkouts to 1)
- [x] volter.ai remake merged (#65, eaaaff59), link to cyclotron.videogame.ai; live
- [ ] www.videogame.ai: final = main's `videogame-ai/` (never published); owner reviews its copy, then it replaces the old landing build
- [x] Browser trial rebuilt with #48: release `model-editor-browser-trial-20261008-3` (deploy: critical path 3)

## Unfinished work, and where it lives (update when you start, park or finish anything)

Nothing here lives only on one machine. Parking work means: push it to a branch, open a draft PR that says what is left, and add a line below.

| Work | Where | State | Next |
|---|---|---|---|
| darwin workbench for the card pull, Chat 0.1.55 and no tab row for one tab | card t_a2bd2a5f (the Mac), editor 5b6840f8 | blocked: the Mac cuts and publishes only on the owner's own word for this cut | the owner's word to the Mac; then the darwin pin in `packages/cyclotron/package.json` (0.5.207 pins win32 and linux at 5b6840f8, darwin keeps ec1e0e845c3a) |
| Browser trial on the renamed packages | sites release `model-editor-browser-trial-20261008-3` (#48 merged) | built; read locally: it opens and Play runs | deploy through the World on the Mac |
| www.videogame.ai replacement | sites `videogame-ai/` | never published | owner looks at the copy, then the World |
| Cyclotron Bridge reopen on the Mac (t_c92f341b) | browser-substrate main (tabnode 0.9.0, 58a06eea) | the pin half is on main; my 0.8.0 pin branch was superseded and deleted | the reopen read on the Mac |

## The launch, in three stages (decided 2026-10-08, 22:40 UTC)

### Stage 1 — everything in place
- [x] **volter.ai** remake live (main's `volter/` as of #66, as the sites README records)
- [ ] **www.videogame.ai** replacement (main's `videogame-ai/`) live after the owner's look at its copy
- [ ] **cyclotron.videogame.ai**: install line for the current release, Windows stated, Discord link
- [ ] **Browser trial** rebuilt on the current release (#48 re-pinned; release `model-editor-browser-trial-20261008-3` built), deployed, fresh and returning browsers checked
- [ ] **Measurement** (decision 0047's second item): `ref` links for posts, analytics collector, sign-in and waitlist counters
- [ ] **Discord** (t_be8c9eea): owner creates the server, guided; invite on the three pages, the editor's Help menu and the README
- [x] **0.5.206** (released 2026-10-09, on npm 06:07 UTC) with the remaining walk blockers fixed: Chat restart/reveal (supercode #1360 in Chat 0.1.55, #332, read PASS on Windows) and the opening's card pull (#323, #341), in the d0e6c475 workbench pin for win32 and linux (#342), which also keeps tabs through a move into an area (#328); "Ask for approval" (#334, merged: Claude Code's own `--permission-mode default`, read live); Safari (#346). The tripwire reply (t_1f2b8dca, #321), #312-#319, #316 (animations) and #292 (tabs) shipped in 0.5.205.

### Stage 2 — blind walks (a fresh agent, a one-page runsheet, the published build, PASS/FAIL per step)
Decision 0047's goals: try the race before signing in; change a model, driving and HUD with the agent, then a second task by New Chat; return to saved work with the conversation intact, including a pending approval; model/save/undo-redo without an account.

| # | Entry | Machine | Starting state | Goals |
|---|---|---|---|---|
| 1 | Cyclotron page → install | Windows (volter-desktop) | Node, Claude signed in | all four |
| 2 | same | Mac | same | all four |
| 3 | same | Windows, Node removed from PATH | no Node | install up to the first model |
| 4 | same | Windows, empty agent profile | no agent signed in (walked to the sign-in screen; no sign-in started) | 1 and 4 |
| 5 | browser trial | Chrome, Edge, Firefox; Safari on a Mac | fresh, then returning | 1 and 4, and what the page says about its AI (the Volter sign-in and the first AI call are stage 3's, by a person) |
| 6 | www.videogame.ai, and www.volter.ai → Cyclotron page, as seven personas (RUNSHEET-discovery.md) | any, and a phone | fresh | find it and start it |
| 7 | a project from 0.5.202, 0.5.203, 0.5.204 and 0.5.205 | Windows and Mac | returning user | upgrade, then goal 3 |
| 8 | Discord invite | any | stuck partway | the help path |

A FAIL is fixed, the next release published, and the walk run again. Each walk's one page is in `release/launch/walks/`.

### Stage 3 — the launch
- [ ] Posts lead with the browser trial only once a stranger can do it from the launch page (decision 0048); a platform is claimed only where its walk passed
- [ ] Home page copy final; security policy enforced; trial robots
- [ ] First real AI call on the trial by a person; if any part fails, the key comes off
- [ ] Discord staffed for launch day; the timing is the owner's

## Found in the 0.5.204 run, owned elsewhere (filed)
- [x] "Ask for approval" stops nothing: Claude Code ran in its own `auto` mode (t_534d9249); fixed in the editor by #334
- [ ] Chat after an editor restart opens the stock agent view with the last prompt in the box (t_d33aaa14, supercode)
- [ ] A queued `chat send` prompt and its answer don't show in the Chat until reopen (t_9add690d)
- [ ] Game editor has no win32 workbench, so a game can't open on Windows (t_d68566c5)

## Waiting on the owner or others
- [ ] Discord (t_be8c9eea): owner creates the server, guided page by page; then the invite goes on the sites, Help menu and README
- [ ] Vercel projects deleted (MacBook, manager's go); fellowship notifications (t_d9df8189)
- [ ] MacBook list: Search Console, the Cyclotron page's analytics token, logo artwork ("VIDEOGAME.ai"), sign-in end to end, intake form route, how games ship, signed desktop apps, Safari, the Dune image
