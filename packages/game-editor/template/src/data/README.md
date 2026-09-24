# src/data — game data

Rules and content live here as ordinary TypeScript literals, in modules
named for the game concept: `player.ts`, `weapons.ts`, `levels.ts`.
Create them when the brief supplies data. TypeScript checks their structure;
editor panels read the data without determining how it is organized.

- **Reading:** import the literal and read fields directly from the
  mechanic that cares. Read per frame if you want live edits to land.
- **Live dials:** write an ordinary editor contribution over the module
  (`src/contributions/use-game-modules.ts` is the hook; writes on the running
  module's object are live for the play).
- **Committing a number:** edit the file. Vite HMR delivers it.

Adding a table: write the literal, export its row type
(`export type Row = (typeof rows)[keyof typeof rows];`), read it from the
game. Nothing to register anywhere.
