// Site fixes from the blind first-time read (one-off edit script).
const fs = require('fs');
const root = process.argv[2];
const edit = (file, pairs) => {
  let text = fs.readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  for (const [from, to] of pairs) {
    const f = from.split('\n').join(eol), t = to.split('\n').join(eol);
    if (!text.includes(f)) throw new Error(file + ' missing: ' + from.slice(0, 70));
    text = text.replace(f, t);
  }
  fs.writeFileSync(file, text);
};
edit(root + '/index.html', [
  // Say what this is, and that the AI builds with you, before the action.
  ['<h1>Make games<br> with Blender<span>.</span></h1>',
   '<h1>Make games<br> with Blender<span>.</span></h1>\n          <p class="hero-lead">Cyclotron is a free, open-source game editor. Model in Blender, play your game in the same window, and build it with your AI agent.</p>'],
  // Play is in the Game panel's bar under the viewport.
  ['<li><h4>Press Play</h4><p>In the viewport header. Drive with the arrow keys or WASD; Escape returns to editing.</p></li>',
   '<li><h4>Press Play</h4><p>In the bar under the viewport. Drive with the arrow keys or WASD; Escape returns to editing.</p></li>'],
  // The inline preview's button loads it here; Open Cyclotron opens its own tab.
  ['<button id="embed-start" type="button">Open editor</button>', '<button id="embed-start" type="button">Load it here</button>'],
]);
edit(root + '/site.css', [
  ['.hero-content h1 { font-size: clamp(42px, 4.4vw, 68px); margin-bottom: 30px; line-height: 1.01; }',
   '.hero-content h1 { font-size: clamp(42px, 4.4vw, 68px); margin-bottom: 18px; line-height: 1.01; }\n.hero-lead { max-width: 30em; margin-bottom: 26px; font-size: 16px; line-height: 1.5; color: var(--volter-text-muted); }'],
]);
console.log('ok');
