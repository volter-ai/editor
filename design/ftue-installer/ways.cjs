// Restructure the Cyclotron page's hero actions and install section (one-off edit script).
const fs = require('fs');
const root = process.argv[2];
const htmlPath = root + '/index.html';
const cssPath = root + '/site.css';

let html = fs.readFileSync(htmlPath, 'utf8');
const swap = (from, to) => {
  const i = html.indexOf(from);
  if (i === -1) throw new Error('html missing: ' + from.slice(0, 70));
  html = html.slice(0, i) + to + html.slice(i + from.length);
};

// Hero: the action sits under the headline, before the video.
const actions = '<div class="hero-actions"><a class="cta" data-open-editor>Open Cyclotron</a><p class="small">Free and open source, in your browser.<br><a href="#install">Install it, with the AI chat ↓</a></p></div>';
const oldActions = html.match(/\s*<div class="hero-actions">.*?<\/div>/);
if (!oldActions) throw new Error('hero actions');
html = html.replace(oldActions[0], '');
swap('<h1>Make games<br> with Blender<span>.</span></h1>', '<h1>Make games<br> with Blender<span>.</span></h1>\n          ' + actions);

// The install section: every way to run it, then how to use it.
const copy = '<button class="copy" type="button" aria-label="Copy the command"><img src="brand/copy.svg" width="16" height="16" alt=""></button>';
const start = html.indexOf('      <div class="take-it wrap" id="install">');
const endMark = '      </ol></div>';
const end = html.indexOf(endMark, start);
if (start === -1 || end === -1) throw new Error('install section');
const get = `      <div class="get wrap" id="install">
        <h3>Ways to run it.</h3>
        <div class="ways">
          <article class="way"><div><h4>In your browser</h4><p>Blender and Play, nothing to install. No AI chat.</p></div><div><a class="cta" data-open-editor>Open Cyclotron</a></div></article>
          <article class="way"><div><h4>On your computer <span class="badge">Recommended</span></h4><p>Everything, with the AI chat. Windows, Macs with Apple Silicon, and Linux. Nothing else to install.</p></div><div>
            <div class="os-choice" role="group" aria-label="Your computer" hidden><button type="button" data-os="windows" aria-pressed="true">Windows</button><button type="button" data-os="unix" aria-pressed="false">macOS · Linux</button></div>
            <div class="os" data-os="windows"><p>Open <b>PowerShell</b> from the Start menu, paste this and press Enter.</p><div class="install"><code>irm https://cyclotron.videogame.ai/install.ps1 | iex</code>${copy}</div></div>
            <div class="os" data-os="unix"><p>Open <b>Terminal</b>, paste this and press Enter.</p><div class="install"><code>curl -fsSL https://cyclotron.videogame.ai/install.sh | sh</code>${copy}</div></div>
            <p>Cyclotron opens in your browser with a starter racing game.</p></div></article>
          <article class="way"><div><h4>With Node.js</h4><p>The same editor, if you already have Node.js 24. On Windows, use Command Prompt.</p></div><div><div class="install"><code>npx @volter/cyclotron create my-race --template playable</code>${copy}</div><p>To reopen it, run <code>npx cyclotron</code> in that folder.</p></div></article>
          <article class="way"><div><h4>From source</h4><p>To change the editor itself.</p></div><div><p>Clone <a href="https://github.com/volter-ai/editor">volter-ai/editor</a> and follow its <a href="https://github.com/volter-ai/editor#building-from-source">Building from source</a>.</p></div></article>
        </div>
        <h3>Using it.</h3>
        <ol class="steps use">
          <li><h4>Connect your AI</h4><p>In the Chat panel, click <b>Sign in with ChatGPT</b>. If Codex or Claude Code is already signed in on this computer, Chat uses it.</p></li>
          <li><h4>Ask for a change</h4><p>Like “make the car red and add a ramp”. Chat edits the Blender model, the gameplay code and the game UI.</p></li>
          <li><h4>Press Play</h4><p>In the viewport header. Drive with the arrow keys or WASD; Escape returns to editing.</p></li>
          <li><h4>Come back to it</h4><p>Your game is in the <b>Cyclotron</b> folder in your home folder. Paste the install line again to reopen it.</p></li>
        </ol>
      </div>`;
html = html.slice(0, start) + get + html.slice(end + endMark.length);
fs.writeFileSync(htmlPath, html);

let css = fs.readFileSync(cssPath, 'utf8');
const eol = css.includes('\r\n') ? '\r\n' : '\n';
const cssSwap = (from, to) => {
  from = from.split('\n').join(eol); to = to.split('\n').join(eol);
  if (!css.includes(from)) throw new Error('css missing: ' + from.slice(0, 70));
  css = css.replace(from, to);
};
// Header: the button and the links share one centre line.
cssSwap('nav { display: flex; gap: 38px; font-size: 13px; }', 'nav { display: flex; align-items: center; gap: 38px; font-size: 13px; }');
// Hero: the action follows the headline; the video follows the action.
cssSwap('.hero-actions { display: flex; justify-content: space-between; align-items: center; gap: 15px; margin-top: 24px; }',
  '.hero-actions { display: flex; align-items: center; gap: 28px; margin-bottom: 34px; }');
cssSwap('.hero-content h1 { font-size: clamp(42px, 4.4vw, 68px); margin-bottom: 42px; line-height: 1.01; }',
  '.hero-content h1 { font-size: clamp(42px, 4.4vw, 68px); margin-bottom: 30px; line-height: 1.01; }');
cssSwap('  .hero-actions { margin-top: 18px; }\n', '  .hero-actions { margin-bottom: 22px; }\n');
cssSwap('  .hero-actions { flex-direction: column; align-items: flex-start; }\n', '  .hero-actions { flex-direction: column; align-items: flex-start; gap: 14px; }\n');
// Ways to run it, and using it.
cssSwap('/* The page\'s one action: the browser editor, in its own tab. */',
`/* Every way to run it, one row each, then how to use it. */
.get { padding-block: 70px 85px; }
.get h3 { font-size: 40px; margin-bottom: 26px; }
.get h3 + .steps { margin-top: 0; }
.ways { border-top: 1px solid var(--volter-border-strong); margin-bottom: 70px; }
.way { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 10%; padding-block: 24px; border-bottom: 1px solid var(--volter-border-strong); }
.way h4 { margin: 0; font-size: 18px; font-weight: 500; line-height: 24px; }
.way p { margin-top: 6px; font-size: 14px; line-height: 1.5; color: var(--volter-text-muted); }
.way p code { font: 13px var(--volter-font-data); }
.way .install { margin-top: 10px; }
.way .os > p:first-child { margin-top: 10px; }
.badge { margin-left: 8px; padding: 2px 7px; background: var(--volter-selection-soft); font: 10px/1.6 var(--volter-font-data); vertical-align: 3px; }
.steps.use { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 30px; }
/* The page's one action: the browser editor, in its own tab. */`);
cssSwap('.os-choice { display: flex; gap: 6px; margin-top: 12px; }', '.os-choice { display: flex; gap: 6px; }');
// Phones: one column.
cssSwap('  .open-editor { padding: 8px 10px; }\n',
  '  .open-editor { padding: 8px 10px; }\n  .get { padding-block: 50px; } .get h3 { font-size: 34px; }\n  .way { grid-template-columns: minmax(0, 1fr); gap: 14px; }\n  .steps.use { grid-template-columns: minmax(0, 1fr); gap: 22px; }\n');
fs.writeFileSync(cssPath, css);
console.log('ok');
