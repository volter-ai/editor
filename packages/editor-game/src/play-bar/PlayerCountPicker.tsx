import { faUsers } from '@fortawesome/free-solid-svg-icons';
import {
  AnchoredMenu,
  Button,
  DisclosureIcon,
  EditorIcon,
  MenuItem,
  Text,
} from '@vgai/editor-sdk/widgets';
import { useRef, useState, useSyncExternalStore } from 'react';
import {
  desiredExtraInstances,
  setDesiredExtraInstances,
  subscribeExtraInstances,
} from '../play/play-mode';

/** The split view caps at four side-by-side seats — beyond that a single
 *  editor viewport is unreadable, and the multiplayer-verification path is
 *  bot-driven anyway (no human needs five keyboards). */
export const MAX_INSTANCES = 4;
/** Compatibility for the existing pure mapping tests; product vocabulary is
 * instance because a mount need not represent a player. */
export const MAX_PLAYERS = MAX_INSTANCES;

/** Total player seats → EXTRA instances beside the primary (clamped to
 *  1..MAX_PLAYERS). Pure so the mapping is unit-tested without React. */
export function extrasForPlayerCount(count: number): number {
  const clamped = Math.min(MAX_INSTANCES, Math.max(1, Math.floor(count)));
  return clamped - 1;
}

/** EXTRA instances → total player seats. */
export function playerCountFromExtras(extra: number): number {
  return extra + 1;
}

function instanceLabel(count: number): string {
  return count === 1 ? '1 instance' : `${count} instances`;
}

/**
 * Pick how many local runtime instances Play mounts side by side. Multiplayer
 * is the common use, but the same mounts also support seed/camera A/B work; the
 * editor therefore never calls them players or hides the mechanism behind a
 * networking capability.
 */
export function InstanceCountPicker() {
  const extra = useSyncExternalStore(
    subscribeExtraInstances,
    desiredExtraInstances,
    desiredExtraInstances,
  );
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const count = playerCountFromExtras(extra);
  return (
    <div className="vgai-playbar-popover-anchor">
      <Button
        ref={ref}
        variant="ghost"
        size="comfortable"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'vgai-player-count-menu' : undefined}
        onClick={() => setOpen((value) => !value)}
        title={`${instanceLabel(count)} — choose how many runtimes Play mounts side by side`}
      >
        <EditorIcon icon={faUsers} size="md" />
        <Text>Instances</Text>
        <Text variant="code">{count}</Text>
        <DisclosureIcon direction="down" />
      </Button>
      {open && (
        <AnchoredMenu
          id="vgai-player-count-menu"
          anchorRef={ref}
          gap={4}
          onDismiss={() => setOpen(false)}
        >
          {Array.from({ length: MAX_INSTANCES }, (_v, i) => i + 1).map((n) => (
            <MenuItem
              key={n}
              role="menuitemradio"
              aria-checked={n === count}
              onSelect={() => {
                setDesiredExtraInstances(extrasForPlayerCount(n));
                setOpen(false);
              }}
            >
              {instanceLabel(n)}
            </MenuItem>
          ))}
        </AnchoredMenu>
      )}
    </div>
  );
}

export const PlayerCountPicker = InstanceCountPicker;
