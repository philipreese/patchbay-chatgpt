export type ModuleType = 'oscillator' | 'noise' | 'filter' | 'envelope' | 'lfo' | 'amplifier' | 'mixer' | 'sequencer' | 'keyboard' | 'delay' | 'reverb' | 'output';
export type SignalType = 'audio' | 'cv' | 'note' | 'gate';
export interface PatchModule { id: string; type: ModuleType; x: number; y: number; params: Record<string, number | string>; }
export interface Cable { id: string; from: string; fromPort: string; to: string; toPort: string; }
export interface Step { note: number; active: boolean; velocity: number; }
export interface MacroMapping { moduleId: string; param: string; min: number; max: number; curve?: 'exp'; }
export interface Macro { id: string; name: string; description: string; value: number; mappings: MacroMapping[]; }
export interface Patch { version: 1; id: string; name: string; description: string; category: 'bass' | 'pad' | 'lead' | 'ambient' | 'custom'; tempo: number; master: number; modules: PatchModule[]; cables: Cable[]; steps: Step[]; macros: Macro[]; }
export interface Port { id: string; label: string; signal: SignalType; }
export interface ParamSpec { id: string; label: string; min: number; max: number; step: number; default: number | string; unit?: string; options?: string[]; scale?: 'log'; }
export interface ModuleSpec { name: string; short: string; description: string; color: string; inputs: Port[]; outputs: Port[]; params: ParamSpec[]; }
export interface EngineSnapshot { ready: boolean; playing: boolean; step: number; activeNotes: number[]; recording: boolean; recordingSeconds: number; contextState: string; }
export interface RecordingResult { blob: Blob; extension: string; duration: number; }
