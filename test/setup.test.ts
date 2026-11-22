import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSetup, parseNetworks, type SetupTransport } from '../server/setup.ts';

const unit = { DeviceName: 'Clear Two', uuid: 'FF31F09E8AFCEBECAF8BF24F', project: 'UP2STREAM_AMP_V4', hardware: 'A31', apcli0: '192.168.1.104' };
const scan = JSON.stringify({ aplist: [
  { ssid: '436166C3A9', auth: 'WPA2PSK', encry: 'AES', channel: '6' },
  { ssid: '4F70656E', auth: 'OPEN', encry: 'NONE', channel: '1' },
  { ssid: '426164', auth: 'WPA3SAE', encry: 'AES', channel: '6' },
] });

test('decodes supported networks advertised by the speaker', () => {
  assert.deepEqual(parseNetworks(scan), [
    { ssid: 'Café', channel: 6, security: 'WPA2' }, { ssid: 'Open', channel: 1, security: 'Open' },
  ]);
});

test('validates the chosen device, joins Wi-Fi and verifies the same device over the LAN', async () => {
  const calls: string[] = [];
  const request: SetupTransport = async (ip, command) => {
    calls.push(`${ip} ${command}`);
    if (command === 'getStatusEx') return JSON.stringify(unit);
    if (command === 'wlanGetApListEx') return scan;
    if (command === 'wlanGetConnectState') return 'OK';
    assert.equal(command, 'wlanConnectApEx:ssid=436166C3A9:ch=6:auth=WPA2PSK:encry=AES:pwd=7465737431323334:chext=1');
    return '';
  };
  const setup = createSetup(request);
  assert.equal((await setup.scan()).speaker.uuid, unit.uuid);
  await setup.join({ uuid: unit.uuid, ssid: 'Café', channel: 6, password: 'test1234' });
  assert.deepEqual(await setup.progress(unit.uuid), { status: 'joined', address: '192.168.1.104' });
  assert.equal((await setup.verify('192.168.1.104', unit.uuid)).name, 'Clear Two');
  assert.equal(calls.at(-1), '192.168.1.104 getStatusEx');
  await assert.rejects(setup.verify('192.168.1.104', 'FFFFFFFFFFFFFFFF'), /different speaker/i);
});

test('rejects invalid passwords and never sends a join command to a different speaker', async () => {
  const setup = createSetup(async (_ip, command) => {
    if (command === 'getStatusEx') return JSON.stringify(unit);
    if (command === 'wlanGetApListEx') return scan;
    assert.fail('Unexpected command');
  });
  await assert.rejects(setup.join({ uuid: unit.uuid, ssid: 'Café', channel: 6, password: 'bad' }), /password/i);
  await assert.rejects(setup.join({ uuid: 'FFFFFFFFFFFFFFFF', ssid: 'Café', channel: 6, password: 'test1234' }), /different speaker/i);
  await assert.rejects(setup.verify('8.8.8.8'), /local IPv4/i);
});
