# @volter/editor-dawproject

The editor for a `@volter/dawproject` piece. A project declares it as a
dependency; its finder (`piecesFromModules`) makes every module that imports
`@volter/dawproject` and default-exports a component a piece document.

The document is laid out as Bitwig Studio's Arrange view: transport, arranger
(tracks, clips, markers), and a lower pane that switches between the selected
clip's editor (piano roll, velocity lane, one lane per `<Points>`, and Freeze,
which writes a generated clip out as literal notes), the selected track's
device chain (each device's `params`), and the mixer (a strip per channel:
fader, pan, mute, solo, send levels).

Every gesture writes the piece's own source, through the same JSX routes the
three.js and React lanes write through (`@volter/editor-react`): a drag writes
the literals on the element it touched; adding or removing a note or point is a
structural write. Each is one entry on the workbench's undo stack. A value the
source computes, or an element one source line renders many times (a `.map`),
is drawn as a ghost and refuses with the line that makes it.

The preview plays the piece with SpessaSynth in an AudioWorklet, through a Web
Audio mix graph built from the channels; the export renders the same
performance offline through the same mix (`src/mix/`): EQ and pan on the
specification's formulas, compressor and limiter as this package's own DSP in
both places, convolution reverb with one prepared impulse response. The two
mixes null against each other at −140 dB.

CLIs, under `tsx`:

| Script | What it does |
| --- | --- |
| `scripts/render-piece.ts` | Loop-ready 24-bit WAV (`smpl` loop), OGG, stems, loudness to a target (EBU R128), `report.json` with the bar lines; `--sections` adds a seamless loop per marker section, `--one-shot` renders a stinger |
| `scripts/check-piece.ts` | Clip bounds, whole bars, instrument ranges, parallel fifths and octaves, re-strikes |
| `scripts/view-piece.ts` | Every part beat by beat over a bar range; a generated note is marked `~` |
| `scripts/freeze-clip.ts` | Rewrites a clip's generated notes and lanes into literal elements, in place |
| `scripts/import-midi.ts`, `export-musicxml.ts`, `export-dawproject.ts` | Interchange |

AGPL-3.0-only.
