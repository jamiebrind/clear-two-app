import { createServer } from 'node:http';
import { isIPv4 } from 'node:net';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSpeaker, parseLevelChange } from '../src/speaker.ts';
import { createToneController, parseToneChange } from './tone.ts';
import { createSetup, localAddress, validUuid } from './setup.ts';
import { discoverSpeakers } from './discovery.ts';

const selection = new URL('../speaker.local.json', import.meta.url);
const pendingSelection = new URL('../speaker.local.json.tmp', import.meta.url);
let amplifier = process.env.CLEAR_TWO_SPEAKER_IP ?? '';
try {
  const saved = JSON.parse(readFileSync(selection, 'utf8'));
  if (localAddress(saved.address)) amplifier = saved.address;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const host = process.env.CLEAR_TWO_HOST ?? '127.0.0.1';
const port = Number(process.env.CLEAR_TWO_PORT ?? 4273);
const development = process.argv.includes('--dev');

if (amplifier && (!isIPv4(amplifier) || amplifier === '0.0.0.0')) {
  throw new Error('Set CLEAR_TWO_SPEAKER_IP to your amplifier’s IPv4 address in .env or your environment.');
}
if (!isIPv4(host) || host === '0.0.0.0' || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Bind the bridge to a specific IPv4 address and a port from 1 to 65535.');
}

async function requestDevice(address: string, command: string) {
  const url = new URL(`http://${address}/httpapi.asp`);
  url.searchParams.set('command', command);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`The amplifier returned HTTP ${response.status}.`);
  return response.text();
}
const setup = createSetup(requestDevice);
const configuredSpeaker = (address: string) => createSpeaker((command) => requestDevice(address, command));
let speaker = configuredSpeaker(amplifier);
let tones = createToneController(amplifier);

const app = express();
const server = createServer(app);
const allowedHosts = new Set([`${host}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`]);
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
  if (!amplifier) {
    response.status(404).json({ error: 'Add a speaker to get started.' });
    return;
  }
  try {
    response.json(await speaker.read());
  } catch {
    response.status(502).json({ error: `Could not read the amplifier at ${amplifier}. Check that it is on the same network.` });
  }
});

app.use('/api', (request, response, next) => {
  if (request.method === 'POST' && request.get('origin') !== `http://${request.get('host')}`) {
    response.status(403).json({ error: 'Open Clear Two directly to use the controls.' });
    return;
  }
  next();
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
    await writeFile(pendingSelection, JSON.stringify({ address: match.value.address }) + '\n');
    await rename(pendingSelection, selection);
    amplifier = match.value.address;
    speaker = configuredSpeaker(amplifier);
    tones = createToneController(amplifier);
    response.json(match.value.speaker);
  } catch {
    response.status(502).json({ error: 'Could not save the selected speaker. Try again.' });
  } finally { setupBusy = false; }
});

let applyingLevel = false;
app.post('/api/speaker/level', express.json({ limit: '1kb' }), async (request, response) => {
  const level = parseLevelChange(request.body);
  if (!level) {
    response.status(400).json({ error: 'Send a volume from 0 to 100 or a mute setting.' });
    return;
  }
  if (applyingLevel) {
    response.status(409).json({ error: 'Another sound change is in progress. Try again.' });
    return;
  }

  applyingLevel = true;
  try {
    response.json(await speaker.change(level));
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('The amplifier')
      ? error.message
      : 'Could not confirm the change. Refresh to check the current setting.';
    response.status(502).json({ error: message });
  } finally {
    applyingLevel = false;
  }
});

app.get('/api/speaker/tone', async (_request, response) => {
  try {
    response.json(await tones.read());
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
  try {
    response.json({ band: change.band, gain: await tones.change(change) });
  } catch {
    response.status(502).json({ error: 'Could not confirm the tone change. Refresh tone settings and try again.' });
  }
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
if (host !== '127.0.0.1') {
  createServer(app).listen(port, '127.0.0.1', () => console.log(`Clear Two setup is available at http://127.0.0.1:${port}`));
}
