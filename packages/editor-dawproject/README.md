# @volter/editor-dawproject

The editor for a `@volter/dawproject` piece. A project declares it as a
dependency; its finder (`piecesFromModules`) makes every module that imports
`@volter/dawproject` and default-exports a component a piece document.

The document is laid out as Bitwig Studio's Arrange view: transport (play,
editable tempo and meter, loop, metronome), arranger (tracks, clips, markers,
a tempo row, a loop strip), and a lower pane that switches between the selected
clip's editor (piano roll, velocity lane, one lane per `<Points>`, and Freeze,
which writes a generated clip out as literal notes), the selected track's
device chain (each device's `params`), and the mixer (a strip per channel:
fader, pan, mute, solo, send levels).

In the arranger, a clip moves with its notes and lanes, resizes, and is added,
deleted and duplicated; markers are added, moved, renamed and deleted; a ruler
click sets where Play starts; tracks, devices and sends are added; a track's
mixer (volume, pan, each send) is automated on its own lanes across the
arrangement, which both mixes apply on one 5 ms grid (they null at −139.6 dB with
lanes moving). A channel's `<Lfo>`s swing its volume, pan or a send on the same grid, over
the lane where there is one (−139 dB null with four LFOs moving), edited as cards beside its
devices. A `<Track>` whose channel is `role="submix"` is a group: the tracks
inside it sum into its strip, drawn indented under it and nested in the DAWproject
export. A compressor's `sidechain` names the track its detector hears
(after that track's fader and pan), in both mixes, picked in its device card. A clip
holding `<Audio file offset gain>` plays a recording instead of notes (both mixes null at
−139.7 dB with one); its editor sets where in the file it starts and its level, and the
DAWproject export embeds the file. The Launch tab is the clip launcher: a column per
`<Scene>`, a `<ClipSlot>` per track, launched by scene or by slot on the next bar (tracks a
scene leaves out stop), with scenes and slots added, renamed and deleted in place;
`render-piece` renders each scene as a seamless loop for the game's music player, and the
DAWproject export carries them as its `Scenes`. Rec records what a person plays
(a MIDI controller, or the computer keyboard laid out as Bitwig's) into the selected track, heard
as it is played: on Stop the take is one edit, into the clip that holds it or a new "take" clip.
In the piano
roll, notes are selected (click, Shift-click, marquee, Cmd+A), moved and
resized together, snapped to a chosen grid, quantized, copied, cut, pasted,
duplicated and given an articulation. A gesture on several elements is one
whole-file edit and one undo entry, refused whole when any element it must
rewrite is generated.

Every gesture writes the piece's own source, through the same JSX routes the
three.js and React lanes write through (`@volter/editor-react`): a drag writes
the literals on the element it touched; adding or removing a note or point is a
structural write. Each is one entry on the workbench's undo stack; undo and
redo write only while the element still holds what the entry expects, so an
edit made since (by the person or the agent) is never overwritten, and a
gesture that writes several attributes puts back what it wrote if a later one
fails. A value the
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
| `scripts/render-piece.ts` | Loop-ready 24-bit WAV (`smpl` loop), OGG and AAC (`.m4a`), stems, loudness to a target (EBU R128), `report.json` with the bar lines and the checks; `--sections` adds a seamless loop per marker section, `--one-shot` renders a stinger. Byte-identical across runs |
| `scripts/check-piece.ts` | The checks: clip bounds, whole bars, instrument ranges, every note against the samples its bank has, parallel fifths and octaves, re-strikes, channel overflow, sends, solos, markers, equalizer bands. Then the analysis (`src/analysis.ts`): key and chords with their degrees per section, the cadence each ends on and the one its loop returns through, low close intervals, crossing parts, each melodic line's range, steps, leaps and repetition, and the share of its melodic figures the folder's other pieces already use |
| `scripts/view-piece.ts` | Every part beat by beat over a bar range; a generated note is marked `~` |
| `scripts/freeze-clip.ts` | Rewrites a clip's generated notes and lanes into literal elements, in place |
| `scripts/sfz-to-sf2.ts` | Builds a SoundFont bank from SFZ instruments, so a sampled library plays through the same engine; each track plays the bank its device names. Articulations become their own programs and round robins presets a bank up; what SFZ can say that a SoundFont cannot (keyswitches) is refused by name |
| `scripts/vsco2-ce.ts` | Fetches VS Chamber Orchestra 2 Community Edition (CC0) and builds its 20 instrument banks (`banks/vsco2-ce.json` is the program table) into `~/.volter/banks/vsco2-ce`, byte-identical on every build |
| `scripts/import-midi.ts`, `export-musicxml.ts`, `export-dawproject.ts` | Interchange |

AGPL-3.0-only.
