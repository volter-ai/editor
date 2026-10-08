const fs = require('fs');
const path = process.argv[2];
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
const start = lines.findIndex(l => l.startsWith("writeFileSync(join(dist, 'install.sh')"));
const end = lines.findIndex((l, i) => i > start && l.startsWith("copyFileSync(join(here, 'src', 'install.ps1')"));
if (start < 0 || end < 0) throw new Error('not found');
const b = String.fromCharCode(92);
lines.splice(start, end - start, `writeFileSync(join(dist, 'install.sh'), readFileSync(join(here, 'src', 'install.sh'), 'utf8').replaceAll('${b}r${b}n', '${b}n'));`);
fs.writeFileSync(path, lines.join('\n'));
