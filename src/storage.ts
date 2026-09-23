import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import { canConnect, MODULE_SPECS } from './modules';
import type { Cable, Macro, MacroMapping, ModuleType, Patch, PatchModule, Step } from './types';

const STORAGE_KEY = 'patchbay.patches.v1';
const MAX_MODULES = 64;
const MAX_CABLES = 128;
const MAX_STEPS = 16;
const MAX_MACROS = 16;
const MAX_MAPPINGS_PER_MACRO = MAX_MODULES;
const MAX_PATCH_BYTES = 256 * 1024;
const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const CATEGORIES = new Set(['bass', 'pad', 'lead', 'ambient', 'custom']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface SavedPatch {
  id: string;
  name: string;
  savedAt: string;
  patch: Patch;
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid patch ${path}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) fail(`${path}.${key}`, 'forbidden property');
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown property');
}

function string(value: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && value.trim().length === 0)) {
    fail(path, `expected a${allowEmpty ? '' : ' non-empty'} string of at most ${maxLength} characters`);
  }
  return value;
}

function id(value: unknown, path: string): string {
  const result = string(value, path, MAX_ID_LENGTH);
  if (!ID_PATTERN.test(result)) fail(path, 'expected letters, digits, underscores, or hyphens');
  return result;
}

function finiteNumber(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(path, `expected a finite number from ${min} to ${max}`);
  }
  return value;
}

function array(value: unknown, path: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length > maxLength) fail(path, `exceeds the limit of ${maxLength}`);
  return value;
}

function assertUnique(values: string[], path: string): void {
  if (new Set(values).size !== values.length) fail(path, 'IDs must be unique');
}

function checkDataTree(value: unknown, path: string, depth = 0): void {
  if (depth > 12) fail(path, 'object nesting is too deep');
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) checkDataTree(value[i], `${path}[${i}]`, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) fail(`${path}.${key}`, 'forbidden property');
      checkDataTree(value[key], `${path}.${key}`, depth + 1);
    }
  }
}

function validateModule(value: unknown, index: number): PatchModule {
  const path = `modules[${index}]`;
  const module = record(value, path);
  exactKeys(module, ['id', 'type', 'x', 'y', 'params'], path);
  const moduleId = id(module.id, `${path}.id`);
  if (typeof module.type !== 'string' || !Object.hasOwn(MODULE_SPECS, module.type)) {
    fail(`${path}.type`, 'unknown module type');
  }
  const type = module.type as ModuleType;
  const spec = MODULE_SPECS[type];
  const params = record(module.params, `${path}.params`);
  const specById = new Map(spec.params.map((param) => [param.id, param]));
  for (const paramKey of Object.keys(params)) {
    const paramSpec = specById.get(paramKey);
    if (!paramSpec) fail(`${path}.params.${paramKey}`, 'unknown parameter');
    const paramValue = params[paramKey];
    if (typeof paramSpec.default === 'number') {
      finiteNumber(paramValue, `${path}.params.${paramKey}`, paramSpec.min, paramSpec.max);
    } else {
      if (typeof paramValue !== 'string' || !paramSpec.options?.includes(paramValue)) {
        fail(`${path}.params.${paramKey}`, 'expected one of the supported options');
      }
    }
  }
  for (const paramSpec of spec.params) {
    if (!Object.hasOwn(params, paramSpec.id)) fail(`${path}.params.${paramSpec.id}`, 'required parameter is missing');
  }
  return {
    id: moduleId,
    type,
    x: finiteNumber(module.x, `${path}.x`, -100000, 100000),
    y: finiteNumber(module.y, `${path}.y`, -100000, 100000),
    params: params as PatchModule['params'],
  };
}

function validateMacroMapping(value: unknown, path: string, modules: Map<string, PatchModule>): MacroMapping {
  const mapping = record(value, path);
  exactKeys(mapping, ['moduleId', 'param', 'min', 'max', 'curve'], path);
  const moduleId = id(mapping.moduleId, `${path}.moduleId`);
  const module = modules.get(moduleId);
  if (!module) fail(`${path}.moduleId`, 'references an unknown module');
  const param = string(mapping.param, `${path}.param`, 64);
  const paramSpec = MODULE_SPECS[module.type].params.find((item) => item.id === param);
  if (!paramSpec || typeof paramSpec.default !== 'number') fail(`${path}.param`, 'must reference a numeric parameter');
  const min = finiteNumber(mapping.min, `${path}.min`, paramSpec.min, paramSpec.max);
  const max = finiteNumber(mapping.max, `${path}.max`, paramSpec.min, paramSpec.max);
  if (min > max) fail(path, 'mapping min must not exceed max');
  if (mapping.curve !== undefined && mapping.curve !== 'exp') fail(`${path}.curve`, 'expected "exp" when provided');
  return { moduleId, param, min, max, ...(mapping.curve === 'exp' ? { curve: 'exp' as const } : {}) };
}

function validateMacro(value: unknown, index: number, modules: Map<string, PatchModule>): Macro {
  const path = `macros[${index}]`;
  const macro = record(value, path);
  exactKeys(macro, ['id', 'name', 'description', 'value', 'mappings'], path);
  const mappings = array(macro.mappings, `${path}.mappings`, MAX_MAPPINGS_PER_MACRO);
  const validatedMappings = mappings.map((item, mappingIndex) =>
    validateMacroMapping(item, `${path}.mappings[${mappingIndex}]`, modules),
  );
  const mappingTargets = validatedMappings.map((item) => `${item.moduleId}:${item.param}`);
  assertUnique(mappingTargets, `${path}.mappings`);
  return {
    id: id(macro.id, `${path}.id`),
    name: string(macro.name, `${path}.name`, 80),
    description: string(macro.description, `${path}.description`, 500, true),
    value: finiteNumber(macro.value, `${path}.value`, 0, 1),
    mappings: validatedMappings,
  };
}

/** Validate untrusted patch data and return a fresh, typed patch snapshot. */
export function validatePatch(input: unknown): Patch {
  checkDataTree(input, 'patch');
  const source = record(input, 'patch');
  exactKeys(source, ['version', 'id', 'name', 'description', 'category', 'tempo', 'master', 'modules', 'cables', 'steps', 'macros'], 'patch');
  if (source.version !== 1) fail('version', 'unsupported patch version');
  const modules = array(source.modules, 'modules', MAX_MODULES).map(validateModule);
  assertUnique(modules.map((module) => module.id), 'modules');
  const moduleById = new Map(modules.map((module) => [module.id, module]));

  const cableValues = array(source.cables, 'cables', MAX_CABLES);
  const cables: Cable[] = [];
  cableValues.forEach((item, index) => {
    const path = `cables[${index}]`;
    const cable = record(item, path);
    exactKeys(cable, ['id', 'from', 'fromPort', 'to', 'toPort'], path);
    const from = id(cable.from, `${path}.from`);
    const to = id(cable.to, `${path}.to`);
    if (!moduleById.has(from)) fail(`${path}.from`, 'references an unknown module');
    if (!moduleById.has(to)) fail(`${path}.to`, 'references an unknown module');
    const fromPort = string(cable.fromPort, `${path}.fromPort`, 64);
    const toPort = string(cable.toPort, `${path}.toPort`, 64);
    const decision = canConnect(
      { modules, cables } as Patch,
      from,
      fromPort,
      to,
      toPort,
    );
    if (!decision.ok) fail(path, decision.reason ?? 'unsupported connection');
    cables.push({ id: id(cable.id, `${path}.id`), from, fromPort, to, toPort });
  });
  assertUnique(cables.map((cable) => cable.id), 'cables');
  // Check cycles over the directed module graph independently of port typing.
  const outgoing = new Map<string, string[]>();
  for (const cable of cables) outgoing.set(cable.from, [...(outgoing.get(cable.from) ?? []), cable.to]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (moduleId: string): void => {
    if (visiting.has(moduleId)) fail('cables', 'audio graph cycles are not allowed');
    if (visited.has(moduleId)) return;
    visiting.add(moduleId);
    for (const next of outgoing.get(moduleId) ?? []) visit(next);
    visiting.delete(moduleId);
    visited.add(moduleId);
  };
  for (const module of modules) visit(module.id);

  const stepsRaw = array(source.steps, 'steps', MAX_STEPS);
  if (stepsRaw.length !== MAX_STEPS) fail('steps', `expected exactly ${MAX_STEPS} steps`);
  const steps: Step[] = stepsRaw.map((item, index) => {
    const path = `steps[${index}]`;
    const step = record(item, path);
    exactKeys(step, ['note', 'active', 'velocity'], path);
    if (typeof step.active !== 'boolean') fail(`${path}.active`, 'expected a boolean');
    return {
      note: finiteNumber(step.note, `${path}.note`, 0, 127),
      active: step.active,
      velocity: finiteNumber(step.velocity, `${path}.velocity`, 0, 1),
    };
  });
  const macros = array(source.macros, 'macros', MAX_MACROS).map((item, index) =>
    validateMacro(item, index, moduleById),
  );
  assertUnique(macros.map((macro) => macro.id), 'macros');

  const result: Patch = {
    version: 1,
    id: id(source.id, 'id'),
    name: string(source.name, 'name', 120),
    description: string(source.description, 'description', 2000, true),
    category: string(source.category, 'category', 16) as Patch['category'],
    tempo: finiteNumber(source.tempo, 'tempo', 30, 300),
    master: finiteNumber(source.master, 'master', 0, 0.8),
    modules,
    cables,
    steps,
    macros,
  };
  if (!CATEGORIES.has(result.category)) fail('category', 'unknown category');
  if (!modules.some((module) => module.type === 'output')) fail('modules', 'at least one output module is required');
  const serialized = JSON.stringify(result);
  if (new TextEncoder().encode(serialized).byteLength > MAX_PATCH_BYTES) fail('patch', 'exceeds the maximum size');
  return result;
}

export function encodePatch(patch: Patch): string {
  const json = JSON.stringify(validatePatch(patch));
  const compressed = compressToEncodedURIComponent(json);
  if (!compressed) throw new Error('Could not encode patch');
  return compressed;
}

export function decodePatch(encoded: string): Patch {
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length > MAX_PATCH_BYTES) {
    throw new Error('Invalid encoded patch: expected a non-empty bounded string');
  }
  const json = decompressFromEncodedURIComponent(encoded);
  if (typeof json !== 'string' || json.length === 0) throw new Error('Invalid encoded patch: decompression failed');
  if (new TextEncoder().encode(json).byteLength > MAX_PATCH_BYTES) throw new Error('Invalid encoded patch: exceeds the maximum size');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    throw new Error('Invalid encoded patch: malformed JSON');
  }
  return validatePatch(parsed);
}

export function createShareUrl(patch: Patch, href?: string): string {
  const base = href ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  if (!base) throw new Error('Cannot create a share URL without a page URL');
  const url = new URL(base);
  url.hash = `patch=${encodePatch(patch)}`;
  return url.toString();
}

export function readSharedPatch(hash?: string): Patch | null {
  const fragment = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  if (!fragment) return null;
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);
  const encoded = params.get('patch');
  if (encoded === null) return null;
  return decodePatch(encoded);
}

function getStorage(): Storage {
  try {
    if (typeof localStorage === 'undefined') throw new Error('Local storage is unavailable');
    return localStorage;
  } catch (error) {
    throw new Error(`Saved patches are unavailable: ${error instanceof Error ? error.message : 'storage access failed'}`);
  }
}

function readStored(): SavedPatch[] {
  const storage = getStorage();
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error(`Could not read saved patches: ${error instanceof Error ? error.message : 'storage access failed'}`);
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Could not read saved patches: stored data is malformed');
  }
  if (!Array.isArray(parsed) || parsed.length > 256) throw new Error('Could not read saved patches: stored list is invalid');
  const saved = parsed.map((item, index): SavedPatch => {
    const path = `saved[${index}]`;
    const entry = record(item, path);
    exactKeys(entry, ['id', 'name', 'savedAt', 'patch'], path);
    const savedAt = string(entry.savedAt, `${path}.savedAt`, 40);
    if (!Number.isFinite(Date.parse(savedAt))) fail(`${path}.savedAt`, 'expected a valid date');
    return {
      id: id(entry.id, `${path}.id`),
      name: string(entry.name, `${path}.name`, 120),
      savedAt,
      patch: validatePatch(entry.patch),
    };
  });
  assertUnique(saved.map((item) => item.id), 'saved patches');
  return saved;
}

function writeStored(saved: SavedPatch[]): void {
  try {
    getStorage().setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    throw new Error(`Could not save patches: ${error instanceof Error ? error.message : 'storage write failed'}`);
  }
}

export function listSavedPatches(): SavedPatch[] {
  return readStored();
}

export function savePatch(patch: Patch): SavedPatch {
  const validated = validatePatch(patch);
  const saved: SavedPatch = {
    id: validated.id,
    name: validated.name,
    savedAt: new Date().toISOString(),
    patch: validated,
  };
  const existing = readStored().filter((item) => item.id !== saved.id);
  writeStored([saved, ...existing].slice(0, 256));
  return saved;
}

export function deleteSavedPatch(savedId: string): void {
  const target = id(savedId, 'saved patch id');
  const remaining = readStored().filter((item) => item.id !== target);
  writeStored(remaining);
}

export function exportPatch(patch: Patch): string {
  return JSON.stringify(validatePatch(patch), null, 2);
}

export function importPatch(text: string): Patch {
  if (typeof text !== 'string' || text.length === 0 || new TextEncoder().encode(text).byteLength > MAX_PATCH_BYTES) {
    throw new Error('Invalid patch file: expected non-empty bounded JSON');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid patch file: malformed JSON');
  }
  return validatePatch(parsed);
}
