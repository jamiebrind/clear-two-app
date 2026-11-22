import { randomUUID } from 'node:crypto';
import { sweepSamples, sweepSeconds, tuningVolumeLimit } from '../src/roomTuning.ts';
import { toneBands, type ToneSettings } from '../src/tone.ts';
import type { SpeakerState } from '../src/speaker.ts';
import type { GroupState } from '../src/rooms.ts';

export class TuningConflict extends Error {}

export function verifyTuningRoom(group: GroupState) {
  if (group.isGuest || group.members.length) throw new TuningConflict('Ungroup this speaker before tuning it.');
}

export function verifySweepPlayback(state: SpeakerState, group: GroupState) {
  verifyTuningRoom(group);
  if (state.input !== 'wifi' || !['Idle', 'Stopped', 'Paused'].includes(state.status)) {
    throw new TuningConflict('Select Wi-Fi / Network and pause or stop playback before measuring.');
  }
  if (state.muted !== false || state.volume === null || state.volume < 1 || state.volume > tuningVolumeLimit) {
    throw new TuningConflict(`Unmute the speaker and set its volume between 1% and ${tuningVolumeLimit}%.`);
  }
}

export function parseTuningSettings(value: unknown): ToneSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== toneBands.length) return null;
  const settings = value as Record<string, unknown>;
  if (!toneBands.every((band) => typeof settings[band] === 'number' && Number.isInteger(settings[band]) && Math.abs(settings[band]) <= 10)) return null;
  return settings as ToneSettings;
}

function createWave() {
  const rate = 44100;
  const samples = sweepSamples(rate);
  const length = samples.length * 2;
  const wav = Buffer.alloc(44 + length);
  wav.write('RIFF', 0); wav.writeUInt32LE(length + 36, 4);
  wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(length, 40);
  samples.forEach((sample, i) => wav.writeInt16LE(Math.round(sample * 32767), 44 + 2 * i));
  return wav;
}

export function createSweepPlayback() {
  let wave: Buffer | undefined;
  let current: { token: string; address: string; expires: number } | undefined;
  return {
    issue(address: string) {
      if (current && Date.now() < current.expires) throw new TuningConflict('A sweep is still in progress. Wait for it to finish.');
      const token = `${randomUUID()}.wav`;
      current = { token, address, expires: Date.now() + Math.ceil((sweepSeconds + 5) * 1000) };
      return token;
    },
    read(token: string, address?: string) {
      if (current?.token === token && current.address === address && Date.now() < current.expires) return wave ??= createWave();
    },
  };
}
