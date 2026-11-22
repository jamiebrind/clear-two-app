import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { requestJson } from './client.ts';
import { nativePhone } from './connection.ts';
import { captureSweep } from './captureSweep.ts';
import { recommendTuning, tuningVolumeLimit } from './roomTuning.ts';
import { toneBands, type ToneSettings } from './tone.ts';

type Profile = { original: ToneSettings; tuned: ToneSettings };
const positionPrompts = ['your usual listening position', 'slightly to the left', 'slightly to the right'];
const same = (first: ToneSettings, second: ToneSettings) => toneBands.every((band) => first[band] === second[band]);
const gain = (value: number) => `${value > 0 ? '+' : ''}${value} dB`;

function loadProfile(key: string): Profile | null {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null');
    return value && [value.original, value.tuned].every((settings) => settings && toneBands.every((band) =>
      Number.isInteger(settings[band]) && Math.abs(settings[band]) <= 10)) ? value : null;
  } catch { return null; }
}

export function RoomTuning({ roomId, online, onEqChange }: { roomId?: string; online: boolean; onEqChange: () => void }) {
  const query = roomId ? `?room=${encodeURIComponent(roomId)}` : '';
  const profileKey = `clear-two-tuning:${roomId ?? 'configured'}`;
  const [profile, setProfile] = useState(() => loadProfile(profileKey));
  const [measurements, setMeasurements] = useState<ToneSettings[]>([]);
  const [recording, setRecording] = useState(false);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [restart, setRestart] = useState(false);
  const capture = useRef<AbortController | null>(null);
  const baseline = useRef<{ tone: ToneSettings; volume: number; mic: string | undefined } | null>(null);
  const canRecord = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioWorkletNode !== 'undefined';

  useEffect(() => () => capture.current?.abort(), []);

  async function measure() {
    if (capture.current || !online || !canRecord || profile) return;
    const controller = new AbortController();
    capture.current = controller;
    setRecording(true);
    setError('');
    setNotice('');
    try {
      const result = await captureSweep(async (mic) => {
        const current = await requestJson<ToneSettings>(`/api/speaker/tone${query}`);
        controller.signal.throwIfAborted();
        const previous = baseline.current;
        if (previous && (!same(current, previous.tone) || previous.mic !== mic)) {
          setRestart(true);
          throw new Error('The EQ or microphone changed between measurements. Start over with the current setup.');
        }
        const { volume } = await requestJson<{ volume: number }>(`/api/tuning/measure${query}`,
          previous ? { expectedVolume: previous.volume } : {}, 13000);
        controller.signal.throwIfAborted();
        if (!Number.isInteger(volume) || volume < 1 || volume > tuningVolumeLimit) {
          throw new Error('Clear Two could not confirm the measurement volume. Refresh the speaker and try again.');
        }
        if (previous && previous.volume !== volume) {
          setRestart(true);
          throw new Error('The volume changed between measurements. Start over at a consistent volume.');
        }
        baseline.current = { tone: current, volume, mic };
      }, controller.signal);
      const next = [...measurements, result];
      if (next.length === 3 && baseline.current) {
        try {
          const original = baseline.current.tone;
          setProfile({ original, tuned: recommendTuning(next, original) });
        } catch (error) {
          setRestart(true);
          throw error;
        }
      }
      setMeasurements(next);
    } catch (problem) {
      if (controller.signal.aborted) setNotice('Measurement cancelled. Any sweep already started will finish on its own.');
      else setError(problem instanceof Error ? problem.message : 'Could not measure this position. Try again.');
      if (!measurements.length) baseline.current = null;
    } finally {
      capture.current = null;
      setRecording(false);
    }
  }

  async function selectProfile(which: keyof Profile) {
    if (!profile || applying || !online) return;
    setApplying(true);
    setError('');
    setNotice('');
    try {
      // Preserve the original EQ before the first write, including across a page reload.
      localStorage.setItem(profileKey, JSON.stringify(profile));
      const current = await requestJson<ToneSettings>(`/api/speaker/tone${query}`);
      if (!same(current, profile.original) && !same(current, profile.tuned)) {
        throw new Error('The EQ was changed separately. Check Tone controls against the original settings below.');
      }
      if (!same(current, profile[which])) {
        await requestJson<ToneSettings>(`/api/tuning/eq${query}`, { expected: current, target: profile[which] }, 18000);
      }
      setNotice(which === 'original' ? 'Original EQ active.' : 'Tuned EQ active.');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not change EQ.');
    } finally {
      onEqChange();
      setApplying(false);
    }
  }

  function startOver() {
    if (profile) {
      try { localStorage.removeItem(profileKey); }
      catch { setError('Could not clear the saved profile from this browser.'); return; }
    }
    baseline.current = null;
    setProfile(null);
    setMeasurements([]);
    setRestart(false);
    setNotice('');
    setError('');
  }

  return <details className="device" onToggle={(event) => { if (!event.currentTarget.open) capture.current?.abort(); }}>
    <summary>Room tuning <span className="tuning-tag">Experimental</span><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="tone-body tuning" aria-busy={applying}>
      {!profile && <>
        <p>Ungroup the speaker, select Wi-Fi / Network, pause or stop playback, and keep the speaker at the same volume (1–{tuningVolumeLimit}%) for all three positions. The test sweep can replace the current queue.</p>
        <p>{recording ? 'Measuring. Keep the microphone still until the sweep finishes.' : `Position ${measurements.length + 1} of 3. Hold the microphone at ear height ${positionPrompts[measurements.length]}.`}</p>
        {!recording && <p>Keep the microphone pointed the same way. A cut is suggested only when bass or treble measures high relative to the midrange at all three positions.</p>}
        {!canRecord && <p className="feedback" role="status">{nativePhone ? 'Microphone capture is unavailable on this device.' : 'Open Clear Two over trusted HTTPS on your phone, or use localhost on the bridge computer, to enable the microphone.'}</p>}
        {recording ? <button className="mute" type="button" onClick={() => capture.current?.abort()}>Cancel measurement</button>
          : <button className="primary" type="button" disabled={!online || !canRecord || restart} onClick={() => void measure()}>Measure position</button>}
        {!recording && (measurements.length > 0 || restart) && <button className="mute" type="button" onClick={startOver}>Start over</button>}
      </>}
      {profile && <>
        <p>{same(profile.original, profile.tuned) ? 'The measurements did not suggest an EQ change.' : 'Compare both settings with familiar music at the same volume.'}</p>
        <table className="tuning-result"><thead><tr><th scope="col">Band</th><th scope="col">Original</th><th scope="col">Tuned</th></tr></thead>
          <tbody>{toneBands.map((band) => <tr key={band}><th scope="row">{band}</th><td>{gain(profile.original[band])}</td><td>{gain(profile.tuned[band])}</td></tr>)}</tbody>
        </table>
        <div className="tuning-actions">
          <button className="primary" type="button" disabled={!online || applying} onClick={() => void selectProfile('tuned')}>Use tuned EQ</button>
          <button className="mute" type="button" disabled={!online || applying} onClick={() => void selectProfile('original')}>Restore original</button>
        </div>
        <details><summary>Start a new tuning</summary>
          <p>A new tuning uses the current speaker EQ as its starting point and clears this comparison.</p>
          <button className="mute" type="button" disabled={applying} onClick={startOver}>Clear comparison</button>
        </details>
      </>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="feedback" role="alert">{error}</p>}
    </div>
  </details>;
}
