The owner, 2026-10-07: "we will obv have big scenes that is the point".

Every Outliner tree read (`rna_outliner`) built a full row for every object in the scene before paging to 64 per list: data, materials, modifiers, constraints and vertex groups. Blender reads the tree after every frame push, so after every selection write and structural edit. The cost grew with the scene, whatever was visible.

**Change** (session.py only):
- **Placeholders first:** objects enter the tree as cheap placeholders. The parent fold, the held rows (#220) and the page all run on placeholders, and only objects the page keeps get their full rows.
- **No name lookups in the fold:** it takes each placed object directly instead of `bpy.data.objects[name]`, which walks the object list. That was 43 ms on Canyon Comet and most of main's 5 s at 10k objects.
- **One pass for moved rows:** they're filtered out of their old list together, instead of one `list.remove` each.
- **Ids are unchanged** for every surviving row, including the `@n` suffixes on repeated addresses. The `_OutlinerScope` helper counts the claims each skipped row would have made:
  - addresses under an object count that object's expansions;
  - addresses under data or shape keys count expansions of that data, with bones counted separately because of Pose Mode;
  - shared addresses (object rows, materials, linked objects, node groups, instanced collections) count over the whole tree, in today's order.
- **Second commit (#220's review P2):** the caller's choice now comes before the engine's other selected objects in the held rows, and the cap is exactly one page.

**Timings.** Native headless Blender 5.2.2, runs interleaved, median after warm-up:

| Scene / case | main | this |
|---|---|---|
| Canyon Comet, 1,493 objects: nothing / kart part / select all | 145 / 128 / 124 ms | **36 / 31 / 30 ms** |
| 10,433 objects (Canyon ×7, linked duplicates): nothing / kart part / select all | 5,328 / 5,007 / 4,159 ms | **163 / 153 / 139 ms** |

What's left is linear and small: the placeholder pass and the claim count. Going further would mean caching the tree between reads.

**Equality.** The first commit's output is byte-identical JSON, as the engine serializes it, to #220's head (523f8a95):
- Canyon Comet: 8 of 8 cases (nothing; a kart part and Kart.4, each with and without the caller's selection; the last three objects; select all, both ways).
- The 10,433-object scene: 4 of 4, including a deep copy whose shared ids carry high `@n`.
- A 1,719-object stress scene: 16 of 16. It is built to hit every id edge: shared data with shape keys; materials on data and object slots; armature modifiers before their rig (`@151`); a Pose Mode rig sharing data with an Object Mode twin; objects in two collections; cross-collection parents; constraints, vertex groups, a node-group modifier, particles and collection instances, all past row 64.
- `track.blend`, `cube.blend` and `arena-vanguard.blend` (an armature character): 4 of 4 each.

The second commit changes which held rows are kept only when the caller's choice and a larger-than-a-page engine selection disagree. That is the point of it.

**Known theoretical difference:** when a local object and a library-linked object share a name, today's name lookup could pick the other one. This uses the placed object. No tested scene hits it.

No tests run (repo rule). The evidence scripts are in `editor-pick-probe/.probe/` on volter-desktop (`equal_outliner.py`, `time_branch.py`).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
