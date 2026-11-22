import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';
import { createToneController, frameCommand, parseToneChange } from '../server/tone.ts';

test('rejects invalid bands and gains', () => {
  for (const value of [{ band: 'VBS', gain: 1 }, { band: 'bass', gain: 11 }, { band: 'mid', gain: 0.5 }, { band: 'treble', gain: '2' }]) {
    assert.equal(parseToneChange(value), null);
  }
  assert.deepEqual(parseToneChange({ band: 'mid', gain: -1 }), { band: 'mid', gain: -1 });
});

test('reads framed tone replies and verifies changes with a separate query', async () => {
  const requests: string[] = [];
  const tones: Record<string, number> = { BAS: 0, MID: 1, TRE: 2 };
  const simulator = createServer((socket) => {
    let buffered = Buffer.alloc(0);
    socket.on('data', (bytes) => {
      buffered = Buffer.concat([buffered, typeof bytes === 'string' ? Buffer.from(bytes) : bytes]);
      while (buffered.length >= 20 && buffered.length >= 20 + buffered.readUInt32LE(4)) {
        const end = 20 + buffered.readUInt32LE(4);
        const data = buffered.subarray(20, end).toString();
        buffered = buffered.subarray(end);
        const [, band, gain] = /RAKOIT:(BAS|MID|TRE)(?::(-?\d+))?&$/.exec(data)!;
        requests.push(data.slice(15, -1));
        if (band === 'TRE' && gain === '-3') {
          socket.write(frameCommand('MCU+PAS+RAKOIT:ERR:unavailable&'));
          continue;
        }
        if (gain !== undefined) tones[band] = Number(gain);
        const packet = frameCommand(`MCU+PAS+RAKOIT:${band}:${tones[band]}&`);
        socket.write(packet.subarray(0, 8));
        socket.write(packet.subarray(8));
      }
    });
  });
  await new Promise<void>((resolve) => simulator.listen(0, '127.0.0.1', resolve));
  try {
    const address = simulator.address();
    assert.ok(address && typeof address !== 'string');
    const controller = createToneController('127.0.0.1', address.port);
    assert.deepEqual(await controller.read(), { bass: 0, mid: 1, treble: 2 });
    assert.equal(await controller.change({ band: 'mid', gain: -1 }), -1);
    assert.deepEqual(requests, ['BAS', 'MID', 'TRE', 'MID:-1', 'MID']);
    const original = { bass: 0, mid: -1, treble: 2 };
    const tuned = { ...original, bass: -2, treble: 1 };
    assert.deepEqual(await controller.replace(original, tuned), tuned);
    await assert.rejects(controller.replace(original, tuned), /changed since/i);
    assert.deepEqual(await controller.replace(tuned, original), original);
    await assert.rejects(controller.replace(original, { ...tuned, treble: -3 }), /previous settings were restored/i);
    assert.deepEqual(await controller.read(), original);
  } finally {
    await new Promise<void>((resolve) => simulator.close(() => resolve()));
  }
});
