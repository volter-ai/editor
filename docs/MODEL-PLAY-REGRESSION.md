# Model Play regression session B

Pending live verification after the integration build and a maintainer capacity grant.
These are additions to the pilot's session B checks. Run serially in the authorized
session, preserve the recording project, and restore any deliberately broken source.

1. **Material Preview visibility and lighting.** In a plain Model document with no Play/UI
   packages, use one viewport-visible mesh hidden from render and one viewport-hidden mesh
   visible to render. In Material Preview, exercise all four combinations of Scene World
   and Scene Lights. Mesh visibility must remain the viewport's in every combination; the
   World and scene lights must each follow their own switch. Check the scene lights' own
   visibility flags too. Switch to Rendered and take a scene-camera capture: render visibility
   must apply. Return to Material Preview and capture while previewing: the photograph uses
   render visibility, and the editing view restores its viewport visibility and lighting.

2. **First Play failure retries on a UI save.** Before first Play, introduce a syntax/import
   error in the project's declared DOM entry, then Play and observe the reported error.
   Fix and save only that UI file: Play must start with the HUD without Stop/Play or touching
   the play script. Repeat with an error in a HUD dependency. Also make the script's first
   update throw because of a value exported by a HUD dependency, after the UI layers have
   mounted; correcting and saving only that dependency must retry successfully. With a game
   already running, a failed replacement must retain the previous game/HUD and a later fix
   must replace them together, without duplicate layers or input listeners.

3. **Second area's view survives Play.** Split the Model viewport, leave the second area's
   initial scene-camera view, orbit/pan/zoom it and select a distinct shading mode. Record its
   camera pose and session identity. Play hides the second area and its header/shelf without
   disposing its viewport session. Escape returns to that same pose, projection and shading,
   without re-entering scene-camera view. Repeat with the header Stop control; then close the
   split and confirm its ordinary disposal still works. Check that Play occupies the viewport
   and that the restored split's controls address the correct area.

Save before/after frames and relevant public-door state alongside the existing evidence in
`/tmp/model-play-frames`. Record observed results and limitations; source inspection alone
does not close these checks.

4. **Project saves preserve the editor page and Chat.** Record the editor load ID, active
   Chat conversation/native resource and an unsent composer draft. With Play stopped and
   the UI board closed, save each starter-owned file in turn: `src/ui/game.tsx` (also its
   `race-hud.tsx` dependency), `src/models/canyon.play.ts`, and `src/models/canyon.py`. Use a
   valid visible change, then a temporary syntax/import error, then repair it. After every
   save, wait for story discovery/update completion: the load ID, conversation, draft,
   panel layout and second view must remain unchanged. Repeat while playing; the relevant
   document/Play owner may update its model/HUD or report an error, but the editor page and
   Chat must survive. Do not Send. Restore every file afterwards.

   Cover a cold session before first Play and a stopped session after Play/UI-board use;
   old epoch modules and background story discovery must not change the guarantee. Wait
   over 60 seconds before a second broken HUD edit: the old stale-chunk recovery throttle
   could conceal the reload defect for a minute. Capture each failure and repair and read
   the load ID independently. A project exception must remain reportable, not be swallowed
   as a deployment error. `canyon.py` is a source file, not a Vite JS module: saving it alone
   need not regenerate the blend or change the running scene.

   In a separately authorized disposable deployment check, remove a genuinely lazy hashed
   editor chunk after loading the old shell, then reach that lazy surface. A confirmed
   404/410 should still cause one deployment-recovery reload; a 500, offline request or
   project module exception should not. Do not remove chunks from the retained integration
   build. Source unit coverage: `packages/editor-core/test/stale-chunk-recovery.test.mjs`
   (Node 24); run through the World only when a test slot is granted.

5. **Registry-installed tools share the host SDK.** In a fresh directory outside any
   checkout, use the normal registry and the release's README create command with
   `--template playable`; no workspace links. Confirm Canyon opens, then Play must
   move the camera, mount the HUD and accept driving input; Escape must restore the
   editing view. Inspect the dependency cache: no SDK subpath may be an optimized
   entry or have its implementation inlined into another dependency's prebundle.
   Browser imports of SDK modules listed in `volter-shared-sdk.json` must use those
   host chunk URLs. The project-module change bus stays source-served for HMR.
   Repeat after a stop/reopen with an existing optimizer cache, and check a HUD
   save still updates Play without reloading Chat. Record install/cache provenance
   and console errors. A workspace-linked pass cannot substitute for this check:
   its realpaths outside `node_modules` bypass the optimizer path that failed in
   the registry-only 0.5.158 acceptance (`No project is open.` on first Play).
