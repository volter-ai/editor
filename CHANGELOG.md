# Release notes

What a release changes that a person, or a tool driving the editor, relies on. Newest first.
The publish workflow versions and publishes packages by itself (`.github/workflows/publish.yml`);
a change that alters an address, a command or a file format adds its note here in the same pull
request, under the 0.5 release-line version it ships in (the editor packages share one version).

## 0.5.208 — a first run on Windows without a Firewall prompt, and a browser given time to arrive

- **No Windows Firewall prompt on a first run** (#363). The editor's live-update (HMR) socket listened on every
  network interface, and on Windows a program's first such listener asks "allow Node.js JavaScript Runtime on
  public and private networks?" (the 0.5.207 blind walk met it with Node.js just downloaded). The socket now
  listens on 127.0.0.1 and ::1 only, like the rest of the editor; WSL and an explicit `VOLTER_EDITOR_HOST` keep
  their wider host.
- **`edit` waits for a browser showing its own first-run screen, and says why** (#364). A fresh browser profile
  opened on its welcome and sign-in screen, and 15 s later `edit` said the editor page did not arrive, although
  it arrived once that screen was closed. From a terminal `edit` now gives a browser three minutes and at 15 s
  says that it may be showing its own welcome or sign-in screen, with the address to open by hand (and, on a
  Mac, the Safari hint). Without a terminal (an agent's command) the answer at 15 s is as before.
- **Wording** (#365): the workbench download says "once for this account on this computer", and a window whose
  server stopped says to reopen it in the project's folder with `npx --no-install cyclotron edit .`.
- **Model Play's Escape** (#362): Escape that frees a game's mouse look no longer stops Play, and a game that
  claims Escape for its own pause keeps it.

## 0.5.207 — one document, no tab row, and pasting the install line again reopens the editor

- **One tab in all, no tab row** (#350), in Cyclotron on Windows and Linux. With one document open, the row
  above the viewport only repeated its name; it now shows once there is a second editor (another document, a
  source file) and hides again when you are back to one. Settings opening over the editor does not count.
  The workbench is the cut from editor 5b6840f8 (`cyclotron-4782d9a281ef-5b6840f8c154`); Chat is 0.1.55, as
  in 0.5.206. macOS keeps 0.5.205's workbench (`ec1e0e845c3a`, where the row always shows) until its own cut
  is made.
- **A tab told to leave no longer fills the console** (#351). Reopening a project over a tab left open on a
  session that ended can open a second tab, and the editor yields one of them; the errors that page reported
  while it shut down (Code-OSS lifecycle lines, storage and the Chat's session store failing to write) were
  kept as unresolved, so `cyclotron console` exited 1 until the next page load. They are now retired, and a
  condition any other page reported is kept as before.
- **Pasting the install line again reopens the editor after its tab closed without a goodbye** (#356). A hidden
  tab that ends with no close beacon (a crash, a killed renderer, a machine asleep, a tab closed by automation)
  stayed present for the hidden grace (30 s), so `edit` refocused a page that was gone and failed after 101 s
  ("Editor page arrived but did not become ready"), as the 0.5.206 blind walk's "come back" step found. A tab
  with no control channel and no beat for longer than a visible tab's grace (3 s) is now gone to `edit`, which
  opens a new one; `cyclotron status` calls it crashed; and a browser that never opens ends in "did not
  arrive" after 15 s.
- **The status bar's Play state follows Cyclotron's Play** (#357). It read the game editor's Play only, so it
  said "Play stopped" while the race ran; it now says Playing while any open document plays, and Paused when
  those playing are paused.
- **Reveal names this platform's file manager** (#354, #355): "Show in File Explorer" and "Reveal in File
  Explorer" on Windows (Finder on a Mac, File Manager elsewhere), the asset menu's shortcuts read Ctrl+D and Del
  off a Mac, and an asset's reveal opens its folder in the project rather than relative to wherever the server
  started.
- **Play input under pointer lock** (#358). A game whose mouse look holds a pointer lock no longer throws
  `InvalidStateError` from pointer capture (20-120 a session in playtests); Esc pressed to free the mouse no
  longer stops Play; and a limited view stops polling the account it cannot answer.

## 0.5.206 — the opening's card pull, and a Chat that saves a conversation once

- **The opening.** While Blender boots, Cyclotron's cover is a card pull. The card rises, flips with
  a burst, prints in a render of the machine standing in the canyon, and lands its stars and the
  setting's name, and the cover stays up until it has (about five and a half seconds of the pull;
  Blender is still preparing underneath). The line under it says what the editor is waiting for. The
  canyon is the one setting so far, and its first sighting in a browser wears a NEW tag; as settings
  are added, each boot pulls the first one that browser has not seen, then the next in turn. With
  reduced motion the settled card shows at once. On Windows and Linux; macOS keeps 0.5.205's workbench
  (the earlier splash and Chat 0.1.51) until its own cut is made.
- **Chat 0.1.55** (supercode #1360), on Windows and Linux. A completed turn no longer saves the same
  conversation to the editor a second time, and it checks the editor's binding before trusting its own
  record of the save.
- **"Ask for approval" asks** (#334). A Claude Code conversation now starts and resumes in Claude Code's
  manual mode (`--permission-mode default`), so a call that needs approval waits in the Chat for Allow or
  Deny. Before, Claude Code could start in its own auto mode and approve its calls itself, and Ask
  never asked. Auto approve answers the same requests by itself, as it did.
- **Safari** (#346). Safari can't run the editor yet (it lacks the cross-origin isolation Blender's worker
  needs). On a Mac whose default browser is Safari, the editor now opens in an installed Chrome, Edge, Brave,
  Arc or Chromium; any other default browser is kept. Opened in Safari anyway, the editor's address shows a
  page saying why, with the address to open elsewhere, and `cyclotron edit` says so in the terminal if the page
  never arrives.
- **Document tabs survive a document moved into an area** (#328), on Windows and Linux. Before, moving the
  open document into the bottom area (dragging its tab onto the Game panel) lost the tab row, and opening the
  document again did not bring it back.
- **The agent guidance refresh ignores line endings** (#349). On Windows, where git checks `AGENTS.md` out with
  CRLF line endings, `edit` no longer replaces an up-to-date copy and says it updated it.

## 0.5.205 — a tab per document, and tripwires that wait for a tool call

Its workbench, on Windows, macOS and Linux, is the cut from editor ec1e0e84
(`cyclotron-4782d9a281ef-ec1e0e845c3a`): a tab per document, with 0.5.204's boot splash and Chat 0.1.51.

- **Document tabs** (#292). Each open document has a tab; the workspace's areas have none.
- **Build tripwires reach the Chat agent only while one of its tool calls is out** (#321). A line
  steered into a talk-only turn used to arrive after it as a new prompt, and the agent answered it in
  the person's Chat. Such a crossing is now kept in the terminal and the session journal, where the
  `tripwire-nudge` event has a new outcome: `no-call-out`.
- **`chat send`** (#312, #313, #314) says when it queued its prompt into a running turn. A turn that has
  just ended takes the prompt as a new send, and a turn that cannot be read cleanly as idle gets nothing
  sent: only a clean idle reading sends.
- **Play loads before it starts** (#316): every character's starting animation clips are baked first, so
  the first frame of Play is not a character in its rest pose.
- **Run configurations** (#318): npm and a configuration's script run as one quoted command line, and a
  configuration whose script or arguments are not plain words (letters, digits and `_@+=:,./-`) is refused
  with a 400 before anything runs.
- **Game projects** (#317, #319): `volter-game-editor upgrade` links a game on the runtime image (or one
  with no `node_modules` and no `package-lock.json`) to the new version's image, or says why it did not (a
  version that is not one exact number); a game with its own lockfile keeps installing its own. It also
  replaces an untouched `check-idioms.ts` with this release's.
- **The workbench server reads its own extensions folder** (#336), `~/.volter/workbench-extensions/<product>`, in
  place of `~/.vscode-server-oss/extensions`, which every Code-OSS server on the machine shares. An extension
  installed there for another Code-OSS session no longer loads in Cyclotron.
- **A project's agent guidance follows the installed editor** (#337). At `edit`, an `AGENTS.md` that is still
  the starter's (same first line) and differs from the installed starter is replaced; the old copy is kept as
  `.volter/AGENTS.previous.md` and the change is printed. An `AGENTS.md` the author wrote is never touched.
- **Play starts without animation when its setup fails** (#338): a `playAnimation` setup that throws is named in
  the console; before, the loading overlay stayed up and the script never ran. Clip reads are kept across Plays
  for each model document and read again when an action changes.
- **Clip reads for Play skip the Timeline's summary row** (#331): one read of a character's clip took about 700 ms
  on a level with 23 armatures and now takes about 10 ms, so a character no longer stands still on its first walk.
- **The UI board** (#329, #330) shows a component's edit without a reload, and a session whose last view was the
  board reopens on it once the board registers; before, the restore logged an error and showed the model.
- **Diagnosis** (#339): `editor.document.run` runs on a document that publishes no context, such as the UI
  board, with `ctx` null and `info.context` false. `capture --region page` no longer prints the flat-surface
  warning, which the editor's dark interface set off on almost every page capture.

## 0.5.204 — Chat starts a new conversation again

From `@volter/cyclotron` 0.5.199 to 0.5.203, the editor Chat refused the first message of a new
conversation with "The harness has not persisted this conversation yet." and no turn ran; a conversation
already under way kept working. The Chat frontend those releases' workbench bundles
(`supercode-frontend-vscode` 0.1.52) asks the editor to link a new conversation before its first message
is sent, and the editor refuses to link a conversation the harness has not saved yet. 0.5.204 pins the
workbench back to the cut with 0.1.51 (`cyclotron-f16dc165c0df-2d5aeb1b4cd7`), where a first message runs.
What that gives up until a fixed frontend is pinned: the Chat no longer restores a running prompt and a
pending approval after a page reload. The boot splash is the same in both.

The first `cyclotron` after upgrading installs that workbench unless this machine already has it.

When the editor cannot link a chat to the harness's conversation, its message now says what it found (no
listed session with that id for the project's folder) and the likely reasons, in place of the sentence above.
The repository also pins the Chat frontend back to 0.1.51, so a workbench cut from it bundles the Chat
0.5.204 ships.

`upgrade` now takes a project made before 0.5.203 the whole way: the kit packages 0.5.203 renamed
(`@volter/editor-project`, `editor-sdk`, `editor-live` and `editor-model-play` become `@volter/project`, `sdk`,
`live` and `play`) move in package.json and in the project's own imports, and what 0.5.203 moved into
`editor/` moves there: a root `volter.adapter.ts`, and `src/contributions` and `src/tools` (with their
`volter.tools` registrations), each file's relative imports rebased. The files that name those places follow
them: the project's instructions (`AGENTS.md`, `IDIOMS.md`, the agent skills), its TypeScript configs and the
game editor's catalog records. A file whose destination already exists stays and is named. Run it with the new
release's command, since a project's own older command does not know the new names, in the project folder:
`npx @volter/cyclotron@latest upgrade`, then `npm install`; or `npx @volter/game-editor@latest upgrade`,
which also links the game to the new release's runtime image.
Opening a project that still has its adapter at the root says to run that, not to make a new project.

## 0.5.203 — the starter's commands never fetch

From `@volter/game-editor` 0.5.203, the starter a new game is made from prints
`npx --no-install volter-game-editor …` and `npx --no-install tsx …` (in `AGENTS.md`, `IDIOMS.md` and the
agent skills), and its npm scripts call `tsx` by name. Inside the project these run the project's own
installed copy, as before; where it is missing they stop with an error instead of fetching whatever holds
the name on npm.
`volter-game-editor` is a bin of `@volter/game-editor`, not a package of its own, so a plain
`npx volter-game-editor` outside an installed project would fetch a stranger's package. Projects made
from an earlier starter keep the old lines; change `npx volter-game-editor` to
`npx --no-install volter-game-editor` in them.

The same holds for what `upgrade` prints when an editor still refuses a project: open it with
`npx --no-install <command> edit .` in the project. A bare `npx cyclotron` outside the project would fetch
an unrelated package that holds that name on npm.

## 0.5.190 — the editor serves from its own host

From `@volter/model-editor` and `@volter/game-editor` 0.5.190, and in every `@volter/cyclotron`
release, each project's editor answers on its own host:

```text
http://editor-<id>.localhost:<port>/?project=<name>
```

`<id>` is a stable hash of the project folder, so a project keeps its host across launches;
browsers resolve `*.localhost` to loopback without DNS. `edit` prints this URL. The old address,
`http://127.0.0.1:<port>/`, still answers and redirects the page to the project's host.

Why: cookies ignore ports. On the shared `127.0.0.1` hostname, another local VS Code app's
secret-storage cookie could select a key server this editor does not have (the startup
`Not Found`). Settings a browser keeps per origin start fresh at the new host.

**Tools that open the editor in a browser** (Playwright, browser extensions, agent harnesses)
must bind the printed host, not `127.0.0.1:<port>`. A bind to the old address loads a fresh tab
that redirects to the project's host; the editor keeps one tab per project, so it yields the
previous tab, and every bind leaves another behind. Instead:

- take the URL `edit` prints; running `edit` again on an open project prints the same URL and
  focuses the existing tab without reloading it;
- match the editor's tab by that host (`editor-<id>.localhost:<port>`), not by `127.0.0.1`;
- reuse the tab you have rather than opening another.
