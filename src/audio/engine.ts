import { MODULE_SPECS, canConnect } from '../modules';
import type { Cable, EngineSnapshot, Patch, PatchModule, RecordingResult, SignalType } from '../types';

const MAX_VOICES = 16;
const EDIT_FADE = 0.065;
const MAX_RELEASE = 5.25;
const MASTER_CEILING = 0.8;

export function finiteClamp(value: unknown, low: number, high: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
}

export function midiFrequency(note: number): number {
  return 440 * 2 ** ((finiteClamp(note, 0, 127, 69) - 69) / 12);
}

/** A valid, independently checked route plan; no Web Audio nodes are created for invalid patches. */
export function planRoutes(patch: Patch): Array<Cable & { signal: SignalType }> {
  if (!patch || !Array.isArray(patch.modules) || !Array.isArray(patch.cables)) throw new Error('Invalid patch graph.');
  if (patch.modules.length > 64 || patch.cables.length > 128) throw new Error('Patch exceeds audio graph limits.');
  const ids = new Set<string>();
  for (const module of patch.modules) {
    if (!module || typeof module.id !== 'string' || ids.has(module.id) || !Object.hasOwn(MODULE_SPECS, module.type)) throw new Error('Invalid or duplicate module.');
    ids.add(module.id);
  }
  const routes: Array<Cable & { signal: SignalType }> = [];
  const cableIds = new Set<string>();
  for (const cable of patch.cables) {
    if (!cable || typeof cable.id !== 'string' || cableIds.has(cable.id)) throw new Error('Invalid or duplicate cable.');
    cableIds.add(cable.id);
    const result = canConnect({ ...patch, cables: routes }, cable.from, cable.fromPort, cable.to, cable.toPort);
    if (!result.ok) throw new Error(`Invalid cable ${cable.id}: ${result.reason}`);
    const source = patch.modules.find(module => module.id === cable.from)!;
    const signal = MODULE_SPECS[source.type].outputs.find(port => port.id === cable.fromPort)!.signal;
    routes.push({ ...cable, signal });
  }
  return routes;
}

type Route = ReturnType<typeof planRoutes>[number];
type VoiceModule = {
  inputs: Record<string, AudioNode>;
  outputs: Record<string, AudioNode>;
  controls: Record<string, AudioParam>;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  update: (module: PatchModule, now: number) => void;
  release?: (at: number) => void;
  cvScales?: Record<string, GainNode>;
};
type Voice = {
  note: number;
  source: string;
  startedAt: number;
  releasedAt: number | null;
  expiresAt: number;
  modules: Map<string, VoiceModule>;
  stop: (at?: number) => void;
};
type Graph = {
  patch: Patch;
  routes: Route[];
  bus: GainNode;
  analysers: Map<string, AnalyserNode>;
  taps: AudioNode[];
  voices: Voice[];
  dispose: () => void;
};
type SequencerClock = { moduleId: string; time: number; index: number };

function param(module: PatchModule, id: string): number {
  const spec = MODULE_SPECS[module.type].params.find(item => item.id === id);
  if (!spec) return 0;
  return finiteClamp(module.params[id], spec.min, spec.max, typeof spec.default === 'number' ? spec.default : spec.min);
}

function option<T extends string>(module: PatchModule, id: string, fallback: T): T {
  const choices = MODULE_SPECS[module.type].params.find(item => item.id === id)?.options;
  const value = module.params[id];
  return typeof value === 'string' && choices?.includes(value) ? value as T : fallback;
}

function ramp(target: AudioParam, value: number, now: number, speed = 0.025): void {
  target.cancelScheduledValues(now);
  target.setTargetAtTime(value, now, speed);
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return buffer;
}

/** PCM WAV is supported even where MediaRecorder cannot encode audio. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const channelCount = Math.max(1, Math.min(2, channels.length));
  const frames = channels[0]?.length ?? 0;
  const bytes = new ArrayBuffer(44 + frames * channelCount * 2);
  const view = new DataView(bytes);
  const ascii = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true); view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, frames * channelCount * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channelCount; c++) {
    const sample = finiteClamp(channels[c]?.[i], -1, 1, 0);
    view.setInt16(offset, sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767), true);
    offset += 2;
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mix: GainNode | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private sink: GainNode | null = null;
  private graph: Graph | null = null;
  private fading = new Set<Graph>();
  private patch: Patch | null = null;
  private playing = false;
  private timer: number | null = null;
  private clocks: SequencerClock[] = [];
  private currentStep = -1;
  private pendingSteps: Array<{ index: number; time: number }> = [];
  private held = new Map<number, number>();
  private recordingStart = 0;
  private recorder: MediaRecorder | null = null;
  private recorderDestination: MediaStreamAudioDestinationNode | null = null;
  private recordedChunks: Blob[] = [];
  private recordingFallback: { processor: ScriptProcessorNode; mute: GainNode; left: Float32Array[]; right: Float32Array[] } | null = null;
  private noise: AudioBuffer | null = null;
  private disposed = false;

  async start(patch: Patch): Promise<void> {
    this.disposed = false;
    planRoutes(patch);
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const ctx = this.ctx;
      this.noise = makeNoise(ctx);
      this.mix = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -12;
      limiter.knee.value = 6;
      limiter.ratio.value = 16;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      const ceiling = ctx.createWaveShaper();
      const curve = new Float32Array(4096);
      for (let i = 0; i < curve.length; i++) {
        const x = i / (curve.length - 1) * 2 - 1;
        curve[i] = Math.tanh(x * 1.35) / Math.tanh(1.35);
      }
      ceiling.curve = curve;
      ceiling.oversample = '2x';
      this.master = ctx.createGain(); this.master.gain.value = 0;
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 2048;
      this.mix.connect(limiter); limiter.connect(ceiling); ceiling.connect(this.master); this.master.connect(this.analyser);
      this.analyser.connect(ctx.destination);
      this.sink = ctx.createGain(); this.sink.gain.value = 0; this.sink.connect(ctx.destination);
    }
    await this.ctx.resume();
    // setPlaying may have been called before the audio context existed.
    if (this.timer === null) this.playing = false;
    this.setPatch(patch);
    this.setPlaying(true);
  }

  setPatch(patch: Patch): void {
    const routes = planRoutes(patch);
    // Copy the patch to prevent callers from changing a playing graph in place.
    const copy: Patch = structuredClone(patch);
    const oldPatch = this.patch;
    this.patch = copy;
    if (!this.ctx || !this.mix || !this.master) return;
    const now = this.ctx.currentTime;
    ramp(this.master.gain, finiteClamp(copy.master, 0, MASTER_CEILING, 0.5), now);
    const sameWiring = !!oldPatch && !!this.graph &&
      oldPatch.modules.length === copy.modules.length && oldPatch.cables.length === copy.cables.length &&
      oldPatch.modules.every((item, i) => item.id === copy.modules[i].id && item.type === copy.modules[i].type) &&
      oldPatch.cables.every((item, i) => {
        const next = copy.cables[i];
        return item.from === next.from && item.fromPort === next.fromPort && item.to === next.to && item.toPort === next.toPort;
      });
    if (sameWiring && this.graph) {
      this.graph.patch = copy; this.graph.routes = routes;
      for (const voice of this.graph.voices) {
        for (const module of copy.modules) {
          const voiceModule = voice.modules.get(module.id);
          voiceModule?.update(module, now);
          if (module.type === 'amplifier' && voiceModule?.cvScales?.gain) {
            ramp(voiceModule.controls.gain, 0, now);
            ramp(voiceModule.cvScales.gain.gain, param(module, 'gain'), now);
          }
        }
      }
    } else {
      const previous = this.graph;
      const next = this.makeGraph(copy, routes);
      this.graph = next;
      if (this.playing) {
        const sequencers = copy.modules.filter(module => module.type === 'sequencer');
        if (sequencers.length !== this.clocks.length || sequencers.some(module => !this.clocks.some(clock => clock.moduleId === module.id))) this.reseedClocks();
        this.startDrone();
      }
      if (previous) for (const voice of previous.voices) {
        if (voice.source === '__drone__' || (voice.releasedAt !== null && voice.releasedAt <= now)) continue;
        if (voice.source.startsWith('keyboard:') && !this.held.has(voice.note)) continue;
        this.trigger(voice.source, voice.note, this.held.get(voice.note) ?? 0.8,
          Math.max(now, voice.startedAt), voice.releasedAt, Math.max(0, now - voice.startedAt));
      }
      if (previous) {
        previous.bus.gain.setValueAtTime(previous.bus.gain.value, now);
        previous.bus.gain.linearRampToValueAtTime(0, now + EDIT_FADE);
        this.fading.add(previous);
        window.setTimeout(() => { previous.dispose(); this.fading.delete(previous); }, Math.ceil((EDIT_FADE + 0.02) * 1000));
      }
      next.bus.gain.setValueAtTime(0, now);
      next.bus.gain.linearRampToValueAtTime(1, now + EDIT_FADE);
    }
  }

  setPlaying(playing: boolean): void {
    if (!this.ctx || !this.patch) { this.playing = playing; return; }
    if (playing && !this.graph) this.graph = this.makeGraph(this.patch, planRoutes(this.patch));
    if (playing === this.playing) return;
    this.playing = playing;
    if (playing) {
      void this.ctx.resume();
      ramp(this.graph!.bus.gain, 1, this.ctx.currentTime, 0.012);
      ramp(this.master!.gain, finiteClamp(this.patch.master, 0, MASTER_CEILING, 0.5), this.ctx.currentTime);
      this.reseedClocks(); this.startDrone();
      this.timer = window.setInterval(() => this.tick(), 25);
      this.tick();
    } else {
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null; this.clocks = []; this.currentStep = -1; this.pendingSteps = [];
      this.held.clear();
      // Stop also clears feedback memories, so playback cannot resurrect an old tail.
      this.graph?.dispose();
      this.graph = null;
      for (const graph of this.fading) graph.dispose();
      this.fading.clear();
    }
  }

  noteOn(note: number, velocity = 1): void {
    if (!this.ctx || !this.patch) return;
    if (!this.graph) this.graph = this.makeGraph(this.patch, planRoutes(this.patch));
    void this.ctx.resume();
    ramp(this.graph.bus.gain, 1, this.ctx.currentTime, 0.012);
    ramp(this.master!.gain, finiteClamp(this.patch.master, 0, MASTER_CEILING, 0.5), this.ctx.currentTime);
    const key = Math.round(finiteClamp(note, 0, 127, 60));
    this.noteOff(key);
    this.held.set(key, finiteClamp(velocity, 0, 1, 1));
    for (const module of this.graph.patch.modules) if (module.type === 'keyboard') {
      this.trigger(`keyboard:${module.id}`, key, velocity, this.ctx.currentTime);
    }
  }

  noteOff(note: number): void {
    if (!this.graph || !this.ctx) return;
    const key = Math.round(finiteClamp(note, 0, 127, 60));
    this.held.delete(key);
    for (const voice of this.graph.voices) {
      if (voice.note === key && voice.source.startsWith('keyboard:') && voice.releasedAt === null) this.release(voice, this.ctx.currentTime);
    }
  }

  panic(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null; this.playing = false; this.held.clear(); this.clocks = []; this.currentStep = -1; this.pendingSteps = [];
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master?.gain.cancelScheduledValues(now);
    this.master?.gain.setValueAtTime(0, now);
    this.graph?.dispose(); this.graph = null;
    for (const graph of this.fading) graph.dispose();
    this.fading.clear();
    // Removing the graph disconnects feedback paths as well as all active oscillators.
  }

  getSnapshot(): EngineSnapshot {
    const now = this.ctx?.currentTime ?? 0;
    this.advanceStep(now);
    return { ready: !!this.ctx && !this.disposed, playing: this.playing, step: this.currentStep,
      activeNotes: [...new Set((this.graph?.voices ?? []).filter(voice => voice.source !== '__drone__' && voice.startedAt <= now && (voice.releasedAt === null || voice.releasedAt > now)).map(voice => voice.note))],
      recording: !!this.recorder || !!this.recordingFallback,
      recordingSeconds: this.recorder || this.recordingFallback ? Math.max(0, now - this.recordingStart) : 0,
      contextState: this.ctx?.state ?? 'uninitialized' };
  }

  getAnalyser(moduleId?: string): AnalyserNode | null {
    if (!moduleId) return this.analyser;
    if (this.graph?.patch.modules.some(module => module.id === moduleId && module.type === 'output')) return this.analyser;
    return this.graph?.analysers.get(moduleId) ?? null;
  }

  /** Measurements from rendered master samples, useful for verification and meters. */
  getDiagnostics(): { rms: number; peak: number; voices: number; routes: number } {
    const analyser = this.analyser;
    if (!analyser) return { rms: 0, peak: 0, voices: 0, routes: 0 };
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let squares = 0, peak = 0;
    for (const sample of samples) { squares += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    return { rms: Math.sqrt(squares / samples.length), peak,
      voices: this.graph?.voices.length ?? 0, routes: this.graph?.routes.length ?? 0 };
  }

  async startRecording(): Promise<void> {
    if (!this.ctx || !this.master || this.recorder || this.recordingFallback) throw new Error('Start audio before recording, or stop the current recording.');
    await this.ctx.resume();
    this.recordingStart = this.ctx.currentTime;
    if (typeof MediaRecorder !== 'undefined') {
      const destination = this.ctx.createMediaStreamDestination();
      this.master.connect(destination);
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      try {
        const recorder = new MediaRecorder(destination.stream, mime ? { mimeType: mime } : undefined);
        this.recordedChunks = [];
        recorder.ondataavailable = event => { if (event.data.size) this.recordedChunks.push(event.data); };
        recorder.start(250);
        this.recorder = recorder; this.recorderDestination = destination;
        return;
      } catch { this.master.disconnect(destination); }
    }
    // Older browsers: record actual rendered master samples into a standard WAV.
    const processor = this.ctx.createScriptProcessor(4096, 2, 2);
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    const left: Float32Array[] = [], right: Float32Array[] = [];
    processor.onaudioprocess = event => {
      left.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      right.push(new Float32Array(event.inputBuffer.getChannelData(1)));
    };
    this.master.connect(processor); processor.connect(mute); mute.connect(this.ctx.destination);
    this.recordingFallback = { processor, mute, left, right };
  }

  async stopRecording(): Promise<RecordingResult> {
    if (!this.ctx || (!this.recorder && !this.recordingFallback)) throw new Error('No recording is in progress.');
    const duration = Math.max(0, this.ctx.currentTime - this.recordingStart);
    if (this.recorder) {
      const recorder = this.recorder;
      const chunks = await new Promise<Blob[]>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('The browser could not finish recording.'));
        recorder.onstop = () => resolve(this.recordedChunks);
        recorder.stop();
      });
      if (this.recorderDestination) this.master?.disconnect(this.recorderDestination);
      this.recorderDestination = null; this.recorder = null;
      const mime = recorder.mimeType || chunks[0]?.type || 'audio/webm';
      const extension = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
      return { blob: new Blob(chunks, { type: mime }), extension, duration };
    }
    const fallback = this.recordingFallback!;
    this.master?.disconnect(fallback.processor);
    fallback.processor.disconnect(); fallback.mute.disconnect(); fallback.processor.onaudioprocess = null;
    this.recordingFallback = null;
    const join = (parts: Float32Array[]) => {
      const result = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; }
      return result;
    };
    return { blob: encodeWav([join(fallback.left), join(fallback.right)], this.ctx.sampleRate), extension: 'wav', duration };
  }

  dispose(): void {
    this.panic(); this.disposed = true;
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.recorder = null;
    if (this.recordingFallback) {
      this.recordingFallback.processor.disconnect(); this.recordingFallback.mute.disconnect();
      this.recordingFallback = null;
    }
    void this.ctx?.close();
    this.ctx = null; this.mix = null; this.master = null; this.analyser = null; this.sink = null; this.noise = null;
  }

  private makeGraph(patch: Patch, routes: Route[]): Graph {
    const ctx = this.ctx!, bus = ctx.createGain();
    bus.gain.value = 0; bus.connect(this.mix!);
    const analysers = new Map<string, AnalyserNode>();
    const taps: AudioNode[] = [];
    for (const module of patch.modules) {
      if (!MODULE_SPECS[module.type].outputs.some(port => port.signal === 'audio' || port.signal === 'cv')) continue;
      const analyser = ctx.createAnalyser(); analyser.fftSize = 2048;
      analyser.connect(this.sink!); analysers.set(module.id, analyser); taps.push(analyser);
    }
    const graph: Graph = {
      patch, routes, bus, analysers, taps, voices: [],
      dispose: () => {
        for (const voice of [...graph.voices]) voice.stop();
        graph.voices.length = 0;
        bus.disconnect();
        for (const tap of taps) tap.disconnect();
      },
    };
    return graph;
  }

  private createModule(module: PatchModule, time: number, note: number, velocity: number, gated: boolean, pitched: boolean, elapsed: number): VoiceModule {
    const ctx = this.ctx!, inputs: Record<string, AudioNode> = {}, outputs: Record<string, AudioNode> = {};
    const controls: Record<string, AudioParam> = {}, nodes: AudioNode[] = [], sources: AudioScheduledSourceNode[] = [];
    const add = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
    const result: VoiceModule = { inputs, outputs, controls, nodes, sources, update: () => {} };
    switch (module.type) {
      case 'oscillator': {
        const osc = add(ctx.createOscillator()), level = add(ctx.createGain());
        osc.type = option(module, 'waveform', 'sawtooth');
        // A note cable supplies pitch; an unpatched oscillator can run at middle C as a drone.
        const baseNote = pitched ? note : 60;
        osc.frequency.value = Math.min(ctx.sampleRate * 0.45, midiFrequency(baseNote) * 2 ** param(module, 'octave'));
        osc.detune.value = param(module, 'detune');
        level.gain.value = gated ? param(module, 'level') * velocity * 0.65 : 0;
        osc.connect(level); outputs.audio = level;
        controls.fm = osc.detune;
        result.update = (next, now) => {
          osc.type = option(next, 'waveform', 'sawtooth');
          ramp(osc.frequency, Math.min(ctx.sampleRate * 0.45, midiFrequency(baseNote) * 2 ** param(next, 'octave')), now);
          ramp(osc.detune, param(next, 'detune'), now);
          ramp(level.gain, gated ? param(next, 'level') * velocity * 0.65 : 0, now);
        };
        result.release = at => { level.gain.cancelScheduledValues(at); level.gain.setTargetAtTime(0, at, 0.007); };
        osc.start(time); sources.push(osc);
        break;
      }
      case 'noise': {
        const src = add(ctx.createBufferSource()), level = add(ctx.createGain());
        src.buffer = this.noise; src.loop = true;
        level.gain.value = param(module, 'level') * 0.18 * velocity;
        src.connect(level); outputs.audio = level;
        result.update = (next, now) => ramp(level.gain, param(next, 'level') * 0.18 * velocity, now);
        result.release = at => { level.gain.cancelScheduledValues(at); level.gain.setTargetAtTime(0, at, 0.007); };
        src.start(time); sources.push(src);
        break;
      }
      case 'filter': {
        const input = add(ctx.createGain()), filter = add(ctx.createBiquadFilter());
        filter.type = option(module, 'mode', 'lowpass') as BiquadFilterType;
        filter.frequency.value = param(module, 'cutoff'); filter.Q.value = param(module, 'resonance');
        input.connect(filter); inputs.audio = input; outputs.audio = filter; controls.cutoff = filter.frequency;
        result.update = (next, now) => { filter.type = option(next, 'mode', 'lowpass') as BiquadFilterType; ramp(filter.frequency, param(next, 'cutoff'), now); ramp(filter.Q, param(next, 'resonance'), now); };
        break;
      }
      case 'envelope': {
        const constant = add(ctx.createConstantSource()), shape = add(ctx.createGain());
        constant.offset.value = 1; shape.gain.value = 0;
        constant.connect(shape); outputs.cv = shape;
        if (gated) {
          const attack = param(module, 'attack'), decay = param(module, 'decay');
          const sustain = param(module, 'sustain'), decayTau = Math.max(0.005, decay / 3);
          if (elapsed < attack) {
            shape.gain.setValueAtTime(elapsed / attack, time);
            shape.gain.linearRampToValueAtTime(1, time + attack - elapsed);
            shape.gain.setTargetAtTime(sustain, time + attack - elapsed, decayTau);
          } else {
            shape.gain.setValueAtTime(sustain + (1 - sustain) * Math.exp(-(elapsed - attack) / decayTau), time);
            shape.gain.setTargetAtTime(sustain, time, decayTau);
          }
        }
        result.release = at => {
          shape.gain.cancelScheduledValues(at);
          shape.gain.setTargetAtTime(0, at, Math.max(0.005, param(this.graph?.patch.modules.find(item => item.id === module.id) ?? module, 'release') / 4));
        };
        result.update = () => {};
        constant.start(time); sources.push(constant);
        break;
      }
      case 'lfo': {
        const osc = add(ctx.createOscillator()), depth = add(ctx.createGain());
        osc.type = option(module, 'shape', 'sine'); osc.frequency.value = param(module, 'rate');
        depth.gain.value = param(module, 'depth'); osc.connect(depth); outputs.cv = depth;
        result.update = (next, now) => { osc.type = option(next, 'shape', 'sine'); ramp(osc.frequency, param(next, 'rate'), now); ramp(depth.gain, param(next, 'depth'), now); };
        osc.start(time); sources.push(osc);
        break;
      }
      case 'amplifier': {
        const amp = add(ctx.createGain());
        amp.gain.value = param(module, 'gain'); inputs.audio = amp; outputs.audio = amp; controls.gain = amp.gain;
        result.update = (next, now) => ramp(amp.gain, param(next, 'gain'), now);
        break;
      }
      case 'mixer': {
        const a = add(ctx.createGain()), b = add(ctx.createGain()), output = add(ctx.createGain());
        a.gain.value = param(module, 'a'); b.gain.value = param(module, 'b');
        a.connect(output); b.connect(output); inputs.a = a; inputs.b = b; outputs.audio = output;
        result.update = (next, now) => { ramp(a.gain, param(next, 'a'), now); ramp(b.gain, param(next, 'b'), now); };
        break;
      }
      case 'delay': {
        const input = add(ctx.createGain()), output = add(ctx.createGain());
        const dry = add(ctx.createGain()), wet = add(ctx.createGain());
        const delay = add(ctx.createDelay(1.25)), feedback = add(ctx.createGain());
        input.connect(dry); dry.connect(output); input.connect(delay); delay.connect(wet); wet.connect(output);
        delay.connect(feedback); feedback.connect(delay);
        delay.delayTime.value = param(module, 'time'); feedback.gain.value = Math.min(0.72, param(module, 'feedback'));
        dry.gain.value = 1 - param(module, 'mix'); wet.gain.value = param(module, 'mix') * 0.6;
        inputs.audio = input; outputs.audio = output;
        result.update = (next, now) => {
          ramp(delay.delayTime, param(next, 'time'), now, 0.05);
          ramp(feedback.gain, Math.min(0.72, param(next, 'feedback')), now);
          ramp(dry.gain, 1 - param(next, 'mix'), now);
          ramp(wet.gain, param(next, 'mix') * 0.6, now);
        };
        break;
      }
      case 'reverb': {
        const input = add(ctx.createGain()), output = add(ctx.createGain());
        const dry = add(ctx.createGain()), wet = add(ctx.createGain());
        input.connect(dry); dry.connect(output); wet.connect(output);
        const lines: { delay: DelayNode; feedback: GainNode; tap: GainNode; base: number }[] = [];
        for (const base of [0.0297, 0.0371, 0.0411, 0.0437]) {
          const delay = add(ctx.createDelay(0.15)), feedback = add(ctx.createGain()), tap = add(ctx.createGain());
          delay.delayTime.value = base * (0.5 + param(module, 'size') * 1.4);
          feedback.gain.value = 0.34 + param(module, 'size') * 0.38;
          tap.gain.value = 0.2;
          input.connect(delay); delay.connect(feedback); feedback.connect(delay);
          delay.connect(tap); tap.connect(wet); lines.push({ delay, feedback, tap, base });
        }
        dry.gain.value = 1 - param(module, 'mix') * 0.6;
        wet.gain.value = param(module, 'mix') * 0.75;
        inputs.audio = input; outputs.audio = output;
        result.update = (next, now) => {
          const size = param(next, 'size');
          for (const line of lines) {
            ramp(line.delay.delayTime, line.base * (0.5 + size * 1.4), now, 0.06);
            ramp(line.feedback.gain, 0.34 + size * 0.38, now);
          }
          ramp(dry.gain, 1 - param(next, 'mix') * 0.6, now);
          ramp(wet.gain, param(next, 'mix') * 0.75, now);
        };
        break;
      }
      case 'output': inputs.audio = add(ctx.createGain()); break;
      case 'keyboard': case 'sequencer': break;
    }
    return result;
  }

  private trigger(source: string, note: number, velocity: number, at: number, end?: number | null, elapsed = 0): void {
    const graph = this.graph, ctx = this.ctx;
    if (!graph || !ctx) return;
    const emitter = source.startsWith('keyboard:') ? source.slice(9) : source.startsWith('sequencer:') ? source.slice(10) : null;
    const noteTargets = new Set(graph.routes.filter(route => route.from === emitter && route.signal === 'note').map(route => route.to));
    const gateTargets = new Set(graph.routes.filter(route => route.from === emitter && route.signal === 'gate').map(route => route.to));
    const drone = source === '__drone__';
    if (!drone && !noteTargets.size && !gateTargets.size) return;
    if (graph.voices.length >= MAX_VOICES) {
      const oldest = graph.voices.shift()!;
      oldest.stop();
    }
    const modules = new Map<string, VoiceModule>();
    const safeVelocity = finiteClamp(velocity, 0, 1, 1);
    for (const module of graph.patch.modules) {
      const pitched = noteTargets.has(module.id);
      const gated = gateTargets.has(module.id);
      // Oscillator only speaks when a note/gate event reaches it, unless explicitly unpatched and running as a drone.
      const canDrone = drone && module.type === 'oscillator' && !graph.routes.some(route => route.to === module.id && (route.signal === 'note' || route.signal === 'gate'));
      modules.set(module.id, this.createModule(module, at, note, safeVelocity, gated || (pitched && !graph.routes.some(route => route.to === module.id && route.signal === 'gate')) || canDrone, pitched, elapsed));
    }
    for (const route of graph.routes) {
      const from = modules.get(route.from), to = modules.get(route.to);
      if (!from || !to) continue;
      if (route.signal === 'audio') {
        const sourceNode = from.outputs[route.fromPort], targetNode = to.inputs[route.toPort];
        if (sourceNode && targetNode) sourceNode.connect(targetNode);
      } else if (route.signal === 'cv') {
        const sourceNode = from.outputs[route.fromPort], control = to.controls[route.toPort];
        if (!sourceNode || !control) continue;
        const scalar = ctx.createGain();
        scalar.gain.value = route.toPort === 'cutoff' ? 2200 : route.toPort === 'fm' ? 150 :
          route.toPort === 'gain' ? param(graph.patch.modules.find(item => item.id === route.to)!, 'gain') : 1;
        if (route.toPort === 'gain') control.setValueAtTime(0, at);
        sourceNode.connect(scalar); scalar.connect(control); to.nodes.push(scalar);
        (to.cvScales ??= {})[route.toPort] = scalar;
      }
    }
    for (const module of graph.patch.modules) {
      const voiceModule = modules.get(module.id)!;
      if (module.type === 'output') voiceModule.inputs.audio?.connect(graph.bus);
      const analyser = graph.analysers.get(module.id);
      const tap = voiceModule.outputs.audio ?? voiceModule.outputs.cv;
      if (analyser && tap) tap.connect(analyser);
    }
    const voice: Voice = {
      note, source, startedAt: at, releasedAt: null, expiresAt: Infinity, modules,
      stop: (when = ctx.currentTime) => {
        for (const mod of modules.values()) {
          for (const src of mod.sources) { try { src.stop(Math.max(ctx.currentTime, when)); } catch { /* already stopped */ } }
          for (const node of mod.nodes) { try { node.disconnect(); } catch { /* disconnected */ } }
        }
        const index = graph.voices.indexOf(voice);
        if (index !== -1) graph.voices.splice(index, 1);
      },
    };
    graph.voices.push(voice);
    if (end !== undefined && end !== null) this.release(voice, end);
  }

  private release(voice: Voice, at: number): void {
    if (voice.releasedAt !== null) return;
    voice.releasedAt = at;
    const patch = this.graph?.patch;
    const moduleById = new Map(patch?.modules.map(module => [module.id, module]) ?? []);
    const envelopeAmps = new Set(patch?.cables.filter(cable =>
      moduleById.get(cable.from)?.type === 'envelope' && moduleById.get(cable.to)?.type === 'amplifier' &&
      cable.fromPort === 'cv' && cable.toPort === 'gain').map(cable => cable.to) ?? []);
    const feedsEnvelopeAmp = (id: string): boolean => {
      const pending = [id], seen = new Set<string>();
      while (pending.length) {
        const current = pending.pop()!;
        if (envelopeAmps.has(current)) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        pending.push(...(this.graph?.routes ?? []).filter(route => route.from === current && route.signal === 'audio').map(route => route.to));
      }
      return false;
    };
    for (const [id, module] of voice.modules) {
      const type = moduleById.get(id)?.type;
      if ((type === 'oscillator' || type === 'noise') && feedsEnvelopeAmp(id)) continue;
      module.release?.(at);
    }
    const release = patch ? Math.max(0.08, ...patch.modules.filter(module => module.type === 'envelope').map(module => param(module, 'release'))) : 0.1;
    const effects = patch?.modules.some(module => module.type === 'delay' || module.type === 'reverb') ? 2.5 : 0.05;
    voice.expiresAt = at + Math.min(MAX_RELEASE + 2.5, release * 1.8 + effects);
    // The transport timer does not run while someone is simply playing the keyboard.
    window.setTimeout(() => voice.stop(), Math.max(0, (voice.expiresAt - (this.ctx?.currentTime ?? at)) * 1000 + 25));
  }

  private startDrone(): void {
    const graph = this.graph, ctx = this.ctx;
    if (!graph || !ctx || graph.voices.some(voice => voice.source === '__drone__')) return;
    const freeSource = graph.patch.modules.some(module =>
      (module.type === 'noise' || module.type === 'oscillator') &&
      !graph.routes.some(route => route.to === module.id && (route.signal === 'note' || route.signal === 'gate')));
    if (freeSource) this.trigger('__drone__', 60, 1, ctx.currentTime);
  }

  private reseedClocks(): void {
    if (!this.ctx || !this.graph) return;
    this.clocks = this.graph.patch.modules.filter(module => module.type === 'sequencer').map(module => ({ moduleId: module.id, time: this.ctx!.currentTime + 0.035, index: 0 }));
    this.currentStep = -1; this.pendingSteps = [];
  }

  private tick(): void {
    if (!this.ctx || !this.graph || !this.playing) return;
    const now = this.ctx.currentTime, graph = this.graph, patch = graph.patch;
    this.advanceStep(now);
    for (const clock of this.clocks) {
      const seq = patch.modules.find(module => module.id === clock.moduleId);
      if (!seq) continue;
      const stepLength = 60 / finiteClamp(patch.tempo, 30, 300, 120) / param(seq, 'rate');
      if (clock.time < now - 0.05) {
        const missed = Math.ceil((now - 0.05 - clock.time) / stepLength);
        clock.time += missed * stepLength;
        clock.index = (clock.index + missed) % 16;
      }
      let count = 0;
      while (clock.time < now + 0.12 && count++ < 12) {
        const step = patch.steps[clock.index % Math.max(1, patch.steps.length)];
        const duration = 60 / finiteClamp(patch.tempo, 30, 300, 120) / param(seq, 'rate');
        if (step?.active) this.trigger(`sequencer:${clock.moduleId}`, Math.round(finiteClamp(step.note, 0, 127, 60)), finiteClamp(step.velocity, 0, 1, 0.8), clock.time, clock.time + duration * param(seq, 'gate'));
        this.pendingSteps.push({ index: clock.index % 16, time: clock.time });
        clock.time += duration; clock.index = (clock.index + 1) % 16;
      }
    }
    for (const voice of [...graph.voices]) if (voice.expiresAt <= now) voice.stop();
  }

  private advanceStep(now: number): void {
    this.pendingSteps.sort((a, b) => a.time - b.time);
    while (this.pendingSteps.length && this.pendingSteps[0].time <= now) this.currentStep = this.pendingSteps.shift()!.index;
  }
}
