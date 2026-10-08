#!/usr/bin/env node
// `volter-game-editor` is the command of @volter/game-editor; this package runs nothing and says where it is.
process.stderr.write(
  'The game editor is @volter/game-editor.\n' +
  'In a game project: npx --no-install volter-game-editor <command>\n' +
  'To make a new game: npx @volter/game-editor create my-game\n',
);
process.exit(1);
