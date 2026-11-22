import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMobileSound } from '../src/mobileSound.ts';
import type { ToneBand } from '../src/tone.ts';

const address = '192.168.1.44';
const original = { bass: 0, mid: 1, treble: 2 };
const target = { ...original, bass: -2, treble: -1 };

function simulator() {
  const settings = { ...original };
  const player = { mode: '0', type: '0', status: 'idle', vol: '19', mute: '0' };
  const played: string[] = [];
  const calls: { band: ToneBand; gain?: number; time: number }[] = [];
  const receiver = {
    async tone(options: { address: string; band: ToneBand; gain?: number }) {
      assert.equal(options.address, address);
      const { band, gain } = options;
      calls.push({ band, gain, time: performance.now() });
      if (gain !== undefined) settings[band] = gain;
      return { gain: settings[band] };
    },
    async serveSweep(options: { address: string; wav: string }) {
      assert.equal(options.address, address);
      const wav = Buffer.from(options.wav, 'base64');
      assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
      assert.equal(wav.readUInt32LE(24), 44100);
      assert.equal(wav.readUInt32LE(40), wav.length - 44);
      return { url: 'http://192.168.1.3:3456/test.wav' };
    },
  };
  const sound = createMobileSound(async (host, command) => {
    assert.equal(host, address);
    if (command === 'getStatusEx') return '{"DeviceName":"Living room"}';
    if (command === 'getPlayerStatus') return JSON.stringify(player);
    if (command === 'multiroom:getSlaveList') return '{"slaves":0}';
    if (command.startsWith('setPlayerCmd:play:')) { played.push(command); return 'OK'; }
    throw new Error('Unexpected command');
  }, receiver);
  return { sound, settings, calls, receiver, player, played };
}

test('mobile reads and writes are paced and a concurrent read cannot split a confirmed write', async () => {
  const { sound, calls, receiver } = simulator();
  const tone = receiver.tone;
  receiver.tone = async (options) => {
    // Opening a native TCP connection can take longer than the inter-command delay.
    if (options.gain !== undefined) await new Promise((resolve) => setTimeout(resolve, 260));
    return tone(options);
  };
  const change = sound.change(address, { band: 'mid', gain: -3 });
  const read = sound.read(address);
  assert.deepEqual(await change, { band: 'mid', gain: -3 });
  assert.deepEqual(await read, { bass: 0, mid: -3, treble: 2 });
  assert.deepEqual(calls.map(({ band, gain }) => [band, gain]), [
    ['mid', -3], ['mid', undefined], ['bass', undefined], ['mid', undefined], ['treble', undefined],
  ]);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].time - calls[i - 1].time >= 220);
});

test('mobile EQ restores a partial change after a write is applied and its reply is lost', async () => {
  const { sound, receiver, settings } = simulator();
  const tone = receiver.tone;
  receiver.tone = async (options) => {
    const result = await tone(options);
    if (options.band === 'treble' && options.gain === -1) throw new Error('Connection closed');
    return result;
  };
  await assert.rejects(sound.eq(address, { expected: original, target }), /previous settings were restored/i);
  assert.deepEqual(settings, original);
});

test('mobile EQ rejects stale settings, malformed profiles and grouped speakers before writing', async () => {
  const { sound, calls, player } = simulator();
  await assert.rejects(sound.eq(address, { expected: target, target: original }), /changed since/i);
  await assert.rejects(sound.eq(address, { expected: original, target: { ...target, mid: 11 } }), /valid EQ/i);
  player.type = '1';
  await assert.rejects(sound.eq(address, { expected: original, target }), /ungroup/i);
  assert.ok(calls.every(({ gain }) => gain === undefined));
});

test('mobile measurement enforces room, playback and volume checks and sends one WAV to the selected speaker', async () => {
  const { sound, player, played } = simulator();
  await assert.rejects(sound.measure(address, { expectedVolume: 18 }), /volume changed/i);
  player.type = '1';
  await assert.rejects(sound.measure(address, {}), /ungroup/i);
  player.type = '0';
  player.vol = '26';
  await assert.rejects(sound.measure(address, {}), /25%/);
  player.vol = '19';
  player.status = 'play';
  await assert.rejects(sound.measure(address, {}), /pause or stop/i);
  player.status = 'idle';
  assert.deepEqual(await sound.measure(address, { expectedVolume: 19 }), { measuring: true, volume: 19 });
  await assert.rejects(sound.measure(address, {}), /in progress/i);
  assert.deepEqual(played, ['setPlayerCmd:play:http://192.168.1.3:3456/test.wav']);
});

test('changing the volume while the phone opens its sweep listener prevents playback', async () => {
  const { sound, player, played, receiver } = simulator();
  const serve = receiver.serveSweep;
  receiver.serveSweep = async (options) => {
    const result = await serve(options);
    player.vol = '22';
    return result;
  };
  await assert.rejects(sound.measure(address, {}), /volume changed/i);
  assert.deepEqual(played, []);
});
