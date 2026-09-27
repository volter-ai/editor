/**
 * VICTORY — the stinger a battle ends on. Two bars at Tidewatch's 112 BPM, played once over the
 * music (`render-piece --one-shot`): the dominant (A) turns to D major, horns rise to the tonic,
 * strings hold a tremolo, the timpani rolls into the last chord.
 */
import { Channel, Clip, Device, Note, Project, Send, Track, Transport } from '@volter/dawproject';

const VSCO = 'out/vsco2';

export default function Victory() {
  return (
    <Project>
      <Transport tempo={112} meter="4/4" />
      <Track name="Horns">
        <Channel volume={-6} pan={-0.2}>
          <Device plugin="soundfont" name="Horns" params={{ bank: `${VSCO}/horn.sf3`, program: 60 }} />
          <Send to="Hall" level={-12} />
        </Channel>
        <Clip at="1" bars={2} name="Arrival">
          <Note at="1:1" pitch="A3" dur="q" vel={0.8} artic="accent" />
          <Note at="1:2" pitch="C#4" dur="q" vel={0.82} />
          <Note at="1:3" pitch="E4" dur="q" vel={0.86} />
          <Note at="1:4" pitch="A4" dur="q" vel={0.9} />
          <Note at="2:1" pitch="F#4" dur="w" vel={0.92} artic="accent" />
          <Note at="2:1" pitch="D4" dur="w" vel={0.88} />
        </Clip>
      </Track>
      <Track name="Violins">
        <Channel volume={-6} pan={-0.35}>
          <Device plugin="soundfont" name="Violins" params={{ bank: `${VSCO}/violins.sf3`, program: 48, articulations: { tremolo: 44 } }} />
          <Send to="Hall" level={-12} />
        </Channel>
        <Clip at="1" bars={2} name="Tremolo">
          <Note at="1:1" pitch="E5" dur="w" vel={0.6} artic="tremolo" />
          <Note at="1:1" pitch="C#5" dur="w" vel={0.58} artic="tremolo" />
          <Note at="2:1" pitch="F#5" dur="w" vel={0.7} artic="tremolo" />
          <Note at="2:1" pitch="D5" dur="w" vel={0.68} artic="tremolo" />
        </Clip>
      </Track>
      <Track name="Cellos">
        <Channel volume={-7} pan={0.3}>
          <Device plugin="soundfont" name="Cellos" params={{ bank: `${VSCO}/cellos.sf3`, program: 42 }} />
          <Send to="Hall" level={-14} />
        </Channel>
        <Clip at="1" bars={2} name="Bass">
          <Note at="1:1" pitch="A2" dur="w" vel={0.75} />
          <Note at="2:1" pitch="D3" dur="w" vel={0.85} />
        </Clip>
      </Track>
      <Track name="Timpani">
        <Channel volume={-8}>
          <Device plugin="soundfont" name="Timpani" params={{ bank: `${VSCO}/timpani.sf3`, program: 116 }} />
          <Send to="Hall" level={-16} />
        </Channel>
        <Clip at="1" bars={2} name="Roll">
          <Note at="1:1" pitch="A2" dur="w" vel={0.55} />
          <Note at="2:1" pitch="D3" dur="h" vel={0.9} />
        </Clip>
      </Track>
      <Track name="Drums">
        <Channel volume={-12}>
          <Device plugin="soundfont" name="Percussion" params={{ bank: `${VSCO}/percussion.sf3`, program: 49, drums: true }} />
          <Send to="Hall" level={-18} />
        </Channel>
        <Clip at="1" bars={2} name="Crash">
          <Note at="2:1" pitch="C#3" dur="w" vel={0.85} />
        </Clip>
      </Track>
      <Track name="Hall">
        <Channel role="effect" volume={-4}>
          <Device plugin="convolution" params={{ ir: 'ir/Musikvereinsaal.wav', predelay: 18 }} />
        </Channel>
      </Track>
      <Track name="Master">
        <Channel role="master">
          <Device plugin="limiter" params={{ ceiling: -1 }} />
        </Channel>
      </Track>
    </Project>
  );
}
