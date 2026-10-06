# Model Editor by VideoGame AI

A free, open-source game editor by VideoGame AI, built from Blender 5.2 compiled to WebAssembly, Code-OSS, three.js, TypeScript and React.

```bash
npx @volter/model-editor create my-race --template playable
```

macOS on Apple Silicon · Node.js 24

For a model, run `npx @volter/model-editor` without arguments. It opens the current
project, or prepares `~/Documents/Volter Models/Untitled Model` with a saved cube
and Chat ready. Later launches reopen that starter and preserve your edits.

![A cube on wheels jumping a ramp in the editor, with the outliner and properties panels beside the viewport and a lap timer over it](https://raw.githubusercontent.com/volter-ai/editor/main/docs/media/model-play-race.png)

## What it's made of

| Part | Tool |
| --- | --- |
| Editor shell | VS Code (Code-OSS) |
| Rendering | three.js |
| Gameplay | TypeScript — `src/models/track.play.ts` |
| UI | React — `src/ui/` |
| 3D modelling | Blender 5.2 compiled to WebAssembly |

## Your agent

- Chat: **Sign in with ChatGPT**, or use the agent already installed on your machine.
- Chat starts Codex or Claude Code when installed and signed in; other agents are available in its agent picker.
- Each project declares a Blender MCP server for Claude Code and Codex. It passes the agent's requests to the editor's Blender, which runs them as `bpy`.
- `AGENTS.md` explains how to interpret images, videos, specifications and existing
  assets; `CLAUDE.md` imports the same instructions. For a new game, the agent
  matches a static 3D scene and React UI screenshot to the visual reference
  before implementing gameplay, including framing, palette and color management.
- New projects include `tsconfig.json` before the editor opens, ready for TypeScript play scripts and React UI source.
- From the project folder, `npx --no-install volter-model-editor chat status`,
  `chat send "your prompt"`, and `chat stop` control the same conversation visible
  in the editor. Sending is asynchronous; status reports busy state and pending requests.

## Free and open source

- Price: free.
- Editor: AGPL-3.0-only.
- Blender and starter `bpy` scripts: GPL-3.0-or-later.
- Other starter source: MIT.

[Licences and notices](https://github.com/volter-ai/editor/blob/main/LICENSE.md)

[Model Editor by VideoGame AI](https://model-editor.videogame.ai) · [Source on GitHub](https://github.com/volter-ai/editor)
