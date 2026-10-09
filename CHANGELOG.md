# Release notes

What a release changes that a person, or a tool driving the editor, relies on. Newest first.
The publish workflow versions and publishes packages by itself (`.github/workflows/publish.yml`);
a change that alters an address, a command or a file format adds its note here in the same pull
request, under the 0.5 release-line version it ships in (the editor packages share one version).

## 0.5.205 — the opening's card pull, and a Chat that saves a conversation once

- **The opening.** While Blender boots, Cyclotron's cover is a card pull. The card rises, flips with
  a burst, prints in a render of the machine standing in the canyon, and lands its stars and the
  setting's name, and the cover stays up until it has (about five and a half seconds of the pull;
  Blender is still preparing underneath). The line under it says what the editor is waiting for. The
  canyon is the one setting so far, and its first sighting in a browser wears a NEW tag; as settings
  are added, each boot pulls the first one that browser has not seen, then the next in turn. With
  reduced motion the settled card shows at once. On Windows and Linux; macOS keeps the previous
  workbench (the axes splash and Chat 0.1.51) until its own cut is made.
- **Chat 0.1.55** (supercode #1360), on Windows and Linux. A completed turn no longer saves the same
  conversation to the editor a second time, and it checks the editor's binding before trusting its own
  record of the save.
- **"Ask for approval" asks** (#334). A Claude Code conversation now starts and resumes in Claude Code's
  manual mode (`--permission-mode default`), so a call that needs approval waits in the Chat for Allow or
  Deny. Before, Claude Code could start in its own auto mode and approve its calls itself, and Ask
  never asked. Auto approve answers the same requests by itself, as it did.
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
