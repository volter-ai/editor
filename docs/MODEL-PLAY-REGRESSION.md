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
