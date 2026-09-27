# Godot-lane fidelity catalog — read this when working a fidelity cycle

**Trigger:** you are building or reviewing a Godot-lane fidelity fix (making a
translated game LOOK/SOUND/FEEL like the real engine, past successful generic import and live
editor verification).
This is the measured catalog of every divergence found in the 2026-08-13
platformer-3d characterization: five parallel audits (render/env, node census,
script+physics semantics, animation, audio/UI) diffed against the demo source,
plus two live instruments — an instrumented **real Godot 3.6** run of the demo
on this box (positions/yaw traced 120 sim-s, 4 screenshots) and a matching
headless trace of the port. Every item names its ground truth; fixes are
CLASS-level (emitter/compat), never fixture conditionals. Erase items here when
they ship (WORK.md rule: Done = erased). Erasure is verified against MAIN'S
CODE, not against PR titles — this catalog once carried camera/audio/touch
sections a parallel stream had already shipped, because nobody re-read main.

Ground-truth instruments (rebuild them freely; ~15 min). The scratchpad
Godot.app is patched LSUIElement=true AND ad-hoc re-signed (`codesign
--force --deep --sign -`) — a plist edit without re-signing gets the binary
SIGKILLed by macOS with zero output. Boot ONCE per batch, record everything
(owner-imposed); never occlude the window (stale frames).
- Godot 3.6 macOS binary + demo copy + `trace.gd` autoload (positions + Armature
  yaw at 2 Hz, screenshots, auto-quit). Run `--editor --quit` once first to
  build `.import/`.
- Generated-app mirror: import through the production command, then capture through the standard
  live editor/doctor surface at the same authored pose.
- The GLES3 color probe: unshaded 0.5-gray quad + N·L=0.5 Lambert quad,
  read back center pixels (results below).

## Measured verdicts that BOUND the campaign (do not re-litigate without a new measurement)

- **Enemy freeze is faithful.** Real 3.6 enemies also stop: travel decays to
  ~0 by t≈40s (one never moves at all), while Armature yaw sweeps continuously
  — "stationary spinners" is the real demo's own behavior, and it is
  run-to-run nondeterministic (one real run had an enemy shove the player ~20
  units; the next had everyone still). Only the decay PROFILE differs (port
  moves more in the first 20 s, then exact-0 where Godot keeps a 0.1–0.8 u/10s
  micro-creep). No fix item; recorded here so nobody re-opens it as a defect.
- **`albedo_color` on GLES3 is sRGB-decoded, like three.** Measured: unshaded
  0.5 gray reads back 0.4998 (round-trip identity) while a linear 0.5 (N·L=0.5,
  Lambert, white albedo) reads back 0.7349 = sRGB(0.5) — so readback is
  display-sRGB and the engine decoded the authored color. The port's hex
  emission is CORRECT; an audit claim that every mid-tone renders 20–40 % dark
  was refuted by this probe. `translate/data/spatial-material.ts`'s header cites
  GLES2 evidence — extend it with this GLES3 measurement, change no behavior.
- **Player physics matches.** Same fall, same resting y (−3.99 vs −3.98), same
  spot, both engines, no-input run.
- **Directional shadows and sun A/B match to one byte** (#1642). A controlled
  same-scene readback against the real binary: lit ground 217,221,232 vs
  218,222,232; shadowed 109,146,201 vs 108,146,200; HDR emissive core and rim
  byte-identical. The owner-reported "shadows too intense" was the inverse
  defect — the port had NO directional shadows (a ReflectionProbe capture
  permanently compiled every material shadow-free); the fix and its contract
  test live in `godot-compat/reflection-probe-3d.ts`. The π-factor hypothesis
  was refuted (three carries it on both sides).

## The catalog, ranked by what a viewer notices

Format: `id — defect → fix site (effort)`. File:line evidence lives in the
audit transcripts and re-derives in minutes; the fix MECHANISM is what is
binding here.

Shipped whole sections, verified against main's code: camera (current-camera
resolution project-wide, toplevel live-global bake, near/far/keep_aspect,
authored-parent walk), audio (one context through the engine's own
`setup-audio` buses, positional 3D with Godot's authored distance curve +
stereo SPCAP + unit_db/max_distance, exact `AudioEffectReverb` DSP in an
AudioWorklet), touch overlays (maxTouchPoints-gated, driving the same input
actions), physics interpolation (previous→current by the fixed-step
remainder), visibility enablers (authored `freeze_bodies` read), environment
(#1582/#1550/#1551/#1590), materials (#1601), animation (#1594), shadows
(#1642), and the authoring hierarchy arc (component-root/built-internal marks,
one-row instances, live drag + play-mode gizmo body routing).

### 1 · Script/physics — CLOSED (#1672 + #1679)
Everything measured shipped: slide-return (input velocity slid, v·n-gated),
infinite-inertia sweep filtering, sweep-honored exceptions, the small basket,
STEP intra-tick publishing (syncNativeBodies + area monitors per substep,
parent-first callbacks; frustum monitors stay on the render clock), GridMap
friction + physics_material_override carries, and gameplay behavior validated in the real engine.
The landing's bounding verdicts:
- **The old kill/coin facts asserted un-Godot fiction** — under the original
  schedule the real demo walks off the spawn ledge and completes neither hunt
  (3× byte-identical traces); they only ever passed on a floor slipperier
  than Godot's. The new closed-loop driver kills at 108.45 sim-s in the real
  engine; facts are sim-time-budgeted (load-independent), values cite traces.
- **PIT-ESCAPE refuted** — step-height parity is real (both engines stopped
  by the capsule radius; autostep verified off with a red-proof).
- **MOVING-PLATFORM FLOOR VELOCITY** stays the one open carry (no fixture
  exercises it; refuse nothing today) (S-M).

### 2 · Visual residue (same-pose characterization — #1682)
The 2026-08-13 characterization used a deterministic pose schedule against the real 3.6 binary
and the generated app, with same-pose projection proof and per-region byte tables. That campaign's
fixture-specific runner has been retired; current fidelity claims must be reproduced through the
production import and standard live editor/doctor evidence.
- **ENV-LUMINANCE — CLOSED (#1742).** The residue was the directional shadow
  box's LATERAL EXTENT (maxDistance/2 = 20 vs Godot's frustum-slice
  bounding-sphere fit ≈ 59); after implementing Godot's own
  SHADOW_ORTHOGONAL fit (verified against visual_server_scene.cpp by
  review, including Godot's ortho-camera branch that IGNORES maxDistance —
  a latent bug for isometric ports, fixed), the worst region went
  +18.4 → +0.2 bytes with no matched region regressing, tolerances
  tightened. Reach and shadowed-ambient leads REFUTED by sweep. NOTE: this
  entry's earlier numbers (+26…+46 ground) were the PRE-#1700 instrument's
  artifact — they reproduce exactly with the port's shadow pass off; a
  recorded measurement is only as good as the instrument version that took
  it (cite the instrument state with the numbers).
- **CHARACTER-REFLECTIVITY — REFUTED at play level (#1700).** The excess was
  the characterization capture path itself (bare renderer, no shadow pass —
  the host always enables PCFSoft shadows); with the instrument mirroring
  the host, the character matches within ±2 bytes and all three material
  hypotheses died by sphere decomposition (probe REPLACES base IBL — no
  double count; F0 is albedo-dominated at metallic 0.62; the roughness-0
  GGX difference is 14 sparkle pixels, not a sheen). The shaded-wall
  residues (+9.8/+18.4) belong to ENV-LUMINANCE above.
- **EDIT-MODE-IMAGE — CLOSED (#1729), hypothesis superseded by measurement.**
  Probes/composer contributed ZERO (design time runs no useFrame at all);
  the whole owner-visible defect was the world's declared renderer config
  never applying (duck-renderer guard) — now routed through the same
  applyWorldRendererConfig seam play mode uses, carried on the adoption
  LIFO, renderer properties only (chrome stays legible), with the un-apply
  path restored on adoption end. Bonus instrument fix: editor.screenshot()
  had been silently dropping tone mapping (plain render target) — now
  half-float + OutputPass, so the door reports what the canvas shows.
  Edit/play frames are byte-identical post-fix.
- **Particle colour — CLOSED (#1663 + #1728).** The trail (material colour
  never sampled by quarks — now per-particle) and the sprite texture decode
  (undecoded sRGB, +60/+73 bytes — now SRGBColorSpace at the factory, with
  the .import sampler flags carried through ParticlesDescriptor.mapSampler)
  both measured, fixed, and byte-matched against the real engine. The A/B
  tables live in cpu-particles-3d.ts's and particles-factory.ts's headers.

## Deferred renderer differences (owner-challenged 2026-08-14: NOT irreducible)
Formerly recorded as "irreducible floors" — the owner asked whether they are
truly unfixable and the answer is no: every one has a named mechanism, and
this lane already crossed the decisive bridge (the exact Filmic carry, the MR
channel-remap and probe-capture shader patches all modify three's own
program). What bounds them is COST vs visible payoff, so none earns a cycle
until a same-pose A/B through the standard generated-app surface shows it visibly contributes. Each with
its mechanism:
- **PCF13 vs PCFSoft kernel** — three's shadow sampling is a replaceable
  shader chunk (`shadowmap_pars_fragment`); implement Godot's 13-tap kernel
  through the existing patch seam. Compat-layer mimicry, Filmic-precedent.
- **Schlick-GGX vs smith-correlated GGX** (roughness-0 highlight shape) —
  patch the specular visibility term per godot-compat material. Same seam.
- **Box-projected reflection probes** — parallax-corrected cubemap sampling
  (patch the envmap reflect vector per-mesh inside the probe volume). Passes
  native-first POSITIVELY: native three games want BPCEM too, so this is a
  candidate HOST capability, not a Godot shim.
- **4-split PSSM** — cascaded shadow maps; three's own examples ship a CSM
  addon because native games need it, so a host-capability candidate.
  The #1682 promotion was SPENT by #1742: the answer was NOT cascades —
  the fixture authors `directional_shadow_mode = 0` (one split in the
  ground truth), and the coverage gap was the single split's mis-sized
  fit, now Godot-faithful. This fixture cannot measure PSSM at all;
  re-promote only from a fixture authoring split modes.
- **MSAA at runtime** — WebGL2 render targets take `samples`, so a game
  rendering through the composer can change MSAA without recreating the
  context; the manifest `rendering.antialias` route was the cheap escape,
  not the only one.
- **GLES2 gamma-composition** — moot: this project is GLES3 and the lane's
  focus is Godot 4.
The one genuinely bounded statement is economic: byte-parity on specular
under all conditions is an asymptote. Chase items here only with a reproducible same-pose
measurement in hand.
