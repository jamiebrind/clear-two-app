import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDirectController } from '../src/directController.ts';
import { localAddress } from '../server/setup.ts';

const id = 'ABCDEF0123456789';
const first = '192.168.8.10';
const moved = '192.168.8.11';
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test('a phone adds and remembers a room and follows its hardware ID after a DHCP change', async () => {
  let current = first;
  let muted = false;
  const writes: string[] = [];
  const options = { storage: memory(), discover: async () => [current], send: async (address: string, command: string) => {
    if (command === 'getStatusEx') return JSON.stringify({ project: 'UP2STREAM_AMP_V4', hardware: 'A31',
      uuid: address === current ? id : 'FFFFFFFFFFFFFFFF', DeviceName: 'Kitchen' });
    if (command === 'getPlayerStatus') return JSON.stringify({ type: '0', mode: '11', mute: muted ? '1' : '0', status: 'play', vol: '12' });
    assert.equal(command, 'setPlayerCmd:mute:1');
    writes.push(address); muted = true; return 'OK';
  }};
  await createDirectController(options)('/api/setup/add', { address: first });
  current = moved;
  const phone = createDirectController(options);
  assert.deepEqual(await phone('/api/rooms'), { rooms: [{ id, name: 'Kitchen' }], defaultId: id });
  await phone('/api/speaker/level?room=' + id, { mute: true });
  assert.deepEqual(writes, [moved]);
});

test('manual direct access refuses public, malformed and reassigned addresses', async () => {
  for (const address of ['8.8.8.8','10.0.0.256','192.168.01.1','192.168.1','10.0.0.8/path','127.0.0.1']) {
    assert.equal(localAddress(address), false);
  }
  let device = id;
  const direct = createDirectController({ storage: memory(), send: async (_address, command) => {
    assert.equal(command, 'getStatusEx');
    return JSON.stringify({ project:'UP2STREAM_AMP_V4', hardware:'A31', uuid: device, DeviceName:'Kitchen' });
  }});
  await direct('/api/setup/add', { address: first });
  device = 'CCCCCCCCCCCCCCCC';
  await assert.rejects(direct('/api/speaker/level?room=' + id, {volume:12}), /unavailable/);
});
