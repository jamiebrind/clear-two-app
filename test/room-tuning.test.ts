import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeSweep, recommendTuning, sweepSamples } from '../src/roomTuning.ts';
import { createSweepPlayback, verifySweepPlayback } from '../server/roomTuning.ts';
import type { SpeakerState } from '../src/speaker.ts';

const sampleRate = 24000;

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
