import type { GodotShortcut } from './shortcut';

export const GODOT_MIDI_MESSAGE_NONE = 0;
export const GODOT_MIDI_MESSAGE_NOTE_OFF = 8;
export const GODOT_MIDI_MESSAGE_NOTE_ON = 9;
export const GODOT_MIDI_MESSAGE_AFTERTOUCH = 10;
export const GODOT_MIDI_MESSAGE_CONTROL_CHANGE = 11;
export const GODOT_MIDI_MESSAGE_PROGRAM_CHANGE = 12;
export const GODOT_MIDI_MESSAGE_CHANNEL_PRESSURE = 13;
export const GODOT_MIDI_MESSAGE_PITCH_BEND = 14;
export const GODOT_MIDI_MESSAGE_SYSTEM_EXCLUSIVE = 240;
export const GODOT_MIDI_MESSAGE_QUARTER_FRAME = 241;
export const GODOT_MIDI_MESSAGE_SONG_POSITION_POINTER = 242;
export const GODOT_MIDI_MESSAGE_SONG_SELECT = 243;
export const GODOT_MIDI_MESSAGE_TUNE_REQUEST = 246;
export const GODOT_MIDI_MESSAGE_TIMING_CLOCK = 248;
export const GODOT_MIDI_MESSAGE_START = 250;
export const GODOT_MIDI_MESSAGE_CONTINUE = 251;
export const GODOT_MIDI_MESSAGE_STOP = 252;
export const GODOT_MIDI_MESSAGE_ACTIVE_SENSING = 254;
export const GODOT_MIDI_MESSAGE_SYSTEM_RESET = 255;

function midiByte(value: number, member: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 127) {
    throw new RangeError(`InputEventMIDI.${member} requires 0..127.`);
  }
  return value;
}

export class GodotInputEventMIDIResource {
  private channel = 0;
  private message = GODOT_MIDI_MESSAGE_NONE;
  private pitch = 0;
  private velocity = 0;
  private instrument = 0;
  private pressure = 0;
  private controllerNumber = 0;
  private controllerValue = 0;

  set_channel(channel: number): void { this.channel = midiByte(channel, 'channel'); }
  get_channel(): number { return this.channel; }
  set_message(message: number): void {
    if (!Number.isSafeInteger(message) || message < 0 || message > 255) throw new RangeError('InputEventMIDI.message requires byte.');
    this.message = message;
  }
  get_message(): number { return this.message; }
  set_pitch(pitch: number): void { this.pitch = midiByte(pitch, 'pitch'); }
  get_pitch(): number { return this.pitch; }
  set_velocity(velocity: number): void { this.velocity = midiByte(velocity, 'velocity'); }
  get_velocity(): number { return this.velocity; }
  set_instrument(instrument: number): void { this.instrument = midiByte(instrument, 'instrument'); }
  get_instrument(): number { return this.instrument; }
  set_pressure(pressure: number): void { this.pressure = midiByte(pressure, 'pressure'); }
  get_pressure(): number { return this.pressure; }
  set_controller_number(controllerNumber: number): void { this.controllerNumber = midiByte(controllerNumber, 'controller_number'); }
  get_controller_number(): number { return this.controllerNumber; }
  set_controller_value(controllerValue: number): void { this.controllerValue = midiByte(controllerValue, 'controller_value'); }
  get_controller_value(): number { return this.controllerValue; }

  is_pressed(): boolean {
    return this.message === GODOT_MIDI_MESSAGE_NOTE_ON && this.velocity > 0;
  }

  is_released(): boolean {
    return this.message === GODOT_MIDI_MESSAGE_NOTE_OFF || (this.message === GODOT_MIDI_MESSAGE_NOTE_ON && this.velocity === 0);
  }

  as_text(): string {
    return `MIDI channel=${this.channel} message=${this.message} pitch=${this.pitch} velocity=${this.velocity}`;
  }
}

export class GodotInputEventMagnifyGestureResource {
  private factor = 1;
  private position = { x: 0, y: 0 };

  set_factor(factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('InputEventMagnifyGesture.factor must be positive.');
    this.factor = factor;
  }
  get_factor(): number { return this.factor; }
  set_position(position: Readonly<{ x: number; y: number }>): void { this.position = { x: position.x, y: position.y }; }
  get_position(): Readonly<{ x: number; y: number }> { return this.position; }
}

export class GodotInputEventPanGestureResource {
  private delta = { x: 0, y: 0 };
  private position = { x: 0, y: 0 };

  set_delta(delta: Readonly<{ x: number; y: number }>): void { this.delta = { x: delta.x, y: delta.y }; }
  get_delta(): Readonly<{ x: number; y: number }> { return this.delta; }
  set_position(position: Readonly<{ x: number; y: number }>): void { this.position = { x: position.x, y: position.y }; }
  get_position(): Readonly<{ x: number; y: number }> { return this.position; }
}

export class GodotInputEventShortcutResource {
  private shortcut: GodotShortcut | null = null;

  set_shortcut(shortcut: GodotShortcut | null): void { this.shortcut = shortcut; }
  get_shortcut(): GodotShortcut | null { return this.shortcut; }
  is_pressed(): boolean { return this.shortcut?.has_valid_event() ?? false; }
  as_text(): string { return this.shortcut?.get_as_text() ?? ''; }
}

export function createGodotInputEventMIDI(): GodotInputEventMIDIResource {
  return new GodotInputEventMIDIResource();
}

export function createGodotInputEventMagnifyGesture(): GodotInputEventMagnifyGestureResource {
  return new GodotInputEventMagnifyGestureResource();
}

export function createGodotInputEventPanGesture(): GodotInputEventPanGestureResource {
  return new GodotInputEventPanGestureResource();
}

export function createGodotInputEventShortcut(): GodotInputEventShortcutResource {
  return new GodotInputEventShortcutResource();
}
