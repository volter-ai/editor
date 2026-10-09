const fs = require('fs');
const root = process.argv[2];
let sh = fs.readFileSync(root + '/install.sh', 'utf8');
sh = sh.replace('main() {\n', "main() {\n  # npm's own notices (a newer npm, funding, audit) aren't for someone opening Cyclotron.\n  npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false\n  export npm_config_update_notifier npm_config_fund npm_config_audit\n");
fs.writeFileSync(root + '/install.sh', sh);
let ps = fs.readFileSync(root + '/install.ps1', 'utf8');
const eol = ps.includes('\r\n') ? '\r\n' : '\n';
ps = ps.replace("  $nodeHome = Join-Path $homeDir '.volter\node'", ["  # npm's own notices (a newer npm, funding, audit) aren't for someone opening Cyclotron.", "  $env:npm_config_update_notifier = 'false'; $env:npm_config_fund = 'false'; $env:npm_config_audit = 'false'", "  $nodeHome = Join-Path $homeDir '.volter\node'"].join(eol));
fs.writeFileSync(root + '/install.ps1', ps);
