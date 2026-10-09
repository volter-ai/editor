# Cyclotron launch checklist (updated 2026-10-08, 22:40 UTC)

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
- [x] Editor 0.5.204 on npm (all 19 at `latest`; cut 5cc93da2, promoted b915c4d2, run 37843833336). Read after publishing: upgrade of a 0.5.202 project, Play, Chat first message in a new conversation, game editor create on Windows (runtime image installed). Version commit merged back (#320)

## Sites (consolidated 2026-10-08: the sites README is the per-site record; 66 branches to 5, 9 checkouts to 1)
- [ ] volter.ai remake merged (#65, eaaaff59), link to cyclotron.videogame.ai; deploy through the World on the Mac (manager, owner's choice)
- [ ] www.videogame.ai: final = main's `videogame-ai/` (never published); owner reviews its copy, then it replaces the old landing build
- [ ] Browser trial rebuild on 0.5.204 with #48 (pins to the release)

## Held for after the release (owner: "that should be after cyclotron releases")
- [ ] volter.ai remake (sites #65): company page, brands one line each, fellowship, packages as links; headline "Software that builds itself."; Stoneguard capture left off. Reviewed (PASS); the videogame.ai link waits on www.videogame.ai naming Cyclotron

## Unfinished work, and where it lives (update when you start, park or finish anything)

Nothing here lives only on one machine. Parking work means: push it to a branch, open a draft PR that says what is left, and add a line below.

| Work | Where | State | Next |
|---|---|---|---|
| 0.5.205 workbench: the opening's card pull (#323) and Chat 0.1.55 with supercode #1360 (#332) | code-oss runs 37870744040 (win32) and 37870747078 (linux), editor 9a813b17 | cutting on runners; darwin needs the Mac (asked on t_b36c660b); 0.1.55 already read PASS on the 0d68186f win32 cut | Chat reading and splash look on the win32 cut, the darwin cut, then the pin in `packages/cyclotron/package.json` |
| Browser trial on the renamed packages | sites release `model-editor-browser-trial-20261008-3` (#48 merged) | built; read locally: it opens and Play runs | deploy through the World on the Mac |
| www.videogame.ai replacement | sites `videogame-ai/` | never published | owner looks at the copy, then the World |
| "Ask for approval" (t_8ea14bad) | supercode #1363 merged; client 0.3.69, SDK 0.3.87 and `@volter/supercode` 0.5.298 published (its win32 binary advertises `permission_modes`) | the editor half is being written: pin those three, pass `permissionMode` on Claude Code's start and resume | the card's Windows reading: Ask waits, Deny stops, Allow runs, Auto runs, on the default model and with a model or effort chosen |
| Cyclotron Bridge reopen on the Mac (t_c92f341b) | browser-substrate main (tabnode 0.9.0, 58a06eea) | the pin half is on main; my 0.8.0 pin branch was superseded and deleted | the reopen read on the Mac |

## The launch, in three stages (decided 2026-10-08, 22:40 UTC)

### Stage 1 — everything in place
- [x] **volter.ai** remake live (main's `volter/` as of #66, as the sites README records)
- [ ] **www.videogame.ai** replacement (main's `videogame-ai/`) live after the owner's look at its copy
- [ ] **cyclotron.videogame.ai**: install line for the current release, Windows stated, Discord link
- [ ] **Browser trial** rebuilt on the current release (#48 re-pinned; release `model-editor-browser-trial-20261008-3` built), deployed, fresh and returning browsers checked
- [ ] **Measurement** (decision 0047's second item): `ref` links for posts, analytics collector, sign-in and waitlist counters
- [ ] **Discord** (t_be8c9eea): owner creates the server, guided; invite on the three pages, the editor's Help menu and the README
- [ ] **0.5.205** with the walk blockers fixed: Chat restart/reveal (supercode #1360 in Chat 0.1.55, #332, read PASS on Windows), the tripwire reply (t_1f2b8dca, #321 merged after live readings), the opening's card pull (#323), plus #312-#319, #316 (animations), #292 (tabs); the workbench cut and pin, and "Ask for approval" (supercode #1363, in `@volter/supercode` 0.5.298, + the editor half)

### Stage 2 — blind walks (a fresh agent, a one-page runsheet, the published build, PASS/FAIL per step)
Decision 0047's goals: try the race before signing in; change a model, driving and HUD with the agent, then a second task by New Chat; return to saved work with the conversation intact, including a pending approval; model/save/undo-redo without an account.

| # | Entry | Machine | Starting state | Goals |
|---|---|---|---|---|
| 1 | Cyclotron page → install | Windows (volter-desktop) | Node, Claude signed in | all four |
| 2 | same | Mac | same | all four |
| 3 | same | Windows, Node removed from PATH | no Node | install up to the first model |
| 4 | same | Windows, empty agent profile | no agent signed in (walked to the sign-in screen; no sign-in started) | 1 and 4 |
| 5 | browser trial | Chrome, Safari, Firefox | fresh, then returning | 1, sign-in, first AI call |
| 6 | volter.ai → videogame.ai → Cyclotron page | any | fresh | find it and start it |
| 7 | a project from 0.5.202 / 0.5.203 | Windows and Mac | returning user | upgrade, then goal 3 |
| 8 | Discord invite | any | stuck partway | the help path |

A FAIL is fixed, the next release published, and the walk run again.

### Stage 3 — the launch
- [ ] Posts lead with the browser trial only once a stranger can do it from the launch page (decision 0048); a platform is claimed only where its walk passed
- [ ] Home page copy final; security policy enforced; trial robots
- [ ] First real AI call on the trial by a person; if any part fails, the key comes off
- [ ] Discord staffed for launch day; the timing is the owner's

## Found in the 0.5.204 run, owned elsewhere (filed)
- [ ] "Ask for approval" stops nothing: Claude Code runs in its own `auto` mode (t_534d9249, supercode)
- [ ] Chat after an editor restart opens the stock agent view with the last prompt in the box (t_d33aaa14, supercode)
- [ ] A queued `chat send` prompt and its answer don't show in the Chat until reopen (t_9add690d)
- [ ] Game editor has no win32 workbench, so a game can't open on Windows (t_d68566c5)

## Waiting on the owner or others
- [ ] Discord (t_be8c9eea): owner creates the server, guided page by page; then the invite goes on the sites, Help menu and README
- [ ] Vercel projects deleted (MacBook, manager's go); fellowship notifications (t_d9df8189)
- [ ] MacBook list: Search Console, the Cyclotron page's analytics token, logo artwork ("VIDEOGAME.ai"), sign-in end to end, intake form route, how games ship, signed desktop apps, Safari, the Dune image
