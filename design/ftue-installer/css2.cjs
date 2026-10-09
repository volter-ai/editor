const fs = require('fs');
const file = process.argv[2];
let css = fs.readFileSync(file, 'utf8');
const eol = css.includes('\r\n') ? '\r\n' : '\n';
const swap = (from, to) => { from = from.split('\n').join(eol); to = to.split('\n').join(eol); if (!css.includes(from)) throw new Error('missing: ' + from.slice(0, 60)); css = css.replace(from, to); };
swap('.steps h4 { font-size: 18px; font-weight: 500; line-height: 24px; }', '.steps h4 { margin: 0; font-size: 18px; font-weight: 500; line-height: 24px; }');
// The install lines fit their column on a laptop screen, with no scrollbar.
swap('.take-it { align-items: start; }', '.take-it { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); align-items: start; }');
swap('.cta { display: inline-block;', '.cta { display: inline-block; white-space: nowrap;');
swap('  .open-editor { padding: 8px 10px; }\n', '  .open-editor { padding: 8px 10px; }\n  .hero-actions { flex-direction: column; align-items: flex-start; }\n');
fs.writeFileSync(file, css);
