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
}

export type LevelChange = { volume: number } | { mute: boolean };
export type SendCommand = (command: string) => Promise<string>;

const sources: Record<string, string> = {
  '0': 'Idle', '1': 'AirPlay', '2': 'DLNA', '10': 'Network', '11': 'USB storage',
  '20': 'Network stream', '31': 'Spotify Connect', '40': 'Line in', '41': 'Bluetooth',
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

export function createSpeaker(send: SendCommand) {
  async function read(): Promise<SpeakerState> {
    const [device, player] = await Promise.all([
      send('getStatusEx').then(parseObject),
      send('getPlayerStatus').then(parseObject),
    ]);
    const name = text(device.DeviceName);
    if (!name) throw new Error('The amplifier did not report a device name.');

    const mute = String(player.mute);
    return {
      name,
      model: text(device.project),
      firmware: text(device.firmware),
      source: sources[String(player.mode)] ?? 'Unknown source',
      status: statuses[String(player.status)] ?? 'Status unavailable',
      volume: parseVolume(player.vol),
      muted: mute === '1' ? true : mute === '0' ? false : null,
      title: metadata(player.Title),
      artist: metadata(player.Artist),
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

  return { read, change };
}
