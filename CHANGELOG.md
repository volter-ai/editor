# Release notes

What a release changes that a person, or a tool driving the editor, relies on. Newest first.
The publish workflow versions and publishes packages by itself (`.github/workflows/publish.yml`);
a change that alters an address, a command or a file format adds its note here in the same pull
request, under the 0.5 release-line version it ships in (the editor packages share one version).

## 0.5.203 — the starter's commands never fetch

From `@volter/game-editor` 0.5.203, the starter a new game is made from prints
`npx --no-install volter-game-editor …` and `npx --no-install tsx …` (in `AGENTS.md`, `IDIOMS.md` and the
agent skills), and its npm scripts call `tsx` by name. Inside the project these run the project's own installed copy, as before;
where it is missing they stop with an error instead of fetching whatever holds the name on npm.
`volter-game-editor` is a bin of `@volter/game-editor`, not a package of its own, so a plain
`npx volter-game-editor` outside an installed project would fetch a stranger's package. Projects made
from an earlier starter keep the old lines; change `npx volter-game-editor` to
`npx --no-install volter-game-editor` in them.

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
