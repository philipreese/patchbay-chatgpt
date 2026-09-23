import { describe, expect, it } from 'vitest';
import { encodeWav, evolveStep, finiteClamp, midiFrequency, planRoutes } from './engine';
import type { Cable, Patch, PatchModule } from '../types';

const modules: PatchModule[] = [
  { id: 'k', type: 'keyboard', x: 0, y: 0, params: {} },
  { id: 'seq', type: 'sequencer', x: 0, y: 0, params: { rate: 4, gate: 0.65 } },
  { id: 'o', type: 'oscillator', x: 0, y: 0, params: {} },
  { id: 'f', type: 'filter', x: 0, y: 0, params: {} },
  { id: 'a', type: 'amplifier', x: 0, y: 0, params: {} },
  { id: 'e', type: 'envelope', x: 0, y: 0, params: {} },
  { id: 'l', type: 'lfo', x: 0, y: 0, params: {} },
  { id: 'out', type: 'output', x: 0, y: 0, params: {} },
];
function patch(cables: Cable[]): Patch {
  return { version: 1, id: 'test', name: 'test', description: '', category: 'custom', tempo: 120, master: 0.5,
    modules, cables, steps: [], macros: [] };
}
function edge(id: string, from: string, fromPort: string, to: string, toPort: string): Cable {
  return { id, from, fromPort, to, toPort };
}

describe('audio graph planning', () => {
  it('routes pitch, gate, audio and CV with their real port types, including two event sources', () => {
    const routes = planRoutes(patch([
      edge('1', 'k', 'note', 'o', 'note'), edge('2', 'seq', 'note', 'o', 'note'),
      edge('3', 'k', 'gate', 'e', 'gate'), edge('4', 'o', 'audio', 'f', 'audio'),
      edge('5', 'l', 'cv', 'f', 'cutoff'), edge('6', 'f', 'audio', 'a', 'audio'),
      edge('7', 'e', 'cv', 'a', 'gain'), edge('8', 'a', 'audio', 'out', 'audio'),
    ]));
    expect(routes.map(route => route.signal)).toEqual(['note', 'note', 'gate', 'audio', 'cv', 'audio', 'cv', 'audio']);
  });

  it('rejects mismatched signal, duplicate input and audio feedback', () => {
    expect(() => planRoutes(patch([edge('x', 'o', 'audio', 'a', 'gain')]))).toThrow(/connects only/i);
    expect(() => planRoutes(patch([
      edge('1', 'o', 'audio', 'f', 'audio'), edge('2', 'a', 'audio', 'f', 'audio'),
    ]))).toThrow(/already has a cable/i);
    expect(() => planRoutes(patch([
      edge('1', 'f', 'audio', 'a', 'audio'), edge('2', 'a', 'audio', 'f', 'audio'),
    ]))).toThrow(/feedback loop/i);
  });
});

describe('numerical audio helpers', () => {
  it('tunes A4 and octave accurately and bounds invalid values', () => {
    expect(midiFrequency(69)).toBe(440);
    expect(midiFrequency(81)).toBe(880);
    expect(finiteClamp(Infinity, 0, 1, 0.4)).toBe(0.4);
  });

  it('keeps edited steps exact at zero evolution and varies later cycles reproducibly', () => {
    expect(evolveStep(60, 0.7, 0, 9, 4, 'seed')).toEqual({ note: 60, velocity: 0.7 });
    expect(evolveStep(60, 0.7, 1, 0, 4, 'seed')).toEqual({ note: 60, velocity: 0.7 });
    const phrases = Array.from({ length: 4 }, (_, cycle) => Array.from({ length: 16 }, (_, index) => evolveStep(60, 0.7, 0.8, cycle + 1, index, 'seed')));
    expect(phrases).toEqual(Array.from({ length: 4 }, (_, cycle) => Array.from({ length: 16 }, (_, index) => evolveStep(60, 0.7, 0.8, cycle + 1, index, 'seed'))));
    expect(new Set(phrases.flat().map(step => step.note)).size).toBeGreaterThan(1);
    expect(phrases.flat().every(step => step.note >= 48 && step.note <= 72 && step.velocity > 0 && step.velocity <= 1)).toBe(true);
  });

  it('writes a playable PCM WAV with correctly saturated sample values', async () => {
    const wav = encodeWav([new Float32Array([-2, -1, 0, 1, 2])], 8000);
    expect(wav.type).toBe('audio/wav');
    const view = new DataView(await wav.arrayBuffer());
    expect(view.getUint32(4, true)).toBe(46);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(10);
    expect([44, 46, 48, 50, 52].map(index => view.getInt16(index, true))).toEqual([-32768, -32768, 0, 32767, 32767]);
  });
});
