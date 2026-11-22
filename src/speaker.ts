import { delay } from './delay.ts';

import { inputLabels, type InputId } from './inputs.ts';

const inputCommands: Record<InputId, string> = {
  wifi: 'wifi', aux: 'line-in', bluetooth: 'bluetooth', 'usb-drive': 'udisk',
  'usb-dac': 'PCUSB', optical: 'optical', coaxial: 'co-axial', 'aux-2': 'line-in2',
};
const inputBits: Record<Exclude<InputId, 'wifi'>, number> = {
  aux: 1, bluetooth: 2, 'usb-drive': 3, 'usb-dac': 15, optical: 4, coaxial: 6, 'aux-2': 8,
};
const playbackInputs: Record<string, InputId> = {
  '0': 'wifi', '1': 'wifi', '2': 'wifi', '10': 'wifi', '20': 'wifi', '31': 'wifi', '32': 'wifi',
  '11': 'usb-drive', '40': 'aux', '41': 'bluetooth', '43': 'optical',
  '45': 'coaxial', '47': 'aux-2', '51': 'usb-dac',
};
const ampV4Inputs = new Set<InputId>(['aux', 'bluetooth', 'usb-drive', 'usb-dac']);

export class InputConflict extends Error {}
export class PlaybackConflict extends Error {}

type PlaybackMode = '10' | '11' | '20';
type PlaybackChange = { action: 'pause' | 'resume'; mode: PlaybackMode };

function isPlaybackMode(mode: unknown): mode is PlaybackMode {
  return mode === '10' || mode === '11' || mode === '20';
}

export interface SpeakerState {
  name: string;
  model: string | null;
  firmware: string | null;
  source: string;
  status: string;
  volume: number | null;
  muted: boolean | null;
  title: string | null;
  artist: string | null;
  input: InputId | null;
  inputs: InputId[];
  groupGuest: boolean;
  playback?: PlaybackChange;
}

export type LevelChange = { volume: number } | { mute: boolean };
export type SendCommand = (command: string) => Promise<string>;

const sources: Record<string, string> = {
  '0': 'Idle', '1': 'AirPlay', '2': 'DLNA', '10': 'Network', '11': 'USB storage',
  '20': 'Network stream', '31': 'Spotify Connect', '32': 'TIDAL Connect', '40': 'Line in', '41': 'Bluetooth',
  '43': 'Optical', '45': 'Coaxial', '47': 'Line in 2', '51': 'USB DAC', '99': 'Grouped playback',
};
const statuses: Record<string, string> = { play: 'Playing', pause: 'Paused', stop: 'Stopped', idle: 'Idle' };

function parseObject(response: string): Record<string, unknown> {
  const value: unknown = JSON.parse(response);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unexpected response from the amplifier.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function metadata(value: unknown): string | null {
  const hex = text(value);
  if (!hex || !/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const bytes = Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  const decoded = text(new TextDecoder().decode(bytes).replace(/\0+$/, ''));
  return decoded?.toLowerCase() === 'unknown' ? null : decoded;
}

function parseVolume(value: unknown) {
  const volume = typeof value === 'string' && /^\d{1,3}$/.test(value) ? Number(value) : value;
  return typeof volume === 'number' && Number.isInteger(volume) && volume >= 0 && volume <= 100 ? volume : null;
}

export function parseLevelChange(body: unknown): LevelChange | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1) return null;
  if ('mute' in body && typeof body.mute === 'boolean') return { mute: body.mute };
  if ('volume' in body && typeof body.volume === 'number' && parseVolume(body.volume) !== null) {
    return { volume: body.volume };
  }
  return null;
}

export function parseInputChange(body: unknown): InputId | null {
  if (!body || typeof body !== 'object' || Object.keys(body).length !== 1 || !('input' in body)) return null;
  return typeof body.input === 'string' && Object.hasOwn(inputLabels, body.input) ? body.input as InputId : null;
}

export function parsePlaybackChange(body: unknown): PlaybackChange | null {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
      || !('action' in body) || !('mode' in body)) return null;
  const { action, mode } = body;
  return (action === 'pause' || action === 'resume') && isPlaybackMode(mode) ? { action, mode } : null;
}

function supportedInputs(model: string | null, value: unknown): InputId[] {
  const raw = String(value);
  const mask = /^(?:0x[0-9a-f]{1,8}|\d{1,10})$/i.test(raw) ? Number(raw) : 0;
  return (Object.keys(inputLabels) as InputId[]).filter((input) =>
    input === 'wifi' || (model === 'UP2STREAM_AMP_V4' && ampV4Inputs.has(input)) || Boolean(mask & (1 << inputBits[input])));
}

export function createSpeaker(send: SendCommand) {
  const readPlayer = () => send('getPlayerStatus').then(parseObject);
  const readReports = () => Promise.all([send('getStatusEx').then(parseObject), readPlayer()]);

  async function read(): Promise<SpeakerState> {
    const [device, player] = await readReports();
    return speakerState(device, player);
  }

  function speakerState(device: Record<string, unknown>, player: Record<string, unknown>): SpeakerState {
    const name = text(device.DeviceName);
    if (!name) throw new Error('The amplifier did not report a device name.');

    const mute = String(player.mute);
    const mode = String(player.mode);
    const groupGuest = String(player.type) === '1' || mode === '99';
    const model = text(device.project);
    const action = player.status === 'play' ? 'pause' : player.status === 'pause' ? 'resume' : null;
    return {
      name,
      model,
      firmware: text(device.firmware),
      source: groupGuest ? 'Grouped playback' : (Object.hasOwn(sources, mode) ? sources[mode] : 'Unknown source'),
      status: statuses[String(player.status)] ?? 'Status unavailable',
      volume: parseVolume(player.vol),
      muted: mute === '1' ? true : mute === '0' ? false : null,
      title: metadata(player.Title),
      artist: metadata(player.Artist),
      input: !groupGuest && Object.hasOwn(playbackInputs, mode) ? playbackInputs[mode] : null,
      inputs: supportedInputs(model, device.plm_support),
      groupGuest,
      ...(action && String(player.type) === '0' && isPlaybackMode(mode) && { playback: { action, mode } }),
    };
  }

  async function change(level: LevelChange): Promise<SpeakerState> {
    const command = 'volume' in level ? `vol:${level.volume}` : `mute:${level.mute ? 1 : 0}`;
    const response = await send(`setPlayerCmd:${command}`);
    if (response.trim() !== 'OK') throw new Error('The amplifier rejected the change.');

    const state = await read();
    if ('volume' in level ? state.volume !== level.volume : state.muted !== level.mute) {
      throw new Error('The amplifier did not confirm the requested setting.');
    }
    return state;
  }

  async function switchInput(input: InputId): Promise<SpeakerState> {
    const [device, player] = await readReports();
    const before = speakerState(device, player);
    if (before.groupGuest) throw new InputConflict('Change the input in the host room.');
    if (!before.inputs.includes(input)) throw new InputConflict('This speaker does not report support for that input.');
    if (before.input === input) return before;

    const acknowledgement = await send(`setPlayerCmd:switchmode:${inputCommands[input]}`).catch(() => null);
    if (acknowledgement !== null && acknowledgement.trim() !== 'OK') throw new Error('The amplifier rejected the input change.');
    for (const wait of [0, 300, 600]) {
      if (wait) await delay(wait);
      const updated = await readPlayer().catch(() => null);
      if (!updated) continue;
      const state = speakerState(device, updated);
      if (state.groupGuest) throw new InputConflict('This room joined a group. Change the input in the host room.');
      if (state.input === input) return state;
    }
    throw new Error('Could not confirm the input change. Check the selected input before trying again.');
  }

  async function setPlayback(change: PlaybackChange): Promise<SpeakerState> {
    function verifySource(player: Record<string, unknown>) {
      if (String(player.type) === '1' || String(player.mode) === '99') {
        throw new PlaybackConflict('Control playback in the host room.');
      }
      if (String(player.type) !== '0' || String(player.mode) !== change.mode) {
        throw new PlaybackConflict('The playback source changed. Check Now playing and try again.');
      }
    }

    const [device, player] = await readReports();
    verifySource(player);
    const before = speakerState(device, player);
    if (!before.playback) throw new PlaybackConflict('Choose a playing or paused track first.');
    if (before.playback.action !== change.action) return before;

    const reply = await send(`setPlayerCmd:${change.action}`).catch(() => null);
    if (reply !== null && reply.trim() !== 'OK') throw new Error('The amplifier rejected the playback change.');
    const expectedStatus = change.action === 'pause' ? 'pause' : 'play';
    for (const wait of [0, 300, 600]) {
      if (wait) await delay(wait);
      const updated = await readPlayer().catch(() => null);
      if (!updated) continue;
      verifySource(updated);
      if (updated.status === expectedStatus) return speakerState(device, updated);
    }
    throw new Error('Could not confirm the playback change. Check Now playing before trying again.');
  }

  return { read, change, switchInput, setPlayback };
}
