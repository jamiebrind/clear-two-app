import { sweepSamples, sweepSeconds, tuningVolumeLimit } from './roomTuning.ts';
import { toneBands, validGain, type ToneSettings } from './tone.ts';
import type { SpeakerState } from './speaker.ts';
import type { GroupState } from './rooms.ts';

export const sweepLifetimeMs = Math.ceil((sweepSeconds + 5) * 1000);

export class TuningConflict extends Error {}

export function verifyTuningRoom(group: GroupState) {
  if (group.isGuest || group.members.length) throw new TuningConflict('Ungroup this speaker before tuning it.');
}

export function verifySweepPlayback(state: SpeakerState, group: GroupState, expectedVolume?: unknown) {
  verifyTuningRoom(group);
  if (state.input !== 'wifi' || !['Idle', 'Stopped', 'Paused'].includes(state.status)) {
    throw new TuningConflict('Select Wi-Fi / Network and pause or stop playback before measuring.');
  }
  if (state.muted !== false || state.volume === null || state.volume < 1 || state.volume > tuningVolumeLimit) {
    throw new TuningConflict(`Unmute the speaker and set its volume between 1% and ${tuningVolumeLimit}%.`);
  }
  if (expectedVolume !== undefined && expectedVolume !== state.volume) {
    throw new TuningConflict('Speaker volume changed between positions. Restore the original volume or start over.');
  }
  return state.volume;
}

export function parseTuningSettings(value: unknown): ToneSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== toneBands.length) return null;
  const settings = value as Record<string, unknown>;
  if (!toneBands.every((band) => validGain(settings[band]))) return null;
  return settings as ToneSettings;
}

export function createSweepWave(): Uint8Array {
  const rate = 44100;
  const samples = sweepSamples(rate);
  const length = samples.length * 2;
  const wav = new Uint8Array(44 + length);
  const view = new DataView(wav.buffer);
  const ascii = new TextEncoder();
  wav.set(ascii.encode('RIFF'), 0);
  view.setUint32(4, length + 36, true);
  wav.set(ascii.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wav.set(ascii.encode('data'), 36);
  view.setUint32(40, length, true);
  samples.forEach((sample, i) => view.setInt16(44 + 2 * i, Math.round(sample * 32767), true));
  return wav;
}
