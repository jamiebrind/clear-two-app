import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { requestJson } from './client.ts';
import { toneBands } from './tone.ts';
import type { ToneChange, ToneSettings } from './tone.ts';

const labels = { bass: 'Bass', mid: 'Mid', treble: 'Treble' };
export function ToneControls({ roomId, online }: { roomId?: string; online: boolean }) {
  const [settings, setSettings] = useState<ToneSettings>();
  const [draft, setDraft] = useState<Partial<ToneSettings>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const running = useRef(false);
  const endpoint = `/api/speaker/tone${roomId ? `?room=${encodeURIComponent(roomId)}` : ''}`;

  async function update(change?: ToneChange) {
    if (running.current || !online) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      if (change) {
        const { band, gain } = await requestJson<ToneChange>(endpoint, change);
        setSettings((current) => current && { ...current, [band]: gain });
        setDraft((current) => ({ ...current, [band]: undefined }));
      } else {
        setSettings(await requestJson<ToneSettings>(endpoint));
        setDraft({});
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Tone controls are unavailable.');
      if (change) {
        setDraft((current) => ({ ...current, [change.band]: undefined }));
        try { setSettings(await requestJson<ToneSettings>(endpoint)); }
        catch { setSettings(undefined); }
      }
    } finally {
      setBusy(false);
      running.current = false;
    }
  }

  useEffect(() => {
    if (open && online) void update();
  }, [open, online]);

  return (
    <details className="device tone" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Tone controls <ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="tone-body" aria-busy={busy}>
        <p>Adjust the amplifier’s bass, mid and treble.</p>
        {settings && toneBands.map((band) => {
          const gain = draft[band] ?? settings[band];
          return <div className="tone-row" key={band}>
            <label htmlFor={`tone-${band}`}><span>{labels[band]}</span><span id={`gain-${band}`}>{gain > 0 ? '+' : ''}{gain} dB</span></label>
            <div className="tone-input">
              <input id={`tone-${band}`} aria-label={labels[band]} aria-describedby={`gain-${band}`} type="range" min="-10" max="10" value={gain} disabled={!online || busy}
                onChange={(event) => setDraft({ ...draft, [band]: Number(event.target.value) })} />
              <button type="button" className="primary" aria-label={`Apply ${labels[band].toLowerCase()}`} disabled={!online || busy || gain === settings[band]} onClick={() => void update({ band, gain })}>Apply</button>
            </div>
          </div>;
        })}
        {error && <p className="feedback" role="alert">{error}</p>}
        <button type="button" className="mute tone-refresh" disabled={!online || busy} onClick={() => void update()}>{busy ? 'Working…' : 'Refresh tone settings'}</button>
      </div>
    </details>
  );
}
