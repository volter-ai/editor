/**
 * HARBOR AT DUSK — menu loop.
 *
 * Brief: calm, warm, a little wistful; the title screen of a coastal game. D major, 80 BPM, 4/4.
 * 16 bars that loop seamlessly: A (bars 1–8) states the theme lightly; A′ (bars 9–16) restates it
 * higher and fuller, darkens for a moment on a borrowed iv (G minor, bar 15), and ends on a half
 * cadence (Asus4 → A) that leads back to bar 1.
 *
 * Ensemble: flute (the theme), clarinet (a sustained counter-line in A′), horn (inner swell in the
 * last four bars), harp (broken chords in A′), strings (the harmonic bed), cello (the bass line),
 * contrabass (doubles the bass an octave down in A′).
 *
 * `harbor.tsx` on the General MIDI SoundFont, moved note for note to VS Chamber Orchestra 2 CE
 * (`sounds/vsco2/*.sf3`), each track's level matched to the General MIDI render.
 */
import { Channel, Clip, Device, formatAt, formatPitch, Marker, Note, Point, Points, Project, Send, Track, Transport } from '@volter/dawproject';
import { voiceLead } from '../lib/music/voicing';

/**
 * HARMONY — two chords per bar (half notes), 16 bars. A is diatonic and settles on the tonic;
 * A′ lifts to F#m, darkens on the borrowed iv (Gm) in bar 15, and stops on the dominant with a
 * 4–3 suspension (Asus4 → A) so the loop falls back into bar 1.
 */
export const HARMONY: readonly (readonly [string, string])[] = [
  ['D', 'D'], ['Bm', 'Bm'], ['G', 'G'], ['A', 'A7'],
  ['Bm', 'Bm'], ['G', 'G'], ['Em', 'A'], ['D', 'D'],
  ['D', 'D'], ['F#m', 'F#m'], ['G', 'A'], ['D', 'D'],
  ['Em', 'Em'], ['Bm', 'Bm'], ['G', 'Gm'], ['Asus4', 'A'],
];

const HARP = voiceLead(HARMONY.flat(), 3, 57, 72);
// Lift the lowest tone on A and Gm: the pad rises against the falling flute.
const PAD = HARP.map((voicing, half) =>
  ['A', 'Gm'].includes(HARMONY.flat()[half]!)
    ? [...voicing.slice(1), voicing[0]! + 12]
    : voicing,
);

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** The root of a chord symbol as the pitch nearest the middle of [low, high]. */
function rootIn(symbol: string, low: number, high: number): number {
  const letter = symbol[0] ?? 'C';
  const shift = symbol[1] === '#' ? 1 : symbol[1] === 'b' ? -1 : 0;
  const pc = ((PITCH_CLASS[letter] ?? 0) + shift + 12) % 12;
  for (let pitch = low; pitch <= high; pitch++) if (pitch % 12 === pc) return pitch;
  return low;
}

export default function Harbor() {
  return (
    <Project>
      <Transport tempo={80} meter="4/4">
        <Points target="tempo">
          <Point at="15:3" value={80} />
          <Point at="16:4" value={72} />
        </Points>
      </Transport>
      <Marker at="1" name="A" />
      <Marker at="9" name="A′" />
      <Track name="Flute">
        <Channel volume={-0.9} pan={0.15}>
          <Device plugin="soundfont" name="Flute" params={{ bank: 'sounds/vsco2/flute.sf3', program: 73, articulations: { staccato: 99, staccatissimo: 99 } }} />
          <Device plugin="humanize" params={{ timingMs: 14, velocity: 0.05, seed: 73 }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 250, q: 0.7 }] }} />
          <Send to="Hall" level={-14} />
        </Channel>
        <Clip at="1" bars={8} name="Theme A">
          <Note at="1:1" pitch="F#5" dur="h" vel={0.6} />
          <Note at="1:3" pitch="E5" dur="q" vel={0.56} />
          <Note at="1:4" pitch="D5" dur="q" vel={0.54} />
          <Note at="2:1" pitch="D5" dur="q." vel={0.6} />
          <Note at="2:2.5" pitch="C#5" dur="8" vel={0.55} />
          <Note at="2:3" pitch="B4" dur="h" vel={0.58} />
          <Note at="3:1" pitch="B4" dur="q" vel={0.62} />
          <Note at="3:2" pitch="D5" dur="q" vel={0.68} />
          <Note at="3:3" pitch="G5" dur="q." vel={0.76} />
          <Note at="3:4.5" pitch="F#5" dur="8" vel={0.7} />
          <Note at="4:1" pitch="E5" dur="h." vel={0.66} />
          <Note at="5:1" pitch="F#5" dur="h" vel={0.62} />
          <Note at="5:3" pitch="E5" dur="q" vel={0.58} />
          <Note at="5:4" pitch="D5" dur="q" vel={0.56} />
          <Note at="6:1" pitch="D5" dur="q" vel={0.6} />
          <Note at="6:2" pitch="E5" dur="q" vel={0.64} />
          <Note at="6:3" pitch="G5" dur="h" vel={0.7} />
          <Note at="7:1" pitch="G5" dur="q" vel={0.66} />
          <Note at="7:2" pitch="F#5" dur="q" vel={0.62} />
          <Note at="7:3" pitch="E5" dur="q" vel={0.6} />
          <Note at="7:4" pitch="C#5" dur="q" vel={0.56} />
          <Note at="8:1" pitch="D5" dur="h." vel={0.58} />
          <Note at="8:4" pitch="A4" dur="q" vel={0.6} />
        </Clip>
        <Clip at="9" bars={8} name="Theme A′">
          <Note at="9:1" pitch="F#5" dur="h" vel={0.7} />
          <Note at="9:3" pitch="A5" dur="q" vel={0.74} />
          <Note at="9:4" pitch="F#5" dur="q" vel={0.68} />
          <Note at="10:1" pitch="E5" dur="q." vel={0.66} />
          <Note at="10:2.5" pitch="F#5" dur="8" vel={0.64} />
          <Note at="10:3" pitch="C#5" dur="h" vel={0.62} />
          <Note at="11:1" pitch="B4" dur="q" vel={0.66} />
          <Note at="11:2" pitch="D5" dur="q" vel={0.7} />
          <Note at="11:3" pitch="C#5" dur="q" vel={0.74} />
          <Note at="11:4" pitch="E5" dur="q" vel={0.8} />
          <Note at="12:1" pitch="A5" dur="h." vel={0.86} />
          <Note at="12:4" pitch="F#5" dur="q" vel={0.74} />
          <Note at="13:1" pitch="G5" dur="h" vel={0.76} />
          <Note at="13:3" pitch="F#5" dur="q" vel={0.7} />
          <Note at="13:4" pitch="E5" dur="q" vel={0.66} />
          <Note at="14:1" pitch="F#5" dur="q." vel={0.66} />
          <Note at="14:2.5" pitch="E5" dur="8" vel={0.6} />
          <Note at="14:3" pitch="D5" dur="h" vel={0.6} />
          <Note at="15:1" pitch="D5" dur="q" vel={0.62} />
          <Note at="15:2" pitch="B4" dur="q" vel={0.58} />
          <Note at="15:3" pitch="A#4" dur="h" vel={0.64} />
          <Note at="16:1" pitch="D5" dur="h" vel={0.6} />
          <Note at="16:3" pitch="C#5" dur="q" vel={0.56} />
          <Note at="16:4" pitch="E5" dur="q" vel={0.58} />
        </Clip>
      </Track>
      <Track name="Clarinet">
        <Channel volume={-14.8} pan={-0.25}>
          <Device plugin="soundfont" name="Clarinet" params={{ bank: 'sounds/vsco2/clarinet.sf3', program: 71, articulations: { staccato: 104, staccatissimo: 104 } }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 150, q: 0.7 }] }} />
          <Send to="Hall" level={-13} />
        </Channel>
        <Clip at="9" bars={8} name="Counter-line">
          <Note at="9:1" pitch="A3" dur="h" artic="legato" vel={0.5} />
          <Note at="9:3" pitch="D4" dur="h" artic="legato" vel={0.52} />
          <Note at="10:1" pitch="A3" dur="w" artic="legato" vel={0.55} />
          <Note at="11:1" pitch="D4" dur="h" artic="legato" vel={0.55} />
          <Note at="11:3" pitch="A3" dur="h" artic="legato" vel={0.58} />
          <Note at="12:1" pitch="A3" dur="h" artic="legato" vel={0.62} />
          <Note at="12:3" pitch="F#4" dur="h" artic="legato" vel={0.6} />
          <Note at="13:1" pitch="E4" dur="w" artic="legato" vel={0.58} />
          <Note at="14:1" pitch="D4" dur="h" artic="legato" vel={0.55} />
          <Note at="14:3" pitch="F#4" dur="h" artic="legato" vel={0.56} />
          <Note at="15:1" pitch="G4" dur="w" artic="legato" vel={0.6} />
          <Note at="16:1" pitch="A3" dur="h" artic="legato" vel={0.55} />
          <Note at="16:3" pitch="E4" dur="h" artic="legato" vel={0.5} />
        </Clip>
      </Track>
      <Track name="Horn">
        <Channel volume={-11.3} pan={0.3}>
          <Device plugin="soundfont" name="French Horn" params={{ bank: 'sounds/vsco2/horn.sf3', program: 60, articulations: { staccato: 108, staccatissimo: 108 } }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 80, q: 0.7 }] }} />
          <Send to="Hall" level={-11} />
        </Channel>
        <Clip at="13" bars={4} name="Swell">
          <Note at="13:1" pitch="B3" dur="w" vel={0.45} />
          <Note at="14:1" pitch="B3" dur="w" vel={0.55} />
          <Note at="15:1" pitch="B3" dur="h" vel={0.62} />
          <Note at="15:3" pitch="D4" dur="h" vel={0.66} />
          <Note at="16:1" pitch="A3" dur="w" vel={0.58} />
        </Clip>
      </Track>
      <Track name="Harp">
        <Channel volume={-5.7} pan={-0.35}>
          <Device plugin="soundfont" name="Harp" params={{ bank: 'sounds/vsco2/harp.sf3', program: 46 }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 90, q: 0.7 }] }} />
          <Send to="Hall" level={-15} />
        </Channel>
        <Clip at="9" bars={8} name="Broken chords">
          {HARP.slice(16).flatMap((voicing, half) => {
            const [low = 62, middle = 66, high = 69] = voicing;
            // Begin on the middle tone so chord changes do not shadow the other lines.
            return [middle - 12, low - 12, high - 12, middle].map((pitch, step) => (
              <Note key={`${half}-${step}`} at={formatAt(32 + half * 2 + step * 0.5, 4)} pitch={formatPitch(pitch)} dur="8" vel={step === 0 ? 0.5 : 0.4} />
            ));
          })}
        </Clip>
      </Track>
      <Track name="Strings">
        <Channel volume={-12.1} pan={0}>
          <Device plugin="soundfont" name="Strings" params={{ bank: 'sounds/vsco2/violins.sf3', program: 48, articulations: { staccato: 80, staccatissimo: 80, pizzicato: 45, tremolo: 44 } }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 120, q: 0.7 }] }} />
          <Send to="Hall" level={-12} />
        </Channel>
        <Clip at="1" bars={16} name="Pad">
          <Points target="cc11">
            <Point at="1:1" value={0.72} />
            <Point at="8:1" value={0.8} />
            <Point at="9:1" value={0.7} />
            <Point at="12:1" value={1} />
            <Point at="15:1" value={0.92} />
            <Point at="16:4" value={0.72} />
          </Points>
          {PAD.flatMap((voicing, half) =>
            voicing.map((pitch) => <Note key={`${half}-${pitch}`} at={formatAt(half * 2, 4)} pitch={formatPitch(pitch)} dur="h" vel={0.42} />),
          )}
        </Clip>
      </Track>
      <Track name="Cello">
        <Channel volume={-11.4} pan={0.2}>
          <Device plugin="soundfont" name="Cello" params={{ bank: 'sounds/vsco2/cellos.sf3', program: 42, articulations: { staccato: 86, staccatissimo: 86, pizzicato: 87, tremolo: 88 } }} />
          <Device plugin="humanize" params={{ timingMs: 14, velocity: 0.05, seed: 42 }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 55, q: 0.7 }] }} />
          <Send to="Hall" level={-18} />
        </Channel>
        <Clip at="1" bars={16} name="Bass line">
          <Note at="1:1" pitch="D3" dur="h" vel={0.62} />
          <Note at="1:3" pitch="A2" dur="h" vel={0.55} />
          <Note at="2:1" pitch="D3" dur="h" vel={0.6} />
          <Note at="2:3" pitch="F#2" dur="h" vel={0.54} />
          <Note at="3:1" pitch="G2" dur="h" vel={0.62} />
          <Note at="3:3" pitch="B2" dur="h" vel={0.58} />
          <Note at="4:1" pitch="E3" dur="h" vel={0.62} />
          <Note at="4:3" pitch="C#3" dur="h" vel={0.56} />
          <Note at="5:1" pitch="B2" dur="h" vel={0.6} />
          <Note at="5:3" pitch="D3" dur="h" vel={0.54} />
          <Note at="6:1" pitch="G2" dur="h" vel={0.6} />
          <Note at="6:3" pitch="F#2" dur="q" vel={0.54} />
          <Note at="6:4" pitch="E2" dur="q" vel={0.54} />
          <Note at="7:1" pitch="E2" dur="h" vel={0.6} />
          <Note at="7:3" pitch="A2" dur="h" vel={0.58} />
          <Note at="8:1" pitch="D3" dur="h." vel={0.6} />
          <Note at="8:4" pitch="F#2" dur="q" vel={0.54} />
          <Note at="9:1" pitch="D3" dur="w" vel={0.68} />
          <Note at="10:1" pitch="F#2" dur="h" vel={0.64} />
          <Note at="10:3" pitch="C#3" dur="h" vel={0.6} />
          <Note at="11:1" pitch="G2" dur="h" vel={0.66} />
          <Note at="11:3" pitch="A2" dur="h" vel={0.64} />
          <Note at="12:1" pitch="F#2" dur="h" vel={0.7} />
          <Note at="12:3" pitch="D3" dur="h" vel={0.62} />
          <Note at="13:1" pitch="E2" dur="w" vel={0.66} />
          <Note at="14:1" pitch="B2" dur="h" vel={0.64} />
          <Note at="14:3" pitch="A2" dur="h" vel={0.6} />
          <Note at="15:1" pitch="G2" dur="w" vel={0.66} />
          <Note at="16:1" pitch="A2" dur="w" vel={0.62} />
        </Clip>
      </Track>
      <Track name="Contrabass">
        <Channel volume={-6.9} pan={0.25}>
          <Device plugin="soundfont" name="Contrabass" params={{ bank: 'sounds/vsco2/contrabass.sf3', program: 43, articulations: { staccato: 90, staccatissimo: 90, pizzicato: 91, tremolo: 92 } }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 35, q: 0.7 }] }} />
          <Send to="Hall" level={-24} />
        </Channel>
        <Clip at="9" bars={8} name="Roots">
          {HARMONY.slice(8).map(([first], bar) => (
            <Note key={bar} at={`${bar + 9}:1`} pitch={formatPitch(rootIn(first, 28, 39))} dur="w" vel={0.58} />
          ))}
        </Clip>
      </Track>
      <Track name="Hall">
        <Channel role="effect" volume={-4}>
          <Device plugin="convolution" params={{ ir: 'ir/Musikvereinsaal.wav', predelay: 20 }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 180, q: 0.7 }, { type: 'highShelf', freq: 7000, gain: -3 }] }} />
        </Channel>
      </Track>
      <Track name="Master">
        <Channel role="master">
          <Device plugin="compressor" params={{ threshold: -34, ratio: 1.5, attack: 40, release: 300, knee: 8, makeup: 0 }} />
          <Device plugin="limiter" params={{ ceiling: -1, release: 80 }} />
        </Channel>
      </Track>
    </Project>
  );
}
