# Reproducing the native geometry comparison

Reference: official macOS arm64 Blender 5.2 LTS build `fbe6228777e7`.
Input: `volter-ai/game-benchmarks` revision `34eb427`,
`benchmarks/stoneguard-bridge/scene/stoneguard-bridge.blend`, SHA256
`ad1430f2e1db93bb8f0996ddc487a2c1f5e8d40f3a410004fb1b1b881d4426e7`.

Run `scene-geometry.py` through each Blender's background Python door with
`STONEGUARD_SCENE` pointing to that file. The Wasm fixture stages it at
`/work/scene.blend`. Both select Stoneguard Bridge without deleting other scenes.
Run apps and diagnostics through the repository's World. Capture stdout to two
files, then run `python3 compare-scene.py native.log wasm.log`.
The comparator builds adjacent SQLite caches, requires a completion marker,
compares object-linked geometry, transforms, every UV channel and topology, and
reports exact counts plus maximum and RMS numeric differences. Logs contain
large base64 arrays; inspect the JSON report instead of printing them.

For the focused bodice comparison, substitute `bodice-stages.py`. Its stages are
base, Armature, Subsurf and Solidify. The expected 28 array hashes are in
`../stoneguard-bodice.json`. The same comparator accepts these stage logs.

These are evaluated geometry comparisons, not pixel comparisons. Full-scene
last-bit differences and normal amplification near collapsed faces are retained
in `../stoneguard-memory.json`; whole-scene bit identity is not claimed.
