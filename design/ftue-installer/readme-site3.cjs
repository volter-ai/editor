const fs = require('fs');
const file = process.argv[2];
let md = fs.readFileSync(file, 'utf8');
const eol = md.includes('\r\n') ? '\r\n' : '\n';
const lines = md.split(/\r?\n/);
const start = lines.findIndex(l => l.startsWith('The page has one action: **Open Cyclotron**'));
const end = lines.findIndex((l, i) => i > start && l === '');
if (start < 0 || end < 0) throw new Error('paragraph');
lines.splice(start, end - start,
  'The page has one action, **Open Cyclotron**: the browser editor in its own tab, directly under',
  'the headline and in the header. It needs no install, no account and no Node.js. Beside it, a',
  'line points to the install section, because the AI chat needs the installed editor.',
  '',
  'The install section, **Ways to run it**, lists every way, one row each, as other editors do:',
  '- **In your browser**: Open Cyclotron. Blender and Play, no AI chat.',
  "- **On your computer** (recommended): one line for the visitor's OS (Windows, or macOS and",
  "  Linux, chosen from the browser's platform), with no Node.js step and no download size.",
  '- **With Node.js**: the README\'s `npx` line, for Command Prompt on Windows.',
  '- **From source**: the editor repository\'s Building from source.',
  '',
  '**Using it** follows in four steps: Sign in with ChatGPT (or the agent already signed in), ask',
  'for a change, Play, and come back to the game.',
  '',
  'The install lines run `install.ps1` and `install.sh`, served beside the page as text and never',
  "cached. Each uses the visitor's Node.js 24 if it fits Cyclotron's platforms. Otherwise it",
  "downloads Node.js 24 from nodejs.org into `~/.volter/node`, checked against nodejs.org's",
  'SHA-256. Then it creates `~/Cyclotron/my-race` from the playable template, or reopens it on a',
  "later run. On Windows, npm runs through its `.cmd` files, because PowerShell's default policy",
  "refuses npm's `.ps1` ones: a bare `npx` line fails in a default PowerShell with \"running scripts",
  'is disabled on this system".');
fs.writeFileSync(file, lines.join(eol));
