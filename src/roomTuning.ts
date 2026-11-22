import { toneBands, type ToneBand, type ToneSettings } from './tone.ts';

const tones = { bass: [100, 160, 250], mid: [500, 800, 1250], treble: [2000, 3150, 5000] };
const marker = 1700;
const leadIn = 0.3;
const markerLength = 0.24;
const firstTone = 0.6;
const step = 0.56;
const toneLength = 0.46;
export const sweepSeconds = leadIn + firstTone + step * 9 + 0.3;
export const tuningVolumeLimit = 25;

export function sweepSamples(sampleRate: number, gains?: ToneSettings): Float32Array {
  const samples = new Float32Array(Math.ceil(sampleRate * sweepSeconds));
  function writeTone(frequency: number, start: number, duration: number, gain: number) {
    const offset = Math.round(start * sampleRate);
    for (let i = 0; i < Math.round(duration * sampleRate); i++) {
      const time = i / sampleRate;
      const fade = Math.min(1, time / 0.025, (duration - time) / 0.025);
      samples[offset + i] = 0.063 * gain * fade * Math.sin(2 * Math.PI * frequency * time);
    }
  }
  writeTone(marker, leadIn, markerLength, 1);
  let index = 0;
  for (const band of toneBands) {
    for (const frequency of tones[band]) writeTone(frequency, leadIn + firstTone + step * index++, toneLength, gains?.[band] ?? 1);
  }
  return samples;
}

function amplitude(samples: Float32Array, offset: number, count: number, frequency: number, rate: number) {
  const coefficient = 2 * Math.cos(2 * Math.PI * frequency / rate);
  let previous = 0;
  let last = 0;
  for (let i = offset; i < offset + count; i++) {
    const current = samples[i] + coefficient * last - previous;
    previous = last;
    last = current;
  }
  return 2 * Math.sqrt(Math.max(0, last * last + previous * previous - coefficient * last * previous)) / count;
}

function median(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
}

export function analyzeSweep(samples: Float32Array, rate: number): ToneSettings {
  if (rate < 16000 || samples.length < rate * sweepSeconds) throw new Error('The microphone capture was too short or used a low sample rate. Try again.');
  if (samples.filter((sample) => Math.abs(sample) >= 0.985).length > rate * 0.002) {
    throw new Error('The microphone clipped. Lower the speaker volume and start the measurements again.');
  }

  // A brief marker and gap identify when the amplifier actually started playback.
  const block = Math.round(rate * 0.02);
  const levels: number[] = [];
  const searchEnd = samples.length - rate * (sweepSeconds - leadIn - 0.18);
  for (let offset = 0; offset + block <= searchEnd; offset += block) levels.push(amplitude(samples, offset, block, marker, rate));
  const floor = Math.max(0.000025, median(levels.slice(0, 12)) * 7);
  let start = -1;
  for (let i = 1; i + 17 < levels.length; i++) {
    if (levels[i - 1] > floor || levels[i] <= floor) continue;
    const peak = median(levels.slice(i + 2, i + 9));
    if (peak > floor && median(levels.slice(i + 13, i + 18)) < peak * 0.28) {
      start = (i - 1) * block;
      break;
    }
  }
  if (start < 0) throw new Error('Could not find the test sweep. Check that the speaker played it and try again.');

  let index = 0;
  const bands = {} as ToneSettings;
  for (const band of toneBands) {
    const readings: number[] = [];
    for (const frequency of tones[band]) {
      const offset = start + Math.round(rate * (firstTone + step * index++ + 0.11));
      const count = Math.round(rate * 0.22);
      if (offset + count > samples.length) break;
      const signal = amplitude(samples, offset, count, frequency, rate);
      const nearby = Math.max(amplitude(samples, offset, count, frequency - 37, rate), amplitude(samples, offset, count, frequency + 37, rate));
      if (signal > Math.max(0.000035, nearby * 4)) readings.push(20 * Math.log10(signal));
    }
    if (readings.length < 2) throw new Error('The sweep was too quiet or noisy. Move away from background noise and try again.');
    bands[band] = median(readings);
  }
  return bands;
}

export function recommendTuning(measurements: ToneSettings[], original: ToneSettings): ToneSettings {
  if (measurements.length !== 3) throw new Error('Take three measurements before tuning.');
  const result = { ...original };
  for (const band of ['bass', 'treble'] as const satisfies readonly ToneBand[]) {
    const offsets = measurements.map((measurement) => measurement[band] - measurement.mid);
    if (Math.max(...offsets) - Math.min(...offsets) > 10) {
      throw new Error('The measurements didn’t agree. Start again and keep the phone pointed the same way near your seat.');
    }
    const cut = Math.min(3, Math.max(0, Math.round((median(offsets) - 1.5) * 0.65)));
    result[band] = Math.max(-10, original[band] - cut);
  }
  return result;
}
