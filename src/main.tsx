import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioLines, ChevronDown, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { requestJson } from './client.ts';
import { ToneControls } from './ToneControls.tsx';
import { SpeakerSetup } from './SpeakerSetup.tsx';
import type { LevelChange, SpeakerState } from './speaker.ts';
import './styles.css';

const requestSpeaker = (level?: LevelChange) => requestJson<SpeakerState>(level ? '/api/speaker/level' : '/api/speaker', level);

function App() {
  const [showSetup, setShowSetup] = useState(() => new URLSearchParams(window.location.search).has('setup'));
  const [speaker, setSpeaker] = useState<SpeakerState>();
  const [connection, setConnection] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [connectionError, setConnectionError] = useState('');
  const [controlError, setControlError] = useState('');
  const [draft, setDraft] = useState<number | null>(null);
  const [working, setWorking] = useState(false);
  const reading = useRef<Promise<SpeakerState> | null>(null);
  const changing = useRef(false);

  async function refresh() {
    if (reading.current || changing.current) return;
    reading.current = requestSpeaker();
    try {
      setSpeaker(await reading.current);
      setConnection('online');
      setConnectionError('');
    } catch (error) {
      setConnection('offline');
      setConnectionError(error instanceof Error ? error.message : 'Could not reach the Clear Two bridge.');
    } finally {
      reading.current = null;
    }
  }

  useEffect(() => {
    if (showSetup) return;
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [showSetup]);

  async function applyLevel(level: LevelChange) {
    if (changing.current || connection !== 'online') return;
    changing.current = true;
    setWorking(true);
    setControlError('');
    try {
      await reading.current;
      setSpeaker(await requestSpeaker(level));
      if ('volume' in level) setDraft(null);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Could not confirm the new setting.');
    } finally {
      changing.current = false;
      setWorking(false);
    }
  }

  const volume = draft ?? speaker?.volume;
  const disabled = connection !== 'online' || working;
  const connectionLabel = { connecting: 'Connecting', online: 'Connected', offline: 'Offline' }[connection];

  return (
    <main>
      <header className="masthead">
        <div className="brand"><span className="brand-mark"><AudioLines size={19} aria-hidden="true" /></span>Clear Two</div>
        {!showSetup && <div className={`connection ${connection}`} role="status"><span aria-hidden="true" />{connectionLabel}</div>}
      </header>

      {showSetup ? <SpeakerSetup onClose={() => {
        const url = new URL(window.location.href);
        url.searchParams.delete('setup');
        window.history.replaceState(null, '', url);
        setShowSetup(false);
      }} /> : <section className="room">
        <div className="room-heading">
          <h1>{speaker?.name ?? 'Your speaker'}</h1>
          <button type="button" className="icon-button" onClick={() => void refresh()} aria-label="Refresh speaker status" title="Refresh speaker status" disabled={working}><RefreshCw size={18} /></button>
        </div>
        {connectionError && <p className="feedback" role="status">{connectionError}</p>}
        {!speaker && <button className="primary setup-entry" type="button" onClick={() => setShowSetup(true)}>Add a speaker</button>}

        {speaker && <><section className="playing" aria-labelledby="now-playing">
          <div className="source-icon"><AudioLines size={32} strokeWidth={1.6} aria-hidden="true" /></div>
          <div className="now-playing">
            <h2 id="now-playing">Now playing</h2>
            <p className="track">{speaker?.title ?? speaker?.source ?? 'Waiting for speaker'}</p>
            {speaker && <p className="source">{speaker.title ? [speaker.artist, speaker.source].filter(Boolean).join(' · ') : speaker.status}</p>}
          </div>
          {speaker?.title && <span className="playing-status">{speaker.status}</span>}
        </section>

        <section className="sound" aria-labelledby="sound">
          <div className="sound-heading"><h2 id="sound">Sound</h2><button className="mute" type="button" onClick={() => void applyLevel({ mute: !speaker?.muted })} disabled={disabled || speaker?.muted == null}>
            {speaker?.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}{speaker?.muted ? 'Unmute' : 'Mute'}
          </button></div>
          <label htmlFor="volume">Volume<span>{volume == null ? 'Unavailable' : `${volume}%`}</span></label>
          <input id="volume" type="range" min="0" max="100" value={volume ?? 0} onChange={(event) => setDraft(Number(event.target.value))} disabled={disabled || speaker?.volume == null} />
          <div className="volume-actions"><button type="button" className="primary" disabled={disabled || draft === null || draft === speaker?.volume} onClick={() => { if (draft !== null) void applyLevel({ volume: draft }); }}>Set volume</button></div>
          {controlError && <p className="feedback" role="alert">{controlError}</p>}
        </section>

        {speaker && <ToneControls online={connection === 'online'} />}
        {speaker && <details className="device"><summary>Device information <ChevronDown size={18} aria-hidden="true" /></summary>
          <dl><div><dt>Board</dt><dd>{speaker.model ?? 'Unavailable'}</dd></div><div><dt>Network firmware</dt><dd>{speaker.firmware ?? 'Unavailable'}</dd></div></dl>
        </details>}
        <button type="button" className="setup-entry mute" onClick={() => setShowSetup(true)}>Add a speaker</button></>}
      </section>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
