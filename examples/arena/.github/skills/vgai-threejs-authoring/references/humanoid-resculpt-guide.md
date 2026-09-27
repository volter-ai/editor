# Humanoid resculpt guide — the spec surface

How to turn the humanoid into a different character — a goblin, a
child, a brawler — by editing DATA ONLY. Every path below is under
`src/lib/humanoid/`, which `vgai add humanoid` copies into your project; a
fresh scaffold has none of it. The body engine
(`src/lib/humanoid/body-engine.ts`) owns topology, rig wiring, and
skinning math; you never touch it. Everything visual lives in a SCULPT SPEC
— one per body lane: `body-spec-lowpoly.ts` (the `default` character) and
`body-spec-smooth.ts` (`smooth`); the worked resculpt proof,
a full goblin, lives in the engine's e2e fixtures at
`packages/engine/e2e/humanoid-lineup/goblin-base.ts`). Spread the seed and
override sections — or copy tables for far-diverging proportions — edit
numbers, render in the line-up/turntable, repeat.

Units: metres at reference scale (~1.83 m rig). Stature is NOT sculpted —
it comes from `HumanoidParams` (height, legLength, armLength, torsoLength,
headSize, shoulderWidth, hipWidth, limbThickness, torsoGirth), ordinary
engine params a game requests; the spec sculpts SHAPE at whatever stature
the params produce (the e2e goblin fixture carries a worked stature).

## Palette + slots — clothing is data

`palette: { name: hexColor }` declares this spec's own color vocabulary
('skin', 'shirt', 'trousers', 'shoes', 'hair', 'eye', 'brow' — or none of
those: the goblin has 'skin', 'loincloth'). Every part/ring/station
references a slot BY NAME; a ring row without a `slot` inherits the previous
row's, so a clothing boundary (cuff, hem, waistband) is exactly one
edge-loop annotation — see the smooth spec's arm cuff (`['EH', …, 'skin']`
ends the shirt) and hip ring (`slot: 'trousers'` starts the trousers).
Undressing a character = removing clothing slots from the palette and
re-annotating rings with skin (that is literally the whole goblin undress
diff). The engine has no clothing-shaped fields.

## The trunk and limbs — profile stations

- **UpperBodySpec / LowerBodySpec**: the welded trunk (chest→shoulders→arm
  tubes) and pants topology (hip block→crotch seam→leg tubes). Ring rows:
  `{ d|t, hx, hz, ox?, oz?, slot? }` — `hx`/`hz` are cross-section
  half-widths (x = side-to-side, z = front-to-back), `ox`/`oz` recenters a
  ring (belly pot: increase hz + push oz forward on waist rings — the goblin
  does exactly this), `slot` re-dresses from that loop on.
- **LimbStation** (arms/legs): `{ seg: 0|1, t, r, slot? }` — seg picks the
  bone (0 proximal, 1 distal), `t` the fraction along it (may overshoot),
  `r` the ring radius. The biceps swell/thin wrist/calf bulge are just
  radius sequences; copy the smooth spec's and scale.
- **AxisPartSpec** (neck, hands, simple parts): one-axis loft with
  `sides`, `rings: SpecRing[]`, one `slot`, chain skinning fields
  (`chain`/`boundaryJoints`/`blend`) you normally copy unchanged.
- **FootSpec / ThumbSpec**: same station idea; the shoe read is the foot
  part's `slot`.

`smooth: true|false` on the spec picks indexed-smooth vs faceted emission —
the entire smooth/faceted style split is this flag plus side counts.

## The head — scalp, hair, face kit

- **ScalpHeadSpec**: the skull is an EXACT ANALYTIC ELLIPSOID
  (`{ center, radii }` in the head's roll-pinned frame: origin at the Head
  joint, +Y up, +Z backward, scaled by heightFactor × headSize). Resculpt
  the skull by moving center/radii (goblin: radii x/z up, y down, center
  lower = wide flat skull). Everything downstream (hair, hats,
  scalp-mounted features) tracks this surface automatically.
- **HairCapSpec**: the hair is the scalp solidified outward by `offset`,
  clipped at `hairline: { front, side, back }` — three scalp elevations
  (u ∈ roughly [-1, 1]) that a quadratic guide sweeps through; raise them
  for a receding line, lower for shaggy. `hairlineTop` (optional) adds a
  SECOND guide clipping from above: hair exists only in the band between
  the two lines — bald crown with a fringe, tonsure, temple wedges
  (`body-spec-balding.ts` is the worked variant; needs `rows ≥ 4`; where
  top ≤ bottom the band collapses and that sector is bald). Omit `hairCap`
  entirely for bald (goblin).
- **FacePartSpec** (eyes, brows, nose, ears, horns…): small lofts anchored
  to the skull. Key fields: `ax`/`ay` place the anchor, `hx`/`hz` size the
  feature, `rings` shape it, `slot` colors it.
  - `axis: 'front' | 'left' | 'right'` (default 'front') — the loft
    direction. 'left'/'right' mount SIDEWAYS: pointed ears, horns. For side
    mounts, `hx` spans vertical and `hz` depth (the ±X roll-pinned frame),
    and `zOff` places the feature fore/aft on the head.
  - `mount: 'scalp'` + `surfaceInset` — project the anchor onto the analytic
    scalp and bury the base `surfaceInset` inside it. This is the
    RESCULPT-SAFE mode: re-sculpt the skull and scalp-mounted features
    re-seat themselves with zero per-feature tuning. `zInset` is the legacy
    manual mode (the smooth/goblin eyes/brows/nose still use it — converting
    them would move today's faces; use `mount: 'scalp'` for everything NEW).

## Hats and headwear — the scalp-fit API

One call fits headwear to ANY skull, hair included:

```ts
import { scalpFitFrame } from './humanoid'; // or scalp-fit.ts directly
const frame = scalpFitFrame(rig, { offset: 0.01 });
// frame.center / frame.radii (scalp + hair envelope + offset) /
// frame.point(theta, phi) — build ON this surface and clearance from both
// skull AND hair is guaranteed by construction.
```

The frame MEASURES the built hair geometry (`hairShell` = the hair's proud
envelope; `hairMinPhi` = how far down hair sits proud): a hat built on
`frame.point(...)` clears the hair, and `frame.hairMinPhi` tells a
crown/skirt how far down to extend so side/back hair is enclosed rather
than poking out beside the crown (the worked demo: `assets/hat-demo.ts`,
176–240 tris, fits template and goblin from the same call). Bald rigs
degrade to the pure scalp fit. `fitHatToScalp(geometry, frame)` radially
pushes independently-authored geometry onto the offset surface. Note the
guarantee covers scalp+hair — NOT face-kit protrusions (heavy brows, ears);
keep a brim's elevation (`brimPhi`-style parameter) above them or check the
render.

## Worked resculpt: the goblin diff

Read the goblin spec (engine checkout:
`packages/engine/e2e/humanoid-lineup/goblin-base.ts`) top-to-bottom against
`body-spec-smooth.ts` — it is the canonical proof that a creature is a data
diff:

1. `GOBLIN_PARAMS` — stature (short, long arms, big head).
2. Palette — green skin + dark loincloth; shirt/trousers/shoes slots
   DELETED (bare-skinned is palette + slot annotations, nothing else).
3. Skull — wider/flatter ellipsoid (radii + center edits).
4. Trunk rings — pot belly (waist hz/oz), squat proportions.
5. Face — hooked nose (ring offsets), heavy brows, pointed side-mounted
   ears (`axis: 'left'/'right'` + `mount: 'scalp'`).
6. `hairCap` omitted — bald.

Every one of those is numbers in one file. If you find yourself wanting an
engine edit, the answer is almost always a spec field you haven't found yet
— or a genuine kit gap worth reporting, not patching around.

## Verify while you sculpt

Render after every meaningful edit (the turntable protocol in SKILL.md):
the humanoid line-up page (`packages/engine/e2e/humanoid-lineup/`, port
5321) renders your figure NEXT TO the shipped ones — `?focus=<i>` solos,
`?zoom=head|hips|…` closes in, `?pose=bend` proves deformation; the
turntable (`packages/engine/e2e/turntable/capture.mjs`) renders any single
builder standalone. The golden-regression fingerprint test pins the shipped
smooth bodies byte-exactly — your new spec is a NEW file; if editing a
SHIPPED spec is really intended, expect that test to tell you exactly what
moved.
