import { analyzeSweep, sweepSeconds } from './roomTuning.ts';

function wait(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { window.clearTimeout(id); reject(signal.reason); };
    const id = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function captureSweep(play: (mic: string | undefined) => Promise<unknown>, signal: AbortSignal) {
  signal.throwIfAborted();
  const audio = new AudioContext();
  let stream: MediaStream | undefined;
  let worklet: AudioWorkletNode | undefined;
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); });
  signal.addEventListener('abort', abort, { once: true });
  try {
    const resume = audio.resume();
    void resume.catch(() => {});
    // Ask for the microphone from the button's user gesture on Safari.
    try {
      const permission = navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      }).then((granted) => {
        // A browser can grant permission after the user cancels in Clear Two.
        if (signal.aborted) {
          granted.getTracks().forEach((track) => track.stop());
          signal.throwIfAborted();
        }
        stream = granted;
        return granted;
      });
      stream = await Promise.race([permission, cancelled]);
    } catch {
      signal.throwIfAborted();
      throw new Error('Allow microphone access to take a room measurement.');
    }
    signal.throwIfAborted();
    await Promise.race([resume, cancelled]);
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) {
      throw new Error('This microphone applies voice processing. Try another browser or microphone.');
    }
    await Promise.race([audio.audioWorklet.addModule(new URL('./tuningCapture.js', import.meta.url)), cancelled]);
    signal.throwIfAborted();
    worklet = new AudioWorkletNode(audio, 'tuning-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    const chunks: Float32Array[] = [];
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => { chunks.push(data); };
    audio.createMediaStreamSource(stream).connect(worklet);
    await wait(450, signal);
    await Promise.race([play(settings.deviceId), cancelled]);
    await wait((sweepSeconds + 5) * 1000, signal);
    if (track.readyState !== 'live' || audio.state !== 'running') throw new Error('Microphone capture was interrupted. Try this position again.');
    const samples = new Float32Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    return analyzeSweep(samples, audio.sampleRate);
  } finally {
    signal.removeEventListener('abort', abort);
    worklet?.disconnect();
    worklet?.port.close();
    stream?.getTracks().forEach((track) => track.stop());
    if (audio.state !== 'closed') void audio.close().catch(() => {});
  }
}
