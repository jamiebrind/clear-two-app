import workletUrl from './tuningCapture.js?url';
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

export async function captureSweep(play: () => Promise<unknown>, signal: AbortSignal) {
  const audio = new AudioContext();
  let stream: MediaStream | undefined;
  let worklet: AudioWorkletNode | undefined;
  const stop = () => {
    stream?.getTracks().forEach((track) => track.stop());
    if (audio.state !== 'closed') void audio.close().catch(() => {});
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    const resume = audio.resume();
    void resume.catch(() => {});
    // Ask for the microphone from the button's user gesture on Safari.
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch {
      throw new Error('Allow microphone access to take a room measurement.');
    }
    signal.throwIfAborted();
    await resume;
    const track = stream.getAudioTracks()[0];
    const settings = track.getSettings();
    if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) {
      throw new Error('This microphone applies voice processing. Try another browser or microphone.');
    }
    await audio.audioWorklet.addModule(workletUrl);
    worklet = new AudioWorkletNode(audio, 'tuning-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
    const chunks: Float32Array[] = [];
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => { chunks.push(data); };
    audio.createMediaStreamSource(stream).connect(worklet);
    await wait(450, signal);
    await play();
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
    signal.removeEventListener('abort', stop);
    worklet?.disconnect();
    worklet?.port.close();
    stop();
  }
}
