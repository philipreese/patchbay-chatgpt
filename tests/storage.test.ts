import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModule } from '../src/modules';
import {
  createShareUrl,
  decodePatch,
  deleteSavedPatch,
  encodePatch,
  exportPatch,
  importPatch,
  listSavedPatches,
  readSharedPatch,
  savePatch,
  validatePatch,
} from '../src/storage';
import type { Patch } from '../src/types';

const STORAGE_KEY = 'patchbay.patches.v1';

function moduleOf(type: Parameters<typeof createModule>[0], id: string) {
  return { ...createModule(type, 20, 30), id };
}

function fixture(): Patch {
  return {
    version: 1,
    id: 'patch-1',
    name: 'Round trip',
    description: 'A small patch',
    category: 'custom',
    tempo: 120,
    master: 0.5,
    modules: [moduleOf('oscillator', 'osc'), moduleOf('output', 'out')],
    cables: [{ id: 'wire', from: 'osc', fromPort: 'audio', to: 'out', toPort: 'audio' }],
    steps: Array.from({ length: 16 }, (_, note) => ({ note: 48 + note, active: note % 2 === 0, velocity: 0.7 })),
    macros: [],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

afterEach(() => vi.unstubAllGlobals());

describe('patch validation and serialization', () => {
  it('validates and round-trips through compressed and file formats', () => {
    const patch = fixture();
    expect(validatePatch(patch)).toEqual(patch);
    expect(decodePatch(encodePatch(patch))).toEqual(patch);
    expect(importPatch(exportPatch(patch))).toEqual(patch);
  });

  it('rejects unknown module types, parameter values, and malformed limits', () => {
    const unknownType = clone(fixture()) as Patch & { modules: Array<Record<string, unknown>> };
    unknownType.modules[0].type = 'not-a-module';
    expect(() => validatePatch(unknownType)).toThrow(/unknown module type/);

    const wrongParam = clone(fixture());
    wrongParam.modules[0].params.level = 5;
    expect(() => validatePatch(wrongParam)).toThrow(/finite number from 0 to 1/);

    const tooMany = clone(fixture());
    tooMany.modules = Array.from({ length: 65 }, (_, index) => moduleOf('output', `o${index}`));
    expect(() => validatePatch(tooMany)).toThrow(/limit of 64/);
  });

  it('rejects unknown or mismatched cable ports and graph cycles', () => {
    const badPort = clone(fixture());
    badPort.cables[0].fromPort = 'not-a-port';
    expect(() => validatePatch(badPort)).toThrow(/port is unavailable/);

    const wrongSignal = clone(fixture());
    wrongSignal.modules.unshift(moduleOf('sequencer', 'seq'));
    wrongSignal.cables = [{ id: 'wire', from: 'seq', fromPort: 'note', to: 'out', toPort: 'audio' }];
    expect(() => validatePatch(wrongSignal)).toThrow(/connects only/);

    const cycle = clone(fixture());
    cycle.modules.splice(1, 0, moduleOf('filter', 'filter'), moduleOf('delay', 'delay'));
    cycle.cables = [
      { id: 'a', from: 'filter', fromPort: 'audio', to: 'delay', toPort: 'audio' },
      { id: 'b', from: 'delay', fromPort: 'audio', to: 'filter', toPort: 'audio' },
    ];
    expect(() => validatePatch(cycle)).toThrow(/feedback loop|cycles are not allowed/);
  });

  it('rejects malformed macro references and prototype-polluting fields', () => {
    const badMacro = clone(fixture());
    badMacro.macros = [{
      id: 'macro', name: 'Tone', description: '', value: 0.5,
      mappings: [{ moduleId: 'missing', param: 'level', min: 0, max: 1 }],
    }];
    expect(() => validatePatch(badMacro)).toThrow(/unknown module/);

    const polluted = JSON.parse(exportPatch(fixture())) as Record<string, unknown>;
    Object.defineProperty(polluted, '__proto__', { value: {}, enumerable: true });
    expect(() => validatePatch(polluted)).toThrow(/forbidden property/);
  });

  it('preserves the deployment path and query in share URLs', () => {
    const patch = fixture();
    const shared = createShareUrl(patch, 'https://example.test/patchbay-chatgpt/?mode=demo#old=1');
    const url = new URL(shared);
    expect(url.origin).toBe('https://example.test');
    expect(url.pathname).toBe('/patchbay-chatgpt/');
    expect(url.search).toBe('?mode=demo');
    expect(readSharedPatch(url.hash)).toEqual(patch);
    expect(readSharedPatch('#other=value')).toBeNull();
    expect(() => readSharedPatch('#patch=not-valid')).toThrow(/Invalid encoded patch/);
  });
});

describe('local patch storage', () => {
  it('saves, lists, replaces, and deletes patches', () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    });
    const saved = savePatch(fixture());
    expect(saved.id).toBe('patch-1');
    expect(listSavedPatches()).toEqual([saved]);
    const replacement = fixture();
    replacement.name = 'Renamed';
    savePatch(replacement);
    expect(listSavedPatches()).toHaveLength(1);
    expect(listSavedPatches()[0].name).toBe('Renamed');
    deleteSavedPatch(saved.id);
    expect(listSavedPatches()).toEqual([]);
    expect(data.has(STORAGE_KEY)).toBe(true);
  });

  it('surfaces unavailable and failing local storage errors', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    expect(() => listSavedPatches()).toThrow(/Could not read saved patches: blocked/);
    // savePatch reads first, so a read failure is surfaced before attempting a write.
    expect(() => savePatch(fixture())).toThrow(/Could not read saved patches: blocked/);
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
    });
    expect(() => savePatch(fixture())).toThrow(/Could not save patches: quota/);
  });
});
