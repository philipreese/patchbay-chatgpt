import type { Cable, ModuleSpec, ModuleType, Patch, PatchModule } from './types';

/** The patch format, audio graph, and canvas all use these exact port/parameter IDs. */
export const MODULE_SPECS: Record<ModuleType, ModuleSpec> = {
  oscillator: {
    name: 'Oscillator', short: 'OSC', description: 'Tunable tone generator', color: '#d6ef8b',
    inputs: [{ id: 'note', label: 'Pitch', signal: 'note' }, { id: 'gate', label: 'Gate', signal: 'gate' }, { id: 'fm', label: 'Vibrato', signal: 'cv' }],
    outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [
      { id: 'waveform', label: 'Wave', min: 0, max: 3, step: 1, default: 'sawtooth', options: ['sine', 'triangle', 'sawtooth', 'square'] },
      { id: 'octave', label: 'Octave', min: -2, max: 2, step: 1, default: 0 },
      { id: 'detune', label: 'Detune', min: -50, max: 50, step: 1, default: 0, unit: 'ct' },
      { id: 'level', label: 'Level', min: 0, max: 1, step: 0.01, default: 0.24 },
    ],
  },
  noise: {
    name: 'Noise', short: 'NOISE', description: 'A little texture and air', color: '#f19b78',
    inputs: [], outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [{ id: 'level', label: 'Level', min: 0, max: 1, step: 0.01, default: 0.05 }],
  },
  filter: {
    name: 'Filter', short: 'FILTER', description: 'Shape the spectrum', color: '#aabdf5',
    inputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }, { id: 'cutoff', label: 'Cutoff', signal: 'cv' }],
    outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [
      { id: 'mode', label: 'Mode', min: 0, max: 2, step: 1, default: 'lowpass', options: ['lowpass', 'highpass', 'bandpass'] },
      { id: 'cutoff', label: 'Cutoff', min: 60, max: 16000, step: 1, default: 1800, unit: 'Hz', scale: 'log' },
      { id: 'resonance', label: 'Resonance', min: 0.1, max: 18, step: 0.1, default: 2.5 },
    ],
  },
  envelope: {
    name: 'Envelope', short: 'ENV', description: 'A contour for each note', color: '#f1bf9c',
    inputs: [{ id: 'gate', label: 'Gate', signal: 'gate' }],
    outputs: [{ id: 'cv', label: 'Shape', signal: 'cv' }],
    params: [
      { id: 'attack', label: 'Attack', min: 0.005, max: 3, step: 0.005, default: 0.02, unit: 's', scale: 'log' },
      { id: 'decay', label: 'Decay', min: 0.01, max: 3, step: 0.01, default: 0.2, unit: 's', scale: 'log' },
      { id: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, default: 0.65 },
      { id: 'release', label: 'Release', min: 0.01, max: 5, step: 0.01, default: 0.35, unit: 's', scale: 'log' },
    ],
  },
  lfo: {
    name: 'LFO', short: 'LFO', description: 'Slow moving modulation', color: '#c4b4ed',
    inputs: [], outputs: [{ id: 'cv', label: 'Motion', signal: 'cv' }],
    params: [
      { id: 'shape', label: 'Shape', min: 0, max: 2, step: 1, default: 'sine', options: ['sine', 'triangle', 'square'] },
      { id: 'rate', label: 'Rate', min: 0.05, max: 20, step: 0.01, default: 1, unit: 'Hz', scale: 'log' },
      { id: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.35 },
    ],
  },
  amplifier: {
    name: 'Amplifier', short: 'AMP', description: 'Control the volume', color: '#d6ef8b',
    inputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }, { id: 'gain', label: 'Gain', signal: 'cv' }],
    outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [{ id: 'gain', label: 'Gain', min: 0, max: 1, step: 0.01, default: 0.7 }],
  },
  mixer: {
    name: 'Mixer', short: 'MIX', description: 'Blend two sound sources', color: '#e9d49c',
    inputs: [{ id: 'a', label: 'A', signal: 'audio' }, { id: 'b', label: 'B', signal: 'audio' }],
    outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [
      { id: 'a', label: 'A level', min: 0, max: 1, step: 0.01, default: 0.65 },
      { id: 'b', label: 'B level', min: 0, max: 1, step: 0.01, default: 0.65 },
    ],
  },
  sequencer: {
    name: 'Sequencer', short: 'SEQ', description: '16-step note pattern', color: '#f19b78',
    inputs: [],
    outputs: [{ id: 'note', label: 'Pitch', signal: 'note' }, { id: 'gate', label: 'Gate', signal: 'gate' }],
    params: [
      { id: 'rate', label: 'Rate', min: 1, max: 4, step: 1, default: 4 },
      { id: 'gate', label: 'Gate', min: 0.1, max: 0.95, step: 0.01, default: 0.65 },
    ],
  },
  keyboard: {
    name: 'Keyboard', short: 'KEYS', description: 'Play notes live', color: '#aabdf5',
    inputs: [], outputs: [{ id: 'note', label: 'Pitch', signal: 'note' }, { id: 'gate', label: 'Gate', signal: 'gate' }], params: [],
  },
  delay: {
    name: 'Delay', short: 'DELAY', description: 'Repeating echoes', color: '#c4b4ed',
    inputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }], outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [
      { id: 'time', label: 'Time', min: 0.06, max: 1.2, step: 0.01, default: 0.3, unit: 's' },
      { id: 'feedback', label: 'Feedback', min: 0, max: 0.75, step: 0.01, default: 0.3 },
      { id: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
  },
  reverb: {
    name: 'Reverb', short: 'VERB', description: 'Add space and depth', color: '#aabdf5',
    inputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }], outputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }],
    params: [
      { id: 'size', label: 'Size', min: 0.1, max: 1, step: 0.01, default: 0.5 },
      { id: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
  },
  output: {
    name: 'Output', short: 'OUT', description: 'Your speakers and recorder', color: '#f1f0e8',
    inputs: [{ id: 'audio', label: 'Audio', signal: 'audio' }], outputs: [], params: [],
  },
};

export const MODULE_TYPES = Object.keys(MODULE_SPECS) as ModuleType[];

export function createModule(type: ModuleType, x: number, y: number): PatchModule {
  const spec = MODULE_SPECS[type];
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `module-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type, x, y,
    params: Object.fromEntries(spec.params.map(param => [param.id, param.default])),
  };
}

export function canConnect(patch: Patch, from: string, fromPort: string, to: string, toPort: string): { ok: boolean; reason?: string } {
  const source = patch.modules.find(module => module.id === from);
  const target = patch.modules.find(module => module.id === to);
  if (!source || !target) return { ok: false, reason: 'Choose two modules on the canvas.' };
  if (from === to) return { ok: false, reason: 'A module cannot connect to itself.' };
  const output = MODULE_SPECS[source.type]?.outputs.find(port => port.id === fromPort);
  const input = MODULE_SPECS[target.type]?.inputs.find(port => port.id === toPort);
  if (!output || !input) return { ok: false, reason: 'That port is unavailable.' };
  if (output.signal !== input.signal) return { ok: false, reason: `${output.signal.toUpperCase()} connects only to ${output.signal.toUpperCase()} ports.` };
  if (patch.cables.some(cable => cable.from === from && cable.fromPort === fromPort && cable.to === to && cable.toPort === toPort)) {
    return { ok: false, reason: 'Those ports are already connected.' };
  }
  if (input.signal !== 'note' && input.signal !== 'gate' && patch.cables.some(cable => cable.to === to && cable.toPort === toPort)) {
    return { ok: false, reason: 'That input already has a cable. Remove it first.' };
  }
  // Every kind of edge participates: an event or CV loop can still create feedback.
  const seen = new Set<string>();
  const pending = [to];
  while (pending.length) {
    const current = pending.pop()!;
    if (current === from) return { ok: false, reason: 'This cable would create a feedback loop.' };
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...patch.cables.filter(cable => cable.from === current).map(cable => cable.to));
  }
  if (patch.cables.length >= 128) return { ok: false, reason: 'This patch has reached its 128-cable limit.' };
  return { ok: true };
}

export function cableSignal(patch: Patch, cable: Cable) {
  const source = patch.modules.find(module => module.id === cable.from);
  return source ? MODULE_SPECS[source.type].outputs.find(port => port.id === cable.fromPort)?.signal : undefined;
}
