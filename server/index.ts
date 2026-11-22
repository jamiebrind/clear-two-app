import { createServer } from 'node:http';
import { isIPv4 } from 'node:net';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createSpeaker, parseLevelChange } from '../src/speaker.ts';
import { createToneController, parseToneChange } from './tone.ts';

const amplifier = process.env.CLEAR_TWO_SPEAKER_IP ?? '';
const host = process.env.CLEAR_TWO_HOST ?? '127.0.0.1';
const port = Number(process.env.CLEAR_TWO_PORT ?? 4273);
const development = process.argv.includes('--dev');

if (!isIPv4(amplifier) || amplifier === '0.0.0.0') {
  throw new Error('Set CLEAR_TWO_SPEAKER_IP to your amplifier’s IPv4 address in .env or your environment.');
}
if (!isIPv4(host) || host === '0.0.0.0' || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Bind the bridge to a specific IPv4 address and a port from 1 to 65535.');
}

const speaker = createSpeaker(async (command) => {
  const url = new URL(`http://${amplifier}/httpapi.asp`);
  url.searchParams.set('command', command);
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`The amplifier returned HTTP ${response.status}.`);
  return response.text();
});
const tones = createToneController(amplifier);

const app = express();
const server = createServer(app);
const allowedHosts = new Set([`${host}:${port}`]);
if (host === '127.0.0.1') allowedHosts.add(`localhost:${port}`);
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
  try {
    response.json(await speaker.read());
  } catch {
    response.status(502).json({ error: `Could not read the amplifier at ${amplifier}. Check that it is on the same network.` });
  }
});

app.use('/api/speaker', (request, response, next) => {
  if (request.method === 'POST' && request.get('origin') !== `http://${request.get('host')}`) {
    response.status(403).json({ error: 'Open Clear Two directly to use the controls.' });
    return;
  }
  next();
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
