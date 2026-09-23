import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AudioContext as NativeAudioContext } from 'node-web-audio-api';
import { PRESETS } from '../presets';
import type { Patch } from '../types';
import { AudioEngine } from './engine';

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const Native = NativeAudioContext as typeof AudioContext;

// The native Web Audio implementation renders on a silent sink in CI. The exact
// same AudioEngine code and patch graphs run in the browser without this adapter.
class SilentAudioContext extends Native {
  constructor(options?: AudioContextOptions) { super({ ...options, sinkId: { type: 'none' } } as AudioContextOptions); }
}

describe('native rendered audio graph', () => {
  beforeAll(() => {
    vi.stubGlobal('AudioContext', SilentAudioContext);
    vi.stubGlobal('window', globalThis);
  });
  afterAll(() => vi.unstubAllGlobals());

  it('renders sequenced bass, cuts output cable, supports 8 pad voices and panics to silence', async () => {
    const engine = new AudioEngine();
    const sample = async (duration: number) => {
      let maxRms = 0, maxPeak = 0;
      for (let elapsed = 0; elapsed < duration; elapsed += 35) {
        await wait(35);
        const { rms, peak } = engine.getDiagnostics();
        maxRms = Math.max(maxRms, rms); maxPeak = Math.max(maxPeak, peak);
      }
      return { rms: maxRms, peak: maxPeak };
    };
    try {
      await engine.start(PRESETS[0]);
      const bass = await sample(700);
      expect(bass.rms, 'sequenced bass has actual output energy').toBeGreaterThan(0.0002);
      expect(bass.peak, 'the post-master signal is bounded').toBeLessThanOrEqual(0.801);

      engine.setPatch({ ...PRESETS[0], cables: PRESETS[0].cables.filter(cable => cable.to !== 'out') });
      await wait(180);
      const unplugged = await sample(140);
      expect(unplugged.rms, 'unplugged output has no signal').toBeLessThan(0.0001);

      engine.panic();
      await engine.start(PRESETS[1]);
      const notes = [48, 52, 55, 59, 60, 64, 67, 71];
      notes.forEach(note => engine.noteOn(note));
      expect(engine.getSnapshot().activeNotes).toHaveLength(8);
      expect(engine.getDiagnostics().voices).toBeGreaterThanOrEqual(8);
      await wait(750);
      const pad = await sample(120);
      expect(pad.rms, 'eight sustained pad notes are audible').toBeGreaterThan(0.0003);
      expect(engine.getAnalyser('env'), 'CV envelope exposes actual analyser').not.toBeNull();
      expect(engine.getAnalyser('out')).toBe(engine.getAnalyser());

      engine.panic();
      const cvPatch: Patch = {
        ...PRESETS[1], id: 'native-cv', master: 0.5,
        modules: PRESETS[1].modules.filter(module => ['keys', 'osc', 'env', 'amp', 'out'].includes(module.id)).map(module => {
          if (module.id === 'osc') return { ...module, params: { ...module.params, waveform: 'sine', level: 0.55 } };
          if (module.id === 'env') return { ...module, params: { ...module.params, attack: 2, sustain: 1 } };
          if (module.id === 'amp') return { ...module, params: { gain: 0.8 } };
          return module;
        }),
        cables: [
          { id: 'note', from: 'keys', fromPort: 'note', to: 'osc', toPort: 'note' },
          { id: 'gate', from: 'keys', fromPort: 'gate', to: 'env', toPort: 'gate' },
          { id: 'tone', from: 'osc', fromPort: 'audio', to: 'amp', toPort: 'audio' },
          { id: 'cv', from: 'env', fromPort: 'cv', to: 'amp', toPort: 'gain' },
          { id: 'speaker', from: 'amp', fromPort: 'audio', to: 'out', toPort: 'audio' },
        ],
      };
      await engine.start(cvPatch);
      engine.noteOn(60);
      const shaped = await sample(120);
      engine.setPatch({ ...cvPatch, cables: cvPatch.cables.filter(cable => cable.id !== 'cv') });
      await wait(170);
      const unshaped = await sample(140);
      expect(unshaped.rms, 'unplugging envelope CV changes actual rendered amplifier gain').toBeGreaterThan(shaped.rms * 3);

      engine.panic();
      await wait(120);
      const silent = await sample(90);
      expect(silent.rms, 'panic after a live graph edit clears effects and sources').toBeLessThan(0.0001);
      console.info('Native rendered audio RMS/peak:', JSON.stringify({ bass, unplugged, pad, shaped, unshaped, panic: silent }));
    } finally { engine.dispose(); }
  }, 15_000);

  it('records the rendered master into a decodable nonzero WAV fallback', async () => {
    const engine = new AudioEngine();
    try {
      await engine.start(PRESETS[0]);
      await engine.startRecording();
      await wait(850);
      const recording = await engine.stopRecording();
      expect(recording.extension).toBe('wav');
      expect(recording.blob.size).toBeGreaterThan(1000);
      const decoding = new SilentAudioContext();
      try {
        const decoded = await decoding.decodeAudioData(await recording.blob.arrayBuffer());
        const samples = decoded.getChannelData(0);
        let power = 0;
        for (const sample of samples) power += sample * sample;
        const rms = Math.sqrt(power / samples.length);
        console.info('Native recorded WAV:', JSON.stringify({ bytes: recording.blob.size, seconds: decoded.duration, rms }));
        expect(decoded.duration).toBeGreaterThan(0.5);
        expect(rms).toBeGreaterThan(0.0002);
      } finally { await decoding.close(); }
    } finally { engine.dispose(); }
  }, 8_000);

  it('renders every preset and keeps a real bounded effect tail until panic', async () => {
    const engine = new AudioEngine();
    const readings: Record<string, number> = {};
    try {
      for (const preset of PRESETS) {
        engine.panic();
        await engine.start(preset);
        if (!preset.modules.some(module => module.type === 'sequencer')) engine.noteOn(60);
        let maxRms = 0;
        for (let i = 0; i < 9; i++) { await wait(45); maxRms = Math.max(maxRms, engine.getDiagnostics().rms); }
        readings[preset.id] = maxRms;
        expect(maxRms, `${preset.name} actually sounds`).toBeGreaterThan(0.0002);
      }
      const tailPatch: Patch = {
        ...PRESETS[1], id: 'native-tail',
        modules: PRESETS[1].modules.map(module => {
          if (module.id === 'env') return { ...module, params: { ...module.params, attack: 0.005, release: 0.01 } };
          if (module.id === 'delay') return { ...module, params: { ...module.params, time: 0.16, feedback: 0.65, mix: 0.85 } };
          if (module.id === 'reverb') return { ...module, params: { ...module.params, size: 0.85, mix: 0.75 } };
          return module;
        }),
      };
      engine.panic(); await engine.start(tailPatch);
      engine.noteOn(60); await wait(180); engine.noteOff(60);
      await wait(110); // direct note is released; delayed echoes remain
      let tailRms = 0;
      for (let i = 0; i < 7; i++) { await wait(35); tailRms = Math.max(tailRms, engine.getDiagnostics().rms); }
      expect(tailRms, 'feedback delay and reverb have audible tails').toBeGreaterThan(0.0002);
      engine.panic(); await wait(140);
      expect(engine.getDiagnostics().rms, 'panic also kills feedback tails').toBeLessThan(0.0001);
      console.info('Native preset/effect RMS:', JSON.stringify({ presets: readings, effectTail: tailRms, panic: engine.getDiagnostics().rms }));
    } finally { engine.dispose(); }
  }, 12_000);

  it('ramps a live filter cutoff and changes rendered output energy', async () => {
    const engine = new AudioEngine();
    const filterPatch: Patch = {
      ...PRESETS[2], id: 'native-filter', master: 0.5,
      modules: PRESETS[2].modules.filter(module => ['keys', 'osc', 'filter', 'amp', 'out'].includes(module.id)).map(module => {
        if (module.id === 'osc') return { ...module, params: { ...module.params, waveform: 'sawtooth', level: 0.55 } };
        if (module.id === 'filter') return { ...module, params: { ...module.params, cutoff: 100, mode: 'lowpass' } };
        if (module.id === 'amp') return { ...module, params: { gain: 0.8 } };
        return module;
      }),
      cables: [
        { id: 'n', from: 'keys', fromPort: 'note', to: 'osc', toPort: 'note' },
        { id: '1', from: 'osc', fromPort: 'audio', to: 'filter', toPort: 'audio' },
        { id: '2', from: 'filter', fromPort: 'audio', to: 'amp', toPort: 'audio' },
        { id: '3', from: 'amp', fromPort: 'audio', to: 'out', toPort: 'audio' },
      ],
    };
    try {
      await engine.start(filterPatch); engine.noteOn(60);
      await wait(180);
      const low = engine.getDiagnostics().rms;
      engine.setPatch({ ...filterPatch, modules: filterPatch.modules.map(module => module.id === 'filter' ? { ...module, params: { ...module.params, cutoff: 10000 } } : module) });
      await wait(200); // AudioParam ramp settles
      const high = engine.getDiagnostics().rms;
      console.info('Native filter response:', JSON.stringify({ lowCutoffRms: low, highCutoffRms: high }));
      expect(high, 'opening lowpass passes more harmonics and fundamental').toBeGreaterThan(low * 3);
    } finally { engine.dispose(); }
  }, 5_000);

  it('preserves a short gate during a long envelope attack and releases smoothly', async () => {
    const engine = new AudioEngine();
    const patch: Patch = {
      ...PRESETS[0], id: 'short-gate', tempo: 60, master: 0.5,
      modules: PRESETS[0].modules.filter(module => ['seq', 'osc', 'env', 'amp', 'out'].includes(module.id)).map(module => {
        if (module.id === 'seq') return { ...module, params: { ...module.params, rate: 1, gate: 0.1, evolve: 0 } };
        if (module.id === 'env') return { ...module, params: { ...module.params, attack: 0.8, release: 0.2, sustain: 1 } };
        return module;
      }),
      cables: [
        { id: 'note', from: 'seq', fromPort: 'note', to: 'osc', toPort: 'note' },
        { id: 'gate', from: 'seq', fromPort: 'gate', to: 'env', toPort: 'gate' },
        { id: 'tone', from: 'osc', fromPort: 'audio', to: 'amp', toPort: 'audio' },
        { id: 'shape', from: 'env', fromPort: 'cv', to: 'amp', toPort: 'gain' },
        { id: 'speaker', from: 'amp', fromPort: 'audio', to: 'out', toPort: 'audio' },
      ],
      steps: PRESETS[0].steps.map((step, index) => ({ ...step, active: index === 0 })),
    };
    const envelopePeak = () => {
      const analyser = engine.getAnalyser('env')!;
      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      return Math.max(...samples);
    };
    try {
      await engine.start(patch);
      await wait(95);
      const attack = envelopePeak();
      const attackMaster = engine.getDiagnostics().rms;
      await wait(90);
      const release = envelopePeak();
      const releaseMaster = engine.getDiagnostics().rms;
      await wait(160);
      const ending = envelopePeak();
      const endingMaster = engine.getDiagnostics().rms;
      console.info('Native short-gate envelope peaks:', JSON.stringify({ attack, release, ending, attackMaster, releaseMaster, endingMaster }));
      expect(attack, 'the scheduled short gate must not erase the attack').toBeGreaterThan(0.01);
      expect(release, 'the release must remain bounded below the unscheduled full attack').toBeLessThan(0.25);
      expect(ending, 'the released envelope decays instead of sticking').toBeLessThan(release * 0.3);
      engine.panic();
      const heldPatch: Patch = { ...PRESETS[1], modules: PRESETS[1].modules.map(module => module.id === 'env'
        ? { ...module, params: { ...module.params, attack: 0.02, release: 0.1 } } : module) };
      await engine.start(heldPatch); engine.noteOn(60); await wait(130);
      const held = envelopePeak();
      engine.noteOff(60); await wait(180);
      const heldEnding = envelopePeak();
      console.info('Native held-gate release peaks:', JSON.stringify({ held, heldEnding }));
      expect(heldEnding, 'a held note must release instead of sustaining').toBeLessThan(held * 0.2);
    } finally { engine.dispose(); }
  }, 5_000);

  it('keeps a source released across a same-wiring parameter edit', async () => {
    const engine = new AudioEngine();
    const patch: Patch = {
      ...PRESETS[2], id: 'released-edit', master: 0.5,
      modules: PRESETS[2].modules.filter(module => ['keys', 'osc', 'out'].includes(module.id)),
      cables: [
        { id: 'note', from: 'keys', fromPort: 'note', to: 'osc', toPort: 'note' },
        { id: 'tone', from: 'osc', fromPort: 'audio', to: 'out', toPort: 'audio' },
      ],
    };
    try {
      await engine.start(patch); engine.noteOn(60); await wait(70);
      const sounding = engine.getDiagnostics().rms;
      engine.noteOff(60);
      await wait(75);
      expect(engine.getDiagnostics().voices, 'the released voice remains allocated briefly').toBeGreaterThan(0);
      engine.setPatch({ ...patch, modules: patch.modules.map(module => module.id === 'osc' ? { ...module, params: { ...module.params, level: 0.9 } } : module) });
      await wait(75);
      const afterEdit = engine.getDiagnostics().rms;
      console.info('Native released-source edit RMS:', JSON.stringify({ sounding, afterEdit }));
      expect(sounding).toBeGreaterThan(0.01);
      expect(afterEdit, 'editing level does not re-open a released oscillator').toBeLessThan(0.0002);
    } finally { engine.dispose(); }
  }, 5_000);
});
