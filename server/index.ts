import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { isIPv4 } from 'node:net';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSpeaker, InputConflict, parseInputChange, parseLevelChange, parsePlaybackChange, PlaybackConflict } from '../src/speaker.ts';
import { createToneController, parseToneChange, ToneConflict } from './tone.ts';
import { createSweepPlayback, parseTuningSettings, TuningConflict, verifySweepPlayback, verifyTuningRoom } from './roomTuning.ts';
import { createSetup, localAddress, validUuid } from './setup.ts';
import { discoverSpeakers } from './discovery.ts';
import { createGroup, GroupConflict, parseGroupAction } from './group.ts';
import { createRooms } from './rooms.ts';
import type { Room } from './rooms.ts';

const selection = new URL('../speaker.local.json', import.meta.url);
const pendingSelection = new URL('../speaker.local.json.tmp', import.meta.url);
const configuredAddress = process.env.CLEAR_TWO_SPEAKER_IP ?? '';
let storedRooms: unknown;
try {
  storedRooms = JSON.parse(readFileSync(selection, 'utf8'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Could not read the saved room list. Use discovery to recover speaker addresses.');
}
const host = process.env.CLEAR_TWO_HOST ?? '127.0.0.1';
const port = Number(process.env.CLEAR_TWO_PORT ?? 4273);
const tlsPort = Number(process.env.CLEAR_TWO_HTTPS_PORT ?? 4274);
const tlsKey = process.env.CLEAR_TWO_TLS_KEY;
const tlsCert = process.env.CLEAR_TWO_TLS_CERT;
const development = process.argv.includes('--dev');

if (configuredAddress && !localAddress(configuredAddress)) {
  throw new Error('Set CLEAR_TWO_SPEAKER_IP to your amplifier’s private IPv4 address in .env or your environment.');
}
if (!isIPv4(host) || host === '0.0.0.0' || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Bind the bridge to a specific IPv4 address and a port from 1 to 65535.');
}
if (Boolean(tlsKey) !== Boolean(tlsCert) || (tlsKey && (!Number.isInteger(tlsPort) || tlsPort < 1 || tlsPort > 65535 || tlsPort === port))) {
  throw new Error('Set both TLS file paths and choose a separate valid HTTPS port.');
}

async function requestDevice(address: string, command: string, limit?: AbortSignal) {
  const url = new URL(`http://${address}/httpapi.asp`);
  url.searchParams.set('command', command);
  const timeout = AbortSignal.timeout(2500);
  const response = await fetch(url, { redirect: 'error', signal: limit ? AbortSignal.any([limit, timeout]) : timeout });
  if (!response.ok) throw new Error(`The amplifier returned HTTP ${response.status}.`);
  return response.text();
}
const setup = createSetup(requestDevice);
const configuredSpeaker = (address: string) => createSpeaker((command) => requestDevice(address, command));
const registry = createRooms(storedRooms, configuredAddress, (value) => {
  writeFileSync(pendingSelection, JSON.stringify(value, null, 2) + '\n');
  renameSync(pendingSelection, selection);
});
const tonesByAddress = new Map<string, ReturnType<typeof createToneController>>();
const mutating = new Set<string>();
let changingGroup = false;
let discovery: Promise<number> | undefined;
let lastDiscovery = -Infinity;

function roomsResponse() {
  const defaultId = registry.get()?.id;
  const configuredId = registry.get('configured')?.id;
  return { rooms: registry.list(), ...(defaultId && { defaultId }), ...(configuredId && { configuredId }) };
}

function findRooms(): Promise<number> {
  if (discovery) return discovery;
  lastDiscovery = Date.now();
  discovery = discoverSpeakers().then(async (addresses) => {
    const results = await Promise.allSettled(addresses.map(async (address) => ({ ...await setup.verify(address), address })));
    const found = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    registry.remember(found);
    return new Set(found.map((speaker) => speaker.uuid)).size;
  }).finally(() => { discovery = undefined; });
  return discovery;
}

class RoomUnavailable extends Error {}

async function verifyRoom(room: Room, limit?: AbortSignal): Promise<Room> {
  try {
    if (room.id === 'configured') {
      // Upgrade an existing address-only installation to the speaker's stable ID.
      const verified = await createSetup((address, command) => requestDevice(address, command, limit)).verify(room.address);
      registry.remember([{ ...verified, address: room.address }]);
      return registry.get(verified.uuid)!;
    }
    await createSetup((address, command) => requestDevice(address, command, limit)).verify(room.address, room.id);
    return room;
  } catch {
    if (Date.now() - lastDiscovery > 8000) void findRooms().catch(() => {});
    throw new RoomUnavailable('Speaker is offline or its address changed. Find speakers to reconnect.');
  }
}

function requestedRoom(value: unknown) {
  if (value === undefined || typeof value === 'string') return registry.get(value);
}

async function mutate<T>(devices: Room[], operation: () => Promise<T>, affectsGroup = false): Promise<T> {
  const keys = devices.map((device) => device.address);
  // An amplifier's group members can change outside Clear Two. Group writes must not race individual writes.
  if (changingGroup || (affectsGroup && mutating.size > 0) || keys.some((key) => mutating.has(key))) {
    throw new GroupConflict('Another sound or group change is in progress. Try again.');
  }
  if (affectsGroup) changingGroup = true;
  keys.forEach((key) => mutating.add(key));
  try { return await operation(); }
  finally {
    keys.forEach((key) => mutating.delete(key));
    if (affectsGroup) changingGroup = false;
  }
}

const app = express();
const server = createServer(app);
const secureServer = tlsKey && tlsCert ? createSecureServer({ key: readFileSync(tlsKey), cert: readFileSync(tlsCert) }, app) : undefined;
const allowedHosts = new Set([`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`]);
if (secureServer) allowedHosts.add(`${host}:${tlsPort}`);
app.disable('x-powered-by');

app.use((request, response, next) => {
  if (!allowedHosts.has(request.headers.host ?? '')) {
    response.status(403).json({ error: 'Use the address shown when the bridge starts.' });
    return;
  }
  next();
});

app.use('/api', (_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/speaker', async (_request, response) => {
  const selected = requestedRoom(_request.query.room);
  if (!selected) {
    response.status(404).json({ error: 'Add a speaker to get started.' });
    return;
  }
  try {
    const room = await verifyRoom(selected);
    response.json(await configuredSpeaker(room.address).read());
  } catch {
    response.status(502).json({ error: 'Could not reach this speaker. Check its connection or find speakers again.' });
  }
});

app.use('/api', (request, response, next) => {
  if (request.method === 'POST' && request.get('origin') !== `${request.protocol}://${request.get('host')}`) {
    response.status(403).json({ error: 'Open Clear Two directly to use the controls.' });
    return;
  }
  next();
});

app.get('/api/rooms', (_request, response) => response.json(roomsResponse()));

app.post('/api/rooms/discover', async (_request, response) => {
  try {
    const foundCount = await findRooms();
    response.json({ ...roomsResponse(), foundCount });
  } catch { response.status(502).json({ error: 'Could not scan for speakers. Try again or add a speaker by address.' }); }
});

app.get('/api/setup/location', (_request, response) => {
  response.json({ url: `http://127.0.0.1:${port}/?setup` });
});

app.use('/api/setup', (request, response, next) => {
  if (request.socket.remoteAddress !== '127.0.0.1') {
    response.status(403).json({ error: `Open http://127.0.0.1:${port} on the computer running Clear Two for setup.` });
    return;
  }
  next();
});

app.get('/api/setup/scan', async (_request, response) => {
  try { response.json(await setup.scan()); }
  catch { response.status(502).json({ error: 'Can’t reach a compatible speaker hotspot. Join the speaker’s Wi-Fi in your computer’s Wi-Fi settings and try again.' }); }
});

const setupJson = express.json({ limit: '1kb' });
let setupBusy = false;
app.post('/api/setup/join', setupJson, async (request, response) => {
  const { uuid, ssid, channel, password } = request.body ?? {};
  if (!validUuid(uuid) || typeof ssid !== 'string' || !Number.isInteger(channel) || typeof password !== 'string') {
    response.status(400).json({ error: 'Choose a speaker and Wi-Fi network first.' });
    return;
  }
  if (setupBusy) { response.status(409).json({ error: 'A setup operation is already in progress.' }); return; }
  setupBusy = true;
  try {
    await setup.join({ uuid, ssid, channel, password });
    response.json({ status: 'joining' });
  } catch (error) {
    const detail = error instanceof Error && ['That network', 'Enter a Wi-Fi', 'This open', 'That address', 'The speaker rejected'].some((prefix) => error.message.startsWith(prefix));
    response.status(400).json({ error: detail ? (error as Error).message : 'Could not send Wi-Fi settings. Check the speaker hotspot and try again.' });
  } finally { setupBusy = false; }
});

app.get('/api/setup/progress', async (request, response) => {
  const uuid = request.query.uuid;
  if (!validUuid(uuid)) { response.status(400).json({ error: 'Invalid speaker identifier.' }); return; }
  try { response.json(await setup.progress(uuid)); }
  catch { response.status(502).json({ error: 'Could not verify the speaker’s Wi-Fi status.' }); }
});

app.post('/api/setup/add', setupJson, async (request, response) => {
  const { address, uuid } = request.body ?? {};
  if ((!localAddress(address) && (address != null || !validUuid(uuid))) || (uuid != null && !validUuid(uuid))) {
    response.status(400).json({ error: 'Enter the speaker’s local IPv4 address.' });
    return;
  }
  if (setupBusy) { response.status(409).json({ error: 'A setup operation is already in progress.' }); return; }
  setupBusy = true;
  try {
    const candidates = address ? [address] : await discoverSpeakers();
    const matches = await Promise.allSettled(candidates.map(async (candidate) => ({
      address: candidate, speaker: await setup.verify(candidate, uuid),
    })));
    const match = matches.find((result) => result.status === 'fulfilled');
    if (!match) {
      response.status(404).json({ error: 'Could not find that speaker on the home network. Check Wi-Fi or enter its IP address.' });
      return;
    }
    registry.remember([{ ...match.value.speaker, address: match.value.address }], match.value.speaker.uuid);
    response.json(match.value.speaker);
  } catch {
    response.status(502).json({ error: 'Could not save the selected speaker. Try again.' });
  } finally { setupBusy = false; }
});

function writeFailure(response: express.Response, error: unknown, message: string) {
  const conflict = error instanceof GroupConflict || error instanceof InputConflict || error instanceof PlaybackConflict || error instanceof ToneConflict || error instanceof TuningConflict;
  const detail = conflict || error instanceof RoomUnavailable || (error instanceof Error && /^The amplifier |^Could not (confirm|restore)/.test(error.message));
  response.status(conflict ? 409 : 502).json({ error: detail ? error.message : message });
}

app.post('/api/speaker/level', express.json({ limit: '1kb' }), async (request, response) => {
  const level = parseLevelChange(request.body);
  if (!level) {
    response.status(400).json({ error: 'Send a volume from 0 to 100 or a mute setting.' });
    return;
  }
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  try {
    response.json(await mutate([selected], async () => configuredSpeaker((await verifyRoom(selected)).address).change(level)));
  } catch (error) {
    writeFailure(response, error, 'Could not confirm the change. Refresh to check the current setting.');
  }
});

app.post('/api/speaker/input', express.json({ limit: '1kb' }), async (request, response) => {
  const input = parseInputChange(request.body);
  if (!input) { response.status(400).json({ error: 'Choose a valid input.' }); return; }
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  try {
    const state = await mutate([selected], async () => {
      const deadline = AbortSignal.timeout(12500);
      const room = await verifyRoom(selected, deadline);
      return createSpeaker((command) => requestDevice(room.address, command, deadline)).switchInput(input);
    }, true);
    response.json(state);
  } catch (error) {
    writeFailure(response, error, 'Could not confirm the input change. Check the selected input before trying again.');
  }
});

app.post('/api/speaker/playback', express.json({ limit: '1kb' }), async (request, response) => {
  const change = parsePlaybackChange(request.body);
  if (!change) { response.status(400).json({ error: 'Choose Pause or Resume for the current source.' }); return; }
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  try {
    const state = await mutate([selected], async () => {
      const deadline = AbortSignal.timeout(12500);
      const room = await verifyRoom(selected, deadline);
      return createSpeaker((command) => requestDevice(room.address, command, deadline)).setPlayback(change);
    }, true);
    response.json(state);
  } catch (error) {
    writeFailure(response, error, 'Could not confirm the playback change. Refresh to check Now playing.');
  }
});

function toneController(address: string) {
  let tones = tonesByAddress.get(address);
  if (!tones) {
    tones = createToneController(address);
    tonesByAddress.set(address, tones);
  }
  return tones;
}

app.get('/api/speaker/tone', async (request, response) => {
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  try {
    response.json(await toneController((await verifyRoom(selected)).address).read());
  } catch {
    response.status(502).json({ error: 'Could not read tone settings from the amplifier. Try again.' });
  }
});

app.post('/api/speaker/tone', express.json({ limit: '1kb' }), async (request, response) => {
  const change = parseToneChange(request.body);
  if (!change) {
    response.status(400).json({ error: 'Choose bass, mid or treble and a whole number from −10 to +10.' });
    return;
  }
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  try {
    const gain = await mutate([selected], async () => toneController((await verifyRoom(selected)).address).change(change));
    response.json({ band: change.band, gain });
  } catch (error) {
    writeFailure(response, error, 'Could not confirm the tone change. Refresh tone settings and try again.');
  }
});

const tuningSweep = createSweepPlayback();

app.get('/api/tuning/sweep/:token', (request, response) => {
  const wav = tuningSweep.read(request.params.token, request.socket.remoteAddress);
  if (!wav) { response.sendStatus(404); return; }
  response.type('audio/wav').send(wav);
});

app.post('/api/tuning/measure', setupJson, async (request, response) => {
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  try {
    const volume = await mutate([selected], async () => {
      if (host.startsWith('127.')) throw new TuningConflict('Bind the bridge to its LAN address so the speaker can fetch the sweep.');
      const room = await verifyRoom(selected);
      const [state, group] = await Promise.all([configuredSpeaker(room.address).read(), createGroup(requestDevice).read(room.address)]);
      verifySweepPlayback(state, group, request.body?.expectedVolume);
      const token = tuningSweep.issue(room.address);
      const reply = await requestDevice(room.address, `setPlayerCmd:play:http://${host}:${port}/api/tuning/sweep/${token}`).catch(() => null);
      if (reply !== null && reply.trim() !== 'OK') throw new Error('The amplifier rejected the test sweep.');
      return state.volume;
    }, true);
    response.json({ measuring: true, volume });
  } catch (error) {
    writeFailure(response, error, 'Could not start the test sweep. Check the speaker and try again.');
  }
});

app.post('/api/tuning/eq', setupJson, async (request, response) => {
  const original = parseTuningSettings(request.body?.expected);
  const target = parseTuningSettings(request.body?.target);
  const selected = requestedRoom(request.query.room);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  if (!original || !target) { response.status(400).json({ error: 'Send both valid EQ profiles.' }); return; }
  try {
    response.json(await mutate([selected], async () => {
      const room = await verifyRoom(selected);
      verifyTuningRoom(await createGroup(requestDevice).read(room.address));
      return toneController(room.address).replace(original, target);
    }, true));
  } catch (error) {
    writeFailure(response, error, 'Could not confirm the EQ change. Check Tone controls and try again.');
  }
});

app.get('/api/rooms/:id/group', async (request, response) => {
  const selected = registry.get(request.params.id);
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  const deadline = AbortSignal.timeout(6500);
  try {
    const host = await verifyRoom(selected, deadline);
    const group = createGroup((address, command) => requestDevice(address, command, deadline));
    response.json(await group.read(host.address));
  } catch (error) { writeFailure(response, error, 'Could not read this group. Refresh to try again.'); }
});

app.post('/api/rooms/:id/group', setupJson, async (request, response) => {
  const action = parseGroupAction(request.body);
  const selected = registry.get(request.params.id);
  if (!action) { response.status(400).json({ error: 'Choose a valid group action.' }); return; }
  if (!selected) { response.status(404).json({ error: 'Choose a saved speaker first.' }); return; }
  const joining = action.action === 'join' ? registry.get(action.memberId) : undefined;
  if (action.action === 'join' && !joining) { response.status(404).json({ error: 'Find and add that speaker before grouping it.' }); return; }

  const deadline = AbortSignal.timeout(11000);
  try {
    const state = await mutate(joining ? [selected, joining] : [selected], async () => {
      const [host, guest] = await Promise.all([verifyRoom(selected, deadline), joining && verifyRoom(joining, deadline)]);
      const group = createGroup((address, command) => requestDevice(address, command, deadline));
      return group.change(host.address, action, guest?.address);
    }, true);
    response.json(state);
  } catch (error) { writeFailure(response, error, 'Could not confirm the group change. Refresh the group before trying again.'); }
});
app.use('/api', (_request, response) => response.status(404).json({ error: 'Unknown Clear Two endpoint.' }));

if (development) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true, hmr: { server } } });
  app.use(vite.middlewares);
} else {
  app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
}

server.listen(port, host, () => console.log(`Clear Two is running at http://${host}:${port}`));
secureServer?.listen(tlsPort, host, () => console.log(`Clear Two microphone access is available at https://${host}:${tlsPort}`));
if (host !== '127.0.0.1') {
  createServer(app).listen(port, '127.0.0.1', () => console.log(`Clear Two setup is available at http://127.0.0.1:${port}`));
}
