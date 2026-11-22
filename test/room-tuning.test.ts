import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSweep, recommendTuning, sweepSamples } from '../src/roomTuning.ts';
import { captureSweep } from '../src/captureSweep.ts';
import { createSweepPlayback, verifySweepPlayback } from '../server/roomTuning.ts';
import type { SpeakerState } from '../src/speaker.ts';

const sampleRate = 24000;

test('accepts a complete clean measurement with only the built-in lead-in and tail', () => {
  const levels = analyzeSweep(sweepSamples(sampleRate), sampleRate);
  assert.ok(Math.abs(levels.bass - levels.treble) < 0.2);
});

test('does not mistake continuous background notes for the scheduled speaker tones', () => {
  const silentTones = sweepSamples(sampleRate, { bass: 0, mid: 0, treble: 0 });
  const recording = new Float32Array(silentTones.length + sampleRate);
  recording.set(silentTones);
  for (const hz of [100, 160, 250, 500, 800, 1250, 2000, 3150, 5000]) {
    for (let i = 0; i < recording.length; i++) recording[i] += 0.006 * Math.sin(2 * Math.PI * hz * i / sampleRate);
  }
  assert.throws(() => analyzeSweep(recording, sampleRate), /quiet or noisy/i);
});

test('skips a stray marker-like sound before the real sweep', () => {
  const clean = sweepSamples(sampleRate);
  const recording = new Float32Array(sampleRate * 3 + clean.length);
  recording.set(clean.subarray(0, Math.floor(0.56 * sampleRate)));
  recording.set(clean, sampleRate * 2);
  const levels = analyzeSweep(recording, sampleRate);
  assert.ok(Math.abs(levels.bass - levels.mid) < 0.2);
});

test('cuts only excess present at all three positions, including when a majority agrees', () => {
  const original = { bass: 0, mid: 1, treble: -1 };
  const positions = [-2, 7, 7].map((bass) => ({ bass, mid: 0, treble: 6 }));
  assert.deepEqual(recommendTuning(positions, original), { bass: 0, mid: 1, treble: -4 });
});

test('cancelling while microphone permission is pending releases a late grant without starting playback', async (t) => {
  let grant!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>((resolve) => { grant = resolve; });
  let closed = false;
  let stopped = false;
  class FakeAudioContext {
    resume() { return Promise.resolve(); }
    async close() { closed = true; }
  }
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: () => permission } });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'AudioContext');
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });
  const controller = new AbortController();
  let played = false;
  const capture = captureSweep(async () => { played = true; }, controller.signal);
  controller.abort();
  await assert.rejects(capture, { name: 'AbortError' });
  assert.ok(closed);
  grant({ getTracks: () => [{ stop: () => { stopped = true; } }] } as unknown as MediaStream);
  await permission;
  assert.ok(stopped);
  assert.equal(played, false);
});

test('reads the delivered PCM sweep after resampling, a short reflection and microphone noise', () => {
  const address = '192.168.8.12';
  const playback = createSweepPlayback();
  const wave = playback.read(playback.issue(address), address)!;
  const inputRate = wave.readUInt32LE(24);
  const outputRate = 48000;
  const length = (wave.length - 44) / 2;
  const samples = new Float32Array(Math.ceil(length * outputRate / inputRate) + outputRate);
  const start = 13781;
  const echo = 631;
  let noise = 17;
  for (let i = 0; i < samples.length; i++) {
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    samples[i] += (noise / 2 ** 32 - 0.5) * 0.001;
    const t = (i - start) * inputRate / outputRate;
    const index = Math.floor(t);
    if (index < 0 || index + 1 >= length) continue;
    const a = wave.readInt16LE(44 + index * 2);
    const b = wave.readInt16LE(44 + (index + 1) * 2);
    const direct = (a + (t - index) * (b - a)) / 32768;
    samples[i] += direct;
    samples[i + echo] += direct * 0.12;
  }
  const levels = analyzeSweep(samples, outputRate);
  for (const level of Object.values(levels)) assert.ok(Math.abs(level + 24) < 2);
});

test('detects an offset sweep and identifies broad excess bass', () => {
  const start = sampleRate * 2;
  const sweep = sweepSamples(sampleRate, { bass: 1, mid: 0.5, treble: 0.5 });
  const recording = new Float32Array(start + sweep.length + sampleRate);
  recording.set(sweep, start);
  const result = analyzeSweep(recording, sampleRate);
  assert.ok(result.bass - result.mid > 5.5);
  assert.ok(Math.abs(result.mid - result.treble) < 0.25);
  assert.deepEqual(recommendTuning([result, result, result], { bass: 0, mid: 1, treble: -1 }), { bass: -3, mid: 1, treble: -1 });
});

test('only issues the test sweep to the intended speaker and refuses overlapping sweeps', () => {
  const playback = createSweepPlayback();
  const address = '192.168.8.12';
  const token = playback.issue(address);
  assert.equal(playback.read(token, '192.168.8.13'), undefined);
  assert.equal(playback.read('wrong.wav', address), undefined);
  const wav = playback.read(token, address);
  assert.equal(wav?.subarray(0, 4).toString(), 'RIFF');
  assert.equal(wav?.readUInt32LE(40), wav!.length - 44);
  assert.throws(() => playback.issue(address), /in progress/i);
});

test('sweep playback only runs on an ungrouped, idle, unmuted network input at low volume', () => {
  const state: SpeakerState = { name: 'Test', model: null, firmware: null, source: 'Idle', status: 'Idle',
    volume: 20, muted: false, title: null, artist: null, input: 'wifi', inputs: ['wifi'], groupGuest: false };
  const group = { isGuest: false, members: [] };
  assert.doesNotThrow(() => verifySweepPlayback(state, group));
  assert.doesNotThrow(() => verifySweepPlayback({ ...state, status: 'Paused' }, group));
  assert.throws(() => verifySweepPlayback(state, { ...group, isGuest: true }), /ungroup/i);
  assert.throws(() => verifySweepPlayback({ ...state, input: 'aux' }, group), /Wi-Fi/i);
  assert.throws(() => verifySweepPlayback({ ...state, status: 'Playing' }, group), /pause or stop playback/i);
  assert.throws(() => verifySweepPlayback({ ...state, volume: 100 }, group), /25%/);
  assert.throws(() => verifySweepPlayback({ ...state, muted: true }, group), /unmute/i);
});

test('rejects silence, clipped recordings, and readings that disagree substantially', () => {
  assert.throws(() => analyzeSweep(new Float32Array(sampleRate * 9), sampleRate), /find the test/i);
  assert.throws(() => analyzeSweep(new Float32Array(sampleRate * 9).fill(1), sampleRate), /clipped/i);
  assert.throws(() => recommendTuning([
    { bass: 0, mid: 0, treble: 0 }, { bass: -15, mid: 0, treble: 0 }, { bass: 12, mid: 0, treble: 0 },
  ], { bass: 0, mid: 0, treble: 0 }), /didn’t agree/i);
});
