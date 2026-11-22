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
