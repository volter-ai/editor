import type { CSSProperties } from 'react';
import type { ArenaState, WeaponKind } from '../arena-state';

const ink = '#f7f7f2';
const muted = '#aeb8bf';
const orange = '#f29632';
const danger = '#dc4c3f';
const shadow = '0 2px 5px rgba(5, 8, 10, .72)';
const panel: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(20, 27, 33, .91), rgba(35, 42, 47, .78))',
  border: '1px solid rgba(255, 255, 255, .18)',
  boxShadow: '0 10px 30px rgba(9, 13, 16, .24), inset 0 1px rgba(255, 255, 255, .06)',
  backdropFilter: 'blur(7px)',
};
const overline: CSSProperties = {
  color: muted,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '.16em',
  lineHeight: 1,
  textTransform: 'uppercase',
};

function Crosshair({ hit }: { hit: number }) {
  const line: CSSProperties = {
    position: 'absolute',
    background: 'rgba(255,255,255,.94)',
    borderRadius: 1,
    boxShadow: shadow,
  };
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 28,
        height: 28,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <span style={{ ...line, width: 2, height: 7, left: 13, top: 0 }} />
      <span style={{ ...line, width: 2, height: 7, left: 13, bottom: 0 }} />
      <span style={{ ...line, width: 7, height: 2, left: 0, top: 13 }} />
      <span style={{ ...line, width: 7, height: 2, right: 0, top: 13 }} />
      <span
        style={{
          position: 'absolute',
          width: 3,
          height: 3,
          left: 12.5,
          top: 12.5,
          borderRadius: '50%',
          background: ink,
          boxShadow: shadow,
        }}
      />
      {hit > 0.04 && (
        <div style={{ position: 'absolute', inset: -3, opacity: hit }}>
          {[45, 135, 225, 315].map((rotation) => (
            <span
              key={rotation}
              style={{
                position: 'absolute',
                left: 12,
                top: -1,
                width: 4,
                height: 9,
                borderTop: `2px solid ${orange}`,
                transformOrigin: '2px 15px',
                transform: `rotate(${rotation}deg)`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ minWidth: 76, textAlign: 'center' }}>
      <div style={overline}>{label}</div>
      <div
        style={{
          marginTop: 4,
          color: ink,
          fontSize: 22,
          fontWeight: 900,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value.toString().padStart(2, '0')}
      </div>
    </div>
  );
}

function WeaponStrip({ owned, active }: { owned: readonly WeaponKind[]; active: WeaponKind }) {
  const order: readonly WeaponKind[] = ['pistol', 'rifle', 'grenade'];
  const labels: Record<WeaponKind, string> = { pistol: 'SIDEARM', rifle: 'RIFLE', grenade: 'GL' };
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 5, marginBottom: 9 }}>
      {order.map((weapon, index) => {
        const available = owned.includes(weapon);
        const selected = weapon === active;
        return (
          <div
            key={weapon}
            style={{
              minWidth: 46,
              padding: '5px 7px 4px',
              color: selected ? '#1a2025' : available ? ink : '#788188',
              background: selected ? orange : 'rgba(255,255,255,.07)',
              border: `1px solid ${selected ? '#ffc06e' : 'rgba(255,255,255,.11)'}`,
              opacity: available ? 1 : 0.58,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 8, fontWeight: 900, lineHeight: 1 }}>
              {String(index + 1).padStart(2, '0')}
            </div>
            <div style={{ marginTop: 3, fontSize: 7, fontWeight: 850, letterSpacing: '.08em' }}>
              {labels[weapon]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface ArenaHudProps {
  readonly state: ArenaState;
}

/** Pure authored HUD page. Live game access belongs exclusively in the root connector. */
export function ArenaHud({ state }: ArenaHudProps) {
  const health = Math.max(0, Math.min(100, state.health));
  const weaponName = state.weapon === 'grenade' ? 'GRENADE LAUNCHER' : state.weapon.toUpperCase();
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        color: ink,
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        textShadow: shadow,
        userSelect: 'none',
      }}
    >
      {state.damagePulse > 0.01 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse at center, transparent 44%, rgba(154, 30, 20, .56) 100%)',
            opacity: state.damagePulse,
          }}
        />
      )}
      {!state.paused && <Crosshair hit={state.hitMarker} />}

      <div
        style={{
          ...panel,
          position: 'absolute',
          top: 20,
          left: '50%',
          display: 'flex',
          gap: 18,
          alignItems: 'center',
          padding: '10px 18px 9px',
          transform: 'translateX(-50%)',
          clipPath: 'polygon(7px 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%, 0 7px)',
        }}
      >
        <Score label="Frags" value={state.kills} />
        <div style={{ width: 1, height: 29, background: 'rgba(255,255,255,.2)' }} />
        <Score label="Falls" value={state.deaths} />
      </div>

      <div
        style={{
          ...panel,
          position: 'absolute',
          left: 28,
          bottom: 28,
          width: 246,
          padding: '13px 15px 14px',
          borderLeft: `3px solid ${health > 30 ? orange : danger}`,
          clipPath: 'polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={overline}>Combat integrity</div>
            <div style={{ marginTop: 6, fontSize: 13, fontWeight: 900, letterSpacing: '.04em' }}>
              VITALS
            </div>
          </div>
          <div
            style={{
              color: health > 30 ? ink : '#ff8176',
              fontSize: 32,
              fontWeight: 900,
              lineHeight: 0.9,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.ceil(health)}
          </div>
        </div>
        <div
          style={{
            height: 7,
            marginTop: 11,
            padding: 2,
            background: 'rgba(0,0,0,.43)',
            border: '1px solid rgba(255,255,255,.16)',
          }}
        >
          <div
            style={{
              width: `${health}%`,
              height: '100%',
              background: health > 30 ? 'linear-gradient(90deg, #d9781c, #ffb34f)' : danger,
              boxShadow:
                health > 30 ? '0 0 10px rgba(242,150,50,.35)' : '0 0 10px rgba(220,76,63,.4)',
            }}
          />
        </div>
      </div>

      <div
        style={{
          ...panel,
          position: 'absolute',
          right: 28,
          bottom: 28,
          width: 260,
          padding: '12px 15px 13px',
          borderRight: `3px solid ${orange}`,
          clipPath: 'polygon(10px 0, 100% 0, 100% 100%, 0 100%, 0 10px)',
        }}
      >
        <WeaponStrip owned={state.ownedWeapons} active={state.weapon} />
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={overline}>Equipped</div>
            <div
              style={{
                marginTop: 5,
                color: orange,
                fontSize: 11,
                fontWeight: 900,
                letterSpacing: '.1em',
              }}
            >
              {weaponName}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}
          >
            <strong style={{ fontSize: 42, fontWeight: 900 }}>{state.ammo}</strong>
            <span style={{ marginLeft: 7, color: muted, fontSize: 15, fontWeight: 700 }}>
              / {state.reserveAmmo}
            </span>
          </div>
        </div>
      </div>

      {state.message && !state.paused && (
        <div
          style={{
            ...panel,
            position: 'absolute',
            left: '50%',
            top: '62%',
            padding: '8px 15px 7px',
            borderBottom: `2px solid ${orange}`,
            transform: 'translateX(-50%)',
            color: ink,
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
          }}
        >
          {state.message}
        </div>
      )}
      {state.paused && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(18, 23, 27, .42)',
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              ...panel,
              minWidth: 300,
              padding: '28px 38px',
              borderTop: `3px solid ${orange}`,
              textAlign: 'center',
            }}
          >
            <div style={overline}>Simulation suspended</div>
            <div style={{ marginTop: 9, fontSize: 34, fontWeight: 900, letterSpacing: '.13em' }}>
              PAUSED
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
