const fs = require('fs');
const file = process.argv[2];
let md = fs.readFileSync(file, 'utf8');
const eol = md.includes('\r\n') ? '\r\n' : '\n';
const from = 'Free, open source and open-web details are secondary in the hero.' + eol;
if (!md.includes(from)) throw new Error('anchor');
const add = [
  'Free, open source and open-web details are secondary in the hero.',
  '',
  'The page has one action: **Open Cyclotron**, the browser editor in its own tab, in the hero',
  'and the header. It needs no install, no account and no Node.js. The AI chat needs the installed',
  "editor, so the hero's second line and the browser section point to the install section. That",
  "section is one line for the visitor's OS (Windows, or macOS and Linux, chosen from the browser's",
  'platform), then Sign in with ChatGPT. There is no Node.js step and no download size: the lines',
  'run `install.ps1` and `install.sh`, served beside the page as text and never cached. Each uses',
  "the visitor's Node.js 24 if it fits Cyclotron's platforms, otherwise downloads Node.js 24 from",
  "nodejs.org into `~/.volter/node`, checked against nodejs.org's SHA-256. Then it creates",
  '`~/Cyclotron/my-race` from the playable template, or reopens it on a later run. On Windows, npm',
  "runs through its `.cmd` files, because PowerShell's default policy refuses npm's `.ps1` ones; a bare",
  '`npx` line fails in a default PowerShell with "running scripts is disabled on this system".',
  '',
].join(eol);
md = md.replace(from, add);
fs.writeFileSync(file, md);
