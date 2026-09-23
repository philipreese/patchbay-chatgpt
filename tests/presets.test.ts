import { describe, expect, it } from 'vitest';
import { MODULE_SPECS } from '../src/modules';
import { applyMacro, PRESETS } from '../src/presets';
import { decodePatch, encodePatch, validatePatch } from '../src/storage';
import type { Patch, PatchModule } from '../src/types';

function canReachOutput(patch: Patch): boolean {
  const byId = new Map(patch.modules.map((module) => [module.id, module]));
  const pending = patch.modules
    .filter((module) => module.type === 'oscillator' || module.type === 'noise')
    .map((module) => module.id);
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    if (byId.get(current)?.type === 'output') return true;
    for (const cable of patch.cables) {
      const source = byId.get(cable.from);
      const signal = source && MODULE_SPECS[source.type].outputs.find((port) => port.id === cable.fromPort)?.signal;
      if (cable.from === current && signal === 'audio') pending.push(cable.to);
    }
  }
  return false;
}

function mappedModule(patch: Patch, moduleId: string): PatchModule {
  const module = patch.modules.find((candidate) => candidate.id === moduleId);
  if (!module) throw new Error(`Missing macro target module: ${moduleId}`);
  return module;
}

describe('factory presets', () => {
  it('all validate, share-round-trip, and route audio to the output', () => {
    expect(PRESETS.length).toBeGreaterThan(0);
    for (const preset of PRESETS) {
      expect(validatePatch(preset), preset.name).toEqual(preset);
      expect(decodePatch(encodePatch(preset)), preset.name).toEqual(preset);
      expect(canReachOutput(preset), `${preset.name} has no audio path to output`).toBe(true);
    }
  });

  it('connects keyboard note and gate events in every preset', () => {
    for (const preset of PRESETS) {
      const keyboard = preset.modules.find((module) => module.type === 'keyboard');
      expect(keyboard, `${preset.name} has a keyboard`).toBeDefined();
      const outgoing = preset.cables.filter((cable) => cable.from === keyboard!.id);
      for (const eventPort of ['note', 'gate']) {
        expect(outgoing.some((cable) => cable.fromPort === eventPort), `${preset.name} routes keyboard ${eventPort}`).toBe(true);
      }
    }
  });

  it('allows keyboard and sequencer to fan into the same note and gate inputs', () => {
    const parallelPresets = PRESETS.filter((preset) => preset.category === 'bass' || preset.category === 'ambient');
    expect(parallelPresets.length).toBeGreaterThan(0);
    for (const preset of parallelPresets) {
      const keyboard = preset.modules.find((module) => module.type === 'keyboard')!;
      const sequencer = preset.modules.find((module) => module.type === 'sequencer')!;
      const oscillator = preset.modules.find((module) => module.type === 'oscillator')!;
      const envelope = preset.modules.find((module) => module.type === 'envelope')!;
      expect(preset.cables.filter((cable) => cable.to === oscillator.id && cable.toPort === 'note').map((cable) => cable.from).sort())
        .toEqual([keyboard.id, sequencer.id].sort());
      expect(preset.cables.filter((cable) => cable.to === envelope.id && cable.toPort === 'gate').map((cable) => cable.from).sort())
        .toEqual([keyboard.id, sequencer.id].sort());
      expect(validatePatch(preset)).toEqual(preset);
    }
  });

  it('keeps every macro endpoint within its target parameter range', () => {
    for (const preset of PRESETS) {
      for (const macro of preset.macros) {
        for (const endpoint of [0, 1]) {
          const updated = applyMacro(preset, macro.id, endpoint);
          expect(validatePatch(updated), `${preset.name}/${macro.id} at ${endpoint}`).toEqual(updated);
          for (const mapping of macro.mappings) {
            const module = mappedModule(updated, mapping.moduleId);
            const value = module.params[mapping.param];
            expect(typeof value, `${preset.name}/${macro.id}/${mapping.param}`).toBe('number');
            expect(value as number).toBeGreaterThanOrEqual(mapping.min - 1e-9);
            expect(value as number).toBeLessThanOrEqual(mapping.max + 1e-9);
          }
        }
      }
    }
  });
});
