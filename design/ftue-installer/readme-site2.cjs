const fs = require('fs');
const file = process.argv[2];
let md = fs.readFileSync(file, 'utf8');
const eol = md.includes('\r\n') ? '\r\n' : '\n';
const swap = (from, to) => { from = from.split('\n').join(eol); to = to.split('\n').join(eol); if (!md.includes(from)) throw new Error('missing: ' + from.slice(0, 50)); md = md.replace(from, to); };
swap('before the visitor clicks. The native Quick install popover exposes the same copyable\nCLI command as the installation section below.\n',
  'before the visitor clicks. The header carries the same Open Cyclotron action as the hero and\na link to the install section; the earlier Quick install popover is gone.\n');
swap('- Product copy follows the public `@volter/cyclotron` README at **0.5.192**:\n  Blender 5.2, Code-OSS, React, three.js, TypeScript, Node.js 24, free/open source\n  and existing agent subscriptions.',
  '- Product copy follows the public `@volter/cyclotron` README at **0.5.196**:\n  Blender 5.2, Code-OSS, React, three.js, TypeScript, free/open source, the one-line\n  install for Windows, Apple Silicon Macs and x64 Linux, and Sign in with ChatGPT or an\n  agent already signed in.');
swap('so the install box shows the README\'s own command,\n  `npx @volter/cyclotron create my-race --template playable`, and its copy button\n  copies the command shown.',
  'so the install section shows the README\'s own lines,\n  `irm https://cyclotron.videogame.ai/install.ps1 | iex` and\n  `curl -fsSL https://cyclotron.videogame.ai/install.sh | sh`, and each copy button\n  copies the line shown.');
fs.writeFileSync(file, md);
