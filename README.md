<p align="center"><img src="https://brand.volter.ai/logo/volter-editor/svg?size=96" alt="Volter Editor"></p>

# Volter Editor

![A cube on wheels jumping a ramp in the Volter Model Editor, with the outliner and properties panels beside the viewport and a lap timer over it](docs/media/model-play-race.png)

**Volter Model Editor, built on Blender.** Blender 5.2 compiled to WebAssembly and running in a
browser tab, with the interface in React, the shell in Code-OSS and the viewport in three.js.
The model on screen is a live three.js scene, so a script can drive it and a React interface
can sit over it, in the same window, with no export step.

```bash
npx @volter/model-editor create my-race --template playable
```

- Needs macOS on Apple Silicon and Node.js 24. Nothing else to install.
- Opens a race circuit modelled in the editor. Press **Play** in the viewport header: the
  camera moves from your editing view to the game's, and you drive with the arrow keys or
  WASD. Escape moves it back and returns the untouched model. A lap is about 30 seconds.
- `src/models/track.py` is the bpy script that built the scene, `src/models/track.play.ts`
  is the script Play runs, and `src/ui/` is the React interface drawn over it.
- In the Chat pane, one click opens Sign in with ChatGPT, or Chat runs the coding agent you
  already have (Codex or Claude Code; others from its agent picker). The editor adds no
  account and bills nothing.
- Three first things to ask the agent, one per file:

  ```text
  Edit src/models/track.py to add a second Ramp.* wedge and three Crate.* boxes after the first corner. Open Track, rerun the script through the project's Blender MCP, and save track.blend.
  ```

  ```text
  Edit src/models/track.play.ts so holding either Shift key boosts forward top speed from 30 to 45 metres per second. Keep braking unchanged.
  ```

  ```text
  Edit src/ui/race-hud.tsx to move the speed panel to the bottom right and show JUMP instead of AIR while airborne. Keep the lap timer at the top left.
  ```
- `npx @volter/model-editor create my-models` makes a plain modelling project with a cube.

## Chat and your agent

Chat offers two ways in. **Sign in with ChatGPT** installs OpenAI's official Codex
extension (`openai.chatgpt`) if it isn't there yet and opens its own sign-in; no terminal is
involved.

Or Chat uses the agents already on your machine. It starts Codex or Claude Code by itself
when it finds one installed and signed in, resuming the project's last conversation with the
agent that held it. When neither is signed in, Chat offers their own sign-ins in the
integrated terminal; with no agent installed, it offers Codex and shows
`npm install -g @openai/codex` before running it. Chat checks readiness and reconnects
without a reload. Other agents Volter Harness supports (Gemini, Grok and more) can be chosen
from Chat's agent picker.

Other extensions install from the **Extensions** view; Claude Code's official extension is
`@id:Anthropic.claude-code`. No agent extension is bundled.

Every model editor project declares the Blender MCP server in both `.mcp.json` and
`.codex/config.toml`, with the same command. Codex loads it once you
[trust the folder in Codex](https://learn.chatgpt.com/docs/config-file/config-basic).
Creating a project never writes to your global `~/.codex`.

## Working in a project

```bash
cd my-race
npm run dev
```

From the project directory, `npx volter-model-editor` provides:

- `edit` opens the project;
- `status` reports the session;
- `console` reports unresolved diagnostics;
- `eval` drives the editor's automation API;
- `blender-mcp` serves the Blender MCP interface over stdio;
- `close` stops the session.

MCP initialization does not start Blender; the first scene request attaches to or opens the
project's editor. Append `--existing-session` after `blender-mcp` to require an editor that
is already open.

Modelling edits save to the project's `.blend` file. Undo and Redo go through the editor's
history, and Blender keeps the snapshots; redo never reruns a script. History lasts for the
session and resets when another `.blend` opens. An arbitrary Python execution counts as an
edit, even one that fails part-way, so use the inspection tools for read-only queries.

To move a project to a new release, close the editor, update its `@volter` packages and
`volter.project.json`'s `engine.version` to the new version, and move
`.volter/workbench.json` aside before reopening. The product then downloads the matching
workbench.

## Package map

The npm scope is `@volter`. Install one product; its supporting packages come with it.

| Package | Responsibility |
| --- | --- |
| `@volter/model-editor` | The model editor and its `volter-model-editor` command |
| `@volter/editor-core` | Shared editor host and Code-OSS integration |
| `@volter/editor-sdk` | Extension and contribution APIs |
| `@volter/editor-live` | Session automation client |
| `@volter/editor-project` | Project manifest and adapter contracts |
| `@volter/editor-threejs` | Shared three.js editor functionality |
| `@volter/editor-blender` | Blender documents, tools and presentation |
| `@volter/blender-engine` | Blender WebAssembly engine and worker |
| `@volter/editor-react` | React source authoring |
| `@volter/editor-game` | Game documents, Play, Scene/UI authoring |
| `@volter/game-live` | Session client for a running game |
| `@volter/game-runtime` | Runtime a game ships with |
| `@volter/threejs-runtime` | three.js runtime a game ships with |

Blender and Code-OSS are separate forked repositories, pinned by this repository's build
configuration. [ARCHITECTURE.md](ARCHITECTURE.md) describes how the pieces fit.

## Building from source

With Node.js 24 and npm:

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run check:release
npm run check:packed-imports
```

To rebuild after a change, name the packages it touched:
`node scripts/build-release-packages.mjs release/modeling.json @volter/editor-core @volter/model-editor`.
[`scripts/workbench/build-release.mjs`](scripts/workbench/build-release.mjs) builds the
Code-OSS workbench.

Only the packages listed in [release/modeling.json](release/modeling.json) and
[release/game.json](release/game.json) are published, from the `publish` branch after a
main commit is promoted to it.

## License

Licenses vary by component; see [LICENSE.md](LICENSE.md) and each package's license and
notice files.
