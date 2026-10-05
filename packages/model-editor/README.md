# [HEADLINE: the idea — a free, open-source game editor built from AI's favorite tools]

[SUBLINE: model in Blender, press Play, and the scene is the game]

```bash
npx @volter/model-editor create my-race --template playable
```

macOS on Apple Silicon · Node.js 24

![A cube on wheels jumping a ramp in the editor, with the outliner and properties panels beside the viewport and a lap timer over it](https://raw.githubusercontent.com/volter-ai/editor/main/docs/media/model-play-race.png)

## [HEADING: the five picks, assembled]

| Part | Tool |
| --- | --- |
| Editor shell | VS Code (Code-OSS) |
| Rendering | three.js |
| Gameplay | TypeScript — `src/models/track.play.ts` |
| UI | React — `src/ui/` |
| 3D modelling | Blender 5.2 compiled to WebAssembly |

## [HEADING: your agent working in tools it knows]

- Chat: **Sign in with ChatGPT**, or use the agent already installed on your machine.
- Chat starts Codex or Claude Code when installed and signed in; other agents are available in its agent picker.
- Each project declares a Blender MCP server for Claude Code and Codex. It passes the agent's requests to the editor's Blender, which runs them as `bpy`.

## [HEADING: free and open source]

- Price: free.
- Editor: AGPL-3.0-only.
- Blender and starter `bpy` scripts: GPL-3.0-or-later.
- Other starter source: MIT.

[Licences and notices](https://github.com/volter-ai/editor/blob/main/LICENSE.md)

[Model Editor by VideoGame AI](https://model-editor.videogame.ai) · [Source on GitHub](https://github.com/volter-ai/editor)
