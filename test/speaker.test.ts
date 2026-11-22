import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeaker, parseLevelChange } from '../src/speaker.ts';

test('builds Now Playing from the amplifier responses', async () => {
  const speaker = createSpeaker(async (command) => {
    if (command === 'getStatusEx') {
      return JSON.stringify({ DeviceName: 'Living Room', project: 'UP2STREAM_AMP_V4', firmware: '4.6.415145' });
    }
    assert.equal(command, 'getPlayerStatus');
    return JSON.stringify({ mode: '51', status: 'play', vol: '100', mute: '0', Title: '556E6B6E6F776E', Artist: '426AC3B6726B' });
  });

  assert.deepEqual(await speaker.read(), {
    name: 'Living Room', model: 'UP2STREAM_AMP_V4', firmware: '4.6.415145',
    source: 'USB DAC', status: 'Playing', volume: 100, muted: false, title: null, artist: 'Björk',
  });
});

test('sends exactly one explicit mute command and reads back the result', async () => {
  const commands: string[] = [];
  const speaker = createSpeaker(async (command) => {
    commands.push(command);
    if (command === 'setPlayerCmd:mute:1') return 'OK\r\n';
    if (command === 'getStatusEx') return '{"DeviceName":"Clear Two"}';
    return '{"vol":"20","mute":"1"}';
  });

  assert.equal((await speaker.change({ mute: true })).muted, true);
  assert.deepEqual(commands, ['setPlayerCmd:mute:1', 'getStatusEx', 'getPlayerStatus']);
});

test('rejects invalid or combined level changes', () => {
  for (const body of [{ volume: '20' }, { volume: 101 }, { volume: 12.5 }, { mute: 1 }, { volume: 19, mute: true }, null]) {
    assert.equal(parseLevelChange(body), null);
  }
  assert.deepEqual(parseLevelChange({ volume: 0 }), { volume: 0 });
  assert.deepEqual(parseLevelChange({ mute: false }), { mute: false });
});

test('reports rejected commands and mismatched readback', async () => {
  const rejecting = createSpeaker(async () => 'FAIL');
  await assert.rejects(rejecting.change({ volume: 25 }), /rejected/i);

  const mismatching = createSpeaker(async (command) => {
    if (command === 'setPlayerCmd:vol:25') return 'OK';
    if (command === 'getStatusEx') return '{"DeviceName":"Clear Two"}';
    return '{"vol":"20","mute":"0"}';
  });
  await assert.rejects(mismatching.change({ volume: 25 }), /confirm/i);
});
