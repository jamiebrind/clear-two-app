import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpeaker, parseInputChange, parseLevelChange, parsePlaybackChange, PlaybackConflict } from '../src/speaker.ts';

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
    input: 'usb-dac', inputs: ['wifi', 'aux', 'bluetooth', 'usb-drive', 'usb-dac'], groupGuest: false,
  });
});

test('keeps network playback metadata separate and reads the documented input capability mask', async () => {
  const speaker = createSpeaker(async (command) => command === 'getStatusEx'
    ? '{"DeviceName":"Office","external":"0x8008","plm_support":"0x50"}'
    : '{"mode":"31","type":"0"}');
  const state = await speaker.read();
  assert.equal(state.source, 'Spotify Connect');
  assert.equal(state.input, 'wifi');
  assert.deepEqual(state.inputs, ['wifi', 'optical', 'coaxial']);
});

test('confirms an input change with one write even if the acknowledgement is lost', async () => {
  const writes: string[] = [];
  let reads = 0;
  const speaker = createSpeaker(async (command) => {
    if (command === 'getStatusEx') return '{"DeviceName":"Office","project":"UP2STREAM_AMP_V4","plm_support":"0x0"}';
    if (command === 'getPlayerStatus') return JSON.stringify({ mode: ++reads >= 3 ? '51' : '10' });
    writes.push(command);
    throw new Error('Connection closed');
  });
  assert.equal((await speaker.switchInput('usb-dac')).input, 'usb-dac');
  assert.deepEqual(writes, ['setPlayerCmd:switchmode:PCUSB']);
});

test('rejects unavailable inputs and grouped guests before sending a write', async () => {
  let player = '{"mode":"10"}';
  const speaker = createSpeaker(async (command) => {
    if (command === 'getStatusEx') return '{"DeviceName":"Office","plm_support":"0x10-invalid"}';
    assert.equal(command, 'getPlayerStatus');
    return player;
  });
  await assert.rejects(speaker.switchInput('optical'), /does not report/i);
  player = '{"type":"1","mode":"10"}';
  assert.equal((await speaker.read()).input, null);
  await assert.rejects(speaker.switchInput('wifi'), /host room/i);
  assert.equal(parseInputChange({ input: 'optical' }), 'optical');
  assert.equal(parseInputChange({ input: 'toString' }), null);
  assert.equal(parseInputChange({ input: 'aux', extra: true }), null);
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

function playbackSpeaker(mode: string, states: Array<{ status: string; mode?: string; type?: string }>, reply: string | Error = 'OK') {
  const writes: string[] = [];
  let index = 0;
  const speaker = createSpeaker(async (command) => {
    if (command === 'getStatusEx') return '{"DeviceName":"Studio"}';
    if (command === 'getPlayerStatus') {
      return JSON.stringify({ type: '0', mode, ...states[Math.min(index++, states.length - 1)] });
    }
    writes.push(command);
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { speaker, writes };
}

test('accepts only explicit playback actions for a device-managed source', () => {
  assert.deepEqual(parsePlaybackChange({ mode: '11', action: 'pause' }), { mode: '11', action: 'pause' });
  for (const invalid of [null, {}, { action: 'resume' }, { mode: '10', action: 'onepause' },
    { mode: '40', action: 'pause' }, { mode: 20, action: 'resume' }, { mode: '20', action: 'resume', other: true }]) {
    assert.equal(parsePlaybackChange(invalid), null);
  }
});

test('offers Pause or Resume only for playing or paused device-managed media', async () => {
  for (const mode of ['10', '11', '20']) {
    const { speaker } = playbackSpeaker(mode, [{ status: 'play' }, { status: 'pause' }, { status: 'stop' }, { status: 'load' }]);
    assert.deepEqual((await speaker.read()).playback, { mode, action: 'pause' });
    assert.deepEqual((await speaker.read()).playback, { mode, action: 'resume' });
    assert.equal((await speaker.read()).playback, undefined);
    assert.equal((await speaker.read()).playback, undefined);
  }
  for (const mode of ['0', '1', '2', '31', '32', '40', '41', '43', '45', '47', '51', '99', 'unknown']) {
    const { speaker } = playbackSpeaker(mode, [{ status: 'play' }]);
    assert.equal((await speaker.read()).playback, undefined);
  }
});

test('checks fresh playback eligibility before writing, including stale source, group and status', async () => {
  for (const initial of [{ status: 'play', mode: '11' }, { status: 'play', type: '1' }, { status: 'play', type: '?' }, { status: 'stop' }]) {
    const { speaker, writes } = playbackSpeaker('10', [initial]);
    await assert.rejects(speaker.setPlayback({ mode: '10', action: 'pause' }), PlaybackConflict);
    assert.deepEqual(writes, []);
  }
  const { speaker, writes } = playbackSpeaker('10', [{ status: 'pause' }]);
  assert.equal((await speaker.setPlayback({ mode: '10', action: 'pause' })).status, 'Paused');
  assert.deepEqual(writes, []);
});

test('sends one explicit command and verifies its result even with delayed state and a lost acknowledgement', async () => {
  const pause = playbackSpeaker('11', [{ status: 'play' }, { status: 'play' }, { status: 'pause' }], new Error('Connection closed'));
  assert.equal((await pause.speaker.setPlayback({ mode: '11', action: 'pause' })).status, 'Paused');
  assert.deepEqual(pause.writes, ['setPlayerCmd:pause']);
  const resume = playbackSpeaker('20', [{ status: 'pause' }, { status: 'play' }]);
  assert.equal((await resume.speaker.setPlayback({ mode: '20', action: 'resume' })).status, 'Playing');
  assert.deepEqual(resume.writes, ['setPlayerCmd:resume']);
});

test('reports rejection, unconfirmed playback, and source or group changes during readback', async () => {
  const rejected = playbackSpeaker('10', [{ status: 'play' }], 'FAIL');
  await assert.rejects(rejected.speaker.setPlayback({ mode: '10', action: 'pause' }), /rejected/i);
  for (const updated of [{ status: 'pause', mode: '11' }, { status: 'pause', type: '1' }]) {
    const { speaker, writes } = playbackSpeaker('10', [{ status: 'play' }, updated]);
    await assert.rejects(speaker.setPlayback({ mode: '10', action: 'pause' }), PlaybackConflict);
    assert.deepEqual(writes, ['setPlayerCmd:pause']);
  }
  const unchanged = playbackSpeaker('11', [{ status: 'play' }]);
  await assert.rejects(unchanged.speaker.setPlayback({ mode: '11', action: 'pause' }), /confirm/i);
  assert.deepEqual(unchanged.writes, ['setPlayerCmd:pause']);
});
