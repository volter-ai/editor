# Playable launch release

Preparation only, 2026-10-04. No build, install, session, test, workflow dispatch,
workbench upload or npm publish was performed for this change. Commit hooks still run.
Keep the preparation PR draft until the external artifacts below exist and are pinned.

## What the previous trigger would do

Read against main `51ac30cc` plus editor PR40 `e04c0d73`; the latter changes Chat
source, not the release package versions or workbench pin. Registry reads on
2026-10-04 found the following. These are conditional publication targets, not
claims that a build or the registry would accept them.

There was no remote `publish` branch. With the old `github.event.created != true`
condition, the first push creating it would publish **nothing**. A subsequent
promotion or dispatch on that branch would select `release/game.json`, detect
changed source and apply `LOCKSTEP=1`:

| Package (@volter/) | Manifest / npm latest before preparation | Old workflow target | Prepared target |
| --- | --- | --- | --- |
| editor-project | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-sdk | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-threejs | 0.5.157 | 0.5.158 | 0.5.158 |
| blender-engine | 0.1.95 | 0.1.96 | 0.1.96 |
| editor-blender | 0.1.97 | 0.1.98 | 0.1.98 |
| editor-core | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-live | 0.5.157 | 0.5.158 | 0.5.158 |
| model-editor | 0.5.157 | 0.5.158 | 0.5.158 |
| threejs-runtime | 0.5.157 | 0.5.158 | 0.5.158 |
| game-runtime | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-react | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-xstate | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-game | 0.5.157 | 0.5.158 | 0.5.158 |
| game-live | 0.5.157 | 0.5.158 | 0.5.158 |
| dawproject | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-dawproject | 0.5.157 | 0.5.158 | 0.5.158 |
| game-editor | 0.5.157 | 0.5.158 | 0.5.158 |
| editor-model-play | 0.5.157 / unpublished (404) | omitted | 0.5.158 |
| editor-ui | 0.5.157 / unpublished (404) | omitted | 0.5.158 |

The old workflow would build the Game list, check its manifest/packed imports,
publish missing selected versions, and read them back. It would **not** consult
the playable list, release either omitted tool, publish Supercode, or build/upload
Code-OSS. Dynamic scaffold dependencies do not automatically enter the release list.
The resulting playable scaffold would request tools npm does not serve.

## What this preparation changes

- `release/game.json` becomes the reviewed 19-package superset, with the two
  source-only tools before Model Editor. The 14-package `release/playable.json`
  stays the narrower installation boundary; no Game Editor product is added to it.
- The existing push/dispatch workflow retains one publish job and also checks the
  playable boundary. A first push creating `publish` now releases, too.
- All selected versions, exact internal dependency/peer pins, lockfile workspace
  entries, catalog pins and the DAW renderer version move together to the table's
  prepared targets. Autorelease reuses manually prepared unpublished versions;
  if another release consumes them first, it chooses the next patch after npm.
- Published external pins advance from frontend-vscode 0.1.14 to **0.1.17** and
  editor-core's attachment client from supercode-frontend 0.2.6 to **0.2.7**.
  Registry tarball URLs/integrities are recorded in the lockfile without installing.
  Published 0.1.17 contains the restored-history fixes.

## Artifacts that are still missing

The extension prerequisite is now public and pinned: frontend-vscode **0.1.17**,
`gitHead` `a32f101ab5baac683102b846c781da12770d0ae4`. Autorelease
[37201264775](https://github.com/volter-ai/supercode/actions/runs/37201264775)'s SDK
job completed successfully; its separate native release cut was still queued at
verification. The npm tarball's SHA512 matches the lockfile. Its `dist/extension.js`,
`dist/view.js` and `dist/chat-setup.js` are byte-identical to the W64 build at
`517a27d9e359bed26049a2cb9fdd6f57e13a6071`; source ancestry also contains
`f2bc8508e85d211a03fda78bd3e3919fe88a265b`. Thus the published bytes include the
restored native tool history with explicit pending-approval labels. This is packed-byte verification, not a new live walk.
The attachment client remains **0.2.7**, matching npm latest and its existing lock
integrity; editor-core needs no further version change. No dependency was installed.

The Model Editor still pins
`model-editor-f16dc165c0df-ae7600a80ae8-darwin-arm64`, SHA256
`cb5922a25786c658e9cea452a5c9bab42125366154ed53ff84721d9f41418c46`.
Its public BUILD.json confirms frontend-vscode **0.1.14**, editor source
`ae7600a80ae8d595a6a843b3f8e5028f94260742`, and Code-OSS source
`f16dc165c0dffe701a7bbf59aefb1c662b206cee`. Changing the npm extension pin does
not change this tarball. A new public Model Editor workbench must be cut from the
overlay now merged to main at `9b098916` (PR40 and PR43) and the actually
published fixed extension, then pinned by its real tag/hash. This overlay routes provider
New Chat through its creation command before native edit-session cleanup, so
picker cancellation preserves the current session. It also prevents repeated
REH Copilot guards on overlay re-application. The changed native workbench
sources require a rebuild; copying a newer extension alone is insufficient.
No invented tag/hash is committed here. A source integration checkout is not a
replacement for this public artifact.

## Live evidence and limits

These are observations from retained development integration sessions, not
registry-only acceptance of the final public artifacts. All three sessions were
closed, their owned consumers retired, and the original project files restored
or verified unchanged by hash. Evidence is retained under `/tmp/model-play-frames`.

- **W44:** valid/broken/fixed saves of the HUD and Play script while stopped and
  playing passed all 12 checks without a page reload or Chat state loss. One real
  boost turn finished without a permission prompt or follow-up. Driving
  measured 108 km/h normally, 132 with left Shift and 121 with right Shift; the
  requested 162 km/h cap was not exercised.
- **W50:** Supercode `29d8fac99` on integration `a394e21a` completed one real HUD
  turn (native duration 9 seconds, no permission prompt or follow-up).
  Play visibly showed bottom-right speed and JUMP while airborne.
  The generic New Session button still opened an unbound draft; the provider's
  own creation command worked. A control-command timeout while its manual picker
  was open is retained as a qualification. W50 did not validate the later
  generic New Session repair. The Play frame is `w50-hud-jump.png`.
- **W58:** integration `2cbd0bd8`, Supercode `f2bc8508e`, and the W56/W57
  extension/overlay/native compile on Code-OSS `f16dc165` passed the visible
  sidebar New Session picker and one completed creation into a bound conversation.
  Cancel preserved the existing conversation/resource, catalogue, connection, layout and
  `@ClaudeCode ` draft prefix. Longer-draft preservation was not exercised: its
  setup used an unsupported automation fill method, with the error retained and
  no retry. No native review tabs were open, so preservation of open review tabs
  remains unexercised. Frames include `w58-new-picker.png` and `w58-cancel.png`.

Signed-out/install transitions, recovery from real failed discovery/attachment,
nonempty draft/review-tab cancellation, and fresh registry-only creation/Chat/Play
with the final public extension and workbench remain release checks. W58's
no-Send walk does not re-prove W50's real-turn behavior on the newest bytes.

## Remaining acts, in order

Commands below are an operator checklist, **not authorization to execute them**.
Builds/tests/installed acceptance require their own granted capacity and run through
the intended World. Publish only reviewed public source; retain notices and the
Blender corresponding-source/artifact mapping.

1. **Fixed Supercode extension: complete.** PR1032 is merged and the SDK job
   published verified frontend-vscode **0.1.17**, now pinned with its actual
   registry tarball/integrity. The attachment client remains **0.2.7**. The
   packed-byte/source evidence is above. Do not dispatch a duplicate publication.

2. **Prepare and publish the public Model Editor workbench.** Editor PR40
   and PR43 are merged on main through `9b098916` and integrated into this branch.
   The scaffold declares the playable tools and default Track document; the overlay
   includes the provider New Chat/cancel fixes described above. The real fixed
   extension and lock entry are now committed. With granted build capacity, materialize that exact published dependency and cut (without publishing):

   ```sh
   volter world run -- node scripts/workbench/build-release.mjs --product model-editor --platform darwin-arm64 --checkout "$CODE_OSS_CHECKOUT" --work "$MODEL_WORKBENCH_WORK" --out "$MODEL_WORKBENCH_OUT"
   ```

   `CODE_OSS_CHECKOUT` must be at `packages/editor-core/workbench/FORK.json`'s exact
   public source commit; work/output must be dedicated disposable directories.
   The script replaces its work directory. Build from a clean committed editor
   revision, with no private look tier; inspect BUILD.json, extension version,
   source mapping, licenses and measured installed behavior. Then the publication is:

   ```sh
   volter world run -- node scripts/workbench/build-release.mjs --publish --out "$MODEL_WORKBENCH_OUT"
   ```

   This uploads the immutable tarball and BUILD.json to `volter-ai/code-oss`.
   Commit the returned actual release tag and SHA256 to Model Editor's manifest.
   Verify anonymous access. Rebuild/check/measure the final pinned source before
   the npm promotion; these checks must not silently use the integration checkout.

3. **Publish the entire editor release with ONE promotion.** After the prerequisites,
   merge the preparation and final pins to main, record the exact measured source
   SHA, and ensure no previous publish run is active. Fetch `publish` if it exists;
   reconcile its prior version commits into the measured promotion without a force
   push, then measure the resulting source. Promote only that exact commit:

   ```sh
   git push origin "$MEASURED_EDITOR_SHA":refs/heads/publish
   ```

   The updated workflow handles both branch creation and subsequent pushes. It
   builds/checks the 19-package release and publishes all missing versions using
   `npm publish --access public --provenance --ignore-scripts`, then verifies
   registry visibility. Do not also dispatch the workflow or manually publish its
   packages. This is the single editor-release trigger, not a cross-repository
   replacement for prerequisite extension/workbench publication.

4. **Only if npm stages accepted packages:** the owner lists and approves exactly
   the versions from the run with `npx npm@latest stage list <package>` and
   `npx npm@latest stage approve <id>` (2FA). Approval makes staged bytes public;
   do not blindly approve superseded versions. Verify every release version is
   anonymously served, then run fresh registry-only playable creation/Chat/Play
   acceptance in an authorized slot. Only then release the README/launch gate.
