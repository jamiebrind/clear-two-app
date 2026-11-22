import { useEffect, useState } from 'react';
import { ArrowLeft, Router, Speaker, Wifi, ShieldCheck } from 'lucide-react';
import { requestJson } from './client.ts';
import { directBrowser, directConnection, iosPhone, speakerLan } from './connection.ts';
import type { SetupProgress, SetupScan, SetupSpeaker } from './setup.ts';

const api = '/api/setup';
type Step = 'start' | 'hotspot' | 'network' | 'join' | 'verify' | 'done';

export function SpeakerSetup({ onClose }: { onClose: (roomId?: string) => void }) {
  const [step, setStep] = useState<Step>('start');
  const [scan, setScan] = useState<SetupScan>();
  const [networkIndex, setNetworkIndex] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [added, setAdded] = useState<SetupSpeaker>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [localSetupUrl, setLocalSetupUrl] = useState('');
  const network = networkIndex === '' ? undefined : scan?.networks[Number(networkIndex)];
  const uuid = scan?.speaker.uuid;
  const isLocal = directConnection || ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  const device = directConnection ? 'this device' : 'this computer';

  useEffect(() => {
    if (isLocal) return;
    let active = true;
    requestJson<{ url: string }>(`${api}/location`).then(({ url }) => {
      if (active) setLocalSetupUrl(url);
    }).catch(() => { /* The startup message also provides the local setup address. */ });
    return () => { active = false; };
  }, [isLocal]);

  useEffect(() => {
    if (step !== 'join' || !uuid) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const state = await requestJson<SetupProgress>(`${api}/progress?uuid=${encodeURIComponent(uuid!)}`);
        if (stopped) return;
        if (state.status === 'bad-password' || state.status === 'failed') {
          setError(state.status === 'bad-password' ? 'The speaker couldn’t join. Check the Wi-Fi password.' : 'The speaker couldn’t join that network. Try again.');
          setStep('network');
        } else if (state.status === 'joined' || state.status === 'hotspot-unavailable') {
          setAddress(state.address ?? '');
          setStep('verify');
        } else {
          timer = setTimeout(() => void check(), 1800);
        }
      } catch {
        if (!stopped) setTimedOut(true);
      }
    }
    const deadline = setTimeout(() => setTimedOut(true), 16000);
    timer = setTimeout(() => void check(), 1200);
    return () => { stopped = true; clearTimeout(timer); clearTimeout(deadline); };
  }, [step, uuid]);

  function go(next: Step) {
    setError('');
    setStep(next);
  }

  async function run(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Could not complete speaker setup.'); }
    finally { setBusy(false); }
  }

  const headings = { start: 'Set up a speaker', hotspot: 'Join the speaker’s Wi-Fi', network: 'Choose your home Wi-Fi',
    join: 'Connecting the speaker', verify: 'Find the speaker on your network', done: 'Speaker added' };
  const Icon = step === 'done' ? ShieldCheck : step === 'start' ? Speaker : step === 'verify' ? Router : Wifi;

  return (
    <section className="setup" aria-labelledby="setup-title" aria-busy={busy}>
      <div className="setup-heading"><span className="source-icon"><Icon size={25} aria-hidden="true" /></span><h1 id="setup-title" aria-live="polite">{headings[step]}</h1></div>
      {!isLocal ? <div className="setup-actions">
        <p>On the computer running the Clear Two bridge, open {localSetupUrl
          ? <code>{localSetupUrl}</code> : 'the local setup address shown when the bridge starts'} to add a speaker.</p>
        <p>If the speaker is already on your network, return to Rooms and use Scan network.</p>
      </div> : <>
        {step === 'start' && <div className="setup-actions">
          <p>Power on your Up2Stream Amp V4.</p>
          <button type="button" className="primary setup-option" onClick={() => go('hotspot')}><Wifi size={19} aria-hidden="true" /> Connect to Wi-Fi</button>
          <button type="button" className="mute setup-option" onClick={() => { setScan(undefined); setAddress(''); go('verify'); }}><Router size={19} aria-hidden="true" /> Add by IP address</button>
          <p>{directBrowser ? 'Direct browser access requires the speaker and browser to allow local HTTP requests. The phone app also supports network discovery.' : 'If the speaker already has Wi-Fi or Ethernet, you can also find it with Scan network in Rooms.'}</p>
        </div>}
        {step === 'hotspot' && <div className="setup-actions">
          <p>On the Amp V4 in Wi-Fi mode, press its mode button twice briefly to enter pairing mode. Wait for the white light to blink slowly.</p>
          <p>Join the speaker’s temporary network, often named <strong>SoundSystem_…</strong>, in Wi-Fi settings on {device}. Then return to Clear Two.</p>
          {iosPhone && <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
            await speakerLan.joinHotspot();
            setScan(await requestJson<SetupScan>(`${api}/scan`)); setNetworkIndex(''); setPassword(''); go('network');
          })}>Join speaker Wi-Fi</button>}
          <button type="button" className="primary" disabled={busy} onClick={() => void run(async () => {
            setScan(await requestJson<SetupScan>(`${api}/scan`)); setNetworkIndex(''); setPassword(''); go('network');
          })}>{busy ? 'Reading Wi-Fi networks…' : 'I’ve joined the speaker’s Wi-Fi'}</button>
          <button type="button" className="mute" disabled={busy} onClick={() => go('start')}>Back</button>
        </div>}
        {step === 'network' && <form className="setup-actions" onSubmit={(event) => {
          event.preventDefault();
          if (!network || !uuid) return;
          void run(async () => {
            const credentials = { uuid, ssid: network.ssid, channel: network.channel, password };
            setPassword('');
            await requestJson(`${api}/join`, credentials);
            setTimedOut(false); go('join');
          });
        }}>
          <p>{scan?.speaker.name} can see these compatible 2.4 GHz networks.</p>
          {!scan?.networks.length && <p>There are no supported networks in the scan. Check that your router has a 2.4 GHz network with WPA2 or open security.</p>}
          <label htmlFor="setup-network">Home Wi-Fi</label>
          <select id="setup-network" value={networkIndex} onChange={(event) => { setNetworkIndex(event.target.value); setPassword(''); }} required>
            <option value="">Choose a network</option>
            {scan?.networks.map((entry, index) => <option key={entry.ssid} value={index}>{entry.ssid}{entry.security === 'Open' ? ' (open)' : ''}</option>)}
          </select>
          {network?.security === 'WPA2' && <><label htmlFor="setup-password">Wi-Fi password</label><input id="setup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={63} autoComplete="off" required /></>}
          <button type="submit" className="primary" disabled={busy || !network}>{busy ? 'Sending settings…' : 'Connect speaker'}</button>
          <button type="button" className="mute" disabled={busy} onClick={() => { setPassword(''); go('hotspot'); }}>Back</button>
        </form>}
        {step === 'join' && <div className="setup-actions">
          <p>Wait for the speaker to join. Its temporary Wi-Fi network may disappear.</p>
          {timedOut && <button type="button" className="primary" onClick={() => go('verify')}>Continue to home Wi-Fi</button>}
        </div>}
        {step === 'verify' && <form className="setup-actions" onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            setAdded(await requestJson<SetupSpeaker>(`${api}/add`, { ...(address.trim() && { address: address.trim() }), ...(uuid && { uuid }) }));
            go('done');
          });
        }}>
          <p>{uuid ? `Reconnect ${device} to your home Wi-Fi, then verify the speaker.` : `Connect ${device} to the same home network as the speaker.`}</p>
          <label htmlFor="setup-address">{uuid && !directBrowser ? 'Speaker IP address (optional)' : 'Speaker IP address'}</label>
          <input id="setup-address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="192.168.1.100" inputMode="decimal" required={!uuid || directBrowser} />
          <button type="submit" className="primary" disabled={busy}>{busy ? 'Checking the home network…' : 'Find and add speaker'}</button>
          <button type="button" className="mute" disabled={busy} onClick={() => go(uuid ? 'hotspot' : 'start')}>Back</button>
        </form>}
        {step === 'done' && <div className="setup-actions"><p>{added?.name} is ready to control.</p><button type="button" className="primary" onClick={() => onClose(added?.uuid.toUpperCase())}>Open speaker controls</button></div>}
      </>}
      {error && <p className="feedback" role="alert">{error}</p>}
      {step !== 'done' && <button type="button" className="setup-cancel" onClick={() => onClose()} disabled={busy}><ArrowLeft size={16} aria-hidden="true" /> Back to rooms</button>}
    </section>
  );
}
