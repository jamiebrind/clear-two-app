import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGroup, parseGroupAction } from '../server/group.ts';

const host = '192.0.2.10';
const guest = '192.168.8.15';
const id = 'FF31F09E8AFCEBECAF8BF24F';
const empty = '{"slaves":0}';
const grouped = JSON.stringify({ slaves: 1, slave_list: [{ uuid: id.toLowerCase(), ip: guest, name: 'Office', volume: '20', mute: '0' }] });

test('join sends a single command to the guest and verifies group membership at the host', async () => {
  let joined = false;
  let writes = 0;
  const engine = createGroup(async (ip, command) => {
    if (command === 'getPlayerStatus') return '{"type":"0","mode":"10"}';
    if (command === 'multiroom:getSlaveList') return ip === host && joined ? grouped : empty;
    assert.equal(ip, guest);
    assert.equal(command, `ConnectMasterAp:JoinGroupMaster:eth${host}:wifi0.0.0.0`);
    writes++;
    joined = true;
    // A change of network state can drop the acknowledgement.
    throw new Error('Connection closed');
  });
  assert.deepEqual(await engine.change(host, { action: 'join', memberId: id }, guest), {
    isGuest: false, members: [{ id, name: 'Office', volume: 20, muted: false }],
  });
  assert.equal(writes, 1);
  await engine.change(host, { action: 'join', memberId: id }, guest);
  assert.equal(writes, 1);
});

test('refuses to modify a guest or take over a different group', async () => {
  const engine = createGroup(async (ip, command) => {
    assert.equal(command, 'getPlayerStatus');
    return ip === guest ? '{"type":"1","mode":"99"}' : '{"type":"1","mode":"99"}';
  });
  assert.deepEqual(await engine.read(guest), { isGuest: true, members: [] });
  await assert.rejects(engine.change(host, { action: 'ungroup' }), /host/i);
});

test('rejects malformed devices and validates changing an existing member through the host', async () => {
  let muted = false;
  const engine = createGroup(async (ip, command) => {
    assert.equal(ip, host);
    if (command === 'getPlayerStatus') return '{"type":"0","mode":"10"}';
    if (command === 'multiroom:getSlaveList') return muted ? grouped.replace('"mute":"0"', '"mute":"1"') : grouped;
    assert.equal(command, `multiroom:SlaveMute:${guest}:1`);
    muted = true;
    return 'OK';
  });
  assert.equal((await engine.change(host, { action: 'mute', memberId: id, mute: true })).members[0].muted, true);
  assert.equal(parseGroupAction({ action: 'volume', memberId: id, volume: 101 }), null);
  assert.equal(parseGroupAction({ action: 'join', memberId: 'not-a-speaker' }), null);
  const invalid = createGroup(async (_ip, command) => command === 'getPlayerStatus' ? '{}' : '{"slaves":1}');
  await assert.rejects(invalid.read(host), /group data/i);
});

test('sets and confirms an absolute group level for the host and every guest', async () => {
  let hostVolume = 30;
  let guestVolume = 20;
  const writes: string[] = [];
  const engine = createGroup(async (ip, command) => {
    assert.equal(ip, host);
    if (command === 'getPlayerStatus') return JSON.stringify({ type: '0', mode: '10', vol: hostVolume });
    if (command === 'multiroom:getSlaveList') return grouped.replace('"volume":"20"', `"volume":"${guestVolume}"`);
    writes.push(command);
    if (command === 'setPlayerCmd:vol:25') hostVolume = 25;
    else if (command === `multiroom:SlaveVolume:${guest}:25`) guestVolume = 25;
    else assert.fail(command);
    return 'OK';
  });
  const result = await engine.change(host, { action: 'group-volume', volume: 25 });
  assert.equal(result.hostVolume, 25);
  assert.equal(result.members[0].volume, 25);
  assert.deepEqual(writes, ['setPlayerCmd:vol:25', `multiroom:SlaveVolume:${guest}:25`]);
});

test('an unavailable guest does not turn a partially applied group level into success', async () => {
  let hostVolume = 30;
  let guestWrites = 0;
  const engine = createGroup(async (_ip, command) => {
    if (command === 'getPlayerStatus') return JSON.stringify({ type: '0', mode: '10', vol: hostVolume });
    if (command === 'multiroom:getSlaveList') return grouped;
    if (command === 'setPlayerCmd:vol:25') { hostVolume = 25; return 'OK'; }
    guestWrites++;
    throw new Error('Guest unavailable');
  });
  await assert.rejects(engine.change(host, { action: 'group-volume', volume: 25 }), /some rooms may have changed/i);
  assert.equal(guestWrites, 1);
  assert.equal((await engine.read(host)).hostVolume, 25);
});

test('two hosts manage separate groups and cannot take each other’s guests', async () => {
  const otherHost = '192.0.2.20';
  const otherGuest = '192.168.8.21';
  const otherId = 'FF31F09E8AFCEBECAF8BF250';
  const devices = new Map([
    [guest, { uuid: id, ip: guest, name: 'Office', volume: 20, mute: 0 }],
    [otherGuest, { uuid: otherId, ip: otherGuest, name: 'Bedroom', volume: 40, mute: 0 }],
  ]);
  const hostsByGuest = new Map<string, string>();
  const engine = createGroup(async (ip, command) => {
    if (command === 'getPlayerStatus') return JSON.stringify({ type: hostsByGuest.has(ip) ? 1 : 0, vol: 30 });
    if (command === 'multiroom:getSlaveList') {
      const members = [...devices.values()].filter((device) => hostsByGuest.get(device.ip) === ip);
      return JSON.stringify({ slaves: members.length, slave_list: members });
    }
    const join = /^ConnectMasterAp:JoinGroupMaster:eth([^:]+):wifi0\.0\.0\.0$/.exec(command);
    if (join) { hostsByGuest.set(ip, join[1]); return 'OK'; }
    if (command === `multiroom:SlaveVolume:${guest}:25` && ip === host) {
      devices.get(guest)!.volume = 25;
      return 'OK';
    }
    if (command === 'multiroom:Ungroup' && ip === host) {
      hostsByGuest.delete(guest);
      return 'OK';
    }
    assert.fail(`${ip} ${command}`);
  });

  await engine.change(host, { action: 'join', memberId: id }, guest);
  await engine.change(otherHost, { action: 'join', memberId: otherId }, otherGuest);
  await assert.rejects(engine.change(host, { action: 'join', memberId: otherId }, otherGuest), /current group/i);
  assert.equal((await engine.change(host, { action: 'volume', memberId: id, volume: 25 })).members[0].volume, 25);
  assert.deepEqual((await engine.change(host, { action: 'ungroup' })).members, []);
  assert.deepEqual((await engine.read(otherHost)).members, [{ id: otherId, name: 'Bedroom', volume: 40, muted: false }]);
  assert.equal((await engine.read(otherGuest)).isGuest, true);
});
