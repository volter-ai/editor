#!/bin/bash
# darwin-arm64 workbench cut for editor #236 (28b19dec), product cyclotron, frontend 0.1.52.
# Owner-approved 2026-10-08 (uuid 736fa4c1), grant_deea1541, decision D299. Everything stays in $B.
set -euo pipefail
B=/Volumes/PeakSSD/workbench-darwin-volter10-20261008
REV=28b19dec3e1a08b71ac44c583e3443134f7d6517
PIN=f16dc165c0dffe701a7bbf59aefb1c662b206cee
FE=767b5998082c8b902a2d24f66d07d54c56baa5770f01ac045658cb7aae983a1b
mkdir -p "$B"; cd "$B"
exec > "$B/build.log" 2>&1
echo "start $(date -u +%FT%TZ)"
export GIT_LFS_SKIP_SMUDGE=1

# Node 24.18.0 (the fork's .nvmrc) from nodejs.org, checked against its SHASUMS256.
if [ ! -x node/bin/node ]; then
  curl -fsSL https://nodejs.org/dist/v24.18.0/SHASUMS256.txt -o SHASUMS256.txt
  f=node-v24.18.0-darwin-arm64.tar.gz
  curl -fsSL "https://nodejs.org/dist/v24.18.0/$f" -o "$f"
  grep "  $f\$" SHASUMS256.txt | shasum -a 256 -c -
  mkdir -p node && tar -xzf "$f" -C node --strip-components 1 && rm -f "$f"
fi
export PATH="$B/node/bin:/usr/bin:/bin:/usr/sbin:/sbin:/Applications/Xcode.app/Contents/Developer/usr/bin"
echo "node $(node -v), npm $(npm -v)"

[ -d editor/.git ] || git clone --filter=blob:none https://github.com/volter-ai/editor.git editor
git -C editor fetch -q origin "$REV" && git -C editor checkout -q --detach "$REV"
[ -d code-oss/.git ] || git clone --filter=blob:none --no-checkout https://github.com/volter-ai/code-oss.git code-oss
git -C code-oss fetch -q origin "$PIN" && git -C code-oss checkout -q --detach "$PIN"
echo "editor $(git -C editor rev-parse HEAD), code-oss $(git -C code-oss rev-parse HEAD)"

cd editor
npm ci --ignore-scripts
sha=$(shasum -a 256 node_modules/@volter/supercode-frontend-vscode/dist/extension.js | cut -d' ' -f1)
echo "frontend dist/extension.js $sha"
[ "$sha" = "$FE" ] || { echo "FRONTEND SHA MISMATCH: expected $FE"; exit 1; }

node scripts/workbench/build-release.mjs --product cyclotron --platform darwin-arm64 \
  --checkout "$B/code-oss" --work "$B/work" --out "$B/out" --min-ram 15
echo "done $(date -u +%FT%TZ)"
ls -la "$B/out"
cat "$B/out/BUILD.json"
