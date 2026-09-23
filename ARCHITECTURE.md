# Patchbay implementation contract

Start recorded: 2026-09-23T04:57:45Z. Private repository; no deployment tonight.

React + TypeScript + Vite, static base `/patchbay-chatgpt/`. No remote runtime dependencies, fonts, samples, or services. Source definitions in `src/types.ts` and module registry in `src/modules.ts` are shared interfaces. Lead owns App/UI composition, presets, integration, verification and reporting.

## Engine contract — `src/audio/engine.ts`

Export class `AudioEngine`. `new AudioEngine()`; `async start(patch: Patch): Promise<void>` enables context via a gesture, applies patch and starts transport for bass/ambient; `setPatch(patch: Patch): void` smoothly updates live patch; `setPlaying(playing: boolean): void`; `noteOn(note: number, velocity?: number): void`; `noteOff(note: number): void`; `panic(): void` stops all sound including effect tails and transport; `getSnapshot(): EngineSnapshot`; `getAnalyser(moduleId?: string): AnalyserNode | null` selected module's actual output (default master); `async startRecording(): Promise<void>`; `async stopRecording(): Promise<RecordingResult>`; `dispose(): void`. Methods safe before startup. Snapshot polled by UI at ~30Hz. Master volume stored in patch.master (0–0.8).

Audio and modulation connections must actually follow cable graph. Note/gate event routing also follows cables from keyboard/sequencer; implicit keyboard is not acceptable. 8-voice polyphony minimum for pads. Envelope -> amplifier gain is CV, LFO -> filter cutoff is CV. Graph edit crossfades; parameter edit ramps. Reject unsupported connections and cycles (including feedback; delay has internal bounded feedback). Module specs are canonical port names and ranges. Sequencer uses patch.steps (16), tempo, sequencer.params.rate (quarter=1, eighth=2, sixteenth=4), gate (0.1–0.95). Patch snapshots are immutable. Protect hearing via conservative gain, limiter, bounded values. No fake visualizer.

## Canvas contract — `src/components/PatchCanvas.tsx`

Props `{ patch: Patch; selectedId: string | null; onSelect: (id: string) => void; onChange: (patch: Patch) => void; onMessage: (message: string) => void; }`. Own `src/components/PatchCanvas.css`. Registry exported `MODULE_SPECS`, `createModule(type, x, y)`, `canConnect(patch, from, fromPort, to, toPort): {ok:boolean;reason?:string}`. Draggable nodes, pan/zoom/fit, add menu, editable parameters, accessible tap output then input to connect, visible removable cables, keyboard reachable controls. No React Flow dependency. Canvas positioned coordinates 220 wide nodes. UI parent can fit viewport freely. Canvas must use actual module/cable state, not art. Use CSS colors dark warm #151816 background, #222723 panel, cream #f1f0e8 text, muted #91988c, lime #d6ef8b, peach #f19b78, periwinkle #aabdf5.

## Storage contract — `src/storage.ts`

Export `validatePatch(input: unknown): Patch` throws descriptive error; `encodePatch(patch): string`; `decodePatch(encoded): Patch`; `createShareUrl(patch, href?: string): string` preserving origin/path/search and using fragment `#patch=...`; `readSharedPatch(hash?: string): Patch | null`; `listSavedPatches(): SavedPatch[]` with `{id,name,savedAt,patch}`; `savePatch(patch): SavedPatch`; `deleteSavedPatch(id): void`; `exportPatch(patch): string`; `importPatch(text): Patch`. Use lz-string URL safe compression. Size ceilings, strict validation, unknown type/port/cycle rejection, no prototype pollution. Save errors surfaced. Local storage key `patchbay.patches.v1`. Scope no network. Add meaningful Vitest tests.

All workers edit their owned files only, do not commit/push. Lead reviews and commits integrated milestones. Do not use Sites deployment tools. No automatic deployments or workflows.
